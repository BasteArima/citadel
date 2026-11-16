package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestAdminPreviewAccessAndHeaders(t *testing.T) {
	f := authorServer(t)
	f.importCourse(t, f.author, "unpublished", false)
	for _, tc := range []struct {
		name, path string
		client     *http.Client
		status     int
	}{
		{"admin", "/admin/preview/own", f.admin, 200},
		{"owner", "/admin/preview/own", f.author, 200},
		{"unpublished draft", "/admin/preview/unpublished", f.author, 200},
		{"foreign author", "/admin/preview/own", f.other, 404},
		{"platform course", "/admin/preview/go", f.author, 404},
		{"missing", "/admin/preview/missing", f.admin, 404},
		{"student", "/admin/preview/own", f.student, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, body := do(t, tc.client, "GET", f.ts.URL+tc.path, "")
			if r.StatusCode != tc.status {
				t.Fatalf("status %d, want %d: %s", r.StatusCode, tc.status, body)
			}
			want := contentSecurityPolicy
			if tc.status == 200 {
				want = strings.Replace(want, "frame-ancestors 'none'", "frame-ancestors 'self'", 1)
				for _, text := range []string{`data-preview="draft"`, "Черновик · превью", `/static/engine/main.js`, `class="tb-account"`} {
					if !strings.Contains(body, text) {
						t.Errorf("preview missing %s", text)
					}
				}
				if r.Header.Get("X-Frame-Options") != "SAMEORIGIN" || r.Header.Get("Cache-Control") != "no-store" {
					t.Error("preview must allow same-origin framing and disable caching")
				}
			}
			if r.Header.Get("Content-Security-Policy") != want {
				t.Error("unexpected CSP")
			}
		})
	}
	anon := client()
	anon.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	r, _ := do(t, anon, "GET", f.ts.URL+"/admin/preview/own", "")
	if r.StatusCode != http.StatusFound || !strings.HasPrefix(r.Header.Get("Location"), "/login?next=") {
		t.Fatal("anonymous preview must redirect to login")
	}
	for _, path := range []string{"/", "/admin", "/c/go/", "/api/admin/courses/own/draft", "/login"} {
		r, _ := do(t, f.admin, "GET", f.ts.URL+path, "")
		if r.Header.Get("Content-Security-Policy") != contentSecurityPolicy || r.Header.Get("X-Frame-Options") == "SAMEORIGIN" {
			t.Errorf("framing policy changed outside preview: %s", path)
		}
	}
}

func TestAdminPageIncludesAccountHeader(t *testing.T) {
	f := authorServer(t)
	for _, c := range []*http.Client{f.admin, f.author} {
		r, body := do(t, c, "GET", f.ts.URL+"/admin", "")
		if r.StatusCode != 200 {
			t.Fatal(r.StatusCode)
		}
		for _, text := range []string{`class="top ad-top"`, `class="tb-me"`, `role="menu"`, `data-theme-set="dark"`, `href="/settings"`, `data-account-logout`} {
			if !strings.Contains(body, text) {
				t.Errorf("admin header missing %s", text)
			}
		}
	}
}
