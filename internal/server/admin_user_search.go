package server

import (
	"net/http"
	"strconv"

	"citadel/internal/store"
)

func (s *server) adminSearchUsers(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			jsonError(w, 400, "limit — число от 1 до 20")
			return
		}
		limit = max(1, min(20, value))
	}
	users, err := s.cfg.Store.SearchUsers(r.Context(), r.URL.Query().Get("q"), limit, r.URL.Query().Get("owners") == "1")
	if err != nil {
		s.fail(w, "search users", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeValue(w, users)
}

func (s *server) adminChangeCourseUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	userID, err := strconv.ParseInt(r.PathValue("uid"), 10, 64)
	if err != nil || userID < 1 {
		jsonError(w, 400, "bad user id")
		return
	}
	granted := r.Method == http.MethodPost
	if s.notFound(w, s.cfg.Store.SetCourseUser(r.Context(), id, userID, granted), "change course user") {
		return
	}
	s.adminAudit(r, store.AuditCourseUsers, id, map[string]any{"userId": userID, "granted": granted})
	w.WriteHeader(http.StatusNoContent)
}
