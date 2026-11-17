package server

import (
	"strings"
	"testing"

	"golang.org/x/net/html"
)

func TestAccountHeaderRoles(t *testing.T) {
	for role, label := range map[string]string{"student": "Ученик", "author": "Автор", "admin": "Админ"} {
		for _, inCourse := range []bool{false, true} {
			src := topHTML(`Имя <x> "`, role, "", "settings", inCourse)
			doc, err := html.Parse(strings.NewReader(src))
			if err != nil {
				t.Fatal(err)
			}
			var navLinks, menuLinks []string
			var walk func(*html.Node, bool, bool)
			walk = func(n *html.Node, nav, menu bool) {
				attrs := map[string]string{}
				for _, a := range n.Attr {
					attrs[a.Key] = a.Val
				}
				if n.Data == "nav" {
					nav = true
				}
				if attrs["role"] == "menu" {
					menu = true
				}
				if n.Data == "a" {
					if nav {
						navLinks = append(navLinks, attrs["href"])
					}
					if menu {
						menuLinks = append(menuLinks, attrs["href"])
						if attrs["role"] != "menuitem" {
							t.Error("missing menuitem role")
						}
					}
				}
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					walk(c, nav, menu)
				}
			}
			walk(doc, false, false)
			navWant := "/,/projects,/review"
			if role != "student" {
				navWant += ",/admin"
			}
			if strings.Join(navLinks, ",") != navWant {
				t.Errorf("navigation: %v", navLinks)
			}
			want := "/profile,/settings"
			if strings.Contains(src, "tb-due") {
				t.Error("duplicate review button")
			}
			if strings.Join(menuLinks, ",") != want {
				t.Errorf("%s menu: %v", role, menuLinks)
			}
			for _, required := range []string{`<button type="button" class="tb-me"`, `aria-expanded="false"`, `aria-haspopup="menu"`, `role="menu"`, `data-account-logout`, `class="tb-account-themes"`, `tabindex="-1" data-theme-set="auto">Тема: Авто`, `tabindex="-1" data-theme-set="light">Тема: Светлая`, `tabindex="-1" data-theme-set="dark">Тема: Тёмная`, "Выйти…", label, "&lt;x&gt;"} {
				if !strings.Contains(src, required) {
					t.Errorf("%s missing %s", role, required)
				}
			}
		}
	}
}
