package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"citadel/internal/course"
	"citadel/internal/runner"
)

// Running course code on the server (decision 0013). Citadel never touches Docker: it sends the
// code to the runner service, which runs it in a throwaway container. Only admins and agents
// with the right to propose can run code; students only ever see saved outputs.

// runLocks allows one run at a time per admin or token.
type runLocks struct {
	mu   sync.Mutex
	busy map[string]bool
}

func (l *runLocks) take(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.busy == nil {
		l.busy = map[string]bool{}
	}
	if l.busy[key] {
		return false
	}
	l.busy[key] = true
	return true
}

func (l *runLocks) free(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.busy, key)
}

var runClient = &http.Client{Timeout: 90 * time.Second}

// runnerCall sends one request to the runner.
func (s *server) runnerCall(ctx context.Context, method, path string, body any, out any) error {
	if s.cfg.RunnerURL == "" {
		return errf(http.StatusServiceUnavailable, "running code is not set up on this server")
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.cfg.RunnerURL, "/")+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.RunnerSecret)
	req.Header.Set("Content-Type", "application/json")
	resp, err := runClient.Do(req)
	if err != nil {
		return errf(http.StatusServiceUnavailable, "runner is not reachable")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return errf(http.StatusTooManyRequests, "runner is busy, try again in a minute")
	}
	if resp.StatusCode != http.StatusOK {
		var e struct{ Error string }
		json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&e)
		return errf(http.StatusBadGateway, "runner: "+e.Error)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// runnerTools lists the course tools the runner can run, e.g. ["Go"]; nil if running is off.
func (s *server) runnerTools(ctx context.Context) []string {
	var list []struct{ Tool string }
	if err := s.runnerCall(ctx, "GET", "/tools", nil, &list); err != nil {
		return nil
	}
	out := []string{}
	for _, t := range list {
		out = append(out, t.Tool)
	}
	return out
}

type runArgs struct {
	Course string `json:"course"`
	File   string `json:"file"`
	Code   string `json:"code"`
}

// runFor runs code with the toolchain of the course's tool, one run at a time per caller.
func (s *server) runFor(ctx context.Context, who string, c *course.Course, file, code string) (runner.Result, error) {
	if file == "" {
		file = c.Tool.File
	}
	if file == "" {
		file = "main.go"
	}
	if !s.runs.take(who) {
		return runner.Result{}, errf(http.StatusTooManyRequests, "a run of yours is still going: wait for it to finish")
	}
	defer s.runs.free(who)
	var res runner.Result
	err := s.runnerCall(ctx, "POST", "/run", runner.Request{Tool: c.Tool.Name, File: file, Code: code}, &res)
	return res, err
}

func (s *server) runRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/admin/runner", s.admin(func(w http.ResponseWriter, r *http.Request) {
		tools := s.runnerTools(r.Context())
		writeValue(w, map[string]any{"available": tools != nil, "tools": tools})
	}))
	mux.Handle("POST /api/admin/run", s.admin(func(w http.ResponseWriter, r *http.Request) {
		var req runArgs
		if !readJSON(w, r, &req, 512<<10) {
			return
		}
		data, _, err := s.cfg.Store.Version(r.Context(), req.Course, 0)
		if s.notFound(w, err, "read course") {
			return
		}
		c, err := course.Decode(data)
		if err != nil {
			jsonError(w, http.StatusUnprocessableEntity, "course: "+err.Error())
			return
		}
		res, err := s.runFor(r.Context(), "user:"+strconv.FormatInt(userFrom(r.Context()).ID, 10), c, req.File, req.Code)
		if err != nil {
			s.agentFail(w, err)
			return
		}
		writeValue(w, res)
	}))
	mux.Handle("POST /api/agent/run", s.agentAPI(func(ctx context.Context, r *http.Request) (any, error) {
		var req runArgs
		if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 512<<10)).Decode(&req); err != nil {
			return nil, errf(http.StatusBadRequest, "bad request: "+err.Error())
		}
		return s.agentRun(ctx, req)
	}))
}

// agentRun lets an agent check its code before proposing it.
func (s *server) agentRun(ctx context.Context, req runArgs) (any, error) {
	t := tokenFrom(ctx)
	if !t.CanPropose {
		return nil, errf(http.StatusForbidden, "running code needs the right to propose changes")
	}
	c, _, err := s.latest(ctx, req.Course)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Code) == "" {
		return nil, errf(http.StatusBadRequest, "code is empty")
	}
	return s.runFor(ctx, "token:"+strconv.FormatInt(t.ID, 10), c, req.File, req.Code)
}

// predictRun is the result of running one «predict» block of a proposal.
type predictRun struct {
	Node     string `json:"node"`
	Block    int    `json:"block"`  // index in the node's blocks
	Status   string `json:"status"` // match, differs, error
	Expected string `json:"expected"`
	Got      string `json:"got,omitempty"`
	Version  string `json:"version,omitempty"`
	Error    string `json:"error,omitempty"`
}

const maxProposalRuns = 8

// verifyProposal runs the «predict» blocks a proposal adds or changes and stores the results.
// It runs in the background after the proposal is queued; a busy runner is retried a few times.
func (s *server) verifyProposal(id int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	p, err := s.cfg.Store.Proposal(ctx, id)
	if err != nil {
		s.log.Error("verify proposal", "id", id, "err", err)
		return
	}
	after, err := course.Decode(p.Data)
	if err != nil {
		return
	}
	var base *course.Course
	if !p.NewCourse {
		if data, _, err := s.cfg.Store.Version(ctx, p.CourseID, p.Base); err == nil {
			base, _ = course.Decode(data)
		}
	}
	runs := []predictRun{}
	after.Walk(func(n *course.Node, _ *course.Node) {
		for i, b := range n.Blocks {
			if b.Type() != "predict" || len(runs) >= maxProposalRuns || unchangedBlock(base, n.ID, b) {
				continue
			}
			code, _ := b["code"].(string)
			file, _ := b["file"].(string)
			out, _ := b["out"].(string)
			pr := predictRun{Node: n.ID, Block: i, Expected: out}
			res, err := s.runRetry(ctx, after, file, code)
			if err != nil {
				pr.Status, pr.Error = "error", err.Error()
			} else {
				pr.Got, pr.Version = res.Output, res.Version
				pr.Status = "differs"
				if sameOutput(res.Output, out) {
					pr.Status = "match"
				}
				if res.TimedOut {
					pr.Status, pr.Error = "error", "время вышло"
				}
			}
			runs = append(runs, pr)
		}
	})
	data, _ := json.Marshal(runs)
	if err := s.cfg.Store.SetProposalRuns(ctx, id, data); err != nil {
		s.log.Error("save proposal runs", "id", id, "err", err)
	}
	s.log.Info("proposal verified", "id", id, "runs", len(runs))
}

func (s *server) runRetry(ctx context.Context, c *course.Course, file, code string) (runner.Result, error) {
	for try := 0; ; try++ {
		res, err := s.runFor(ctx, "verify", c, file, code)
		var ae *agentErr
		if err == nil || !errors.As(err, &ae) || ae.status != http.StatusTooManyRequests || try == 4 {
			return res, err
		}
		select {
		case <-ctx.Done():
			return res, ctx.Err()
		case <-time.After(20 * time.Second):
		}
	}
}

// unchangedBlock reports whether the base course has the same block in the same node.
func unchangedBlock(base *course.Course, nodeID string, b course.Block) bool {
	if base == nil {
		return false
	}
	n := base.FindNode(nodeID)
	if n == nil {
		return false
	}
	want, _ := json.Marshal(b)
	for _, ob := range n.Blocks {
		if got, _ := json.Marshal(ob); bytes.Equal(got, want) {
			return true
		}
	}
	return false
}

// sameOutput compares outputs ignoring trailing spaces and blank lines at the end.
func sameOutput(a, b string) bool {
	norm := func(s string) string {
		lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
		for i, l := range lines {
			lines[i] = strings.TrimRight(l, " \t")
		}
		return strings.TrimRight(strings.Join(lines, "\n"), "\n")
	}
	return norm(a) == norm(b)
}
