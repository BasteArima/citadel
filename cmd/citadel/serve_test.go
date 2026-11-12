package main

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"citadel/internal/course"
)

// A course file that fails a newer, stricter check must not stop the service: the database
// keeps its version, the file is skipped and logged (decision 0009).
func TestInvalidContentFileIsSkipped(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"demo", "broken"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "content-demo", "demo", "course.json"))
		if err != nil {
			t.Fatal(err)
		}
		c, err := course.Decode(raw)
		if err != nil {
			t.Fatal(err)
		}
		c.ID = id
		if id == "broken" {
			c.About = "печатает <nil>"
		}
		data, err := course.Encode(c)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(dir, id), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, id, "course.json"), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	courses, err := course.LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	got := validCourses(courses, slog.New(slog.NewTextHandler(&logs, nil)))
	if len(got) != 1 || got[0].ID != "demo" {
		t.Fatalf("want only demo, got %d courses", len(got))
	}
	if !strings.Contains(logs.String(), "id=broken") {
		t.Fatalf("skipped course is not logged: %s", logs.String())
	}
}
