package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"citadel/internal/course"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	c := &course.Course{
		Schema: course.SchemaVersion, ID: "go", Title: "Go", Metal: "iron",
		Tool: course.Tool{Name: "Go", Version: "1.27"},
		Root: []*course.Node{{ID: "s", Kind: course.KindSection, Title: "Раздел", Children: []*course.Node{
			{ID: "a", Kind: course.KindLesson, Title: "А", Blocks: []course.Block{{"type": "text", "html": "x"}}},
			{ID: "b", Kind: course.KindLesson, Title: "Б", Planned: true},
		}}},
	}
	ts := httptest.NewServer(New([]*course.Course{c}, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(ts.Close)
	return ts
}

func get(t *testing.T, ts *httptest.Server, path string) (*http.Response, string) {
	t.Helper()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(ts.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

func TestRoutes(t *testing.T) {
	ts := newTestServer(t)
	tests := []struct {
		path   string
		status int
		has    string
	}{
		{"/healthz", 200, "ok"},
		{"/api/courses/go", 200, `"id":"go"`},
		{"/api/courses/nope", 404, "not found"},
		{"/api/blocks", 200, `"predict"`},
		{"/c/go/", 200, "/static/engine/main.js"},
		{"/c/nope/", 404, ""},
		{"/static/engine/app.js", 200, "export function start"},
		{"/static/engine/blocks/index.js", 200, "register("},
		{"/ladder.html", 200, "<meta charset"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			resp, body := get(t, ts, tt.path)
			if resp.StatusCode != tt.status {
				t.Fatalf("status %d, want %d", resp.StatusCode, tt.status)
			}
			if !strings.Contains(body, tt.has) {
				t.Errorf("body does not contain %q", tt.has)
			}
		})
	}
}

func TestHomeRedirectsToFirstCourse(t *testing.T) {
	resp, _ := get(t, newTestServer(t), "/")
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/c/go/" {
		t.Fatalf("got %d to %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestCourseList(t *testing.T) {
	_, body := get(t, newTestServer(t), "/api/courses")
	var list []Summary
	if err := json.Unmarshal([]byte(body), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Lessons != 2 || list[0].Ready != 1 {
		t.Fatalf("got %+v", list)
	}
}
