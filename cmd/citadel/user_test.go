package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"citadel/internal/server"
	"citadel/internal/store"
)

func TestUserConsoleWhileServing(t *testing.T) {
	data := t.TempDir()
	t.Setenv("CITADEL_DATA", data)
	run := func(args ...string) string {
		t.Helper()
		var out bytes.Buffer
		if err := userCommand(args, &out); err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(out.String())
	}
	password := run("add", "--role", "admin", "--name", "Владелец", "baste")
	if len(password) != 20 || strings.ContainsAny(password, "0O1lI") {
		t.Fatal("invalid generated password")
	}
	st, err := store.Open(dbPath(data))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	h, err := server.New(ctx, server.Config{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(h)
	defer ts.Close()
	request := func(c *http.Client, method, path string, body any) int {
		t.Helper()
		payload, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}
	device := func() *http.Client { jar, _ := cookiejar.New(nil); return &http.Client{Jar: jar} }
	login := func(c *http.Client, password string) int {
		return request(c, "POST", "/api/login", map[string]string{"login": "baste", "password": password})
	}
	a, b := device(), device()
	if login(a, password) != 200 || login(b, password) != 200 {
		t.Fatal("initial login failed")
	}
	// Every command opens the same WAL database through a second store connection.
	if list := run("list", "-data", data); !strings.Contains(list, "baste") || !strings.Contains(list, "Владелец") {
		t.Fatal("list missing user")
	}
	reset := run("reset-password", "baste", "-data", data)
	if reset == password || len(reset) != 20 {
		t.Fatal("reset did not generate a password")
	}
	if request(a, "GET", "/api/me", nil) != 401 || request(b, "GET", "/api/me", nil) != 401 {
		t.Fatal("reset left a session")
	}
	if login(a, password) != 401 || login(a, reset) != 200 {
		t.Fatal("reset password not applied")
	}
	if login(b, reset) != 200 {
		t.Fatal("second device login failed")
	}
	if request(a, "PUT", "/api/me/password", map[string]string{"oldPassword": reset, "newPassword": "my new password 123"}) != 204 {
		t.Fatal("profile change failed")
	}
	if request(b, "GET", "/api/me", nil) != 401 || login(b, reset) != 401 || login(b, "my new password 123") != 200 {
		t.Fatal("profile password/session rules failed")
	}
	run("add", "--name", "Ученик", "student")
	run("set-role", "student", "author")
	u, err := st.UserByLogin(ctx, "student")
	if err != nil || u.Role != store.RoleAuthor {
		t.Fatal("author role was not saved")
	}
	if request(a, "PUT", fmt.Sprintf("/api/admin/users/%d/disabled", u.ID), map[string]bool{"disabled": true}) != 204 {
		t.Fatal("block failed")
	}
	run("unblock", "student")
	if _, err := st.CreateSession(ctx, u.ID, time.Hour); err != nil {
		t.Fatal("unblock did not apply")
	}
	// Exercise --id/--login against a legacy row without a login.
	legacyID := u.ID
	raw, err := sql.Open("sqlite", dbPath(data))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE users SET login = NULL WHERE id = ?`, legacyID); err != nil {
		t.Fatal(err)
	}
	raw.Close()
	newPassword := run("reset-password", "--id", fmt.Sprint(legacyID), "--login", "renamed")
	if _, err := st.Authenticate(ctx, "renamed", newPassword); err != nil {
		t.Fatal("id/login recovery failed")
	}
}

func TestUserConsoleValidation(t *testing.T) {
	t.Setenv("CITADEL_DATA", t.TempDir())
	for _, args := range [][]string{{}, {"unknown"}, {"add"}, {"add", "--role", "root", "someone"}, {"reset-password", "--id", "1"}, {"reset-password", "--login", "abc"}, {"reset-password", "--id", "1", "--login", "abc", "extra"}, {"list", "extra"}, {"set-role", "abc"}} {
		var out bytes.Buffer
		if err := userCommand(args, &out); err == nil || out.Len() != 0 {
			t.Fatalf("invalid arguments accepted: %v", args)
		}
	}
}
