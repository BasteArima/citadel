package server

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"citadel/internal/course"
	"citadel/internal/store"
	"citadel/web"
	"golang.org/x/net/html"
)

func TestHTMLSecurityHeaders(t *testing.T) {
	ts := newTestServerWith(t, func(cfg *Config) {
		courses, err := course.LoadDir("../../content-demo")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := cfg.Store.ImportContent(context.Background(), courses); err != nil {
			t.Fatal(err)
		}
	})
	admin := signIn(t, ts, "Baste")
	for _, path := range []string{"/", "/profile", "/review", "/projects", "/c/go/", "/p/demo-project/", "/admin", "/login"} {
		c := admin
		if path == "/login" {
			c = client()
		}
		r, _ := do(t, c, "GET", ts.URL+path, "")
		if r.StatusCode != 200 || !strings.Contains(r.Header.Get("Content-Type"), "text/html") {
			t.Errorf("%s: status=%d type=%s", path, r.StatusCode, r.Header.Get("Content-Type"))
		}
		if got := r.Header.Get("Content-Security-Policy"); got != contentSecurityPolicy {
			t.Errorf("%s: CSP=%q", path, got)
		}
	}
}

func TestOldUnsafeProposalCannotBeAccepted(t *testing.T) {
	for _, newCourse := range []bool{false, true} {
		t.Run(strconv.FormatBool(newCourse), func(t *testing.T) {
			var proposalID int64
			ts := newTestServerWith(t, func(cfg *Config) {
				ctx := context.Background()
				data, _, err := cfg.Store.Version(ctx, "go", 0)
				if err != nil {
					t.Fatal(err)
				}
				c, err := course.Decode(data)
				if err != nil {
					t.Fatal(err)
				}
				c.About = `<img src=x onerror="alert(1)">`
				base := 1
				if newCourse {
					c.ID = "new-course"
					base = 0
				}
				data, _ = course.Encode(c)
				token, _, err := cfg.Store.CreateToken(ctx, store.Token{Name: "test"})
				if err != nil {
					t.Fatal(err)
				}
				proposalID, err = cfg.Store.AddProposal(ctx, store.Proposal{CourseID: c.ID, TokenID: token.ID, Agent: "test", Base: base, NewCourse: newCourse, Data: data, Status: store.ProposalPending, Checks: json.RawMessage(`{"errors":0,"warnings":0,"problems":[]}`)})
				if err != nil {
					t.Fatal(err)
				}
			})
			admin := signIn(t, ts, "Baste")
			r, body := do(t, admin, "POST", ts.URL+"/api/admin/proposals/"+strconv.FormatInt(proposalID, 10)+"/accept", `{}`)
			if r.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("accept old unsafe proposal: %d %s", r.StatusCode, body)
			}
		})
	}
}

func TestPagesHaveNoInlineScripts(t *testing.T) {
	paths, err := fs.Glob(web.FS, "*.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := web.FS.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		z := html.NewTokenizer(strings.NewReader(string(data)))
		for {
			kind := z.Next()
			if kind == html.ErrorToken {
				if z.Err() != io.EOF {
					t.Fatal(z.Err())
				}
				break
			}
			if kind != html.StartTagToken {
				continue
			}
			token := z.Token()
			src := ""
			for _, a := range token.Attr {
				if strings.HasPrefix(a.Key, "on") {
					t.Errorf("%s: inline handler %s", path, a.Key)
				}
				if a.Key == "src" {
					src = a.Val
				}
			}
			if token.Data == "script" {
				if !strings.HasPrefix(src, "/static/") {
					t.Fatalf("%s: script without local src", path)
				}
				if _, err := web.FS.ReadFile(strings.TrimPrefix(src, "/")); err != nil {
					t.Fatal(err)
				}
				if z.Next() == html.TextToken && strings.TrimSpace(string(z.Text())) != "" {
					t.Errorf("%s: inline script body", path)
				}
			}
		}
	}
}

func TestUnsafeHTMLDraftCannotPublish(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	_, body := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/draft", "")
	var d draft
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatal(err)
	}
	d.Course["about"] = `<img src=x onerror="alert(1)"><nil>`
	data, _ := json.Marshal(map[string]any{"base": 1, "course": d.Course})
	r, body := do(t, admin, "PUT", ts.URL+"/api/admin/courses/go/draft", string(data))
	if r.StatusCode != 200 || !strings.Contains(body, `"errors":4`) {
		t.Fatalf("save invalid draft: %d %s", r.StatusCode, body)
	}
	r, body = do(t, admin, "POST", ts.URL+"/api/admin/courses/go/publish", `{"version":2}`)
	if r.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("publish invalid draft: %d %s", r.StatusCode, body)
	}
	_, body = do(t, admin, "GET", ts.URL+"/api/courses/go", "")
	if strings.Contains(body, "onerror") {
		t.Fatal("unsafe draft replaced published course")
	}
}
