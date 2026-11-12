package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/argon2"
)

func TestPasswordPHC(t *testing.T) {
	password := "длинный пароль 🔐"
	a, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	b, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if a == b || !strings.HasPrefix(a, "$argon2id$v=19$m=19456,t=2,p=1$") || !CheckPassword(a, password) || CheckPassword(a, password+"x") {
		t.Fatal("hash, salt or verification failed")
	}
	// Verification uses the stored parameters, not just today's defaults.
	salt := []byte("0123456789abcdef")
	key := argon2.IDKey([]byte(password), salt, 3, 20480, 2, 32)
	changed := fmt.Sprintf("$argon2id$v=19$m=20480,t=3,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
	if !CheckPassword(changed, password) {
		t.Fatal("changed parameters rejected")
	}
	for _, hash := range []string{"", "$argon2i$v=19$m=19456,t=2,p=1$a$b", strings.Replace(a, "v=19", "v=18", 1), strings.Replace(a, "p=1", "p=0", 1), strings.Replace(a, "m=19456", "m=4294967295", 1), strings.Replace(a, "t=2", "t=-1", 1), a + "$extra", strings.Replace(a, "p=1", "p=1,z=2", 1)} {
		if CheckPassword(hash, password) {
			t.Fatal("malformed hash accepted")
		}
	}
}

func TestAccountLifecycle(t *testing.T) {
	s, ctx := open(t), context.Background()
	u, err := s.CreateUser(ctx, "Student", "Ученик", "old password 123", RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	if u.Login != "student" {
		t.Fatal("login not normalized")
	}
	if _, err := s.Authenticate(ctx, "STUDENT", "old password 123"); err != nil {
		t.Fatal(err)
	}
	for _, login := range []string{"student", "missing"} {
		if _, err := s.Authenticate(ctx, login, "wrong password"); !errors.Is(err, ErrCredentials) {
			t.Fatal("bad credentials accepted")
		}
	}
	a, _ := s.CreateSession(ctx, u.ID, time.Hour)
	b, _ := s.CreateSession(ctx, u.ID, time.Hour)
	if err := s.ChangePassword(ctx, u.ID, "wrong password", "new password 123", a); !errors.Is(err, ErrCredentials) {
		t.Fatal("wrong current password accepted")
	}
	if err := s.ChangePassword(ctx, u.ID, "old password 123", "new password 123", a); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, a); err != nil {
		t.Fatal("current session lost")
	}
	if _, err := s.UserBySession(ctx, b); !errors.Is(err, ErrNoSession) {
		t.Fatal("other session survived")
	}
	if _, err := s.Authenticate(ctx, "student", "old password 123"); !errors.Is(err, ErrCredentials) {
		t.Fatal("old password survived")
	}
	if err := s.SetDisabled(ctx, u.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, "student", "new password 123"); !errors.Is(err, ErrCredentials) {
		t.Fatal("disabled user signed in")
	}
	if _, err := s.UserBySession(ctx, a); !errors.Is(err, ErrNoSession) {
		t.Fatal("disabled user's session survived")
	}
	if _, err := s.CreateSession(ctx, u.ID, time.Hour); !errors.Is(err, ErrCredentials) {
		t.Fatal("disabled user got new session")
	}
	if err := s.SetDisabled(ctx, u.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, a); !errors.Is(err, ErrNoSession) {
		t.Fatal("old session resurrected")
	}
	if _, err := s.Authenticate(ctx, "student", "new password 123"); err != nil {
		t.Fatal(err)
	}
	c, _ := s.CreateSession(ctx, u.ID, time.Hour)
	if err := s.SetPassword(ctx, u.ID, "reset password 123"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, c); !errors.Is(err, ErrNoSession) {
		t.Fatal("reset did not close sessions")
	}
}

func TestAccountValidation(t *testing.T) {
	s, ctx := open(t), context.Background()
	for _, password := range []string{"short", strings.Repeat("x", 257), "long-login"} {
		if _, err := s.CreateUser(ctx, "long-login", "User", password, RoleStudent); err == nil {
			t.Fatal("invalid password accepted")
		}
	}
	u, err := s.CreateUser(ctx, "first", "Первый", strings.Repeat("я", 256), RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(ctx, "FIRST", "Второй", "long password", RoleStudent); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate login accepted")
	}
	v, err := s.CreateUser(ctx, "second", "Второй", "long password", RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetName(ctx, v.ID, "Первый"); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate name accepted")
	}
	if err := s.SetLogin(ctx, v.ID, "first"); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate login accepted")
	}
	if err := s.SetName(ctx, u.ID, "  Новое   имя  "); err != nil {
		t.Fatal(err)
	}
	if got, err := s.Authenticate(ctx, "first", strings.Repeat("я", 256)); err != nil || got.Name != "Новое имя" {
		t.Fatal("name change failed")
	}
}

func TestPasswordResetInvalidatesPendingLogin(t *testing.T) {
	s, ctx := open(t), context.Background()
	created, err := s.CreateUser(ctx, "pending", "Pending", "old password 123", RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := s.Authenticate(ctx, "pending", "old password 123")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetPassword(ctx, created.ID, "new password 123"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAuthenticatedSession(ctx, pending, time.Hour); !errors.Is(err, ErrCredentials) {
		t.Fatal("stale authentication created a session after reset")
	}
	current, err := s.Authenticate(ctx, "pending", "new password 123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAuthenticatedSession(ctx, current, time.Hour); err != nil {
		t.Fatal(err)
	}
}

func TestLastAdminProtectionAcrossConnections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "citadel.db")
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	ctx := context.Background()
	u, _ := a.CreateUser(ctx, "admin-one", "One", "long password", RoleAdmin)
	v, _ := a.CreateUser(ctx, "admin-two", "Two", "long password", RoleAdmin)
	done := make(chan error, 2)
	go func() { done <- a.SetRole(ctx, u.ID, RoleStudent) }()
	go func() { done <- b.SetDisabled(ctx, v.ID, true) }()
	x, y := <-done, <-done
	if (x == nil) == (y == nil) {
		t.Fatalf("expected one protected admin: %v %v", x, y)
	}
	if x != nil && !errors.Is(x, ErrConflict) || y != nil && !errors.Is(y, ErrConflict) {
		t.Fatalf("unexpected errors: %v %v", x, y)
	}
	if ok, err := a.HasSignInAdmin(ctx); err != nil || !ok {
		t.Fatal("no usable admin remains")
	}
}

func TestLegacyAccountMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations[:7] {
		if _, err := db.Exec(migration); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (7); INSERT INTO users (id, name, role, created_at) VALUES (1, 'Baste', 'admin', 'old'), (2, 'Иван', 'student', 'old'), (3, 'Kate', 'student', 'old'), (4, 'Kate', 'student', 'old'); INSERT INTO sessions VALUES (?, 1, 'old', '2099-01-01T00:00:00Z')`, tokenHash("legacy-session")); err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	users, err := s.Users(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64]string{1: "baste", 2: "", 3: "kate", 4: ""}
	for _, u := range users {
		if u.Login != want[u.ID] {
			t.Fatalf("id %d: login %q", u.ID, u.Login)
		}
	}
	if ok, _ := s.HasSignInAdmin(ctx); ok {
		t.Fatal("legacy admin has no password")
	}
	if _, err := s.UserBySession(ctx, "legacy-session"); err != nil {
		t.Fatal("migration changed existing sessions")
	}
	if err := s.SetLogin(ctx, 2, "ivan"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPassword(ctx, 1, "new password 123"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, "baste", "new password 123"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, "legacy-session"); !errors.Is(err, ErrNoSession) {
		t.Fatal("reset left legacy session")
	}
}
