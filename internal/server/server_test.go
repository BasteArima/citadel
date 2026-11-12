package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"citadel/internal/course"
	"citadel/internal/store"
)

const testPassword = "test-password-long"

var testStores sync.Map

func registerTestStore(t *testing.T, ts *httptest.Server, st *store.Store) {
	testStores.Store(ts.URL, st)
	t.Cleanup(func() { testStores.Delete(ts.URL) })
}

func testLogin(name string) string {
	switch name {
	case "Гость":
		return "guest"
	case "Ученик":
		return "student"
	case "A":
		return "user-a"
	}
	return strings.ToLower(name)
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	return newTestServerWith(t, func(*Config) {})
}

// newTestServerWith lets a test change the config, e.g. point it at a fake runner.
func newTestServerWith(t *testing.T, tune func(*Config)) *httptest.Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "citadel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	c := &course.Course{
		Schema: course.SchemaVersion, ID: "go", Title: "Go", Metal: "iron",
		Tool: course.Tool{Name: "Go", Version: "1.27"},
		Root: []*course.Node{{ID: "s", Kind: course.KindSection, Title: "Раздел", Children: []*course.Node{
			{ID: "a", Kind: course.KindLesson, Title: "А", Blocks: []course.Block{{"type": "text", "html": "x"}}},
			{ID: "b", Kind: course.KindLesson, Title: "Б", Planned: true},
		}}},
	}
	ctx := context.Background()
	if _, err := st.ImportContent(ctx, []*course.Course{c}); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	tune(&cfg)
	h, err := New(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	registerTestStore(t, ts, st)
	return ts
}

// client keeps cookies and does not follow redirects.
func client() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func do(t *testing.T, c *http.Client, method, url, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func signIn(t *testing.T, ts *httptest.Server, name string) *http.Client {
	t.Helper()
	c := client()
	login := testLogin(name)
	value, _ := testStores.Load(ts.URL)
	st := value.(*store.Store)
	if _, err := st.UserByLogin(context.Background(), login); err != nil {
		role := store.RoleStudent
		if login == "baste" {
			role = store.RoleAdmin
			name = "Baste"
		}
		if _, err := st.CreateUser(context.Background(), login, name, testPassword, role); err != nil {
			t.Fatal(err)
		}
	}
	resp, body := do(t, c, "POST", ts.URL+"/api/login", `{"login":"`+login+`","password":"`+testPassword+`","remember":true}`)
	if resp.StatusCode != 200 {
		t.Fatalf("sign in: %d %s", resp.StatusCode, body)
	}
	return c
}

func TestPublicRoutes(t *testing.T) {
	ts := newTestServer(t)
	c := client()
	tests := []struct {
		path   string
		status int
		has    string
	}{
		{"/healthz", 200, "ok"},
		{"/login", 200, "Пароль"},
		{"/static/engine/app.js", 200, "export function start"},
		{"/api/courses/go", 401, "sign in required"},
		{"/api/progress/go", 401, "sign in required"},
	}
	for _, tt := range tests {
		resp, body := do(t, c, "GET", ts.URL+tt.path, "")
		if resp.StatusCode != tt.status || !strings.Contains(body, tt.has) {
			t.Errorf("%s: %d %q", tt.path, resp.StatusCode, body)
		}
	}
	resp, _ := do(t, c, "GET", ts.URL+"/c/go/", "")
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/login?next=%2Fc%2Fgo%2F" {
		t.Errorf("course page without session: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestSignInFlow(t *testing.T) {
	ts := newTestServer(t)
	c := client()
	for _, tt := range []struct{ body, want string }{
		{`{"login":"Baste","password":"wrong"}`, loginError},
		{`{"login":"","password":"` + testPassword + `"}`, loginError},
		{`{"login":"<script>","password":"` + testPassword + `"}`, loginError},
	} {
		resp, body := do(t, c, "POST", ts.URL+"/api/login", tt.body)
		if resp.StatusCode < 400 || !strings.Contains(body, tt.want) {
			t.Errorf("%s: %d %s", tt.body, resp.StatusCode, body)
		}
	}
	// a form post from another site cannot sign in
	req, _ := http.NewRequest("POST", ts.URL+"/api/login", strings.NewReader("login=Baste&password="+testPassword))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if resp, err := c.Do(req); err != nil || resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("form post: %v %v", resp, err)
	}

	c = signIn(t, ts, "baste")
	_, body := do(t, c, "GET", ts.URL+"/api/me", "")
	if !strings.Contains(body, `"role":"admin"`) {
		t.Errorf("me: %s", body)
	}
	for _, p := range []string{"/api/courses/go", "/c/go/", "/api/blocks"} {
		if resp, _ := do(t, c, "GET", ts.URL+p, ""); resp.StatusCode != 200 {
			t.Errorf("%s after sign in: %d", p, resp.StatusCode)
		}
	}
	for _, p := range []string{"/", "/profile", "/review"} {
		if resp, body := do(t, c, "GET", ts.URL+p, ""); resp.StatusCode != 200 || !strings.Contains(body, "/static/site/") {
			t.Errorf("%s: %d", p, resp.StatusCode)
		}
	}
	if resp, _ := do(t, c, "POST", ts.URL+"/api/logout", ""); resp.StatusCode != http.StatusNoContent {
		t.Errorf("logout: %d", resp.StatusCode)
	}
	if resp, _ := do(t, c, "GET", ts.URL+"/api/me", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("me after logout: %d", resp.StatusCode)
	}
}

func TestSignInRateLimit(t *testing.T) {
	ts := newTestServer(t)
	c := signIn(t, ts, "Baste")
	var last int
	for i := 0; i < 11; i++ {
		resp, _ := do(t, c, "POST", ts.URL+"/api/login", fmt.Sprintf(`{"login":"user-%d","password":"wrong"}`, i))
		last = resp.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("11th failed attempt: %d", last)
	}
	// even the right password is refused while blocked
	resp, _ := do(t, c, "POST", ts.URL+"/api/login", `{"login":"baste","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("right password while blocked: %d", resp.StatusCode)
	}
}

func TestProgressSync(t *testing.T) {
	ts := newTestServer(t)
	a, b := signIn(t, ts, "Baste"), signIn(t, ts, "Baste") // two devices of one user
	other := signIn(t, ts, "Гость")

	post := func(c *http.Client, items string) map[string]store.Item {
		t.Helper()
		resp, body := do(t, c, "POST", ts.URL+"/api/progress/go", `{"items":`+items+`}`)
		if resp.StatusCode != 200 {
			t.Fatalf("post: %d %s", resp.StatusCode, body)
		}
		var out progressBody
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatal(err)
		}
		return out.Items
	}
	post(a, `{"q:a.q1":{"v":1,"at":100},"done:a":{"v":"2026-10-29","at":100}}`)
	got := post(b, `{"q:a.q2":{"v":1,"at":120},"done:a":{"v":"2026-10-01","at":50}}`)
	if len(got) != 3 || string(got["done:a"].V) != `"2026-10-29"` {
		t.Fatalf("device b sees %+v", got)
	}
	if mine := post(other, `{}`); len(mine) != 0 {
		t.Fatalf("other user sees %+v", mine)
	}

	for _, bad := range []string{
		`{"drop table":{"v":1,"at":1}}`,
		`{"q:x":{"v":1,"at":0}}`,
		`{"q:x":{"v":"` + strings.Repeat("a", 300) + `","at":1}}`,
	} {
		resp, _ := do(t, a, "POST", ts.URL+"/api/progress/go", `{"items":`+bad+`}`)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, resp.StatusCode)
		}
	}
	if resp, _ := do(t, a, "POST", ts.URL+"/api/progress/nope", `{"items":{}}`); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown course: %d", resp.StatusCode)
	}

	// a clock far in the future is clamped, so a later honest mark still wins
	post(a, `{"seen:a:0":{"v":1,"at":99999999999999}}`)
	_, body := do(t, a, "GET", ts.URL+"/api/progress/go", "")
	var out progressBody
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if out.Items["seen:a:0"].At >= 99999999999999 {
		t.Fatalf("future mark not clamped: %+v", out.Items["seen:a:0"])
	}
}

func TestOverview(t *testing.T) {
	ts := newTestServer(t)
	c := signIn(t, ts, "A")
	get := func(today string) Overview {
		t.Helper()
		_, body := do(t, c, "GET", ts.URL+"/api/overview?today="+today, "")
		var out struct{ Courses []Overview }
		if err := json.Unmarshal([]byte(body), &out); err != nil || len(out.Courses) != 1 {
			t.Fatalf("overview: %s", body)
		}
		return out.Courses[0]
	}
	o := get("2026-10-30")
	if o.Started || o.Done != 0 || o.Next == nil || o.Next.ID != "a" {
		t.Fatalf("fresh: %+v", o)
	}
	// one question right, one wrong on the first attempt; the wrong one became a card due on the 28th,
	// a «say» card is due on the 31st
	do(t, c, "POST", ts.URL+"/api/progress/go", `{"items":{
		"q:a:a.q1":{"v":1,"at":1},"q:a:a.q2":{"v":2,"at":1},"done:a":{"v":"2026-10-27","at":1},
		"card:a:a.q2":{"v":{"d":"2026-10-28","i":1,"s":0},"at":1},
		"card:a:say":{"v":{"d":"2026-10-31","i":3,"s":0},"at":1}}}`)
	o = get("2026-10-27")
	if o.Done != 1 || o.Solved != 2 || o.FirstRight != 1 || o.Next != nil || o.Cards != 2 || o.Due != 0 {
		t.Fatalf("same day: %+v", o)
	}
	if o.Week != [7]int{0, 1, 0, 0, 1, 0, 0} {
		t.Fatalf("week from the 27th: %v", o.Week)
	}
	// an overdue card counts today
	if o = get("2026-10-30"); o.Due != 1 || o.Week[0] != 1 || o.Week[1] != 1 {
		t.Fatalf("on the 30th: %+v", o)
	}
	if o = get("2026-10-31"); o.Due != 2 {
		t.Fatalf("on the 31st: %+v", o)
	}
}

func TestCourseList(t *testing.T) {
	ts := newTestServer(t)
	_, body := do(t, signIn(t, ts, "A"), "GET", ts.URL+"/api/courses", "")
	var list []Summary
	if err := json.Unmarshal([]byte(body), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Lessons != 2 || list[0].Ready != 1 {
		t.Fatalf("got %+v", list)
	}
}

func TestSearch(t *testing.T) {
	ts := newTestServer(t)
	c := signIn(t, ts, "A")
	get := func(q string) (out struct{ Places, Terms []Hit }) {
		t.Helper()
		_, body := do(t, c, "GET", ts.URL+"/api/search?q="+q, "")
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatalf("%s: %s", q, body)
		}
		return
	}
	// lesson «А» is ready, «Б» is planned and must not be found
	if r := get("%D0%B0"); len(r.Places) != 1 || r.Places[0].Href != "/c/go/#a" || r.Places[0].Kind != "lesson" {
		t.Fatalf("«а»: %+v", r.Places)
	}
	if r := get("%D0%B1"); len(r.Places) != 0 {
		t.Fatalf("planned lesson found: %+v", r.Places)
	}
	if r := get(""); len(r.Places) != 1 || r.Places[0].Kind != "course" {
		t.Fatalf("empty query lists courses: %+v", r.Places)
	}
	if resp, _ := do(t, client(), "GET", ts.URL+"/api/search?q=a", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("search without session: %d", resp.StatusCode)
	}
}
