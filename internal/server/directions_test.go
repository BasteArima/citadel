package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"citadel/internal/store"
)

func TestDirectionRoutesAndOverview(t *testing.T) {
	f := authorServer(t)
	for _, client := range []*http.Client{f.admin, f.author, f.other, f.student} {
		f.act(t, client, "GET", "/api/directions", "", 200)
	}
	f.act(t, f.ts.Client(), "GET", "/api/directions", "", 401)
	f.act(t, f.admin, "POST", "/api/admin/directions", `{"id":"programming","title":"Программирование"}`, 200)
	f.act(t, f.admin, "POST", "/api/admin/directions", `{"id":"narrative","title":"Нарратив"}`, 200)
	f.act(t, f.admin, "POST", "/api/admin/directions", `{"id":"duplicate","title":"программирование"}`, 400)
	f.act(t, f.admin, "PUT", "/api/admin/directions/narrative", `{"title":"Нарратив и режиссура","position":0}`, 200)
	f.act(t, f.admin, "PUT", "/api/admin/courses/go/direction", `{"direction":"programming"}`, 200)
	f.act(t, f.author, "PUT", "/api/admin/courses/own/direction", `{"direction":"narrative"}`, 200)
	f.act(t, f.author, "PUT", "/api/admin/courses/other-course/direction", `{"direction":"narrative"}`, 404)
	f.act(t, f.student, "PUT", "/api/admin/courses/own/direction", `{"direction":"narrative"}`, 403)
	for _, client := range []*http.Client{f.author, f.other, f.student} {
		f.act(t, client, "POST", "/api/admin/directions", `{"id":"forbidden","title":"Нельзя"}`, 403)
		f.act(t, client, "PUT", "/api/admin/directions/narrative", `{"title":"Нельзя"}`, 403)
		f.act(t, client, "DELETE", "/api/admin/directions/narrative", "", 403)
	}
	f.importCourse(t, f.author, "own-project", true)
	f.act(t, f.author, "POST", "/api/admin/courses/own-project/publish", `{"version":1}`, 200)
	f.act(t, f.author, "PUT", "/api/admin/courses/own-project/direction", `{"direction":"narrative"}`, 200)
	f.importCourse(t, f.admin, "soon", false)
	f.act(t, f.admin, "PUT", "/api/admin/courses/soon/direction", `{"direction":"programming"}`, 200)
	var result struct {
		Courses    []Overview
		Soon       []Soon
		Directions []store.Direction
	}
	if err := json.Unmarshal([]byte(f.act(t, f.author, "GET", "/api/overview", "", 200)), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Directions) != 2 || result.Directions[0].ID != "narrative" {
		t.Fatal("directions missing or unordered")
	}
	found := 0
	for _, c := range result.Courses {
		if c.ID == "own" || c.ID == "own-project" {
			found++
			if c.Author != f.user.Name || c.Direction != "narrative" {
				t.Fatalf("missing course/project metadata: %+v", c)
			}
		}
		if c.ID == "go" && (c.Author != "" || c.Direction != "programming") {
			t.Fatal("wrong platform metadata")
		}
		if c.ID == "other-course" {
			t.Fatal("private course leaked")
		}
	}
	if found != 2 || len(result.Soon) != 1 || result.Soon[0].Direction != "programming" {
		t.Fatal("missing project or soon metadata")
	}
	f.act(t, f.admin, "DELETE", "/api/admin/directions/narrative", "", 204)
	if err := json.Unmarshal([]byte(f.act(t, f.author, "GET", "/api/overview", "", 200)), &result); err != nil {
		t.Fatal(err)
	}
	for _, c := range result.Courses {
		if (c.ID == "own" || c.ID == "own-project") && c.Direction != "" {
			t.Fatal("deleted direction still assigned")
		}
	}
	f.act(t, f.admin, "PUT", "/api/admin/courses/go/direction", `{"direction":"missing"}`, 400)
	f.act(t, f.admin, "PUT", "/api/admin/courses/go/direction", `{"direction":""}`, 200)
	for _, action := range []string{store.AuditDirectionCreated, store.AuditDirectionUpdated, store.AuditDirectionDeleted, store.AuditCourseDirection} {
		out := f.act(t, f.admin, "GET", "/api/admin/audit?action="+action, "", 200)
		var entries []store.AuditEntry
		if err := json.Unmarshal([]byte(out), &entries); err != nil || len(entries) == 0 || entries[0].Actor == "" || entries[0].Target == "" {
			t.Fatalf("missing audit for %s", action)
		}
	}
}
