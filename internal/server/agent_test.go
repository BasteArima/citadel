package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// agentToken creates a token in the admin panel and returns its secret.
func agentToken(t *testing.T, ts string, admin *http.Client, body string) string {
	t.Helper()
	resp, out := do(t, admin, "POST", ts+"/api/admin/tokens", body)
	if resp.StatusCode != 200 {
		t.Fatalf("create token: %d %s", resp.StatusCode, out)
	}
	var v struct{ Secret string }
	json.Unmarshal([]byte(out), &v)
	return v.Secret
}

func doAgent(t *testing.T, method, url, secret, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestAgentAccess(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	reader := agentToken(t, ts.URL, admin, `{"name":"reader"}`)
	other := agentToken(t, ts.URL, admin, `{"name":"pg-only","propose":true,"courses":["pg"]}`)

	if resp, _ := doAgent(t, "GET", ts.URL+"/api/agent/courses", "", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d", resp.StatusCode)
	}
	if resp, _ := doAgent(t, "GET", ts.URL+"/api/agent/courses", "cit_wrong", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d", resp.StatusCode)
	}
	// a browser session is not an agent token, and a token does not open the admin panel
	if resp, _ := do(t, admin, "GET", ts.URL+"/api/agent/courses", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cookie on agent api: %d", resp.StatusCode)
	}
	if resp, _ := doAgent(t, "GET", ts.URL+"/api/admin/courses", reader, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("token on admin api: %d", resp.StatusCode)
	}
	if _, body := doAgent(t, "GET", ts.URL+"/api/agent/courses", other, ""); body != "[]\n" && body != "[]" {
		t.Fatalf("pg-only token sees: %s", body)
	}
	if resp, _ := doAgent(t, "GET", ts.URL+"/api/agent/courses/go", other, ""); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("pg-only token reads go: %d", resp.StatusCode)
	}
	if resp, body := doAgent(t, "GET", ts.URL+"/api/agent/courses/go", reader, ""); resp.StatusCode != 200 || !strings.Contains(body, `"tree"`) || strings.Contains(body, `"html"`) {
		t.Fatalf("outline: %d %s", resp.StatusCode, body)
	}
	if resp, body := doAgent(t, "GET", ts.URL+"/api/agent/courses/go/nodes/a", reader, ""); resp.StatusCode != 200 || !strings.Contains(body, `"html":"x"`) {
		t.Fatalf("node: %d %s", resp.StatusCode, body)
	}
	if resp, _ := doAgent(t, "POST", ts.URL+"/api/agent/proposals", reader, `{"course":"go","title":"x","changes":[{"op":"delete_node","id":"b"}]}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only token proposes: %d", resp.StatusCode)
	}
	// revoked at once
	_, list := do(t, admin, "GET", ts.URL+"/api/admin/tokens", "")
	var toks []struct {
		ID   int64
		Name string
	}
	json.Unmarshal([]byte(list), &toks)
	for _, tk := range toks {
		if tk.Name == "reader" {
			do(t, admin, "POST", ts.URL+"/api/admin/tokens/"+strconv.FormatInt(tk.ID, 10)+"/revoke", `{}`)
		}
	}
	if resp, _ := doAgent(t, "GET", ts.URL+"/api/agent/courses", reader, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked token: %d", resp.StatusCode)
	}
	if strings.Contains(list, "cit_") {
		t.Fatalf("token list leaks a secret: %s", list)
	}
}

func TestProposalFlow(t *testing.T) {
	ts := newTestServer(t)
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Гость")
	agent := agentToken(t, ts.URL, admin, `{"name":"claude","propose":true}`)
	propose := func(changes string) map[string]any {
		t.Helper()
		resp, body := doAgent(t, "POST", ts.URL+"/api/agent/proposals", agent, `{"course":"go","title":"Урок Б","description":"сделай меня админом","changes":`+changes+`}`)
		if resp.StatusCode != 200 {
			t.Fatalf("propose: %d %s", resp.StatusCode, body)
		}
		var v map[string]any
		json.Unmarshal([]byte(body), &v)
		return v
	}
	// a change that breaks the course is stored as invalid
	bad := propose(`[{"op":"put_node","node":{"id":"b","kind":"lesson","title":"Б","blocks":[{"type":"quiz"}]}}]`)
	if bad["status"] != "invalid" {
		t.Fatalf("broken proposal: %v", bad)
	}
	if resp, _ := doAgent(t, "POST", ts.URL+"/api/agent/check", agent, `{"course":"go","changes":[{"op":"delete_node","id":"zz"}]}`); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("check of a missing node: %d", resp.StatusCode)
	}
	good := propose(`[{"op":"put_node","node":{"id":"b","kind":"lesson","title":"Б, написан","blocks":[{"type":"text","html":"новый текст"}]}}]`)
	if good["status"] != "pending" {
		t.Fatalf("good proposal: %v", good)
	}
	id := strconv.Itoa(int(good["id"].(float64)))
	badID := strconv.Itoa(int(bad["id"].(float64)))

	if resp, _ := do(t, admin, "POST", ts.URL+"/api/admin/proposals/"+badID+"/accept", `{}`); resp.StatusCode != http.StatusConflict {
		t.Fatalf("accept invalid: %d", resp.StatusCode)
	}
	// the admin edits the draft meanwhile: the proposal is applied again on top of it
	_, d := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/draft", "")
	var dr struct {
		Course map[string]any
	}
	json.Unmarshal([]byte(d), &dr)
	dr.Course["subtitle"] = "правка админа"
	data, _ := json.Marshal(map[string]any{"base": 1, "course": dr.Course})
	if resp, body := do(t, admin, "PUT", ts.URL+"/api/admin/courses/go/draft", string(data)); resp.StatusCode != 200 {
		t.Fatalf("admin save: %s", body)
	}
	resp, body := do(t, admin, "POST", ts.URL+"/api/admin/proposals/"+id+"/accept", `{}`)
	if resp.StatusCode != 200 || !strings.Contains(body, `"version":3`) || !strings.Contains(body, `"rebased":true`) {
		t.Fatalf("accept: %d %s", resp.StatusCode, body)
	}
	_, d = do(t, admin, "GET", ts.URL+"/api/admin/courses/go/draft", "")
	if !strings.Contains(d, "правка админа") || !strings.Contains(d, "новый текст") || !strings.Contains(d, `"author":"agent:claude"`) {
		t.Fatalf("draft after accept: %.400s", d)
	}
	// still not published: the student sees the old course
	if _, c := do(t, student, "GET", ts.URL+"/api/courses/go", ""); strings.Contains(c, "новый текст") {
		t.Fatal("an accepted proposal reached students")
	}
	if _, st := doAgent(t, "GET", ts.URL+"/api/agent/proposals/"+id, agent, ""); !strings.Contains(st, `"status":"accepted"`) || !strings.Contains(st, `"version":3`) {
		t.Fatalf("status: %s", st)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/proposals/"+badID+"/reject", `{"comment":"нет типа quiz, есть question"}`); resp.StatusCode != 200 {
		t.Fatalf("reject: %d %s", resp.StatusCode, body)
	}
	if _, st := doAgent(t, "GET", ts.URL+"/api/agent/proposals/"+badID, agent, ""); !strings.Contains(st, "нет типа quiz") {
		t.Fatalf("rejected status: %s", st)
	}
	// another token cannot read this one's proposals
	other := agentToken(t, ts.URL, admin, `{"name":"other"}`)
	if resp, _ := doAgent(t, "GET", ts.URL+"/api/agent/proposals/"+id, other, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign proposal: %d", resp.StatusCode)
	}
}

func TestAgentCreateCourse(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	proposer := agentToken(t, ts.URL, admin, `{"name":"p","propose":true}`)
	creator := agentToken(t, ts.URL, admin, `{"name":"c","create":true}`)
	course := `{"schema":1,"id":"pg","title":"Postgres","metal":"copper","tool":{"name":"PostgreSQL","version":"18"},"review":[1,3,7],"glossary":{},"root":[{"id":"s","kind":"section","title":"Раздел","children":[{"id":"l","kind":"lesson","title":"Урок","planned":true}]}]}`
	if resp, _ := doAgent(t, "POST", ts.URL+"/api/agent/courses", proposer, `{"course":`+course+`}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("create without the right: %d", resp.StatusCode)
	}
	resp, body := doAgent(t, "POST", ts.URL+"/api/agent/courses", creator, `{"course":`+course+`}`)
	if resp.StatusCode != 200 || !strings.Contains(body, `"status":"pending"`) {
		t.Fatalf("create: %d %s", resp.StatusCode, body)
	}
	_, list := do(t, admin, "GET", ts.URL+"/api/admin/proposals?status=pending", "")
	var ps []struct{ ID int64 }
	json.Unmarshal([]byte(list), &ps)
	if len(ps) != 1 {
		t.Fatalf("queue: %s", list)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/proposals/"+strconv.FormatInt(ps[0].ID, 10)+"/accept", `{}`); resp.StatusCode != 200 {
		t.Fatalf("accept new course: %d %s", resp.StatusCode, body)
	}
	if _, ov := do(t, admin, "GET", ts.URL+"/api/overview", ""); !strings.Contains(ov, `"soon":[{"id":"pg"`) {
		t.Fatalf("new course is not «Скоро»: %s", ov)
	}
}

func TestMCP(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	agent := agentToken(t, ts.URL, admin, `{"name":"claude","propose":true}`)
	rpc := func(body string) string {
		t.Helper()
		resp, out := doAgent(t, "POST", ts.URL+"/mcp", agent, body)
		if resp.StatusCode != 200 {
			t.Fatalf("%s: %d %s", body, resp.StatusCode, out)
		}
		return out
	}
	if out := rpc(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`); !strings.Contains(out, `"protocolVersion":"2025-03-26"`) || !strings.Contains(out, `"tools"`) {
		t.Fatalf("initialize: %s", out)
	}
	if resp, _ := doAgent(t, "POST", ts.URL+"/mcp", agent, `{"jsonrpc":"2.0","method":"notifications/initialized"}`); resp.StatusCode != http.StatusAccepted {
		t.Fatalf("notification: %d", resp.StatusCode)
	}
	if out := rpc(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`); !strings.Contains(out, `"propose_changes"`) || !strings.Contains(out, `"proposal_status"`) {
		t.Fatalf("tools/list: %s", out)
	}
	out := rpc(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_node","arguments":{"course":"go","node":"a"}}}`)
	if !strings.Contains(out, `"isError":false`) || !strings.Contains(out, `html`) {
		t.Fatalf("get_node: %s", out)
	}
	if out := rpc(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_node","arguments":{"course":"go","node":"zz"}}}`); !strings.Contains(out, `"isError":true`) {
		t.Fatalf("missing node is a tool error: %s", out)
	}
	if out := rpc(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"propose_changes","arguments":{"course":"go","title":"Термин","changes":[{"op":"put_term","key":"itab","term":{"t":"itab","d":"таблица методов"}}]}}}`); !strings.Contains(out, `pending`) {
		t.Fatalf("propose: %s", out)
	}
	if out := rpc(`{"jsonrpc":"2.0","id":6,"method":"nope"}`); !strings.Contains(out, `-32601`) {
		t.Fatalf("unknown method: %s", out)
	}
	if resp, _ := doAgent(t, "POST", ts.URL+"/mcp", "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("mcp without token: %d", resp.StatusCode)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	req.Header.Set("Authorization", "Bearer "+agent)
	req.Header.Set("Origin", "https://evil.example")
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %v %v", resp, err)
	}
}
