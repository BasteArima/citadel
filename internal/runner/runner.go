// Package runner runs course code in throwaway containers (decision 0013).
//
// The runner is a small service of its own (`citadel runner`). Citadel sends it only the code,
// the file name and the toolchain name; the runner builds the container config itself, so a
// compromised Citadel cannot ask for a privileged container or a mounted volume. Every run gets
// a fresh container with no network, no volumes, a read-only root, a non-root user, no
// capabilities and hard limits on memory, processes, CPU, disk, output and time.
package runner

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Toolchain is how code of one course tool is run.
type Toolchain struct {
	Tool    string // course tool name, as in the course passport: Go
	Image   string // container image, pulled in advance: the runner never pulls
	Version string // what is reported back, e.g. «Go 1.27.3»
	// Script runs in /bin/sh inside the container. The code is in $CODE, the file name in $FILE;
	// neither is ever put into the script text, so no part of a course reaches the shell.
	Script string
}

// Go builds and runs one file with `go run`. Output is capped by head; pipefail keeps the exit code.
var Go = Toolchain{
	Tool:  "Go",
	Image: "golang:1.27-alpine",
	Script: `set -o pipefail
mkdir -p /tmp/w && cd /tmp/w
printf '%s' "$CODE" > "$FILE"
echo "@@version Go $(go env GOVERSION | sed 's/^go//')" >&2
go run "$FILE" 2>&1 | head -c ` + maxOutputStr,
}

const (
	maxOutput    = 64 << 10
	maxOutputStr = "65536"
	maxCode      = 256 << 10
	runTimeout   = 60 * time.Second
	maxParallel  = 2
)

// Request is one run.
type Request struct {
	Tool string `json:"tool"`
	File string `json:"file"`
	Code string `json:"code"`
}

// Result is what came out.
type Result struct {
	Output    string `json:"output"`
	ExitCode  int    `json:"exitCode"`
	TimedOut  bool   `json:"timedOut"`
	Truncated bool   `json:"truncated"`
	Version   string `json:"version"` // the tool version the output was obtained on
	Millis    int64  `json:"ms"`
}

var fileRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}\.[a-z]{1,5}$`)

// Server is the runner's HTTP side.
type Server struct {
	Docker  *Docker
	Secret  string
	Runtime string // container runtime, e.g. runsc (gVisor); empty — Docker's default
	Tools   map[string]Toolchain
	Log     *slog.Logger
	slots   chan struct{}
}

// Handler serves GET /tools and POST /run, both behind the shared secret.
func (s *Server) Handler() http.Handler {
	s.slots = make(chan struct{}, maxParallel)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /tools", s.auth(func(w http.ResponseWriter, r *http.Request) {
		var out []map[string]string
		for _, t := range s.Tools {
			out = append(out, map[string]string{"tool": t.Tool, "image": t.Image})
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("POST /run", s.auth(s.run))
	return mux
}

func (s *Server) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		a, b := sha256.Sum256([]byte(got)), sha256.Sum256([]byte(s.Secret))
		if s.Secret == "" || subtle.ConstantTimeCompare(a[:], b[:]) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "runner secret required"})
			return
		}
		h(w, r)
	}
}

func (s *Server) run(w http.ResponseWriter, r *http.Request) {
	var req Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxCode+4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
		return
	}
	tc, ok := s.Tools[req.Tool]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no toolchain for " + req.Tool})
		return
	}
	if !fileRe.MatchString(req.File) || len(req.Code) == 0 || len(req.Code) > maxCode {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad file name or code"})
		return
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "runner is busy, try again in a minute"})
		return
	}
	res, err := s.Run(r.Context(), tc, req)
	if err != nil {
		s.Log.Error("run", "tool", req.Tool, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "run failed: " + err.Error()})
		return
	}
	s.Log.Info("run", "tool", req.Tool, "exit", res.ExitCode, "timeout", res.TimedOut, "ms", res.Millis)
	writeJSON(w, http.StatusOK, res)
}

// Config is the container config of one run. It is built here and nowhere else.
func (s *Server) Config(tc Toolchain, req Request) map[string]any {
	host := map[string]any{
		"NetworkMode":    "none",
		"ReadonlyRootfs": true,
		"Tmpfs":          map[string]string{"/tmp": "rw,exec,nosuid,nodev,size=384m"},
		"Memory":         int64(768 << 20), // the tmpfs counts against it too: a cold build of net/http needs ~200 MB of it
		"MemorySwap":     int64(768 << 20),
		"PidsLimit":      int64(64),
		"NanoCpus":       int64(1e9),
		"CapDrop":        []string{"ALL"},
		"SecurityOpt":    []string{"no-new-privileges"},
		"Privileged":     false,
		"Binds":          []string{},
		"Mounts":         []any{},
		"LogConfig":      map[string]any{"Type": "json-file", "Config": map[string]string{"max-size": "1m", "max-file": "1"}},
		"Ulimits":        []map[string]any{{"Name": "nofile", "Soft": 256, "Hard": 256}, {"Name": "fsize", "Soft": 64 << 20, "Hard": 64 << 20}},
	}
	if s.Runtime != "" {
		host["Runtime"] = s.Runtime
	}
	return map[string]any{
		"Image":           tc.Image,
		"Cmd":             []string{"/bin/sh", "-c", tc.Script},
		"Env":             []string{"CODE=" + req.Code, "FILE=" + req.File, "HOME=/tmp", "GOCACHE=/tmp/cache", "GOPATH=/tmp/gopath", "GOTOOLCHAIN=local", "GOFLAGS=-mod=mod", "CGO_ENABLED=0", "GOPROXY=off"},
		"User":            "65534:65534",
		"WorkingDir":      "/tmp",
		"NetworkDisabled": true,
		"AttachStdout":    false,
		"AttachStderr":    false,
		"Labels":          map[string]string{"citadel.run": "1"},
		"HostConfig":      host,
	}
}

// Run executes one request in a fresh container and always removes it.
func (s *Server) Run(ctx context.Context, tc Toolchain, req Request) (Result, error) {
	start := time.Now()
	id, err := s.Docker.Create(ctx, s.Config(tc, req))
	if err != nil {
		return Result{}, err
	}
	defer func() {
		// a fresh context: the request may be gone, the container must still go
		rc, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.Docker.Remove(rc, id); err != nil {
			s.Log.Error("remove container", "id", id, "err", err)
		}
	}()
	if err := s.Docker.Start(ctx, id); err != nil {
		return Result{}, err
	}
	wctx, cancel := context.WithTimeout(ctx, runTimeout)
	defer cancel()
	code, err := s.Docker.Wait(wctx, id)
	res := Result{}
	if errors.Is(err, context.DeadlineExceeded) {
		res.TimedOut = true
		kctx, kcancel := context.WithTimeout(context.Background(), 10*time.Second)
		s.Docker.Kill(kctx, id)
		kcancel()
	} else if err != nil {
		return Result{}, err
	}
	res.ExitCode = code
	out, truncated, err := s.Docker.Logs(context.Background(), id, maxOutput+1024)
	if err != nil {
		return Result{}, err
	}
	res.Output, res.Version = splitVersion(out, tc)
	res.Truncated = truncated || len(res.Output) >= maxOutput
	res.Millis = time.Since(start).Milliseconds()
	return res, nil
}

// splitVersion takes the «@@version …» line the script prints first out of the output.
func splitVersion(out string, tc Toolchain) (string, string) {
	version := tc.Version
	var keep []string
	for _, ln := range strings.SplitAfter(out, "\n") {
		if v, ok := strings.CutPrefix(ln, "@@version "); ok && version == "" {
			version = strings.TrimSpace(v)
			continue
		}
		keep = append(keep, ln)
	}
	return strings.Join(keep, ""), version
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
