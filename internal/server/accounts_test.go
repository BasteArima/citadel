package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"citadel/internal/store"
)

func TestProfileAccountChanges(t *testing.T) {
	ts := newTestServer(t)
	a, b := signIn(t, ts, "Baste"), signIn(t, ts, "Baste")
	for _, path := range []string{"/api/me/password", "/api/me/name", "/api/me/logout-all"} {
		method := "PUT"
		if strings.HasSuffix(path, "logout-all") {
			method = "POST"
		}
		if resp, _ := do(t, a, method, ts.URL+path, ""); resp.StatusCode != 415 {
			t.Fatalf("non-JSON %s: %d", path, resp.StatusCode)
		}
	}
	if resp, _ := do(t, a, "PUT", ts.URL+"/api/me/name", `{"name":"<script>"}`); resp.StatusCode != 400 {
		t.Fatal("invalid name accepted")
	}
	if resp, body := do(t, a, "PUT", ts.URL+"/api/me/name", `{"name":"Новое имя"}`); resp.StatusCode != 200 || !strings.Contains(body, `"name":"Новое имя"`) || !strings.Contains(body, `"login":"baste"`) {
		t.Fatalf("name change: %d %s", resp.StatusCode, body)
	}
	signIn(t, ts, "Гость")
	if resp, _ := do(t, a, "PUT", ts.URL+"/api/me/name", `{"name":"Гость"}`); resp.StatusCode != 409 {
		t.Fatal("duplicate name accepted")
	}
	if resp, _ := do(t, a, "PUT", ts.URL+"/api/me/password", `{"oldPassword":"wrong","newPassword":"new-password-long"}`); resp.StatusCode != 400 {
		t.Fatal("wrong old password accepted")
	}
	if resp, _ := do(t, b, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 200 {
		t.Fatal("failed change closed sessions")
	}
	if resp, body := do(t, a, "PUT", ts.URL+"/api/me/password", `{"oldPassword":"`+testPassword+`","newPassword":"new-password-long"}`); resp.StatusCode != 204 {
		t.Fatalf("password change: %d %s", resp.StatusCode, body)
	}
	if resp, _ := do(t, a, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 200 {
		t.Fatal("current session lost")
	}
	if resp, _ := do(t, b, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 401 {
		t.Fatal("other session survived")
	}
	if resp, body := do(t, client(), "POST", ts.URL+"/api/login", `{"login":"baste","password":"`+testPassword+`"}`); resp.StatusCode != 401 || !strings.Contains(body, loginError) {
		t.Fatal("old password accepted")
	}
	c := client()
	if resp, _ := do(t, c, "POST", ts.URL+"/api/login", `{"login":"BASTE","password":"new-password-long"}`); resp.StatusCode != 200 {
		t.Fatal("new password rejected")
	}
	if resp, _ := do(t, a, "POST", ts.URL+"/api/me/logout-all", `{}`); resp.StatusCode != 204 {
		t.Fatal("logout all failed")
	}
	for _, device := range []*http.Client{a, c} {
		if resp, _ := do(t, device, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 401 {
			t.Fatal("session survived logout all")
		}
	}
}

func TestAccountBlocking(t *testing.T) {
	ts := newTestServer(t)
	admin, guest := signIn(t, ts, "Baste"), signIn(t, ts, "Гость")
	value, _ := testStores.Load(ts.URL)
	st := value.(*store.Store)
	u, _ := st.UserByLogin(context.Background(), "guest")
	a, _ := st.UserByLogin(context.Background(), "baste")
	path := fmt.Sprintf("%s/api/admin/users/%d/disabled", ts.URL, u.ID)
	self := fmt.Sprintf("%s/api/admin/users/%d/disabled", ts.URL, a.ID)
	if resp, _ := do(t, admin, "PUT", self, `{"disabled":true}`); resp.StatusCode != 400 {
		t.Fatal("self-block allowed")
	}
	if resp, _ := do(t, guest, "PUT", path, `{"disabled":true}`); resp.StatusCode != 403 {
		t.Fatal("student can block")
	}
	if resp, _ := do(t, admin, "PUT", path, `{"disabled":true}`); resp.StatusCode != 204 {
		t.Fatal("blocking failed")
	}
	for _, endpoint := range []string{"/api/me", "/api/overview", "/api/courses", "/api/progress/go", "/api/admin/users", "/api/search?q=x"} {
		if resp, _ := do(t, guest, "GET", ts.URL+endpoint, ""); resp.StatusCode != 401 {
			t.Fatalf("disabled %s: %d", endpoint, resp.StatusCode)
		}
	}
	if resp, body := do(t, guest, "POST", ts.URL+"/api/login", `{"login":"guest","password":"`+testPassword+`"}`); resp.StatusCode != 401 || !strings.Contains(body, loginError) {
		t.Fatal("blocked user signed in")
	}
	if resp, _ := do(t, admin, "PUT", path, `{"disabled":false}`); resp.StatusCode != 204 {
		t.Fatal("unblocking failed")
	}
	if resp, _ := do(t, guest, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 401 {
		t.Fatal("unblocking revived session")
	}
	signIn(t, ts, "Гость")
}

func TestLoginRateLimitAcrossIPs(t *testing.T) {
	// Use the handler directly so each attempt can have a different real peer IP.
	var cfg Config
	ts := newTestServerWith(t, func(c *Config) { cfg = *c })
	signIn(t, ts, "Baste")
	h, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 11; i++ {
		login := "BASTE"
		if i%2 == 0 {
			login = "baste"
		}
		password := "wrong-password"
		if i == 10 {
			password = testPassword
		}
		body, _ := json.Marshal(map[string]string{"login": login, "password": password})
		r := httptest.NewRequest("POST", "/api/login", strings.NewReader(string(body)))
		r.RemoteAddr = fmt.Sprintf("192.0.2.%d:1234", i+1)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 401
		if i == 10 {
			want = 429
		}
		if w.Code != want || !strings.Contains(w.Body.String(), loginError) {
			t.Fatalf("attempt %d: %d", i+1, w.Code)
		}
	}
}

func TestLastAdminServerGuard(t *testing.T) {
	// An already authorized request can race another admin's demotion. Store checks
	// must still guard the target, even after the request passed the admin wrapper.
	var cfg Config
	ts := newTestServerWith(t, func(c *Config) { cfg = *c })
	signIn(t, ts, "Baste")
	actor, err := cfg.Store.CreateUser(context.Background(), "second-admin", "Second", testPassword, store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.Store.SetRole(context.Background(), actor.ID, store.RoleStudent); err != nil {
		t.Fatal(err)
	}
	target, _ := cfg.Store.UserByLogin(context.Background(), "baste")
	s := &server{cfg: cfg, log: cfg.Log}
	for _, disabled := range []bool{false, true} {
		body := `{"role":"student"}`
		if disabled {
			body = `{"disabled":true}`
		}
		r := httptest.NewRequest("PUT", "/", strings.NewReader(body))
		r.SetPathValue("id", fmt.Sprint(target.ID))
		r.Header.Set("Content-Type", "application/json")
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, actor))
		w := httptest.NewRecorder()
		if disabled {
			s.adminSetDisabled(w, r)
		} else {
			s.adminSetRole(w, r)
		}
		if w.Code != 400 {
			t.Fatalf("last admin mutation: %d", w.Code)
		}
	}
}

func TestAuthorHasStudentAccess(t *testing.T) {
	ts := newTestServerWith(t, func(cfg *Config) {
		if _, err := cfg.Store.CreateUser(context.Background(), "author", "Author", testPassword, store.RoleAuthor); err != nil {
			t.Fatal(err)
		}
	})
	author := signIn(t, ts, "author")
	for _, check := range []struct {
		path   string
		status int
	}{
		{"/api/courses", http.StatusOK},
		{"/api/admin/courses", http.StatusForbidden},
		{"/api/admin/users", http.StatusForbidden},
		{"/admin", http.StatusFound},
	} {
		if resp, _ := do(t, author, "GET", ts.URL+check.path, ""); resp.StatusCode != check.status {
			t.Fatalf("author %s: %d", check.path, resp.StatusCode)
		}
	}
}
