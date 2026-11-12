package store

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"citadel/internal/course"
)

const inviteTestPassword = "invite-test-password"

func inviteAdmin(t *testing.T, s *Store) User {
	t.Helper()
	u, err := s.CreateUser(context.Background(), "admin", "Админ", inviteTestPassword, RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func makeInvite(t *testing.T, s *Store, admin User, max *int64) Invite {
	t.Helper()
	i, err := s.CreateInvite(context.Background(), Invite{Role: RoleAuthor, Note: "личная пометка", CreatedBy: admin.ID, MaxUses: max, Courses: []string{"go", "deleted"}})
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestInviteRegistration(t *testing.T) {
	s, ctx := open(t), context.Background()
	admin := inviteAdmin(t, s)
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Закрытый курс")}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCourseAccess(ctx, "go", AccessPrivate); err != nil {
		t.Fatal(err)
	}
	n := int64(2)
	i := makeInvite(t, s, admin, &n)
	raw, err := base64.RawURLEncoding.DecodeString(i.Code)
	if err != nil || len(raw) != 16 {
		t.Fatal("invalid code format")
	}
	u, session, err := s.RegisterInvite(ctx, i.Code, "STUDENT", "Ученик", inviteTestPassword, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if u.Role != RoleAuthor || u.Login != "student" {
		t.Fatal("wrong account role or login")
	}
	if got, err := s.UserBySession(ctx, session); err != nil || got.ID != u.ID {
		t.Fatal("registration session missing")
	}
	grants, err := s.UserCourses(ctx, u.ID)
	if err != nil || len(grants) != 1 || grants[0] != "go" {
		t.Fatalf("grants: %v %v", grants, err)
	}
	var inviteID int64
	if err := s.db.QueryRow(`SELECT invite_id FROM users WHERE id = ?`, u.ID).Scan(&inviteID); err != nil || inviteID != i.ID {
		t.Fatal("invite attribution missing")
	}
	for _, attempt := range []struct{ login, name string }{{"student", "Другое имя"}, {"another", "Ученик"}} {
		if _, _, err := s.RegisterInvite(ctx, i.Code, attempt.login, attempt.name, inviteTestPassword, time.Hour); !errors.Is(err, ErrConflict) {
			t.Fatalf("duplicate accepted: %v", err)
		}
	}
	list, err := s.Invites(ctx)
	if err != nil || len(list) != 1 || list[0].Uses != 1 || len(list[0].Users) != 1 || list[0].Users[0] != "Ученик" {
		t.Fatalf("list or rollback: %+v %v", list, err)
	}
	if err := s.DeleteInvite(ctx, i.ID); !errors.Is(err, ErrConflict) {
		t.Fatal("active invite deleted")
	}
	if _, _, err := s.RegisterInvite(ctx, i.Code, "second", "Второй", inviteTestPassword, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.RegisterInvite(ctx, i.Code, "third", "Третий", inviteTestPassword, time.Hour); !errors.Is(err, ErrInviteExhausted) {
		t.Fatalf("exhausted invite: %v", err)
	}
	if err := s.DeleteInvite(ctx, i.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, session); err != nil {
		t.Fatal("deleting invite changed account")
	}
	grants, _ = s.UserCourses(ctx, u.ID)
	if len(grants) != 1 {
		t.Fatal("deleting invite removed grants")
	}
}

func TestInactiveInvitesAndValidation(t *testing.T) {
	s, ctx := open(t), context.Background()
	admin := inviteAdmin(t, s)
	zero := int64(0)
	for _, i := range []Invite{{Role: RoleAdmin}, {Role: RoleStudent, MaxUses: &zero}, {Role: RoleStudent, ExpiresAt: "not a date"}, {Role: RoleStudent, ExpiresAt: time.Now().Add(-time.Hour).Format(time.RFC3339)}} {
		i.CreatedBy = admin.ID
		if _, err := s.CreateInvite(ctx, i); err == nil {
			t.Fatal("invalid invite accepted")
		}
	}
	for _, state := range []string{"expired", "revoked", "missing"} {
		t.Run(state, func(t *testing.T) {
			i := makeInvite(t, s, admin, nil)
			want := ErrInviteMissing
			if state == "expired" {
				want = ErrInviteExpired
				_, err := s.db.Exec(`UPDATE invites SET expires_at = ? WHERE id = ?`, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339), i.ID)
				if err != nil {
					t.Fatal(err)
				}
			}
			if state == "revoked" {
				want = ErrInviteRevoked
				if err := s.RevokeInvite(ctx, i.ID); err != nil {
					t.Fatal(err)
				}
			}
			if state == "missing" {
				i.Code = "missing"
			}
			if _, err := s.InviteByCode(ctx, i.Code); !errors.Is(err, want) {
				t.Fatalf("metadata: %v", err)
			}
			if _, _, err := s.RegisterInvite(ctx, i.Code, "new-user", "Новое имя", inviteTestPassword, time.Hour); !errors.Is(err, want) {
				t.Fatalf("registration: %v", err)
			}
			if state != "missing" {
				if err := s.DeleteInvite(ctx, i.ID); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestInviteConcurrentSingleUse(t *testing.T) {
	// Independent connections exercise SQLite locking, rather than just sql.DB's single connection.
	path := filepath.Join(t.TempDir(), "race.db")
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
	admin := inviteAdmin(t, a)
	one := int64(1)
	i := makeInvite(t, a, admin, &one)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for n, s := range []*Store{a, b} {
		wg.Add(1)
		go func(n int, s *Store) {
			defer wg.Done()
			<-start
			_, _, err := s.RegisterInvite(context.Background(), i.Code, fmt.Sprintf("user-%d", n), fmt.Sprintf("Имя %d", n), inviteTestPassword, time.Hour)
			results <- err
		}(n, s)
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, ErrInviteExhausted) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("successful registrations: %d", success)
	}
	list, err := a.Invites(context.Background())
	if err != nil || list[0].Uses != 1 || len(list[0].Users) != 1 {
		t.Fatalf("race left partial account: %+v %v", list, err)
	}
}

func TestPasswordResetLifecycle(t *testing.T) {
	s, ctx := open(t), context.Background()
	admin := inviteAdmin(t, s)
	user, err := s.CreateUser(ctx, "student", "Ученик", inviteTestPassword, RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	old, _ := s.CreateSession(ctx, user.ID, time.Hour)
	other, _ := s.CreateSession(ctx, user.ID, time.Hour)
	authenticated, _ := s.Authenticate(ctx, "student", inviteTestPassword)
	first, err := s.CreatePasswordReset(ctx, user.ID, admin.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(first)
	if err != nil || len(raw) != 32 {
		t.Fatal("invalid reset token")
	}
	var hash, expires, created string
	if err := s.db.QueryRow(`SELECT token_hash, expires_at, created_at FROM password_resets`).Scan(&hash, &expires, &created); err != nil || hash != tokenHash(first) || hash == first {
		t.Fatal("plaintext reset stored")
	}
	a, _ := time.Parse(time.RFC3339, created)
	b, _ := time.Parse(time.RFC3339, expires)
	if b.Sub(a) != 24*time.Hour {
		t.Fatal("wrong reset lifetime")
	}
	second, err := s.CreatePasswordReset(ctx, user.ID, admin.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyPasswordReset(ctx, first, "new-test-password", time.Hour); !errors.Is(err, ErrResetInvalid) {
		t.Fatal("old link survived")
	}
	if _, _, err := s.ApplyPasswordReset(ctx, second, "short", time.Hour); !errors.Is(err, ErrPasswordPolicy) {
		t.Fatal("weak password accepted")
	}
	got, session, err := s.ApplyPasswordReset(ctx, second, "new-test-password", time.Hour)
	if err != nil || got.ID != user.ID {
		t.Fatalf("reset failed: %v", err)
	}
	for _, previous := range []string{old, other} {
		if _, err := s.UserBySession(ctx, previous); !errors.Is(err, ErrNoSession) {
			t.Fatal("old session survived")
		}
	}
	if _, err := s.UserBySession(ctx, session); err != nil {
		t.Fatal("new session missing")
	}
	if _, _, err := s.ApplyPasswordReset(ctx, second, "third-test-password", time.Hour); !errors.Is(err, ErrResetInvalid) {
		t.Fatal("reset reused")
	}
	if _, err := s.Authenticate(ctx, "student", inviteTestPassword); !errors.Is(err, ErrCredentials) {
		t.Fatal("old password survived")
	}
	if _, err := s.Authenticate(ctx, "student", "new-test-password"); err != nil {
		t.Fatal("new password rejected")
	}
	if _, err := s.CreateAuthenticatedSession(ctx, authenticated, time.Hour); !errors.Is(err, ErrCredentials) {
		t.Fatal("stale authentication created a session")
	}
	third, err := s.CreatePasswordReset(ctx, user.ID, admin.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE password_resets SET expires_at = ? WHERE token_hash = ?`, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339), tokenHash(third)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyPasswordReset(ctx, third, "expired-test-password", time.Hour); !errors.Is(err, ErrResetInvalid) {
		t.Fatal("expired link accepted")
	}
}

func TestResetLegacyLoginAndBlocking(t *testing.T) {
	s, ctx := open(t), context.Background()
	admin := inviteAdmin(t, s)
	var id int64
	if err := s.db.QueryRow(`INSERT INTO users (name, role, created_at) VALUES ('Старый аккаунт', 'student', ?) RETURNING id`, now()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePasswordReset(ctx, id, admin.ID, ""); err == nil {
		t.Fatal("legacy user without login accepted")
	}
	if _, err := s.CreatePasswordReset(ctx, id, admin.ID, "admin"); !errors.Is(err, ErrConflict) {
		t.Fatalf("occupied login accepted: %v", err)
	}
	token, err := s.CreatePasswordReset(ctx, id, admin.ID, "LEGACY")
	if err != nil {
		t.Fatal(err)
	}
	if u, err := s.UserByLogin(ctx, "legacy"); err != nil || u.ID != id {
		t.Fatal("legacy login not set")
	}
	if err := s.SetDisabled(ctx, id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePasswordReset(ctx, id, admin.ID, ""); !errors.Is(err, ErrUserDisabled) {
		t.Fatal("reset issued to disabled user")
	}
	if _, _, err := s.ApplyPasswordReset(ctx, token, "new-test-password", time.Hour); !errors.Is(err, ErrResetInvalid) {
		t.Fatal("disabled reset accepted")
	}
	if err := s.SetDisabled(ctx, id, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyPasswordReset(ctx, token, "new-test-password", time.Hour); !errors.Is(err, ErrResetInvalid) {
		t.Fatal("link revived on unblock")
	}
}
func TestAccountLinksRollbackWhenSessionFails(t *testing.T) {
	s, ctx := open(t), context.Background()
	admin := inviteAdmin(t, s)
	one := int64(1)
	invite := makeInvite(t, s, admin, &one)
	oldSession, err := s.CreateSession(ctx, admin.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	reset, err := s.CreatePasswordReset(ctx, admin.ID, admin.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER fail_link_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'session fixture failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.RegisterInvite(ctx, invite.Code, "rolled-back", "Откат", inviteTestPassword, time.Hour); err == nil {
		t.Fatal("session failure ignored")
	}
	if _, err := s.UserByLogin(ctx, "rolled-back"); !errors.Is(err, ErrNotFound) {
		t.Fatal("partial registration committed")
	}
	if i, err := s.InviteByCode(ctx, invite.Code); err != nil || i.Uses != 0 {
		t.Fatal("failed registration consumed invite")
	}
	if _, _, err := s.ApplyPasswordReset(ctx, reset, "different-test-password", time.Hour); err == nil {
		t.Fatal("reset session failure ignored")
	}
	if _, err := s.UserBySession(ctx, oldSession); err != nil {
		t.Fatal("failed reset revoked session")
	}
	if _, err := s.Authenticate(ctx, "admin", inviteTestPassword); err != nil {
		t.Fatal("failed reset changed password")
	}
	if _, err := s.db.Exec(`DROP TRIGGER fail_link_session`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyPasswordReset(ctx, reset, "different-test-password", time.Hour); err != nil {
		t.Fatalf("failed reset consumed link: %v", err)
	}
}

func TestResetConcurrentSingleUse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reset-race.db")
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
	admin := inviteAdmin(t, a)
	token, err := a.CreatePasswordReset(context.Background(), admin.ID, admin.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, s := range []*Store{a, b} {
		go func(s *Store) {
			<-start
			_, _, err := s.ApplyPasswordReset(context.Background(), token, "new-race-password", time.Hour)
			results <- err
		}(s)
	}
	close(start)
	success := 0
	for range 2 {
		err := <-results
		if err == nil {
			success++
		} else if !errors.Is(err, ErrResetInvalid) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("successful resets: %d", success)
	}
}
