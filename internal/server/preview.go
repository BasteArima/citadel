package server

import (
	"net/http"
	"strings"

	"citadel/web"
)

// This is the trusted course engine, not a sandbox for course-supplied scripts.
func (s *server) adminPreview(w http.ResponseWriter, r *http.Request) {
	data, err := web.FS.ReadFile("course.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	u := userFrom(r.Context())
	page := strings.Replace(string(data), `<html lang="ru">`, `<html lang="ru" data-preview="draft">`, 1)
	page = strings.Replace(page, `id="top"></header>`, `id="top">`+topHTML(u.Name, u.Role, u.Avatar, "admin", true)+`</header><div class="preview-banner">Черновик · превью</div>`, 1)
	w.Header().Set("Content-Security-Policy", strings.Replace(contentSecurityPolicy, "frame-ancestors 'none'", "frame-ancestors 'self'", 1))
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(page))
}
