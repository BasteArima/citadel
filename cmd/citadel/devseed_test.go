package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"citadel/internal/course"
	"citadel/internal/server"
	"citadel/internal/store"
)

func TestDevSeed(t *testing.T) {
	t.Chdir("../..")
	dir := filepath.Join(t.TempDir(), "dev")
	if err := devSeed([]string{"-data", dir}); err != nil {
		t.Fatal(err)
	}
	if marked, err := store.IsDevelopmentDatabase(context.Background(), dbPath(dir)); err != nil || !marked {
		t.Fatalf("seed did not persist its database marker: marked=%t err=%v", marked, err)
	}
	if err := devSeed([]string{"-data", dir}); err == nil {
		t.Fatal("replaced database without force")
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := devSeed([]string{"-data", dir, "-force"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep.txt")); err != nil {
		t.Fatal("force removed unrelated file")
	}
	st, err := store.Open(dbPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	credentials, err := os.ReadFile(filepath.Join(dir, "dev-login.txt"))
	if err != nil {
		t.Fatal(err)
	}
	users := map[string]store.User{}
	for _, line := range strings.Split(strings.TrimSpace(string(credentials)), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			t.Fatal("invalid credentials file")
		}
		u, err := st.Authenticate(ctx, fields[0], fields[1])
		if err != nil {
			t.Fatal("generated credentials do not authenticate")
		}
		users[fields[0]] = u
	}
	if len(users) != 3 || users["ira"].Name != "Ира" || users["ira"].Role != store.RoleAuthor || users["devadmin"].Role != store.RoleAdmin {
		t.Fatal("wrong seeded accounts")
	}
	pub, err := st.Published(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var withoutExplanation []string
	for _, c := range pub {
		if errs := course.Errors(course.Validate(c)); len(errs) != 0 {
			t.Fatalf("invalid seeded course %s: %v", c.ID, errs)
		}
		if strings.HasPrefix(c.ID, "dev-course-") {
			c.Walk(func(n, _ *course.Node) {
				for _, b := range n.Blocks {
					why, _ := b["why"].(string)
					if b.Type() == "question" && strings.TrimSpace(why) == "" {
						withoutExplanation = append(withoutExplanation, c.ID+":"+b["id"].(string))
					}
				}
			})
		}
	}
	if got := strings.Join(withoutExplanation, ","); got != "dev-course-01:lesson-1.q" {
		t.Fatalf("explanation filter fixture: %s", got)
	}
	h, err := server.New(ctx, server.Config{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	for _, login := range []string{"devadmin", "student"} {
		token, err := st.CreateSession(ctx, users[login].ID, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("GET", "/api/overview?today="+time.Now().Format(time.DateOnly), nil)
		r.AddCookie(&http.Cookie{Name: "citadel_session", Value: token})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		// Session cookie name is part of the HTTP contract; no passwords enter logs.
		if w.Code != 200 {
			t.Fatalf("overview returned %d", w.Code)
		}
		var ov struct {
			Courses    []server.Overview
			Soon       []server.Soon
			Directions []store.Direction
		}
		if err := json.Unmarshal(w.Body.Bytes(), &ov); err != nil {
			t.Fatal(err)
		}
		counts := map[string]int{}
		due, active, complete, project := 0, 0, 0, false
		private := false
		for _, c := range ov.Courses {
			if c.Type == course.TypeProject {
				project = c.Started
				continue
			}
			counts[c.Direction]++
			due += c.Due
			if c.Done == c.Lessons {
				complete++
			} else if c.Started {
				active++
			}
			if c.ID == "dev-course-04" {
				private = true
			}
		}
		for _, c := range ov.Soon {
			counts[c.Direction]++
		}
		if len(ov.Directions) != 3 || counts["programming"] != 6 || counts["narrative"] != 3 || counts[""] != 1 || !private {
			t.Fatalf("wrong catalog counts for %s: %v", login, counts)
		}
		if login == "devadmin" && (due != 3 || active != 2 || complete != 1 || !project) {
			t.Fatalf("wrong admin progress: due=%d active=%d complete=%d project=%t", due, active, complete, project)
		}
		if login == "student" && (due != 0 || active != 0 || complete != 0 || project) {
			t.Fatal("student has progress")
		}
	}
}

func TestSeedCoursesCheck(t *testing.T) {
	dir := t.TempDir()
	for _, c := range seedCourses() {
		encoded, err := course.Encode(c)
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, c.ID)
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "course.json"), encoded, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := check([]string{"-content", dir}); err != nil {
		t.Fatal(err)
	}
}

func TestDevSeedProtectedData(t *testing.T) {
	for _, name := range []string{"data", "DATA"} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), name)
			for _, force := range []bool{false, true} {
				args := []string{"-data", dir}
				if force {
					args = append(args, "-force")
				}
				if err := devSeed(args); err == nil || !strings.Contains(err.Error(), "refusing to seed data") {
					t.Fatalf("accepted protected directory with force=%t: %v", force, err)
				}
				if _, err := os.Stat(dir); !os.IsNotExist(err) {
					t.Fatal("touched protected directory")
				}
			}
			// Even a marked development database must not be replaced inside data.
			if err := os.Mkdir(dir, 0o700); err != nil {
				t.Fatal(err)
			}
			st, err := store.Open(dbPath(dir))
			if err != nil {
				t.Fatal(err)
			}
			if err := st.MarkDevelopment(context.Background()); err != nil {
				t.Fatal(err)
			}
			if err := st.Close(); err != nil {
				t.Fatal(err)
			}
			before := seedDirectorySnapshot(t, dir)
			if err := devSeed([]string{"-data", dir, "-force"}); err == nil {
				t.Fatal("replaced a marked database inside data")
			}
			assertSeedDirectoryUnchanged(t, dir, before)
		})
	}
}

func TestDevSeedRefusesUnmarkedDatabase(t *testing.T) {
	for _, kind := range []string{"current", "old-schema", "invalid", "orphan-wal"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := dbPath(dir)
			switch kind {
			case "current":
				st, err := store.Open(path)
				if err != nil {
					t.Fatal(err)
				}
				if err := st.CreateDirection(context.Background(), "personal", "Личные данные"); err != nil {
					t.Fatal(err)
				}
				if err := st.Close(); err != nil {
					t.Fatal(err)
				}
			case "old-schema":
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec("CREATE TABLE personal (value TEXT); INSERT INTO personal VALUES ('keep')"); err != nil {
					t.Fatal(err)
				}
				if err := db.Close(); err != nil {
					t.Fatal(err)
				}
			case "invalid":
				if err := os.WriteFile(path, []byte("not a SQLite database"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			// The marker must be in the database, not a nearby file or an account name.
			for _, name := range []string{"dev-login.txt", "keep.txt"} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte("keep"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "invalid" || kind == "orphan-wal" {
				for _, suffix := range []string{"-wal", "-shm"} {
					if err := os.WriteFile(path+suffix, []byte("keep sidecar"), 0o600); err != nil {
						t.Fatal(err)
					}
				}
			}
			before := seedDirectorySnapshot(t, dir)
			if err := devSeed([]string{"-data", dir, "-force"}); err == nil || !strings.Contains(err.Error(), "not a test database") {
				t.Fatalf("expected refusal for unmarked database: %v", err)
			}
			assertSeedDirectoryUnchanged(t, dir, before)
		})
	}
}

func seedDirectorySnapshot(t *testing.T, dir string) map[string][]byte {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := make(map[string][]byte)
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		snapshot[e.Name()] = data
	}
	return snapshot
}

func assertSeedDirectoryUnchanged(t *testing.T, dir string, before map[string][]byte) {
	t.Helper()
	after := seedDirectorySnapshot(t, dir)
	if len(before) != len(after) {
		t.Fatal("refused seed added or removed files")
	}
	for name, data := range before {
		if !bytes.Equal(data, after[name]) {
			t.Fatalf("refused seed changed %s", name)
		}
	}
}
