package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestAdminOnly(t *testing.T) {
	ts := newTestServer(t)
	student := signIn(t, ts, "Гость")
	for _, p := range []string{"/api/admin/courses", "/api/admin/users", "/api/admin/courses/go/draft"} {
		if resp, _ := do(t, student, "GET", ts.URL+p, ""); resp.StatusCode != http.StatusForbidden {
			t.Errorf("student %s: %d", p, resp.StatusCode)
		}
		if resp, _ := do(t, client(), "GET", ts.URL+p, ""); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("anonymous %s: %d", p, resp.StatusCode)
		}
	}
	if resp, _ := do(t, student, "GET", ts.URL+"/admin", ""); resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/" {
		t.Errorf("student /admin: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	admin := signIn(t, ts, "Baste")
	if resp, body := do(t, admin, "GET", ts.URL+"/admin", ""); resp.StatusCode != 200 || !strings.Contains(body, "/static/admin/") {
		t.Errorf("admin /admin: %d", resp.StatusCode)
	}
}

// draft is what GET /api/admin/courses/{id}/draft returns.
type draft struct {
	Version struct {
		Version   int  `json:"version"`
		Published bool `json:"published"`
	} `json:"version"`
	Course map[string]any `json:"course"`
}

func TestDraftPublishFlow(t *testing.T) {
	ts := newTestServer(t)
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Гость")
	getDraft := func() draft {
		t.Helper()
		_, body := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/draft", "")
		var d draft
		if err := json.Unmarshal([]byte(body), &d); err != nil {
			t.Fatalf("draft: %s", body)
		}
		return d
	}
	save := func(c map[string]any, base int) (*http.Response, string) {
		t.Helper()
		data, _ := json.Marshal(map[string]any{"base": base, "course": c})
		return do(t, admin, "PUT", ts.URL+"/api/admin/courses/go/draft", string(data))
	}
	studentTitle := func() string {
		t.Helper()
		_, body := do(t, student, "GET", ts.URL+"/api/courses/go", "")
		var c struct{ Title string }
		json.Unmarshal([]byte(body), &c)
		return c.Title
	}

	d := getDraft()
	if d.Version.Version != 1 || !d.Version.Published {
		t.Fatalf("first draft: %+v", d.Version)
	}
	d.Course["title"] = "Go: правка"
	if resp, body := save(d.Course, 1); resp.StatusCode != 200 || !strings.Contains(body, `"version":2`) {
		t.Fatalf("save: %d %s", resp.StatusCode, body)
	}
	if resp, _ := save(d.Course, 1); resp.StatusCode != http.StatusConflict {
		t.Fatalf("stale save: %d", resp.StatusCode)
	}
	if got := studentTitle(); got != "Go" {
		t.Fatalf("draft leaked to students: %q", got)
	}

	// a draft with an error is kept but cannot be published
	d.Course["metal"] = ""
	if resp, body := save(d.Course, 2); resp.StatusCode != 200 || !strings.Contains(body, `"errors":1`) {
		t.Fatalf("save broken: %d %s", resp.StatusCode, body)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/go/publish", `{"version":3}`); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("publish broken: %d %s", resp.StatusCode, body)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/go/publish", `{"version":2}`); resp.StatusCode != 200 {
		t.Fatalf("publish v2: %d %s", resp.StatusCode, body)
	}
	if got := studentTitle(); got != "Go: правка" {
		t.Fatalf("student after publish: %q", got)
	}

	// rollback puts v1 on top as v4
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/go/rollback", `{"version":1,"base":3}`); resp.StatusCode != 200 || !strings.Contains(body, `"version":4`) {
		t.Fatalf("rollback: %d %s", resp.StatusCode, body)
	}
	if d := getDraft(); d.Version.Version != 4 || d.Course["title"] != "Go" {
		t.Fatalf("after rollback: %+v %v", d.Version, d.Course["title"])
	}
	_, body := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/versions", "")
	var vs []struct {
		Version   int    `json:"version"`
		Author    string `json:"author"`
		Published bool   `json:"published"`
	}
	json.Unmarshal([]byte(body), &vs)
	if len(vs) != 4 || vs[0].Version != 4 || !vs[2].Published || vs[0].Author != "Baste" {
		t.Fatalf("versions: %s", body)
	}
	if resp, _ := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/versions/2", ""); resp.StatusCode != 200 {
		t.Fatalf("version 2: %d", resp.StatusCode)
	}
	if resp, _ := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/versions/9", ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("version 9: %d", resp.StatusCode)
	}
}

func TestCreateAndImport(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	for _, bad := range []string{
		`{"id":"Bad ID","title":"x","metal":"iron","toolName":"x","toolVersion":"1"}`,
		`{"id":"pg","title":"","metal":"iron","toolName":"x","toolVersion":"1"}`,
		`{"id":"go","title":"x","metal":"iron","toolName":"x","toolVersion":"1"}`,
	} {
		if resp, _ := do(t, admin, "POST", ts.URL+"/api/admin/courses", bad); resp.StatusCode < 400 {
			t.Errorf("%s: %d", bad, resp.StatusCode)
		}
	}
	resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses", `{"id":"pg","title":"PostgreSQL","metal":"copper","toolName":"PostgreSQL","toolVersion":"18"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("create: %d %s", resp.StatusCode, body)
	}
	// unpublished: not in the catalog, shown as «Скоро»
	_, body = do(t, admin, "GET", ts.URL+"/api/overview", "")
	if strings.Contains(body, `"courses":[{"id":"pg"`) || !strings.Contains(body, `"soon":[{"id":"pg","title":"PostgreSQL"`) {
		t.Fatalf("overview: %s", body)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/pg/publish", `{"version":1}`); resp.StatusCode != 200 {
		t.Fatalf("publish new course: %d %s", resp.StatusCode, body)
	}
	_, body = do(t, admin, "GET", ts.URL+"/api/overview", "")
	if !strings.Contains(body, `"id":"pg"`) || !strings.Contains(body, `"soon":[]`) {
		t.Fatalf("overview after publish: %s", body)
	}

	// import: a new id makes a course, a known one a new draft
	imp := `{"schema":1,"id":"k8s","title":"Kubernetes","metal":"steel","tool":{"name":"kubectl","version":"1.34"},"review":[1],"glossary":{},"root":[{"id":"s","kind":"section","title":"Раздел"}]}`
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/import", imp); resp.StatusCode != 200 || !strings.Contains(body, `"version":1`) {
		t.Fatalf("import new: %d %s", resp.StatusCode, body)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/import", imp); resp.StatusCode != 200 || !strings.Contains(body, `"version":2`) {
		t.Fatalf("import again: %d %s", resp.StatusCode, body)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/check", `{"schema":1,"id":"x","root":[]}`); resp.StatusCode != 200 || strings.Contains(body, `"errors":0`) {
		t.Fatalf("check: %d %s", resp.StatusCode, body)
	}
	_, body = do(t, admin, "GET", ts.URL+"/api/admin/courses", "")
	for _, id := range []string{`"id":"go"`, `"id":"pg"`, `"id":"k8s"`} {
		if !strings.Contains(body, id) {
			t.Errorf("course list misses %s: %s", id, body)
		}
	}
}

func TestUserRoles(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	guest := signIn(t, ts, "Гость")
	_, body := do(t, admin, "GET", ts.URL+"/api/admin/users", "")
	var out struct {
		Users []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
			Role string `json:"role"`
		} `json:"users"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || len(out.Users) != 2 {
		t.Fatalf("users: %s", body)
	}
	ids := map[string]int64{}
	for _, u := range out.Users {
		ids[u.Name] = u.ID
	}
	path := func(name string) string { return ts.URL + "/api/admin/users/" + strconv.FormatInt(ids[name], 10) }
	if resp, _ := do(t, admin, "PUT", path("Baste"), `{"role":"student"}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("own role: %d", resp.StatusCode)
	}
	if resp, _ := do(t, admin, "PUT", path("Гость"), `{"role":"root"}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("unknown role: %d", resp.StatusCode)
	}
	if resp, body := do(t, admin, "PUT", path("Гость"), `{"role":"admin"}`); resp.StatusCode != 200 {
		t.Fatalf("make admin: %d %s", resp.StatusCode, body)
	}
	// the role applies to the existing session right away
	if resp, _ := do(t, guest, "GET", ts.URL+"/api/admin/courses", ""); resp.StatusCode != 200 {
		t.Errorf("new admin: %d", resp.StatusCode)
	}
}
