package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"citadel/internal/store"
)

func TestAdminAuditActions(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	signIn(t, ts, "Ученик")
	value, _ := testStores.Load(ts.URL)
	st := value.(*store.Store)
	ctx := context.Background()
	u, _ := st.UserByLogin(ctx, "student")
	owner, _ := st.UserByLogin(ctx, "baste")
	actor := store.UserActor(owner)
	userPath := fmt.Sprintf("/api/admin/users/%d", u.ID)
	userTarget := store.UserTarget(u.ID, u.Name)
	secrets := []string{testPassword, "replacement-password-test"}

	// Each successful endpoint must add exactly one event, containing only curated metadata.
	act := func(c *http.Client, method, path, body, action, who, target string, details map[string]any) string {
		t.Helper()
		before, err := st.AuditEntries(ctx, "", 1000)
		if err != nil {
			t.Fatal(err)
		}
		resp, result := do(t, c, method, ts.URL+path, body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			t.Fatalf("%s %s: %d %s", method, path, resp.StatusCode, result)
		}
		after, err := st.AuditEntries(ctx, "", 1000)
		if err != nil || len(after) != len(before)+1 {
			t.Fatalf("%s audit count: %d → %d, %v", action, len(before), len(after), err)
		}
		a := after[0]
		if a.Action != action || a.Actor != who || target != "" && a.Target != target || a.Target == "" {
			t.Fatalf("%s event: %+v", action, a)
		}
		if _, err := time.Parse(time.RFC3339, a.At); err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(a.Details, &got); err != nil {
			t.Fatal(err)
		}
		for key, want := range details {
			if !reflect.DeepEqual(got[key], want) {
				t.Errorf("%s %s: got %#v, want %#v", action, key, got[key], want)
			}
		}
		return result
	}
	act(admin, "PUT", userPath, `{"role":"author"}`, store.AuditUserRole, actor, userTarget, map[string]any{"before": "student", "after": "author"})
	act(admin, "PUT", userPath+"/disabled", `{"disabled":true}`, store.AuditUserDisabled, actor, userTarget, nil)
	act(admin, "PUT", userPath+"/disabled", `{"disabled":false}`, store.AuditUserEnabled, actor, userTarget, nil)
	reset := act(admin, "POST", userPath+"/reset-link", `{}`, store.AuditResetLink, actor, userTarget, nil)
	var link struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(reset), &link); err != nil {
		t.Fatal(err)
	}
	resetToken := link.URL[strings.LastIndex(link.URL, "/")+1:]
	secrets = append(secrets, resetToken)
	act(client(), "POST", "/api/reset", fmt.Sprintf(`{"token":%q,"password":"replacement-password-test"}`, resetToken), store.AuditPasswordReset, store.UserActor(u), userTarget, map[string]any{"source": "link"})
	act(admin, "PUT", userPath+"/courses", `{"courses":["go","go","missing"]}`, store.AuditUserCourses, actor, userTarget, map[string]any{"before": []any{}, "after": []any{"go"}})
	act(admin, "PUT", "/api/admin/courses/go/users", `{"users":[]}`, store.AuditCourseUsers, actor, "go", map[string]any{"before": []any{float64(u.ID)}, "after": []any{}})
	act(admin, "PUT", "/api/admin/courses/go/users", fmt.Sprintf(`{"users":[%d,%d,999999]}`, u.ID, u.ID), store.AuditCourseUsers, actor, "go", map[string]any{"before": []any{}, "after": []any{float64(u.ID)}})
	act(admin, "PUT", "/api/admin/courses/go/access", `{"access":"private"}`, store.AuditCourseAccess, actor, "go", map[string]any{"before": "public", "after": "private"})
	act(admin, "PUT", "/api/admin/courses/go/access", `{"access":"public"}`, store.AuditCourseAccess, actor, "go", map[string]any{"before": "private", "after": "public"})
	var invite store.Invite
	body := act(admin, "POST", "/api/admin/invites", `{"note":"Для Саши","role":"author","courses":["go"],"maxUses":1}`, store.AuditInviteCreated, actor, "", map[string]any{"note": "Для Саши", "role": "author", "courses": []any{"go"}, "maxUses": float64(1)})
	if err := json.Unmarshal([]byte(body), &invite); err != nil {
		t.Fatal(err)
	}
	secrets = append(secrets, invite.Code)
	registration := fmt.Sprintf(`{"code":%q,"login":"sasha","name":"Саша","password":%q}`, invite.Code, testPassword)
	// Newly registered user is the actor; the id is assigned by SQLite during the request.
	before, _ := st.AuditEntries(ctx, "", 1000)
	resp, body := do(t, client(), "POST", ts.URL+"/api/join", registration)
	if resp.StatusCode != 200 {
		t.Fatalf("register: %s", body)
	}
	sasha, _ := st.UserByLogin(ctx, "sasha")
	after, _ := st.AuditEntries(ctx, "", 1000)
	if len(after) != len(before)+1 || after[0].Action != store.AuditRegistered || after[0].Actor != store.UserActor(sasha) || after[0].Target != store.UserTarget(sasha.ID, sasha.Name) {
		t.Fatalf("registration event: %+v", after)
	}
	var registered struct {
		InviteID int64    `json:"inviteId"`
		Role     string   `json:"role"`
		Courses  []string `json:"courses"`
	}
	if err := json.Unmarshal(after[0].Details, &registered); err != nil || registered.InviteID != invite.ID || registered.Role != "author" || !reflect.DeepEqual(registered.Courses, []string{"go"}) {
		t.Fatalf("registration details: %s", after[0].Details)
	}
	_, body = do(t, admin, "GET", ts.URL+"/api/admin/users", "")
	var users struct {
		Users []struct {
			store.UserInfo
			Courses []string `json:"courses"`
		}
		CurrentUserID int64 `json:"currentUserId"`
	}
	if err := json.Unmarshal([]byte(body), &users); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range users.Users {
		if row.ID == sasha.ID {
			found = row.Login == "sasha" && row.InviteID == invite.ID && row.InviteNote == "Для Саши" && row.Created != "" && row.LastSeen != "" && row.DisabledAt == "" && reflect.DeepEqual(row.Courses, []string{"go"})
		}
	}
	if !found || users.CurrentUserID != owner.ID {
		t.Fatalf("user table metadata: %s", body)
	}
	invitePath := fmt.Sprintf("/api/admin/invites/%d", invite.ID)
	inviteTarget := fmt.Sprintf("Приглашение #%d", invite.ID)
	act(admin, "POST", invitePath+"/revoke", `{}`, store.AuditInviteRevoked, actor, inviteTarget, nil)
	act(admin, "DELETE", invitePath, "", store.AuditInviteDeleted, actor, inviteTarget, nil)
	tokenJSON := act(admin, "POST", "/api/admin/tokens", `{"name":"Тестовый агент","propose":true,"courses":["go"]}`, store.AuditTokenCreated, actor, "", map[string]any{"name": "Тестовый агент", "propose": true, "courses": []any{"go"}})
	var token struct {
		Token  store.Token `json:"token"`
		Secret string      `json:"secret"`
	}
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		t.Fatal(err)
	}
	secrets = append(secrets, token.Secret)
	tokenPath := fmt.Sprintf("/api/admin/tokens/%d", token.Token.ID)
	tokenTarget := fmt.Sprintf("Токен #%d", token.Token.ID)
	act(admin, "POST", tokenPath+"/review", `{"review":true}`, store.AuditTokenReview, actor, tokenTarget, map[string]any{"review": true})
	act(admin, "POST", tokenPath+"/revoke", `{}`, store.AuditTokenRevoked, actor, tokenTarget, nil)
	act(admin, "DELETE", tokenPath, "", store.AuditTokenDeleted, actor, tokenTarget, nil)
	_, body = do(t, admin, "GET", ts.URL+"/api/admin/audit", "")
	for _, secret := range secrets {
		if secret == "" || strings.Contains(body, secret) {
			t.Fatal("audit contains a secret or test failed to capture it")
		}
	}
	for _, forbidden := range []string{"password_hash", "token_hash", "$argon2id$", `"code":`, `"secret":`, `"tail":`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("audit contains forbidden data: %s", forbidden)
		}
	}
	resp, body = do(t, admin, "GET", ts.URL+"/api/admin/audit?action=user.role&limit=1", "")
	var filtered []store.AuditEntry
	if err := json.Unmarshal([]byte(body), &filtered); err != nil || resp.StatusCode != 200 || len(filtered) != 1 || filtered[0].Action != store.AuditUserRole {
		t.Fatalf("filter: %s", body)
	}
	for _, limit := range []string{"0", "-1", "no", "1001"} {
		if resp, _ := do(t, admin, "GET", ts.URL+"/api/admin/audit?limit="+limit, ""); resp.StatusCode != 400 {
			t.Fatalf("invalid limit %s accepted", limit)
		}
	}
	// Failed actions produce no false audit events.
	before, _ = st.AuditEntries(ctx, "", 1000)
	for _, path := range []string{fmt.Sprintf("/api/admin/users/%d", owner.ID), "/api/admin/users/999999"} {
		if resp, _ := do(t, admin, "PUT", ts.URL+path, `{"role":"student"}`); resp.StatusCode < 400 {
			t.Fatal("invalid role mutation accepted")
		}
	}
	after, _ = st.AuditEntries(ctx, "", 1000)
	if len(after) != len(before) {
		t.Fatal("failed mutation audited as successful")
	}
}

func TestCourseGrantsBothDirectionsAndAuthorization(t *testing.T) {
	ts := newTestServer(t)
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Ученик")
	value, _ := testStores.Load(ts.URL)
	st := value.(*store.Store)
	ctx := context.Background()
	u, _ := st.UserByLogin(ctx, "student")
	_, err := st.CreateUser(ctx, "writer", "Автор", testPassword, store.RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		client *http.Client
		status int
	}{{client(), 401}, {student, 403}, {signIn(t, ts, "writer"), 403}} {
		c, want := check.client, check.status
		for _, endpoint := range []struct{ method, path, body string }{{"GET", "/api/admin/audit", ""}, {"GET", "/api/admin/courses/go/users", ""}, {"PUT", "/api/admin/courses/go/users", `{}`}, {"GET", "/api/admin/users", ""}} {
			if resp, _ := do(t, c, endpoint.method, ts.URL+endpoint.path, endpoint.body); resp.StatusCode != want {
				t.Fatalf("%s %s: got %d, want %d", endpoint.method, endpoint.path, resp.StatusCode, want)
			}
		}
	}
	for _, e := range []struct{ method, path, body string }{
		{"PUT", "/api/admin/courses/go/access", `{"access":"private"}`},
		{"PUT", "/api/admin/courses/go/users", fmt.Sprintf(`{"users":[%d]}`, u.ID)},
	} {
		if resp, body := do(t, admin, e.method, ts.URL+e.path, e.body); resp.StatusCode != 200 {
			t.Fatalf("grant: %s", body)
		}
	}
	if resp, _ := do(t, student, "GET", ts.URL+"/api/courses/go", ""); resp.StatusCode != 200 {
		t.Fatal("course-side grant invisible to student")
	}
	grants, _ := st.UserCourses(ctx, u.ID)
	if !reflect.DeepEqual(grants, []string{"go"}) {
		t.Fatalf("user grants: %v", grants)
	}
	_, body := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/users", "")
	if !strings.Contains(body, fmt.Sprint(u.ID)) {
		t.Fatalf("course grant list: %s", body)
	}
	if resp, _ := do(t, admin, "PUT", fmt.Sprintf("%s/api/admin/users/%d/courses", ts.URL, u.ID), `{"courses":[]}`); resp.StatusCode != 200 {
		t.Fatal("user-side revoke failed")
	}
	ids, _ := st.CourseUsers(ctx, "go")
	if len(ids) != 0 {
		t.Fatalf("course grants not removed: %v", ids)
	}
	if resp, _ := do(t, student, "GET", ts.URL+"/api/courses/go", ""); resp.StatusCode != 404 {
		t.Fatal("revoked student still sees course")
	}
	for _, method := range []string{"GET", "PUT"} {
		if resp, _ := do(t, admin, method, ts.URL+"/api/admin/courses/missing/users", `{}`); resp.StatusCode != 404 {
			t.Fatal("unknown course accepted")
		}
	}
}

func TestAuditFailureDoesNotRollbackAction(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "citadel.db")
	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	admin, err := st.CreateUser(ctx, "admin", "Админ", testPassword, store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	u, err := st.CreateUser(ctx, "student", "Ученик", testPassword, store.RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	h, err := New(ctx, Config{Store: st, Log: slog.New(slog.NewTextHandler(&logs, nil))})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(h)
	defer ts.Close()
	c := client()
	token, err := st.CreateSession(ctx, admin.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	baseURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	c.Jar.SetCookies(baseURL, []*http.Cookie{{Name: cookieName, Value: token}})
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err := raw.Exec(`DROP TABLE audit`); err != nil {
		t.Fatal(err)
	}
	resp, body := do(t, c, "PUT", fmt.Sprintf("%s/api/admin/users/%d", ts.URL, u.ID), `{"role":"author"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("audit failure broke action: %s", body)
	}
	u, err = st.UserByLogin(ctx, "student")
	if err != nil || u.Role != store.RoleAuthor || !strings.Contains(logs.String(), "write audit") {
		t.Fatal("action rolled back or audit failure not logged")
	}
}
