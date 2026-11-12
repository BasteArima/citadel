package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func TestOwnershipMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "before-authors.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations[:10] {
		if _, err := db.Exec(migration); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (10);
 INSERT INTO users (id,name,role,created_at) VALUES (1,'Admin','admin','old');
 INSERT INTO courses (id,created_at) VALUES ('go','old');
 INSERT INTO tokens (name,hash,tail,can_propose,can_create,created_by,created_at) VALUES ('legacy',?,'test',1,1,'Admin','old')`, tokenHash("cit_legacy-test")); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	owner, err := s.CourseOwner(ctx, "go")
	if err != nil || owner != 0 {
		t.Fatalf("legacy owner: %d %v", owner, err)
	}
	u, err := s.UserInfoByID(ctx, 1)
	if err != nil || u.CourseLimit != 10 {
		t.Fatalf("default limit: %+v %v", u, err)
	}
	tok, err := s.TokenBySecret(ctx, "cit_legacy-test")
	if err != nil || tok.UserID != 0 || !s.TokenAllows(ctx, tok, "go") {
		t.Fatalf("legacy token: %+v %v", tok, err)
	}
}

func TestConcurrentOwnedCourseLimit(t *testing.T) {
	s, ctx := open(t), context.Background()
	u, err := s.CreateUser(ctx, "author", "Автор", "test-password-long", RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	limit := 2
	if err := s.SetCourseLimit(ctx, u.ID, &limit); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 12)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results <- s.CreateOwnedCourse(ctx, fmt.Sprintf("course-%d", i), []byte(`{}`), "author", u.ID)
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	made, limited := 0, 0
	for err := range results {
		switch {
		case err == nil:
			made++
		case errors.Is(err, ErrCourseLimit):
			limited++
		default:
			t.Fatal(err)
		}
	}
	if made != 2 || limited != 10 {
		t.Fatalf("made %d, limited %d", made, limited)
	}
}

func TestLegacyAndAdminTokenScope(t *testing.T) {
	s, ctx := open(t), context.Background()
	author, err := s.CreateUser(ctx, "author", "Автор", "test-password-long", RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := s.CreateUser(ctx, "admin", "Админ", "test-password-long", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		id    string
		owner int64
	}{{"platform", 0}, {"author-course", author.ID}, {"admin-course", admin.ID}} {
		if err := s.CreateOwnedCourse(ctx, c.id, []byte(`{}`), "test", c.owner); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct {
		token Token
		want  map[string]bool
	}{
		{Token{}, map[string]bool{"platform": true, "author-course": false, "admin-course": false}},
		{Token{UserID: admin.ID}, map[string]bool{"platform": true, "author-course": false, "admin-course": true}},
		{Token{UserID: admin.ID, Courses: []string{"author-course"}}, map[string]bool{"platform": false, "author-course": true, "admin-course": false}},
		{Token{UserID: author.ID, Courses: []string{"platform", "author-course", "admin-course"}}, map[string]bool{"platform": false, "author-course": true, "admin-course": false}},
	} {
		for id, want := range check.want {
			if got := s.TokenAllows(ctx, check.token, id); got != want {
				t.Errorf("token %+v, course %s: got %v, want %v", check.token, id, got, want)
			}
		}
	}
}

func TestProposalOwnershipBeforeLimit(t *testing.T) {
	s, ctx := open(t), context.Background()
	author, err := s.CreateUser(ctx, "writer", "Автор", "test-password-long", RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		id    string
		owner int64
	}{{"own", author.ID}, {"platform", 0}} {
		if err := s.CreateOwnedCourse(ctx, c.id, []byte(`{}`), "test", c.owner); err != nil {
			t.Fatal(err)
		}
	}
	tk, _, err := s.CreateToken(ctx, Token{Name: "test"})
	if err != nil {
		t.Fatal(err)
	}
	own, err := s.AddProposal(ctx, Proposal{CourseID: "own", TokenID: tk.ID, Title: "own", Status: ProposalPending})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 501; i++ {
		if _, err := tx.ExecContext(ctx, `INSERT INTO proposals (course_id,token_id,agent,title,base,changes,data,status,checks,created_at) VALUES ('platform',?,'test','foreign',1,'[]','{}','pending','{}','now')`, tk.ID); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	ps, err := s.Proposals(ctx, ProposalFilter{OwnerID: author.ID})
	if err != nil || len(ps) != 1 || ps[0].ID != own {
		t.Fatalf("author proposal hidden behind foreign result limit: %d %v", len(ps), err)
	}
}
