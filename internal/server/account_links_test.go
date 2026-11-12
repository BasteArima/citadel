package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"citadel/internal/store"
)

func TestInviteHTTP(t *testing.T) {
	var logs bytes.Buffer
	ts := newTestServerWith(t, func(c *Config) { c.Log = slog.New(slog.NewTextHandler(&logs, nil)) })
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Ученик")
	for _, method := range []string{"GET", "POST"} {
		for _, c := range []struct {
			client *http.Client
			want   int
		}{{client(), 401}, {student, 403}} {
			if resp, _ := do(t, c.client, method, ts.URL+"/api/admin/invites", `{}`); resp.StatusCode != c.want {
				t.Fatalf("%s authorization: %d", method, resp.StatusCode)
			}
		}
	}
	if resp, _ := do(t, admin, "POST", ts.URL+"/api/admin/invites", `{"role":"admin"}`); resp.StatusCode != 400 {
		t.Fatal("admin invitation accepted")
	}
	value, _ := testStores.Load(ts.URL)
	st := value.(*store.Store)
	if err := st.SetCourseAccess(context.Background(), "go", store.AccessPrivate); err != nil {
		t.Fatal(err)
	}
	resp, body := do(t, admin, "POST", ts.URL+"/api/admin/invites", `{"note":"secret-note","role":"author","courses":["go"],"maxUses":1}`)
	if resp.StatusCode != 200 {
		t.Fatalf("create: %d %s", resp.StatusCode, body)
	}
	var invite store.Invite
	if err := json.Unmarshal([]byte(body), &invite); err != nil {
		t.Fatal(err)
	}
	guest := client()
	resp, body = do(t, guest, "GET", ts.URL+"/api/join/"+invite.Code, "")
	if resp.StatusCode != 200 || !strings.Contains(body, `"author"`) || !strings.Contains(body, `"Go"`) || strings.Contains(body, "secret-note") || strings.Contains(body, invite.Code) {
		t.Fatalf("public invite: %d %s", resp.StatusCode, body)
	}
	for _, path := range []string{"/join/" + invite.Code, "/reset/synthetic-token"} {
		resp, body = do(t, guest, "GET", ts.URL+path, "")
		if resp.StatusCode != 200 || !strings.Contains(body, "account-links.js") || resp.Header.Get("Content-Security-Policy") != contentSecurityPolicy || resp.Header.Get("Referrer-Policy") != "no-referrer" || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("public page %s: %d", path, resp.StatusCode)
		}
	}
	payload := fmt.Sprintf(`{"code":%q,"login":"new-author","name":"Новый автор","password":%q}`, invite.Code, testPassword)
	if resp, _ := do(t, admin, "POST", ts.URL+"/api/join", payload); resp.StatusCode != 409 {
		t.Fatal("signed-in registration accepted")
	}
	resp, body = do(t, guest, "POST", ts.URL+"/api/join", payload)
	if resp.StatusCode != 200 {
		t.Fatalf("registration: %d %s", resp.StatusCode, body)
	}
	if len(resp.Cookies()) != 1 || !resp.Cookies()[0].HttpOnly || resp.Cookies()[0].SameSite != http.SameSiteLaxMode {
		t.Fatal("registration cookie not protected")
	}
	if resp, _ := do(t, guest, "GET", ts.URL+"/api/courses/go", ""); resp.StatusCode != 200 {
		t.Fatal("invited course inaccessible")
	}
	resp, body = do(t, client(), "GET", ts.URL+"/api/join/"+invite.Code, "")
	if resp.StatusCode != 400 || strings.Contains(body, "secret-note") || strings.Contains(body, "Go") || strings.Contains(body, "author") || !strings.Contains(body, "исчерпано") {
		t.Fatalf("exhausted details leaked: %s", body)
	}
	resp, body = do(t, admin, "GET", ts.URL+"/api/admin/invites", "")
	if resp.StatusCode != 200 || !strings.Contains(body, "Новый автор") || !strings.Contains(body, "exhausted") {
		t.Fatal("invite admin list missing registration")
	}
	path := fmt.Sprintf("%s/api/admin/invites/%d", ts.URL, invite.ID)
	if resp, _ := do(t, admin, "POST", path+"/revoke", `{}`); resp.StatusCode != 204 {
		t.Fatal("revoke failed")
	}
	if resp, _ := do(t, admin, "DELETE", path, ""); resp.StatusCode != 204 {
		t.Fatal("delete failed")
	}
	if strings.Contains(logs.String(), invite.Code) || strings.Contains(logs.String(), "synthetic-token") || strings.Contains(logs.String(), testPassword) {
		t.Fatal("secret in request log")
	}
	if !strings.Contains(logs.String(), "invite=") {
		t.Fatal("registration log lacks invite id")
	}
}

func TestResetHTTP(t *testing.T) {
	ts := newTestServer(t)
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Ученик")
	value, _ := testStores.Load(ts.URL)
	st := value.(*store.Store)
	user, err := st.UserByLogin(context.Background(), "student")
	if err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("%s/api/admin/users/%d/reset-link", ts.URL, user.ID)
	for _, c := range []struct {
		client *http.Client
		want   int
	}{{client(), 401}, {student, 403}} {
		if resp, _ := do(t, c.client, "POST", path, `{}`); resp.StatusCode != c.want {
			t.Fatal("reset link authorization")
		}
	}
	resp, body := do(t, admin, "POST", path, `{}`)
	if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("create reset: %d %s", resp.StatusCode, body)
	}
	var link struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(body), &link); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(link.URL, ts.URL+"/reset/") {
		t.Fatal("wrong reset URL")
	}
	token := strings.TrimPrefix(link.URL, ts.URL+"/reset/")
	next := client()
	payload := fmt.Sprintf(`{"token":%q,"password":"updated-test-password"}`, token)
	if resp, body := do(t, next, "POST", ts.URL+"/api/reset", payload); resp.StatusCode != 200 {
		t.Fatalf("apply reset: %d %s", resp.StatusCode, body)
	}
	if resp, _ := do(t, next, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 200 {
		t.Fatal("reset did not sign in")
	}
	if resp, _ := do(t, student, "GET", ts.URL+"/api/me", ""); resp.StatusCode != 401 {
		t.Fatal("old session survived reset")
	}
	if resp, _ := do(t, client(), "POST", ts.URL+"/api/reset", payload); resp.StatusCode != 400 {
		t.Fatal("reset used twice")
	}
	if err := st.SetDisabled(context.Background(), user.ID, true); err != nil {
		t.Fatal(err)
	}
	if resp, _ := do(t, admin, "POST", path, `{}`); resp.StatusCode != 400 {
		t.Fatal("reset issued to disabled account")
	}
}

func TestLinkRateLimitAndJSON(t *testing.T) {
	for _, endpoint := range []string{"/api/join", "/api/reset"} {
		t.Run(endpoint, func(t *testing.T) {
			ts := newTestServer(t)
			for n := 0; n < 10; n++ {
				if resp, _ := do(t, client(), "POST", ts.URL+endpoint, `{}`); resp.StatusCode != 400 {
					t.Fatalf("attempt %d: %d", n, resp.StatusCode)
				}
			}
			if resp, _ := do(t, client(), "POST", ts.URL+endpoint, `{}`); resp.StatusCode != 429 {
				t.Fatal("link limiter missing")
			}
			if resp, _ := do(t, client(), "POST", ts.URL+"/api/login", `{"login":"any","password":"anything"}`); resp.StatusCode != 429 {
				t.Fatal("link attempts do not share sign-in limiter")
			}
		})
	}
	ts := newTestServer(t)
	for _, endpoint := range []string{"/api/join", "/api/reset"} {
		if resp, _ := do(t, client(), "POST", ts.URL+endpoint, ""); resp.StatusCode != 415 {
			t.Fatal("HTML form accepted")
		}
	}
}
