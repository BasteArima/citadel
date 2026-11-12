package server

import (
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"citadel/internal/course"
	"citadel/internal/store"
)

// Every registered admin route must have an explicit policy here. Course routes
// also run the same positive/negative requests against three ownership states.
var adminPolicies = map[string]string{
	"GET /api/admin/courses":                    "staff",
	"POST /api/admin/courses":                   "staff",
	"DELETE /api/admin/courses/{id}":            "staffCourse",
	"POST /api/admin/import":                    "staff",
	"POST /api/admin/check":                     "staff",
	"GET /api/admin/courses/{id}/draft":         "staffCourse",
	"PUT /api/admin/courses/{id}/draft":         "staffCourse",
	"POST /api/admin/courses/{id}/publish":      "staffCourse",
	"POST /api/admin/courses/{id}/rollback":     "staffCourse",
	"GET /api/admin/courses/{id}/versions":      "staffCourse",
	"GET /api/admin/courses/{id}/versions/{v}":  "staffCourse",
	"GET /api/admin/audit":                      "admin",
	"GET /api/admin/courses/{id}/users":         "admin",
	"PUT /api/admin/courses/{id}/users":         "admin",
	"GET /api/admin/users":                      "admin",
	"PUT /api/admin/users/{id}":                 "admin",
	"PUT /api/admin/users/{id}/disabled":        "admin",
	"PUT /api/admin/users/{id}/courses":         "admin",
	"PUT /api/admin/courses/{id}/access":        "admin",
	"PUT /api/admin/courses/{id}/owner":         "admin",
	"PUT /api/admin/users/{id}/course-limit":    "admin",
	"GET /api/admin/tokens":                     "staff",
	"POST /api/admin/tokens":                    "staff",
	"POST /api/admin/tokens/{id}/revoke":        "staffToken",
	"POST /api/admin/tokens/{id}/review":        "staffToken",
	"DELETE /api/admin/tokens/{id}":             "staffToken",
	"GET /api/admin/proposals":                  "staff",
	"GET /api/admin/proposals/{id}":             "staff",
	"POST /api/admin/proposals/{id}/accept":     "staff",
	"POST /api/admin/proposals/{id}/reject":     "staff",
	"GET /api/admin/courses/{id}/audio":         "staffCourse",
	"POST /api/admin/courses/{id}/audio":        "staffCourse",
	"POST /api/admin/courses/{id}/audio/cancel": "staffCourse",
	"POST /api/admin/speech/preview":            "staff",
	"GET /api/admin/runner":                     "staff",
	"POST /api/admin/run":                       "staff",
	"GET /api/admin/invites":                    "admin",
	"POST /api/admin/invites":                   "admin",
	"POST /api/admin/invites/{id}/revoke":       "admin",
	"DELETE /api/admin/invites/{id}":            "admin",
	"POST /api/admin/users/{id}/reset-link":     "admin",
}

type authorFixture struct {
	ts                            *httptest.Server
	st                            *store.Store
	admin, author, other, student *http.Client
	user, otherUser               store.User
}

func authorServer(t *testing.T, tune ...func(*Config)) authorFixture {
	t.Helper()
	rs := fakeRunner(t)
	ts := newTestServerWith(t, func(c *Config) {
		c.Synth = &fakeSynth{}
		c.AudioDir = t.TempDir()
		c.RunnerURL, c.RunnerSecret = rs.URL, runnerSecret
		for _, change := range tune {
			change(c)
		}
	})
	value, _ := testStores.Load(ts.URL)
	f := authorFixture{ts: ts, st: value.(*store.Store)}
	f.admin, f.author, f.other, f.student = signIn(t, ts, "Baste"), signIn(t, ts, "writer"), signIn(t, ts, "other"), signIn(t, ts, "Ученик")
	f.user, _ = f.st.UserByLogin(context.Background(), "writer")
	f.otherUser, _ = f.st.UserByLogin(context.Background(), "other")
	for _, u := range []store.User{f.user, f.otherUser} {
		if err := f.st.SetRole(context.Background(), u.ID, store.RoleAuthor); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range []struct {
		id    string
		owner int64
	}{{"own", f.user.ID}, {"other-course", f.otherUser.ID}} {
		f.importCourse(t, f.admin, item.id, false)
		f.act(t, f.admin, "PUT", "/api/admin/courses/"+item.id+"/owner", fmt.Sprintf(`{"ownerId":%d}`, item.owner), 200)
		f.act(t, f.admin, "PUT", "/api/admin/courses/"+item.id+"/access", `{"access":"private"}`, 200)
		f.act(t, f.admin, "POST", "/api/admin/courses/"+item.id+"/publish", `{"version":1}`, 200)
	}
	return f
}

func TestAuthorProposalRouteMatrix(t *testing.T) {
	for route := range adminPolicies {
		if !strings.Contains(route, "/proposals/{id}") {
			continue
		}
		t.Run(route, func(t *testing.T) {
			f := authorServer(t)
			tk, _, err := f.st.CreateToken(context.Background(), store.Token{Name: "writer", UserID: f.user.ID})
			if err != nil {
				t.Fatal(err)
			}
			method, path, _ := strings.Cut(route, " ")
			for _, cid := range []string{"go", "other-course", "own"} {
				p, err := f.st.AddProposal(context.Background(), store.Proposal{CourseID: cid, TokenID: tk.ID, Agent: "writer", Title: "Правка", Base: 1, Data: json.RawMessage(authorCourse(cid, false)), Status: store.ProposalPending, Checks: json.RawMessage(`{"errors":0}`)})
				if err != nil {
					t.Fatal(err)
				}
				want := 404
				if cid == "own" {
					want = 200
				}
				f.act(t, f.author, method, strings.ReplaceAll(path, "{id}", strconv.FormatInt(p, 10)), `{"comment":"Не подходит"}`, want)
			}
		})
	}
}

func TestAuthorRunAndPreview(t *testing.T) {
	f := authorServer(t)
	for _, id := range []string{"go", "other-course", "missing", "own"} {
		want := 404
		if id == "own" {
			want = 200
		}
		f.act(t, f.author, "POST", "/api/admin/run", `{"course":"`+id+`","code":"package main"}`, want)
	}
	f.act(t, f.author, "GET", "/api/admin/runner", "", 200)
	f.act(t, f.author, "POST", "/api/admin/check", authorCourse("test", false), 200)
	f.act(t, f.author, "POST", "/api/admin/speech/preview", `{"text":"Проверка произношения"}`, 200)
}

type queuedAuthorSynth struct {
	entered chan struct{}
	release chan struct{}
}

func (s *queuedAuthorSynth) Speak(ctx context.Context, voice, text string) ([]byte, error) {
	s.entered <- struct{}{}
	select {
	case <-s.release:
		return (&fakeSynth{}).Speak(ctx, voice, text)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestAuthorsShareRecordingQueue(t *testing.T) {
	synth := &queuedAuthorSynth{entered: make(chan struct{}, 4), release: make(chan struct{})}
	defer close(synth.release)
	f := authorServer(t, func(c *Config) { c.Synth = synth })
	f.act(t, f.author, "POST", "/api/admin/courses/own/audio", `{"nodes":["a.1"]}`, 200)
	select {
	case <-synth.entered:
	case <-time.After(time.Second):
		t.Fatal("first recording did not start")
	}
	f.act(t, f.other, "POST", "/api/admin/courses/other-course/audio", `{"nodes":["a.1"]}`, 200)
	select {
	case <-synth.entered:
		t.Fatal("two authors recorded concurrently")
	case <-time.After(60 * time.Millisecond):
	}
	f.act(t, f.author, "POST", "/api/admin/courses/own/audio/cancel", `{}`, 200)
	select {
	case <-synth.entered:
	case <-time.After(time.Second):
		t.Fatal("next queued recording did not start after cancellation")
	}
	f.act(t, f.other, "POST", "/api/admin/courses/other-course/audio/cancel", `{}`, 200)
}

func authorCourse(id string, project bool) string {
	c := &course.Course{Schema: 1, ID: id, Title: id, Metal: "iron", Tool: course.Tool{Name: "Go", Version: "1.27"}, Review: []int{1, 3, 7}, Glossary: map[string]course.Term{}, Root: []*course.Node{{ID: "s", Kind: course.KindSection, Title: "Раздел", Children: []*course.Node{{ID: "a", Kind: course.KindLesson, Title: "Урок", Children: []*course.Node{{ID: "a.1", Kind: course.KindPart, Title: "Часть", Blocks: []course.Block{{"type": "text", "html": "Уникальная теория автора"}}}}}}}}}
	if project {
		c.Type = course.TypeProject
		c.Root[0].Children[0].Children = nil
		c.Root[0].Children[0].Blocks = []course.Block{{"type": "spec", "task": "Задача", "done": []any{"готово"}, "lessons": []any{map[string]any{"course": "go", "id": "a"}}}}
	}
	b, _ := course.Encode(c)
	return string(b)
}

func (f authorFixture) act(t *testing.T, c *http.Client, method, path, body string, want int) string {
	t.Helper()
	resp, out := do(t, c, method, f.ts.URL+path, body)
	if resp.StatusCode != want {
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, resp.StatusCode, want, out)
	}
	return out
}

func (f authorFixture) importCourse(t *testing.T, c *http.Client, id string, project bool) {
	t.Helper()
	f.act(t, c, "POST", "/api/admin/import", authorCourse(id, project), 200)
}

func TestAdminRoutePolicies(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		node, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(node, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || len(call.Args) < 2 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (sel.Sel.Name != "Handle" && sel.Sel.Name != "HandleFunc") {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok {
				t.Errorf("route registration must use a literal in %s", file)
				return true
			}
			route, _ := strconv.Unquote(lit.Value)
			if !strings.Contains(route, "/api/admin/") {
				return true
			}
			wrapper, ok := call.Args[1].(*ast.CallExpr)
			if !ok {
				t.Errorf("unprotected admin route %s", route)
				return true
			}
			policy, ok := wrapper.Fun.(*ast.SelectorExpr)
			if !ok {
				t.Errorf("unknown wrapper %s", route)
				return true
			}
			if adminPolicies[route] != policy.Sel.Name {
				t.Errorf("route %s: policy %q, registered %q; update the access matrix", route, adminPolicies[route], policy.Sel.Name)
			}
			seen[route] = true
			return true
		})
	}
	for route := range adminPolicies {
		if !seen[route] {
			t.Errorf("stale route policy: %s", route)
		}
	}
	f := authorServer(t)
	for route, policy := range adminPolicies {
		method, path, _ := strings.Cut(route, " ")
		path = strings.ReplaceAll(strings.ReplaceAll(path, "{id}", "own"), "{v}", "1")
		f.act(t, f.student, method, path, `{}`, 403)
		if policy == "admin" {
			f.act(t, f.author, method, path, `{}`, 403)
		}
	}
}

func TestAuthorCourseRouteMatrix(t *testing.T) {
	for route, policy := range adminPolicies {
		if policy != "staffCourse" {
			continue
		}
		t.Run(route, func(t *testing.T) {
			f := authorServer(t)
			method, pattern, _ := strings.Cut(route, " ")
			for _, id := range []string{"go", "other-course", "missing", "own"} {
				path := strings.ReplaceAll(strings.ReplaceAll(pattern, "{id}", id), "{v}", "1")
				body := `{"version":1,"base":1}`
				if method == "PUT" {
					body = `{"base":1,"course":` + authorCourse(id, false) + `}`
				}
				if strings.HasSuffix(path, "/audio") && method == "POST" {
					body = `{"nodes":["a.1"]}`
				}
				want := 404
				if id == "own" {
					want = 200
				}
				f.act(t, f.author, method, path, body, want)
			}
		})
	}
}

func TestAuthorLimitsAndImport(t *testing.T) {
	f := authorServer(t)
	for i := 1; i < 10; i++ {
		f.importCourse(t, f.author, fmt.Sprintf("mine-%d", i), i%2 == 0)
	}
	f.act(t, f.author, "POST", "/api/admin/courses", `{"id":"eleventh","title":"Курс","metal":"iron","toolName":"Go","toolVersion":"1.27"}`, 409)
	f.act(t, f.author, "POST", "/api/admin/import", authorCourse("eleventh", false), 409)
	f.importCourse(t, f.author, "own", false) // updating does not consume a slot
	for _, id := range []string{"go", "other-course"} {
		out := f.act(t, f.author, "POST", "/api/admin/import", authorCourse(id, false), 409)
		if !strings.Contains(out, "id занят") {
			t.Fatal(out)
		}
	}
	secret := agentToken(t, f.ts.URL, f.author, `{"name":"author","create":true,"review":true}`)
	resp, _ := doAgent(t, "POST", f.ts.URL+"/api/agent/courses", secret, `{"course":`+authorCourse("eleventh", false)+`}`)
	if resp.StatusCode != 409 {
		t.Fatal(resp.StatusCode)
	}
	f.act(t, f.admin, "PUT", fmt.Sprintf("/api/admin/users/%d/course-limit", f.user.ID), `{"courseLimit":11}`, 200)
	f.importCourse(t, f.author, "eleventh", false)
	owner, _ := f.st.CourseOwner(context.Background(), "eleventh")
	if owner != f.user.ID {
		t.Fatal("lost ownership")
	}
	f.act(t, f.admin, "PUT", fmt.Sprintf("/api/admin/users/%d/course-limit", f.user.ID), `{"courseLimit":null}`, 200)
	f.act(t, f.author, "POST", "/api/admin/import", authorCourse("twelfth", false), 409)
}

func TestAuthorTokenAndProposalIsolation(t *testing.T) {
	f := authorServer(t)
	secret := agentToken(t, f.ts.URL, f.author, `{"name":"author-agent","create":true,"review":true}`)
	otherSecret := agentToken(t, f.ts.URL, f.other, `{"name":"other-agent","create":true,"review":true}`)
	adminSecret := agentToken(t, f.ts.URL, f.admin, `{"name":"admin-agent","create":true,"review":true}`)
	change := func(id string) string {
		return `{"course":"` + id + `","title":"Правка","changes":[{"op":"set_passport","fields":{"subtitle":"обновлено"}}]}`
	}
	proposal := func(secret, id string) int64 {
		t.Helper()
		resp, out := doAgent(t, "POST", f.ts.URL+"/api/agent/proposals", secret, change(id))
		if resp.StatusCode != 200 {
			t.Fatalf("proposal %d %s", resp.StatusCode, out)
		}
		var v struct{ ID int64 }
		json.Unmarshal([]byte(out), &v)
		return v.ID
	}
	ownP, otherP, platformP := proposal(secret, "own"), proposal(otherSecret, "other-course"), proposal(adminSecret, "go")
	for _, otherID := range []string{"go", "other-course"} {
		for _, endpoint := range []struct{ method, path, body string }{
			{"GET", "/api/agent/courses/" + otherID + "/nodes/a", ""},
			{"POST", "/api/agent/proposals", change(otherID)},
			{"POST", "/api/agent/courses/" + otherID + "/publish", `{"version":1}`},
			{"POST", "/api/agent/run", `{"course":"` + otherID + `","code":"package main"}`},
		} {
			resp, _ := doAgent(t, endpoint.method, f.ts.URL+endpoint.path, secret, endpoint.body)
			if resp.StatusCode < 400 {
				t.Errorf("foreign token access: %s", endpoint.path)
			}
		}
	}
	for _, p := range []int64{otherP, platformP} {
		for _, suffix := range []string{"", "/accept", "/reject"} {
			method, body := "GET", ""
			if suffix != "" {
				method, body = "POST", `{"comment":"нет"}`
			}
			path := "/api/admin/proposals/" + strconv.FormatInt(p, 10) + suffix
			f.act(t, f.author, method, path, body, 404)
			resp, _ := doAgent(t, method, f.ts.URL+strings.Replace(path, "/api/admin/", "/api/agent/", 1), secret, body)
			if resp.StatusCode != 404 {
				t.Errorf("foreign proposal %s: %d", suffix, resp.StatusCode)
			}
		}
	}
	for _, path := range []string{"/api/agent/courses", "/api/agent/queue", "/api/agent/proposals"} {
		_, out := doAgent(t, "GET", f.ts.URL+path, secret, "")
		if strings.Contains(out, `"course":"go"`) || strings.Contains(out, "other-course") || strings.Contains(out, `"id":"go"`) {
			t.Fatalf("foreign data in %s: %s", path, out)
		}
	}
	for _, path := range []string{"/api/admin/courses", "/api/admin/proposals", "/api/admin/tokens"} {
		out := f.act(t, f.author, "GET", path, "", 200)
		if strings.Contains(out, "other-course") || strings.Contains(out, "other-agent") || strings.Contains(out, "admin-agent") {
			t.Fatal("foreign list data: " + out)
		}
	}
	_, list := doAgent(t, "GET", f.ts.URL+"/api/agent/courses", adminSecret, "")
	if strings.Contains(list, `"id":"own"`) {
		t.Fatal("admin all token sees author course")
	}
	explicit := agentToken(t, f.ts.URL, f.admin, `{"name":"explicit","courses":["own"]}`)
	resp, _ := doAgent(t, "GET", f.ts.URL+"/api/agent/courses/own/nodes/a", explicit, "")
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	_, out := doAgent(t, "POST", f.ts.URL+"/mcp", secret, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if !strings.Contains(out, "только курсы этого автора") {
		t.Fatal("missing author instructions")
	}
	for _, tool := range []string{"get_node", "propose_changes", "publish_version", "run_code"} {
		args := `{"course":"other-course","node":"a","title":"Изменить","version":1,"code":"package main","changes":[{"op":"set_passport","fields":{"subtitle":"x"}}]}`
		_, out := doAgent(t, "POST", f.ts.URL+"/mcp", secret, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`","arguments":`+args+`}}`)
		if !strings.Contains(out, `"isError":true`) {
			t.Errorf("MCP leaked %s: %s", tool, out)
		}
	}
	// A mismatch is decided by the human owner in the same admin panel.
	if err := f.st.SetProposalRuns(context.Background(), ownP, []byte(`[{"status":"differs"}]`)); err != nil {
		t.Fatal(err)
	}
	f.act(t, f.author, "POST", fmt.Sprintf("/api/admin/proposals/%d/accept", ownP), `{}`, 200)
	f.act(t, f.admin, "PUT", "/api/admin/courses/own/owner", `{"ownerId":0}`, 200)
	resp, _ = doAgent(t, "GET", f.ts.URL+"/api/agent/courses/own/nodes/a", secret, "")
	if resp.StatusCode < 400 {
		t.Fatal("transferred course still accessible")
	}
	resp, _ = doAgent(t, "GET", f.ts.URL+fmt.Sprintf("/api/agent/proposals/%d", ownP), secret, "")
	if resp.StatusCode != 404 {
		t.Fatal("transferred proposal still accessible")
	}
	f.act(t, f.author, "GET", "/api/admin/courses/own/draft", "", 404)
	for _, disabled := range []bool{true, false} {
		if err := f.st.SetDisabled(context.Background(), f.user.ID, disabled); err != nil {
			t.Fatal(err)
		}
		want := 200
		if disabled {
			want = 401
		}
		for _, path := range []string{"/api/agent/courses", "/mcp"} {
			method, body := "GET", ""
			if path == "/mcp" {
				method, body = "POST", `{"jsonrpc":"2.0","id":1,"method":"ping"}`
			}
			resp, _ := doAgent(t, method, f.ts.URL+path, secret, body)
			if resp.StatusCode != want {
				t.Fatal("token account state", resp.StatusCode, want)
			}
		}
	}
	if err := f.st.SetRole(context.Background(), f.user.ID, store.RoleStudent); err != nil {
		t.Fatal(err)
	}
	resp, _ = doAgent(t, "GET", f.ts.URL+"/api/agent/courses", secret, "")
	if resp.StatusCode != 401 {
		t.Fatal("demoted token works")
	}
	resp, _ = doAgent(t, "POST", f.ts.URL+"/mcp", secret, `{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	if resp.StatusCode != 401 {
		t.Fatal("demoted MCP token works")
	}
}

func TestAuthorTokenResourceRoutes(t *testing.T) {
	for route, policy := range adminPolicies {
		if policy != "staffToken" {
			continue
		}
		t.Run(route, func(t *testing.T) {
			f := authorServer(t)
			own, _, err := f.st.CreateToken(context.Background(), store.Token{Name: "own", UserID: f.user.ID})
			if err != nil {
				t.Fatal(err)
			}
			foreign, _, err := f.st.CreateToken(context.Background(), store.Token{Name: "foreign", UserID: f.otherUser.ID})
			if err != nil {
				t.Fatal(err)
			}
			legacy, _, err := f.st.CreateToken(context.Background(), store.Token{Name: "legacy"})
			if err != nil {
				t.Fatal(err)
			}
			method, path, _ := strings.Cut(route, " ")
			for _, id := range []int64{foreign.ID, legacy.ID, 99999, own.ID} {
				if method == "DELETE" && id == own.ID {
					if err := f.st.RevokeToken(context.Background(), id); err != nil {
						t.Fatal(err)
					}
				}
				want := 404
				if id == own.ID {
					want = 200
				}
				f.act(t, f.author, method, strings.ReplaceAll(path, "{id}", strconv.FormatInt(id, 10)), `{"review":true}`, want)
			}
		})
	}
}

func TestAuthorVisibilityAndNarration(t *testing.T) {
	f := authorServer(t)
	f.importCourse(t, f.author, "project-own", true)
	f.act(t, f.author, "POST", "/api/admin/courses/project-own/publish", `{"version":1}`, 200)
	f.importCourse(t, f.author, "unpublished-own", false)
	for _, path := range []string{"/api/courses", "/api/overview", "/api/search?q=теория", "/api/courses/go/applied"} {
		out := f.act(t, f.student, "GET", path, "", 200)
		if strings.Contains(out, `"own"`) || strings.Contains(out, "project-own") || strings.Contains(out, "unpublished-own") {
			t.Fatal("private course visible: " + path + out)
		}
	}
	for _, path := range []string{"/c/own/", "/p/project-own/", "/api/courses/own", "/api/courses/own/audio", "/audio/own/test.mp3", "/api/courses/own/links", "/api/courses/own/applied", "/api/progress/own"} {
		f.act(t, f.student, "GET", path, "", 404)
	}
	f.act(t, f.student, "POST", "/api/progress/own", `{}`, 404)
	out := f.act(t, f.author, "GET", "/api/overview", "", 200)
	if !strings.Contains(out, `"onlyYours":true`) || strings.Contains(out, "unpublished-own") {
		t.Fatal("owner catalog metadata: " + out)
	}
	f.act(t, f.author, "POST", "/api/admin/courses/own/audio", `{"nodes":["a.1"]}`, 200)
	deadline := time.Now().Add(3 * time.Second)
	for {
		records, err := f.st.Audio(context.Background(), "own")
		if err != nil {
			t.Fatal(err)
		}
		if rec, ok := records["a.1"]; ok {
			f.act(t, f.author, "GET", audioURL("own", rec.File), "", 200)
			f.act(t, f.student, "GET", audioURL("own", rec.File), "", 404)
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("narration not recorded")
		}
		time.Sleep(10 * time.Millisecond)
	}
	student, _ := f.st.UserByLogin(context.Background(), "student")
	f.act(t, f.admin, "PUT", fmt.Sprintf("/api/admin/users/%d/courses", student.ID), `{"courses":["own","project-own"]}`, 200)
	f.act(t, f.student, "GET", "/api/courses/own", "", 200)
	out = f.act(t, f.student, "GET", "/api/courses/go/applied", "", 200)
	if !strings.Contains(out, "project-own") {
		t.Fatal("granted project missing")
	}
	f.act(t, f.admin, "PUT", fmt.Sprintf("/api/admin/users/%d/courses", student.ID), `{"courses":[]}`, 200)
	f.act(t, f.admin, "PUT", "/api/admin/courses/own/access", `{"access":"public"}`, 200)
	f.act(t, f.student, "GET", "/api/courses/own", "", 200)
	// Demotion retains reading of owned private courses but removes editing.
	f.act(t, f.admin, "PUT", "/api/admin/courses/own/access", `{"access":"private"}`, 200)
	if err := f.st.SetRole(context.Background(), f.user.ID, store.RoleStudent); err != nil {
		t.Fatal(err)
	}
	f.act(t, f.author, "GET", "/api/courses/own", "", 200)
	f.act(t, f.author, "GET", "/api/admin/courses/own/draft", "", 403)
}

func TestAuthorNewCourseReview(t *testing.T) {
	f := authorServer(t)
	secret := agentToken(t, f.ts.URL, f.author, `{"name":"writer","create":true,"review":true}`)
	otherSecret := agentToken(t, f.ts.URL, f.other, `{"name":"other","create":true,"review":true}`)
	create := func(secret, id string) int64 {
		t.Helper()
		resp, out := doAgent(t, "POST", f.ts.URL+"/api/agent/courses", secret, `{"course":`+authorCourse(id, false)+`}`)
		if resp.StatusCode != 200 {
			t.Fatalf("create proposal: %d %s", resp.StatusCode, out)
		}
		var p struct{ ID int64 }
		json.Unmarshal([]byte(out), &p)
		return p.ID
	}
	call := func(secret, name, args string) string {
		t.Helper()
		resp, out := doAgent(t, "POST", f.ts.URL+"/mcp", secret, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)
		if resp.StatusCode != 200 {
			t.Fatal(resp.StatusCode)
		}
		return out
	}
	p := create(secret, "agent-new")
	// A second author may propose the same free id but cannot review the first
	// author's proposal. Scope must use the proposal's own ownership snapshot.
	otherP := create(otherSecret, "agent-new")
	for _, tool := range []string{"accept_proposal", "reject_proposal", "proposal_status"} {
		out := call(otherSecret, tool, fmt.Sprintf(`{"id":%d,"comment":"нет"}`, p))
		if !strings.Contains(out, `"isError":true`) {
			t.Fatalf("foreign proposal collision: %s", out)
		}
	}
	for _, tool := range []string{"list_courses", "list_queue"} {
		out := call(secret, tool, `{}`)
		if strings.Contains(out, "other-course") || strings.Contains(out, `\"course\": \"go\"`) {
			t.Fatalf("MCP list leak: %s", out)
		}
	}
	out := call(secret, "accept_proposal", fmt.Sprintf(`{"id":%d}`, p))
	if strings.Contains(out, `"isError":true`) {
		t.Fatal(out)
	}
	owner, err := f.st.CourseOwner(context.Background(), "agent-new")
	if err != nil || owner != f.user.ID {
		t.Fatalf("new course owner: %d %v", owner, err)
	}
	out = call(secret, "publish_version", `{"course":"agent-new","version":1}`)
	if strings.Contains(out, `"isError":true`) {
		t.Fatal(out)
	}
	f.act(t, f.author, "GET", "/api/courses/agent-new", "", 200)
	f.act(t, f.student, "GET", "/api/courses/agent-new", "", 404)
	out = call(otherSecret, "accept_proposal", fmt.Sprintf(`{"id":%d}`, otherP))
	if !strings.Contains(out, `"isError":true`) {
		t.Fatal("collision overwritten")
	}
	// Proposal creation does not reserve a slot: the transactional acceptance
	// check must still reject it if the author fills the last slot meanwhile.
	pending := create(secret, "pending-limit")
	f.act(t, f.admin, "PUT", fmt.Sprintf("/api/admin/users/%d/course-limit", f.user.ID), `{"courseLimit":2}`, 200)
	f.act(t, f.author, "POST", fmt.Sprintf("/api/admin/proposals/%d/accept", pending), `{}`, 409)
	out = call(secret, "accept_proposal", fmt.Sprintf(`{"id":%d}`, pending))
	if !strings.Contains(out, `"isError":true`) {
		t.Fatal("accept bypasses limit")
	}
	f.act(t, f.admin, "PUT", fmt.Sprintf("/api/admin/users/%d/course-limit", f.user.ID), `{"courseLimit":3}`, 200)
	f.act(t, f.author, "POST", fmt.Sprintf("/api/admin/proposals/%d/accept", pending), `{}`, 200)
}

func TestAuthorInvitationToCourse(t *testing.T) {
	f := authorServer(t)
	data := f.act(t, f.admin, "POST", "/api/admin/invites", `{"role":"author","note":"Для автора"}`, 200)
	var invite store.Invite
	json.Unmarshal([]byte(data), &invite)
	invited := client()
	out := f.act(t, invited, "POST", "/api/join", fmt.Sprintf(`{"code":%q,"login":"invited-author","name":"Приглашённый автор","password":%q}`, invite.Code, testPassword), 200)
	if !strings.Contains(out, `"role":"author"`) {
		t.Fatal("wrong invited role")
	}
	f.act(t, invited, "GET", "/admin", "", 200)
	f.act(t, invited, "POST", "/api/admin/courses", `{"id":"from-editor","title":"Первый курс","metal":"iron","toolName":"Go","toolVersion":"1.27"}`, 200)
	secret := agentToken(t, f.ts.URL, invited, `{"name":"personal","propose":true}`)
	_, list := doAgent(t, "GET", f.ts.URL+"/api/agent/courses", secret, "")
	var courses []struct{ ID string }
	json.Unmarshal([]byte(list), &courses)
	if len(courses) != 1 || courses[0].ID != "from-editor" {
		t.Fatalf("unexpected author scope: %s", list)
	}
	f.act(t, invited, "POST", "/api/admin/courses/from-editor/publish", `{"version":1}`, 200)
	f.act(t, f.student, "GET", "/api/courses/from-editor", "", 404)
}
