package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"citadel/internal/runner"
)

const runnerSecret = "fake-runner-secret-0123456789"

// fakeRunner answers like the runner: the output is the code reversed, so tests can tell runs apart.
func fakeRunner(t *testing.T) *httptest.Server {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+runnerSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/tools" {
			w.Write([]byte(`[{"tool":"Go","image":"golang:1.27-alpine"}]`))
			return
		}
		var req runner.Request
		json.NewDecoder(r.Body).Decode(&req)
		out := "ran " + req.Tool + " " + req.File + ": " + req.Code
		if strings.Contains(req.Code, "fmt.Println(42)") {
			out = "42\n"
		}
		json.NewEncoder(w).Encode(runner.Result{Output: out, Version: "Go 1.27.3"})
	}))
	t.Cleanup(ts.Close)
	return ts
}

func runServer(t *testing.T) *httptest.Server {
	rs := fakeRunner(t)
	return newTestServerWith(t, func(c *Config) { c.RunnerURL, c.RunnerSecret = rs.URL, runnerSecret })
}

func TestAdminRun(t *testing.T) {
	ts := runServer(t)
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Гость")
	if _, body := do(t, admin, "GET", ts.URL+"/api/admin/runner", ""); !strings.Contains(body, `"available":true`) || !strings.Contains(body, `"Go"`) {
		t.Fatalf("runner info: %s", body)
	}
	resp, body := do(t, admin, "POST", ts.URL+"/api/admin/run", `{"course":"go","code":"package main"}`)
	if resp.StatusCode != 200 || !strings.Contains(body, `"output":"ran Go main.go: package main"`) || !strings.Contains(body, `"version":"Go 1.27.3"`) {
		t.Fatalf("admin run: %d %s", resp.StatusCode, body)
	}
	// students never run code
	if resp, _ := do(t, student, "POST", ts.URL+"/api/admin/run", `{"course":"go","code":"package main"}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("student run: %d", resp.StatusCode)
	}
	// without a runner the button is off and a run says so
	off := newTestServer(t)
	a2 := signIn(t, off, "Baste")
	if _, body := do(t, a2, "GET", off.URL+"/api/admin/runner", ""); !strings.Contains(body, `"available":false`) {
		t.Fatalf("runner off: %s", body)
	}
	if resp, _ := do(t, a2, "POST", off.URL+"/api/admin/run", `{"course":"go","code":"x"}`); resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("run without runner: %d", resp.StatusCode)
	}
}

func TestAgentRunAndVerify(t *testing.T) {
	ts := runServer(t)
	admin := signIn(t, ts, "Baste")
	reader := agentToken(t, ts.URL, admin, `{"name":"reader"}`)
	agent := agentToken(t, ts.URL, admin, `{"name":"claude","propose":true,"review":true}`)
	if resp, _ := doAgent(t, "POST", ts.URL+"/api/agent/run", reader, `{"course":"go","code":"package main"}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only token runs code: %d", resp.StatusCode)
	}
	if resp, body := doAgent(t, "POST", ts.URL+"/api/agent/run", agent, `{"course":"go","code":"package main"}`); resp.StatusCode != 200 || !strings.Contains(body, "ran Go") {
		t.Fatalf("agent run: %d %s", resp.StatusCode, body)
	}
	// a proposal with two «predict» blocks: one output right, one wrong
	node := `{"id":"b","kind":"lesson","title":"Б","blocks":[` +
		`{"type":"predict","code":"package main\nfunc main() { fmt.Println(42) }","out":"42"},` +
		`{"type":"predict","code":"package main // other","out":"7"}]}`
	resp, body := doAgent(t, "POST", ts.URL+"/api/agent/proposals", agent, `{"course":"go","title":"Предскажи","changes":[{"op":"put_node","node":`+node+`}]}`)
	if resp.StatusCode != 200 {
		t.Fatalf("propose: %d %s", resp.StatusCode, body)
	}
	var p struct{ ID int64 }
	json.Unmarshal([]byte(body), &p)
	var runs []predictRun
	for i := 0; i < 50 && len(runs) == 0; i++ {
		time.Sleep(20 * time.Millisecond)
		_, body = do(t, admin, "GET", ts.URL+"/api/admin/proposals/"+strconv.FormatInt(p.ID, 10), "")
		var out struct{ Proposal struct{ Runs []predictRun } }
		json.Unmarshal([]byte(body), &out)
		runs = out.Proposal.Runs
	}
	if len(runs) != 2 || runs[0].Status != "match" || runs[1].Status != "differs" || runs[1].Expected != "7" {
		t.Fatalf("runs: %+v", runs)
	}
	if resp, body := doAgent(t, "POST", ts.URL+"/api/agent/proposals/"+strconv.FormatInt(p.ID, 10)+"/accept", agent, `{}`); resp.StatusCode != http.StatusConflict {
		t.Fatalf("reviewer accepted own proposal with differing output: %d %s", resp.StatusCode, body)
	}
}

func TestVerifyMarksBlocksOverLimit(t *testing.T) {
	ts := runServer(t)
	admin := signIn(t, ts, "Baste")
	agent := agentToken(t, ts.URL, admin, `{"name":"claude","propose":true}`)
	const total = maxProposalRuns + 2
	blocks := make([]string, total)
	for i := range blocks {
		blocks[i] = `{"type":"predict","code":"package main\nfunc main() { fmt.Println(42) } // ` + strconv.Itoa(i) + `","out":"42"}`
	}
	node := `{"id":"b","kind":"lesson","title":"Б","blocks":[` + strings.Join(blocks, ",") + `]}`
	resp, body := doAgent(t, "POST", ts.URL+"/api/agent/proposals", agent, `{"course":"go","title":"Много","changes":[{"op":"put_node","node":`+node+`}]}`)
	if resp.StatusCode != 200 {
		t.Fatalf("propose: %d %s", resp.StatusCode, body)
	}
	var p struct{ ID int64 }
	json.Unmarshal([]byte(body), &p)
	var runs []predictRun
	for i := 0; i < 100 && len(runs) == 0; i++ {
		time.Sleep(20 * time.Millisecond)
		_, body = do(t, admin, "GET", ts.URL+"/api/admin/proposals/"+strconv.FormatInt(p.ID, 10), "")
		var out struct{ Proposal struct{ Runs []predictRun } }
		json.Unmarshal([]byte(body), &out)
		runs = out.Proposal.Runs
	}
	if len(runs) != total {
		t.Fatalf("runs: %d, want %d: every changed block is listed", len(runs), total)
	}
	for i, r := range runs {
		want := "match"
		if i >= maxProposalRuns {
			want = "skipped"
		}
		if r.Status != want || r.Block != i {
			t.Fatalf("run %d: %+v, want status %s", i, r, want)
		}
	}
	// the queue a reviewer reads says so too
	reviewer := agentToken(t, ts.URL, admin, `{"name":"reviewer","review":true}`)
	if resp, body := doAgent(t, "GET", ts.URL+"/api/agent/queue", reviewer, ""); resp.StatusCode != 200 || !strings.Contains(body, `"skipped":2`) {
		t.Fatalf("queue: %d %s", resp.StatusCode, body)
	}
}

func TestSameOutput(t *testing.T) {
	if !sameOutput("a  \nb\n\n", "a\nb") || sameOutput("a\nb", "a\nc") {
		t.Fatal("sameOutput")
	}
}
