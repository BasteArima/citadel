package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
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
	u, err := s.SignIn(ctx, "Baste", true)
	if err != nil {
		t.Fatal(err)
	}
	// same person; not in the config list any more, but the stored role stays
	u2, err := s.SignIn(ctx, "baste", false)
	if err != nil {
		t.Fatal(err)
	}
	if u2.ID != u.ID || u2.Name != "Baste" || u2.Role != RoleAdmin {
		t.Fatalf("second sign-in: %+v", u2)
	}
	if err := s.SetRole(ctx, u.ID, RoleStudent); err != nil {
		t.Fatal(err)
	}
	if u3, _ := s.SignIn(ctx, "Baste", false); u3.Role != RoleStudent {
		t.Fatalf("role set in the admin panel: %+v", u3)
	}
	if u4, _ := s.SignIn(ctx, "Baste", true); u4.Role != RoleAdmin {
		t.Fatalf("CITADEL_ADMINS always wins: %+v", u4)
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

func TestDraftsAndPublishing(t *testing.T) {
	s, ctx := open(t), context.Background()
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Из файла")}); err != nil {
		t.Fatal(err)
	}
	enc := func(title string) []byte { data, _ := course.Encode(testCourse(title)); return data }

	// an editor save is a new version on top of the latest; students still see v1
	v, err := s.SaveDraft(ctx, "go", enc("Правка"), 1, "Baste", "")
	if err != nil || v != 2 {
		t.Fatalf("save: %d %v", v, err)
	}
	if _, err := s.SaveDraft(ctx, "go", enc("Чужая"), 1, "Other", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale save: %v", err)
	}
	if pub, _ := s.Published(ctx); pub[0].Title != "Из файла" {
		t.Fatalf("draft leaked to students: %s", pub[0].Title)
	}
	// content/ no longer overrides a course edited in the editor
	res, err := s.ImportContent(ctx, []*course.Course{testCourse("Новый файл")})
	if err != nil || !res[0].Skipped {
		t.Fatalf("import over the editor: %+v %v", res, err)
	}
	if err := s.Publish(ctx, "go", 2); err != nil {
		t.Fatal(err)
	}
	if pub, _ := s.Published(ctx); pub[0].Title != "Правка" {
		t.Fatalf("published: %s", pub[0].Title)
	}
	if err := s.Publish(ctx, "go", 9); !errors.Is(err, ErrNotFound) {
		t.Fatalf("publish a missing version: %v", err)
	}
	vs, _ := s.Versions(ctx, "go")
	if len(vs) != 2 || !vs[0].Published || vs[0].Author != "Baste" || vs[1].Author != AuthorContent {
		t.Fatalf("versions: %+v", vs)
	}
	list, _ := s.Courses(ctx)
	if len(list) != 1 || list[0].Published != 2 || list[0].Title != "Правка" {
		t.Fatalf("courses: %+v", list)
	}

	// a new course is unpublished until someone publishes it
	if err := s.CreateCourse(ctx, "pg", enc("Postgres"), "Baste"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateCourse(ctx, "pg", enc("Again"), "Baste"); err == nil {
		t.Fatal("a course id must be unique")
	}
	if pub, _ := s.Published(ctx); len(pub) != 1 {
		t.Fatalf("unpublished course is visible: %d", len(pub))
	}
	if data, vi, err := s.Version(ctx, "pg", 0); err != nil || vi.Version != 1 || vi.Published || len(data) == 0 {
		t.Fatalf("latest of pg: %+v %v", vi, err)
	}
}

func TestMergeProgressNewerWins(t *testing.T) {
	s, ctx := open(t), context.Background()
	u, _ := s.SignIn(ctx, "A", false)
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

func TestTokens(t *testing.T) {
	s, ctx := open(t), context.Background()
	tok, secret, err := s.CreateToken(ctx, Token{Name: "claude", CanPropose: true, Courses: []string{"go"}, CreatedBy: "Baste"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, TokenPrefix) || len(secret) < 40 || !strings.HasSuffix(secret, tok.Tail) {
		t.Fatalf("secret %d chars, tail %q", len(secret), tok.Tail)
	}
	got, err := s.TokenBySecret(ctx, secret)
	if err != nil || got.ID != tok.ID || !got.CanPropose || got.CanCreate || !got.Allows("go") || got.Allows("pg") || got.LastUsedAt == "" {
		t.Fatalf("by secret: %+v %v", got, err)
	}
	for _, bad := range []string{"", "cit_", secret + "x", strings.TrimPrefix(secret, TokenPrefix)} {
		if _, err := s.TokenBySecret(ctx, bad); !errors.Is(err, ErrNoToken) {
			t.Errorf("%q: %v", bad, err)
		}
	}
	if err := s.RevokeToken(ctx, tok.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.TokenBySecret(ctx, secret); !errors.Is(err, ErrNoToken) {
		t.Fatalf("revoked token works: %v", err)
	}
	if err := s.RevokeToken(ctx, tok.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoke twice: %v", err)
	}
	list, _ := s.Tokens(ctx)
	if len(list) != 1 || list[0].RevokedAt == "" {
		t.Fatalf("tokens: %+v", list)
	}
}

func TestProposals(t *testing.T) {
	s, ctx := open(t), context.Background()
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Go")}); err != nil {
		t.Fatal(err)
	}
	tok, _, _ := s.CreateToken(ctx, Token{Name: "claude", CanPropose: true, CreatedBy: "Baste"})
	data, _ := course.Encode(testCourse("Go: правка агента"))
	id, err := s.AddProposal(ctx, Proposal{CourseID: "go", TokenID: tok.ID, Agent: "claude", Title: "Опечатки", Base: 1,
		Changes: json.RawMessage(`[]`), Data: data, Status: ProposalPending, Checks: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := s.PendingByCourse(ctx); n["go"] != 1 {
		t.Fatalf("pending: %v", n)
	}
	if _, err := s.AcceptProposal(ctx, id, "go", data, 2, "agent:claude", "Опечатки", "Baste"); !errors.Is(err, ErrConflict) {
		t.Fatalf("accept on a wrong base: %v", err)
	}
	v, err := s.AcceptProposal(ctx, id, "go", data, 1, "agent:claude", "Опечатки", "Baste")
	if err != nil || v != 2 {
		t.Fatalf("accept: %d %v", v, err)
	}
	p, _ := s.Proposal(ctx, id)
	if p.Status != ProposalAccepted || p.Version != 2 || p.DecidedBy != "Baste" || len(p.Data) == 0 {
		t.Fatalf("after accept: %+v", p)
	}
	if err := s.DecideProposal(ctx, id, ProposalRejected, "Baste", "нет", 0); !errors.Is(err, ErrConflict) {
		t.Fatalf("decide twice: %v", err)
	}
	if pub, _ := s.Published(ctx); pub[0].Title != "Go" {
		t.Fatal("an accepted proposal must not publish")
	}
	// a new course from an agent
	pid, _ := s.AddProposal(ctx, Proposal{CourseID: "pg", TokenID: tok.ID, Agent: "claude", Title: "Postgres", NewCourse: true, Data: data, Status: ProposalPending, Checks: json.RawMessage(`{}`)})
	if v, err := s.AcceptProposal(ctx, pid, "pg", data, 0, "agent:claude", "Postgres", "Baste"); err != nil || v != 1 {
		t.Fatalf("accept new course: %d %v", v, err)
	}
	if list, _ := s.Proposals(ctx, ProposalFilter{TokenID: tok.ID}); len(list) != 2 || len(list[0].Data) != 0 {
		t.Fatalf("list: %+v", list)
	}
}

func TestCourseAccess(t *testing.T) {
	s, ctx := open(t), context.Background()
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Go")}); err != nil {
		t.Fatal(err)
	}
	u, _ := s.SignIn(ctx, "Гость", false)
	if a, _ := s.CourseAccess(ctx); a["go"] != AccessPublic {
		t.Fatalf("a new course must be public: %v", a)
	}
	if err := s.SetCourseAccess(ctx, "go", "secret"); err == nil {
		t.Fatal("unknown access accepted")
	}
	if err := s.SetCourseAccess(ctx, "go", AccessPrivate); err != nil {
		t.Fatal(err)
	}
	if err := s.SetUserCourses(ctx, u.ID, []string{"go", "nope"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.UserCourses(ctx, u.ID); len(got) != 1 || got[0] != "go" {
		t.Fatalf("grants (an unknown course is skipped): %v", got)
	}
	if g, _ := s.Grants(ctx); len(g[u.ID]) != 1 {
		t.Fatalf("all grants: %v", g)
	}
	if err := s.SetUserCourses(ctx, 999, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user: %v", err)
	}
}

func TestDeleteToken(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "citadel.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	tok, _, err := s.CreateToken(ctx, Token{Name: "agent", CreatedBy: "Baste", CanPropose: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteToken(ctx, tok.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete a working token: %v", err)
	}
	if err := s.RevokeToken(ctx, tok.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteToken(ctx, tok.ID); err != nil {
		t.Fatalf("delete a revoked token: %v", err)
	}
	if err := s.DeleteToken(ctx, tok.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete twice: %v", err)
	}
}
