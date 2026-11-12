package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"citadel/internal/course"
	"citadel/internal/store"
)

func TestProject(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "citadel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	lessons := &course.Course{
		Schema: course.SchemaVersion, ID: "go", Title: "Go", Metal: "iron", Tool: course.Tool{Name: "Go", Version: "1.27"},
		Root: []*course.Node{{ID: "s", Kind: course.KindSection, Title: "Раздел", Children: []*course.Node{
			{ID: "http", Kind: course.KindLesson, N: 35, Title: "HTTP", Planned: true},
			{ID: "ifaces", Kind: course.KindLesson, N: 11, Title: "Интерфейсы", Blocks: []course.Block{{"type": "text", "html": "x"}}},
		}}},
	}
	spec := func(refs ...any) []course.Block {
		return []course.Block{{"type": "spec", "task": "Задача", "done": []any{"готово"}, "lessons": refs}}
	}
	project := &course.Course{
		Schema: course.SchemaVersion, Type: course.TypeProject, ID: "shop", Title: "Магазин", Metal: "steel", Tool: course.Tool{Name: "Go", Version: "1.27"},
		Root: []*course.Node{
			{ID: "one", Kind: course.KindSection, Title: "Первый", Tag: "guided", Children: []*course.Node{
				{ID: "one.a", Kind: course.KindLesson, Title: "А", Blocks: spec(
					map[string]any{"course": "go", "id": "http"},
					map[string]any{"course": "go", "id": "missing"},
					map[string]any{"course": "nocourse", "id": "x"},
				)},
				{ID: "one.b", Kind: course.KindLesson, Title: "Б", Blocks: spec(map[string]any{"course": "go", "id": "ifaces", "why": "пригодится"})},
			}},
			{ID: "two", Kind: course.KindSection, Title: "Второй", Children: []*course.Node{
				{ID: "two.a", Kind: course.KindLesson, Title: "В", Blocks: spec()},
			}},
		},
	}
	if errs := course.Errors(course.Validate(project)); len(errs) > 0 {
		t.Fatalf("project is invalid: %v", errs)
	}
	ctx := context.Background()
	if _, err := st.ImportContent(ctx, []*course.Course{lessons, project}); err != nil {
		t.Fatal(err)
	}
	h, err := New(ctx, Config{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	registerTestStore(t, ts, st)
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Ученик")

	// a new project starts closed: the student does not see it, not even in lessons
	if resp, _ := do(t, student, "GET", ts.URL+"/p/shop/", ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("closed project for a student: %d", resp.StatusCode)
	}
	if _, body := do(t, student, "GET", ts.URL+"/api/courses/go/applied", ""); body != "{}" {
		t.Fatalf("closed project in the lessons of a student: %s", body)
	}

	// the page lives at /p/, the old address of a course leads there
	if resp, _ := do(t, admin, "GET", ts.URL+"/p/shop/", ""); resp.StatusCode != http.StatusOK {
		t.Fatalf("project page: %d", resp.StatusCode)
	}
	if resp, _ := do(t, admin, "GET", ts.URL+"/c/shop/", ""); resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/p/shop/" {
		t.Fatalf("redirect: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	if resp, _ := do(t, admin, "GET", ts.URL+"/p/go/", ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a course is not a project: %d", resp.StatusCode)
	}

	// links: titles of known lessons only
	_, body := do(t, admin, "GET", ts.URL+"/api/courses/shop/links", "")
	var links map[string]LessonLink
	json.Unmarshal([]byte(body), &links)
	if l := links["go:http"]; l.N != 35 || l.Ready || len(links) != 2 {
		t.Fatalf("links: %s", body)
	}
	if !links["go:ifaces"].Ready {
		t.Fatalf("ready lesson: %s", body)
	}

	// the lesson knows the step it leads to, with the number of the step
	_, body = do(t, admin, "GET", ts.URL+"/api/courses/go/applied", "")
	var applied map[string][]AppliedStep
	json.Unmarshal([]byte(body), &applied)
	if a := applied["ifaces"]; len(a) != 1 || a[0].Num != "1.2" || a[0].Project != "shop" || a[0].Why != "пригодится" {
		t.Fatalf("applied: %s", body)
	}

	level := func() Overview {
		t.Helper()
		_, body := do(t, admin, "GET", ts.URL+"/api/overview", "")
		var ov struct{ Courses []Overview }
		json.Unmarshal([]byte(body), &ov)
		for _, c := range ov.Courses {
			if c.ID == "shop" {
				return c
			}
		}
		t.Fatalf("no project in the overview: %s", body)
		return Overview{}
	}
	if o := level(); o.Type != "project" || len(o.Levels) != 2 || o.Levels[0].Total != 2 || o.Next.Num != "1.1" {
		t.Fatalf("overview: %+v", o)
	}

	// closing a step moves the current one; returning it to work brings it back
	mark := func(v string, at int64) {
		t.Helper()
		data := `{"items":{"done:one.a":{"v":` + v + `,"at":` + itoa(int(at)) + `}}}`
		if resp, body := do(t, admin, "POST", ts.URL+"/api/progress/shop", data); resp.StatusCode != http.StatusOK {
			t.Fatalf("mark: %d %s", resp.StatusCode, body)
		}
	}
	now := time.Now().UnixMilli()
	mark(`"2026-11-01"`, now-2000)
	if o := level(); o.Done != 1 || o.Levels[0].Closed != 1 || o.Next.Num != "1.2" {
		t.Fatalf("after closing: %+v", o)
	}
	mark(`0`, now-1000)
	if o := level(); o.Done != 0 || o.Levels[0].Closed != 0 || o.Next.Num != "1.1" {
		t.Fatalf("after reopening: %+v", o)
	}

	// a deleted course is gone with its progress and does not come back from content/
	if resp, body := do(t, student, "DELETE", ts.URL+"/api/admin/courses/shop", ""); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("student deletes a course: %d %s", resp.StatusCode, body)
	}
	defer func() {
		if resp, body := do(t, admin, "DELETE", ts.URL+"/api/admin/courses/shop", ""); resp.StatusCode != http.StatusOK {
			t.Fatalf("delete: %d %s", resp.StatusCode, body)
		}
		if resp, _ := do(t, admin, "GET", ts.URL+"/p/shop/", ""); resp.StatusCode != http.StatusNotFound {
			t.Fatalf("deleted project page: %d", resp.StatusCode)
		}
		left, err := st.Progress(ctx, 1, "shop")
		if err != nil || len(left) != 0 {
			t.Fatalf("progress left: %v %v", left, err)
		}
		imported, err := st.ImportContent(ctx, []*course.Course{project})
		if err != nil || !imported[0].Deleted {
			t.Fatalf("deleted course came back: %+v %v", imported, err)
		}
	}()

	// search numbers steps by level
	if _, body := do(t, admin, "GET", ts.URL+"/api/search?q=%D0%91&course=shop", ""); !strings.Contains(body, "Шаг 1.2") && !strings.Contains(body, "Урок 1.2") {
		t.Fatalf("search: %s", body)
	}
}
