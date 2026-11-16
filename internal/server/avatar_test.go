package server

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"

	"citadel/internal/course"
	"citadel/internal/store"
)

func avatarRequest(t *testing.T, c *http.Client, method, url, media string, data []byte) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, url, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if media != "" {
		req.Header.Set("Content-Type", media)
	}
	r, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return r, body
}

func currentAvatar(t *testing.T, c *http.Client, url string) string {
	t.Helper()
	r, body := do(t, c, "GET", url+"/api/me", "")
	var u store.User
	if r.StatusCode != 200 || json.Unmarshal([]byte(body), &u) != nil {
		t.Fatalf("me: %d %s", r.StatusCode, body)
	}
	return u.Avatar
}

func TestAvatarNormalizationAndOwnership(t *testing.T) {
	ts := newTestServer(t)
	owner, other := signIn(t, ts, "Ученик"), signIn(t, ts, "other")
	if currentAvatar(t, owner, ts.URL) != "" {
		t.Fatal("new account has an avatar")
	}
	// A landscape JPEG from the assignment and a PNG with alpha: crop must retain
	// only the green center, not the red margins, and strip all trailing source data.
	previous := ""
	for _, format := range []string{"jpeg", "png"} {
		src := image.NewNRGBA(image.Rect(0, 0, 3000, 2000))
		for y := 0; y < 2000; y++ {
			for x := 0; x < 3000; x++ {
				c := color.NRGBA{R: 255, A: 255}
				if x >= 500 && x < 2500 {
					c = color.NRGBA{G: 200, A: 255}
					if format == "png" {
						c.A = 128
					}
				}
				src.SetNRGBA(x, y, c)
			}
		}
		var input bytes.Buffer
		if format == "jpeg" {
			if err := jpeg.Encode(&input, src, nil); err != nil {
				t.Fatal(err)
			}
		} else if err := png.Encode(&input, src); err != nil {
			t.Fatal(err)
		}
		input.WriteString("source-metadata-must-not-survive")
		r, body := avatarRequest(t, owner, "PUT", ts.URL+"/api/me/avatar", "image/"+format, input.Bytes())
		if r.StatusCode != 204 {
			t.Fatalf("upload %s: %d %s", format, r.StatusCode, body)
		}
		url := currentAvatar(t, owner, ts.URL)
		if !strings.HasPrefix(url, "/avatar/") || !strings.Contains(url, "?v=") || url == previous {
			t.Fatalf("avatar URL: %q", url)
		}
		previous = url
		r, body = avatarRequest(t, other, "GET", ts.URL+url, "", nil)
		if r.StatusCode != 200 || r.Header.Get("Content-Type") != "image/png" || r.Header.Get("Cache-Control") != "private, max-age=31536000, immutable" {
			t.Fatalf("image response: %d %v", r.StatusCode, r.Header)
		}
		img, err := png.Decode(bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if img.Bounds().Dx() != 256 || img.Bounds().Dy() != 256 {
			t.Fatalf("bounds: %v", img.Bounds())
		}
		if bytes.Contains(body, []byte("source-metadata")) {
			t.Fatal("original bytes stored")
		}
		for _, point := range []image.Point{{0, 0}, {128, 128}, {255, 255}} {
			c := color.NRGBAModel.Convert(img.At(point.X, point.Y)).(color.NRGBA)
			if c.G < 175 || c.R > 30 || (format == "png" && c.A != 128) {
				t.Fatalf("crop %s at %v: %v", format, point, c)
			}
		}
		// Both the initial server-rendered header and /api/me carry the image URL.
		_, page := do(t, owner, "GET", ts.URL+"/settings", "")
		if !strings.Contains(page, `src="`+url+`" alt="" width="32" height="32"`) {
			t.Fatal("header has no avatar")
		}
	}
	// There is no route accepting an arbitrary user ID for mutation.
	idPath := strings.Split(previous, "?")[0]
	r, _ := avatarRequest(t, other, "DELETE", ts.URL+idPath, "", nil)
	if r.StatusCode < 400 {
		t.Fatal("another user can delete avatar by ID")
	}
	r, _ = avatarRequest(t, other, "DELETE", ts.URL+"/api/me/avatar", "", nil)
	if r.StatusCode != 204 || currentAvatar(t, owner, ts.URL) != previous {
		t.Fatal("deleting own avatar affected another account")
	}
	avatarRequest(t, owner, "DELETE", ts.URL+"/api/me/avatar", "", nil)
	if currentAvatar(t, owner, ts.URL) != "" {
		t.Fatal("deleted avatar still advertised")
	}
	r, _ = avatarRequest(t, owner, "GET", ts.URL+previous, "", nil)
	if r.StatusCode != 404 {
		t.Fatal("deleted avatar still served")
	}
}

func TestAvatarRejectsInvalidUploads(t *testing.T) {
	ts := newTestServer(t)
	c := signIn(t, ts, "Ученик")
	var wide bytes.Buffer
	if err := png.Encode(&wide, image.NewRGBA(image.Rect(0, 0, 5000, 10))); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name, media string
		body        []byte
		status      int
	}{
		{"unsupported", "image/gif", []byte("GIF89a"), 415},
		{"no media", "", nil, 415},
		{"not an image", "image/png", []byte("not an image"), 400},
		{"too wide", "image/png", wide.Bytes(), 400},
		{"too large", "image/jpeg", make([]byte, maxAvatarBytes+1), 413},
		{"truncated", "image/png", wide.Bytes()[:33], 400},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r, body := avatarRequest(t, c, "PUT", ts.URL+"/api/me/avatar", tt.media, tt.body)
			if r.StatusCode != tt.status {
				t.Fatalf("status=%d body=%s", r.StatusCode, body)
			}
			if tt.status == 413 && !strings.Contains(string(body), "Картинка больше 2 МБ") {
				t.Fatal(string(body))
			}
			if currentAvatar(t, c, ts.URL) != "" {
				t.Fatal("rejected upload stored")
			}
		})
	}
	for _, tt := range []struct{ method, path string }{{"PUT", "/api/me/avatar"}, {"DELETE", "/api/me/avatar"}, {"GET", "/avatar/1"}} {
		r, _ := avatarRequest(t, client(), tt.method, ts.URL+tt.path, "image/png", nil)
		if r.StatusCode != 401 {
			t.Errorf("unauthenticated %s: %d", tt.method, r.StatusCode)
		}
	}
}

func TestAccountPagesForEveryRole(t *testing.T) {
	ts := newTestServerWith(t, func(cfg *Config) {
		courses, err := course.LoadDir("../../content-demo")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := cfg.Store.ImportContent(context.Background(), courses); err != nil {
			t.Fatal(err)
		}
		if err := cfg.Store.SetCourseAccess(context.Background(), "demo-project", store.AccessPublic); err != nil {
			t.Fatal(err)
		}
	})
	for _, role := range []string{store.RoleStudent, store.RoleAuthor, store.RoleAdmin} {
		c := signIn(t, ts, role)
		value, _ := testStores.Load(ts.URL)
		st := value.(*store.Store)
		u, err := st.UserByLogin(context.Background(), role)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.SetRole(context.Background(), u.ID, role); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/", "/settings", "/profile", "/c/go/", "/p/demo-project/"} {
			r, body := do(t, c, "GET", ts.URL+path, "")
			if r.StatusCode != 200 || !strings.Contains(body, `aria-haspopup="menu"`) || strings.Contains(body, `<a class="tb-me"`) {
				t.Fatalf("%s %s: %d %s", role, path, r.StatusCode, body)
			}
			if strings.Contains(body, `href="/admin"`) != (role != store.RoleStudent) {
				t.Errorf("%s: wrong admin visibility", role)
			}
			if path == "/settings" && (!strings.Contains(body, "/static/site/settings.js") || r.Header.Get("Content-Security-Policy") != contentSecurityPolicy) {
				t.Fatal("settings asset or CSP missing")
			}
		}
		if role != store.RoleStudent {
			r, body := do(t, c, "PUT", ts.URL+"/api/me/name", `{"name":"student"}`)
			if r.StatusCode != 409 || !strings.Contains(body, "Это имя уже занято, выбери другое.") {
				t.Fatalf("name conflict: %d %s", r.StatusCode, body)
			}
		}
	}
	r, _ := do(t, client(), "GET", ts.URL+"/settings", "")
	if r.StatusCode != 302 {
		t.Errorf("settings without a session: %d", r.StatusCode)
	}
}
