package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"citadel/internal/store"
	"citadel/web"
)

func (s *server) accountLinkRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /join/{code}", accountLinkPage("join.html"))
	mux.HandleFunc("GET /reset/{token}", accountLinkPage("reset.html"))
	mux.HandleFunc("GET /api/join/{code}", s.joinInfo)
	mux.HandleFunc("POST /api/join", s.join)
	mux.HandleFunc("POST /api/reset", s.resetPassword)
	mux.Handle("GET /api/admin/invites", s.admin(s.adminInvites))
	mux.Handle("POST /api/admin/invites", s.admin(s.adminCreateInvite))
	mux.Handle("POST /api/admin/invites/{id}/revoke", s.admin(s.adminRevokeInvite))
	mux.Handle("DELETE /api/admin/invites/{id}", s.admin(s.adminDeleteInvite))
	mux.Handle("POST /api/admin/users/{id}/reset-link", s.admin(s.adminResetLink))
}

func accountLinkPage(file string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		http.ServeFileFS(w, r, web.FS, file)
	}
}

func (s *server) adminInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := s.cfg.Store.Invites(r.Context())
	if err != nil {
		s.fail(w, "list invites", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeValue(w, invites)
}

func (s *server) adminCreateInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Note      string   `json:"note"`
		Role      string   `json:"role"`
		Courses   []string `json:"courses"`
		MaxUses   *int64   `json:"maxUses"`
		ExpiresAt string   `json:"expiresAt"`
	}
	if !readJSON(w, r, &req, 16384) {
		return
	}
	i, err := s.cfg.Store.CreateInvite(r.Context(), store.Invite{Note: req.Note, Role: req.Role, Courses: req.Courses, MaxUses: req.MaxUses, ExpiresAt: req.ExpiresAt, CreatedBy: userFrom(r.Context()).ID})
	if err != nil {
		jsonError(w, 400, "Не удалось создать приглашение: проверь роль, число использований и срок.")
		return
	}
	s.log.Info("invite created", "id", i.ID)
	w.Header().Set("Cache-Control", "no-store")
	writeValue(w, i)
}

func (s *server) adminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	var req struct{}
	if !readJSON(w, r, &req, 1024) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, 400, "bad id")
		return
	}
	if s.notFound(w, s.cfg.Store.RevokeInvite(r.Context(), id), "revoke invite") {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) adminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, 400, "bad id")
		return
	}
	err = s.cfg.Store.DeleteInvite(r.Context(), id)
	if errors.Is(err, store.ErrConflict) {
		jsonError(w, 409, "Удалить можно только неактивное приглашение")
		return
	}
	if s.notFound(w, err, "delete invite") {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) joinInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	i, err := s.cfg.Store.InviteByCode(r.Context(), r.PathValue("code"))
	if err != nil {
		s.linkError(w, err)
		return
	}
	// Public metadata contains neither the admin's note nor the reusable invite code.
	titles := []string{}
	courses, err := s.cfg.Store.Courses(r.Context())
	if err != nil {
		s.fail(w, "join courses", err)
		return
	}
	for _, id := range i.Courses {
		for _, c := range courses {
			if c.ID == id {
				titles = append(titles, c.Title)
				break
			}
		}
	}
	writeValue(w, map[string]any{"role": i.Role, "courses": titles})
}

func (s *server) linkError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrInviteMissing), errors.Is(err, store.ErrInviteExpired), errors.Is(err, store.ErrInviteRevoked), errors.Is(err, store.ErrInviteExhausted), errors.Is(err, store.ErrResetInvalid):
		jsonError(w, 400, err.Error())
	case errors.Is(err, store.ErrConflict):
		jsonError(w, 409, "Логин или имя уже заняты")
	case errors.Is(err, store.ErrPasswordPolicy):
		jsonError(w, 400, err.Error())
	default:
		jsonError(w, 400, "Не удалось сохранить аккаунт. Проверь логин (3–32 символа: латиница, цифры, ._-), имя (1–40 букв, цифр, пробелов, ._-) и пароль.")
	}
}

func (s *server) linkAttempt(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Cache-Control", "no-store")
	if !s.limiter.allow(clientIP(r)) {
		jsonError(w, 429, "Слишком много попыток. Попробуй позже.")
		return false
	}
	return true
}

func (s *server) join(w http.ResponseWriter, r *http.Request) {
	if !s.linkAttempt(w, r) {
		return
	}
	if _, ok := s.currentUser(r); ok {
		jsonError(w, 409, "Сначала выйди из текущего аккаунта")
		return
	}
	var req struct {
		Code     string `json:"code"`
		Login    string `json:"login"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &req, 8192) {
		s.limiter.fail(clientIP(r))
		return
	}
	u, token, err := s.cfg.Store.RegisterInvite(r.Context(), req.Code, req.Login, req.Name, req.Password, shortTTL)
	if err != nil {
		s.limiter.fail(clientIP(r))
		s.linkError(w, err)
		return
	}
	setLinkSession(w, r, token)
	s.log.Info("user registered", "login", u.Login, "invite", u.InviteID)
	writeValue(w, u)
}

func setLinkSession(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r)})
}

func (s *server) adminResetLink(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var req struct {
		Login string `json:"login"`
	}
	if !readJSON(w, r, &req, 4096) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, 400, "bad id")
		return
	}
	token, err := s.cfg.Store.CreatePasswordReset(r.Context(), id, userFrom(r.Context()).ID, req.Login)
	if err != nil {
		if errors.Is(err, store.ErrUserDisabled) {
			jsonError(w, 400, err.Error())
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			jsonError(w, 404, "Пользователь не найден")
			return
		}
		jsonError(w, 400, "Не удалось создать ссылку. Проверь, что логин задан, соответствует правилам и свободен.")
		return
	}
	scheme := "http"
	if isHTTPS(r) {
		scheme = "https"
	}
	s.log.Info("password reset created", "user", id)
	writeValue(w, map[string]string{"url": scheme + "://" + r.Host + "/reset/" + token})
}

func (s *server) resetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.linkAttempt(w, r) {
		return
	}
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &req, 8192) {
		s.limiter.fail(clientIP(r))
		return
	}
	u, session, err := s.cfg.Store.ApplyPasswordReset(r.Context(), req.Token, req.Password, shortTTL)
	if err != nil {
		s.limiter.fail(clientIP(r))
		s.linkError(w, err)
		return
	}
	setLinkSession(w, r, session)
	s.log.Info("password reset", "user", u.ID)
	writeValue(w, u)
}

// Secret-bearing paths must never enter the request log.
func safeRequestPath(path string) string {
	for _, prefix := range []string{"/join/", "/api/join/", "/reset/"} {
		if strings.HasPrefix(path, prefix) {
			return prefix + "[redacted]"
		}
	}
	return path
}
