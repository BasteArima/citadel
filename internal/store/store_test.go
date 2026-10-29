package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"citadel/internal/course"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "citadel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func testCourse(title string) *course.Course {
	return &course.Course{Schema: 1, ID: "go", Title: title, Metal: "iron", Tool: course.Tool{Name: "Go", Version: "1.27"},
		Root: []*course.Node{{ID: "s", Kind: course.KindSection, Title: "Раздел"}}}
}

func TestImportContentVersions(t *testing.T) {
	s, ctx := open(t), context.Background()
	steps := []struct {
		title   string
		version int
		isNew   bool
	}{
		{"Первая", 1, true},
		{"Первая", 1, false}, // the same content does not make a version
		{"Вторая", 2, true},
	}
	for _, st := range steps {
		res, err := s.ImportContent(ctx, []*course.Course{testCourse(st.title)})
		if err != nil {
			t.Fatal(err)
		}
		if res[0].Version != st.version || res[0].New != st.isNew {
			t.Fatalf("%s: got %+v", st.title, res[0])
		}
	}
	pub, err := s.Published(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(pub) != 1 || pub[0].Title != "Вторая" {
		t.Fatalf("published: %+v", pub)
	}
}

func TestReopenKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "citadel.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ImportContent(context.Background(), []*course.Course{testCourse("A")}); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path) // migrations must not run twice
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	pub, _ := s.Published(context.Background())
	if len(pub) != 1 {
		t.Fatalf("got %d courses after reopen", len(pub))
	}
}

func TestSessions(t *testing.T) {
	s, ctx := open(t), context.Background()
	u, err := s.SignIn(ctx, "Baste", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	u2, err := s.SignIn(ctx, "baste", RoleStudent) // same person, role follows the config
	if err != nil {
		t.Fatal(err)
	}
	if u2.ID != u.ID || u2.Name != "Baste" || u2.Role != RoleStudent {
		t.Fatalf("second sign-in: %+v", u2)
	}
	tok, err := s.CreateSession(ctx, u.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.UserBySession(ctx, tok); err != nil || got.ID != u.ID {
		t.Fatalf("session lookup: %+v %v", got, err)
	}
	if _, err := s.UserBySession(ctx, tok+"x"); !errors.Is(err, ErrNoSession) {
		t.Fatalf("wrong token: %v", err)
	}
	expired, _ := s.CreateSession(ctx, u.ID, -time.Minute)
	if _, err := s.UserBySession(ctx, expired); !errors.Is(err, ErrNoSession) {
		t.Fatalf("expired token: %v", err)
	}
	if err := s.DeleteSession(ctx, tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, tok); !errors.Is(err, ErrNoSession) {
		t.Fatalf("deleted token: %v", err)
	}
}

func TestMergeProgressNewerWins(t *testing.T) {
	s, ctx := open(t), context.Background()
	u, _ := s.SignIn(ctx, "A", RoleStudent)
	v := func(s string) json.RawMessage { return json.RawMessage(`"` + s + `"`) }

	// device 1
	if _, err := s.MergeProgress(ctx, u.ID, "go", map[string]Item{"done:a": {V: v("2026-10-01"), At: 100}, "q:a.q1": {V: json.RawMessage(`1`), At: 100}}); err != nil {
		t.Fatal(err)
	}
	// device 2 was offline: one older mark, one newer, one new key
	got, err := s.MergeProgress(ctx, u.ID, "go", map[string]Item{
		"done:a": {V: v("2026-09-01"), At: 50},       // older: ignored
		"q:a.q1": {V: json.RawMessage(`1`), At: 200}, // newer: wins
		"q:a.q2": {V: json.RawMessage(`1`), At: 150},
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(got["done:a"].V) != `"2026-10-01"` || got["q:a.q1"].At != 200 || len(got) != 3 {
		t.Fatalf("merged: %+v", got)
	}
	other, _ := s.Progress(ctx, u.ID, "postgres")
	if len(other) != 0 {
		t.Fatalf("progress leaked into another course: %+v", other)
	}
}

func TestBackup(t *testing.T) {
	s, ctx := open(t), context.Background()
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("A")}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "backup.db")
	if err := s.Backup(ctx, path); err != nil {
		t.Fatal(err)
	}
	if err := s.Backup(ctx, path); err == nil {
		t.Fatal("backup over an existing file must fail")
	}
	b, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	pub, _ := b.Published(ctx)
	if len(pub) != 1 {
		t.Fatalf("backup has %d courses", len(pub))
	}
}
