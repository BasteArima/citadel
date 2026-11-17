package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"citadel/internal/store"
)

func TestAdminUserSearch(t *testing.T) {
	f := authorServer(t)
	ctx := context.Background()
	for i := 0; i < 23; i++ {
		_, err := f.st.CreateUser(ctx, fmt.Sprintf("prefix-%02d", i), fmt.Sprintf("Имя %02d", i), testPassword, store.RoleStudent)
		if err != nil {
			t.Fatal(err)
		}
	}
	exact, err := f.st.CreateUser(ctx, "prefix", "ПРЕФИКС", testPassword, store.RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.st.SetAvatar(ctx, exact.ID, []byte("normalized-test-png")); err != nil {
		t.Fatal(err)
	}
	blocked, err := f.st.CreateUser(ctx, "prefix-blocked", "Заблокированный", testPassword, store.RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.st.SetDisabled(ctx, blocked.ID, true); err != nil {
		t.Fatal(err)
	}
	search := func(q, suffix string) []store.UserMatch {
		t.Helper()
		out := f.act(t, f.admin, "GET", "/api/admin/users/search?q="+url.QueryEscape(q)+suffix, "", 200)
		for _, forbidden := range []string{"password", "inviteId", "courseLimit", "token"} {
			if strings.Contains(out, forbidden) {
				t.Fatalf("private fields: %s", out)
			}
		}
		var users []store.UserMatch
		if err := json.Unmarshal([]byte(out), &users); err != nil || users == nil {
			t.Fatalf("search: %s %v", out, err)
		}
		return users
	}
	for _, q := range []string{"", "p", "И", "  p  "} {
		if len(search(q, "")) != 0 {
			t.Fatalf("short query %q", q)
		}
	}
	users := search("PREFIX", "")
	if len(users) != 10 || users[0].ID != exact.ID || users[0].Avatar == "" {
		t.Fatalf("default/exact/avatar: %+v", users)
	}
	for i := 2; i < len(users); i++ {
		if users[i-1].Login > users[i].Login {
			t.Fatal("unordered logins")
		}
	}
	for _, tc := range []struct {
		suffix string
		want   int
	}{{"&limit=1", 1}, {"&limit=20", 20}, {"&limit=99", 20}, {"&limit=0", 1}, {"&limit=-3", 1}, {"&owners=1", 1}} {
		if got := len(search("prefix", tc.suffix)); got != tc.want {
			t.Fatalf("%s: %d", tc.suffix, got)
		}
	}
	if users := search("пре", ""); len(users) != 1 || users[0].ID != exact.ID {
		t.Fatalf("Unicode case: %+v", users)
	}
	if users := search("prefix-b", ""); len(users) != 1 || users[0].DisabledAt == "" {
		t.Fatalf("disabled: %+v", users)
	}
	for _, q := range []string{"%_", "prefix%", "fix", "' OR 1=1"} {
		if len(search(q, "")) != 0 {
			t.Fatal("not a literal prefix: " + q)
		}
	}
	f.act(t, f.admin, "GET", "/api/admin/users/search?q=prefix&limit=no", "", 400)
	for _, client := range []*http.Client{f.author, f.other, f.student} {
		f.act(t, client, "GET", "/api/admin/users/search?q=prefix", "", 403)
	}
}

func TestIndividualCourseGrants(t *testing.T) {
	f := authorServer(t)
	ctx := context.Background()
	student, err := f.st.UserByLogin(ctx, "student")
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/admin/courses/own/users"
	member := path + fmt.Sprintf("/%d", student.ID)
	f.act(t, f.admin, "GET", path, "", 200)
	for _, client := range []*http.Client{f.author, f.other, f.student} {
		f.act(t, client, "POST", member, `{}`, 403)
		f.act(t, client, "DELETE", member, "", 403)
	}
	f.act(t, f.admin, "POST", member, `{}`, 204)
	f.act(t, f.admin, "POST", member, `{}`, 204)
	f.act(t, f.student, "GET", "/api/courses/own", "", 200)
	other := path + fmt.Sprintf("/%d", f.otherUser.ID)
	f.act(t, f.admin, "POST", other, `{}`, 204)
	var out struct {
		Users []store.UserMatch `json:"users"`
	}
	if err := json.Unmarshal([]byte(f.act(t, f.admin, "GET", path, "", 200)), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Users) != 2 {
		t.Fatalf("only grantees: %+v", out.Users)
	}
	f.act(t, f.admin, "DELETE", member, "", 204)
	f.act(t, f.admin, "DELETE", member, "", 204)
	f.act(t, f.student, "GET", "/api/courses/own", "", 404)
	ids, err := f.st.CourseUsers(ctx, "own")
	if err != nil || len(ids) != 1 || ids[0] != f.otherUser.ID {
		t.Fatalf("another grant lost: %v %v", ids, err)
	}
	for _, method := range []string{"POST", "DELETE"} {
		f.act(t, f.admin, method, path+"/999999", `{}`, 404)
		f.act(t, f.admin, method, "/api/admin/courses/missing/users/1", `{}`, 404)
	}
}
