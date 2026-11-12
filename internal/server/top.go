package server

import (
	"html"
	"net/http"
	"strings"
	"unicode/utf8"

	"citadel/web"
)

// The header is rendered here, into the page HTML: it is there in the very first frame, so moving
// between the catalog, the reviews, the profile and a course does not make it blink. The browser
// only fills in what the server does not know: the card count, the course menu and lesson strip.
// The active theme button is styled by CSS from <html data-theme>, which an inline script in
// <head> sets before the first paint.

const (
	icSearch = `<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`
	icRepeat = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>`
	icSun    = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
	icMoon   = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
	icMenu   = `<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`
	logo     = `<svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><rect x="2" y="4" width="15" height="12" rx="6" fill="none" stroke="var(--dim)" stroke-width="2.5"/><rect x="13" y="4" width="15" height="12" rx="6" fill="none" stroke="var(--acc-fill)" stroke-width="2.5"/></svg>`
)

// topHTML is the inside of <header id="top">. current — catalog, review or profile; inCourse adds
// the course menu button and the places the engine fills (lesson head and part strip on a phone).
func topHTML(name, role, current string, inCourse bool) string {
	var b strings.Builder
	if inCourse {
		b.WriteString(`<button type="button" class="tb-ic tb-menu" data-act="menu" aria-controls="side" aria-expanded="false" aria-label="Меню уроков">` + icMenu + `</button>`)
		b.WriteString(`<div class="tb-lesson-w"></div>`)
	}
	b.WriteString(`<a class="tb-home" href="/">` + logo + `<span>Citadel</span></a>`)
	b.WriteString(`<nav class="tb-nav" aria-label="Разделы">`)
	nav := [][3]string{{"/", "Курсы", "catalog"}, {"/projects", "Проекты", "projects"}, {"/review", "Повторения", "review"}, {"/profile", "Профиль", "profile"}}
	if role == "admin" || role == "author" {
		nav = append(nav, [3]string{"/admin", "Админка", "admin"})
	}
	for _, n := range nav {
		b.WriteString(`<a href="` + n[0] + `"`)
		if n[2] == current {
			b.WriteString(` aria-current="page"`)
		}
		b.WriteString(`>` + n[1])
		if n[2] == "review" {
			b.WriteString(`<b class="nav-badge" hidden></b>`)
		}
		b.WriteString(`</a>`)
	}
	b.WriteString(`</nav><div class="tb-tools">`)
	label := "Поиск по всем курсам"
	if inCourse {
		label = "Поиск по курсу"
	}
	b.WriteString(`<button type="button" class="tb-search" data-act="search" aria-label="` + label + `, Ctrl K">` + icSearch + `<span>Поиск</span><span class="kbd">Ctrl K</span></button>`)
	b.WriteString(`<a class="tb-due" href="/review" title="Повторить сегодня" hidden>` + icRepeat + `<span>Повторить</span><b></b></a>`)
	b.WriteString(`<div class="tb-theme" role="group" aria-label="Тема">` +
		`<button type="button" data-theme-set="auto">Авто</button>` +
		`<button type="button" data-theme-set="light" aria-label="Светлая" title="Светлая">` + icSun + `</button>` +
		`<button type="button" data-theme-set="dark" aria-label="Тёмная" title="Тёмная">` + icMoon + `</button></div>`)
	initial := "·"
	if r, _ := utf8.DecodeRuneInString(name); r != utf8.RuneError {
		initial = strings.ToUpper(string(r))
	}
	b.WriteString(`<a class="tb-me" href="/profile" aria-label="Профиль: ` + html.EscapeString(name) + `">` + html.EscapeString(initial) + `</a>`)
	b.WriteString(`</div>`)
	if inCourse {
		b.WriteString(`<div class="tb-strip-w"></div>`)
	}
	return b.String()
}

// withTop serves an embedded page with the header filled in.
func withTop(w http.ResponseWriter, r *http.Request, file, current string, inCourse bool) {
	data, err := web.FS.ReadFile(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	u := userFrom(r.Context())
	page := strings.Replace(string(data), `id="top"></header>`, `id="top">`+topHTML(u.Name, u.Role, current, inCourse)+`</header>`, 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write([]byte(page))
}
