package runner

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const secret = "test-runner-secret-0123456789"

// fakeDocker answers the calls a run makes and remembers them.
type fakeDocker struct {
	mu      sync.Mutex
	calls   []string
	created map[string]any
	logs    []byte
}

func frame(stream byte, s string) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(s)))
	return append(h, s...)
}

func (f *fakeDocker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	f.mu.Unlock()
	switch {
	case strings.HasSuffix(r.URL.Path, "/containers/create"):
		json.NewDecoder(r.Body).Decode(&f.created)
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"Id":"c1"}`))
	case strings.HasSuffix(r.URL.Path, "/wait"):
		w.Write([]byte(`{"StatusCode":2}`))
	case strings.HasSuffix(r.URL.Path, "/logs"):
		w.Write(f.logs)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func newRunner(t *testing.T, f *fakeDocker) *httptest.Server {
	t.Helper()
	dsrv := httptest.NewServer(f)
	t.Cleanup(dsrv.Close)
	d, err := NewDocker("tcp://" + strings.TrimPrefix(dsrv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Docker: d, Secret: secret, Tools: map[string]Toolchain{"Go": Go}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rs := httptest.NewServer(s.Handler())
	t.Cleanup(rs.Close)
	return rs
}

func post(t *testing.T, url, auth, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest("POST", url, strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", "Bearer "+auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestRun(t *testing.T) {
	f := &fakeDocker{logs: append(frame(2, "@@version Go 1.27.3\n"), frame(1, "panic: boom\n\nexit status 2\n")...)}
	rs := newRunner(t, f)
	code := `package main; func main() { panic("boom") } // $(rm -rf /) "quotes"`
	body, _ := json.Marshal(Request{Tool: "Go", File: "main.go", Code: code})
	resp, out := post(t, rs.URL+"/run", secret, string(body))
	if resp.StatusCode != 200 {
		t.Fatalf("run: %d %s", resp.StatusCode, out)
	}
	var res Result
	json.Unmarshal([]byte(out), &res)
	if res.Output != "panic: boom\n\nexit status 2\n" || res.ExitCode != 2 || res.Version != "Go 1.27.3" {
		t.Fatalf("result: %+v", res)
	}
	// the container is always removed
	if last := f.calls[len(f.calls)-1]; last != "DELETE /containers/c1" {
		t.Fatalf("calls: %v", f.calls)
	}
	// isolation is set by the runner, and the code never becomes part of the shell script
	host := f.created["HostConfig"].(map[string]any)
	cmd, _ := json.Marshal(f.created["Cmd"])
	checks := map[string]bool{
		"no network":       host["NetworkMode"] == "none" && f.created["NetworkDisabled"] == true,
		"read-only root":   host["ReadonlyRootfs"] == true,
		"not privileged":   host["Privileged"] == false,
		"no capabilities":  len(host["CapDrop"].([]any)) == 1 && host["CapDrop"].([]any)[0] == "ALL",
		"no new privs":     host["SecurityOpt"].([]any)[0] == "no-new-privileges",
		"no binds":         len(host["Binds"].([]any)) == 0,
		"pids limit":       host["PidsLimit"].(float64) == 64,
		"non-root user":    f.created["User"] == "65534:65534",
		"code not in Cmd":  !strings.Contains(string(cmd), "rm -rf") && !strings.Contains(string(cmd), "boom"),
		"code in env only": strings.Contains(strings.Join(toStrings(f.created["Env"]), "\n"), "CODE="+code),
	}
	for name, ok := range checks {
		if !ok {
			t.Errorf("%s: %+v", name, f.created)
		}
	}
}

func toStrings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func TestRunRejects(t *testing.T) {
	rs := newRunner(t, &fakeDocker{})
	ok, _ := json.Marshal(Request{Tool: "Go", File: "main.go", Code: "package main"})
	if resp, _ := post(t, rs.URL+"/run", "", string(ok)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no secret: %d", resp.StatusCode)
	}
	if resp, _ := post(t, rs.URL+"/run", "wrong", string(ok)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("wrong secret: %d", resp.StatusCode)
	}
	for _, req := range []Request{
		{Tool: "Rust", File: "main.go", Code: "x"},
		{Tool: "Go", File: "../etc/passwd", Code: "x"},
		{Tool: "Go", File: "main.go; rm -rf /", Code: "x"},
		{Tool: "Go", File: "main.go", Code: ""},
	} {
		b, _ := json.Marshal(req)
		if resp, _ := post(t, rs.URL+"/run", secret, string(b)); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%+v: %d", req, resp.StatusCode)
		}
	}
}

func TestLogsLimit(t *testing.T) {
	f := &fakeDocker{logs: frame(1, strings.Repeat("x", 5000))}
	d, _ := NewDocker("tcp://" + strings.TrimPrefix(httptest.NewServer(f).URL, "http://"))
	out, truncated, err := d.Logs(t.Context(), "c1", 1000)
	if err != nil || len(out) != 1000 || !truncated {
		t.Fatalf("logs: %d %v %v", len(out), truncated, err)
	}
}
