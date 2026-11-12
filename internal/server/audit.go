package server

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"citadel/internal/store"
)

// History is best effort and independent of the successful mutation. A disconnected
// client must not cancel it; a bounded context prevents an unavailable DB hanging HTTP.
func (s *server) audit(ctx context.Context, actor, action, target string, details any) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.cfg.Store.Audit(ctx, actor, action, target, details); err != nil {
		s.log.Error("write audit", "action", action, "err", err)
	}
}

func (s *server) adminAudit(r *http.Request, action, target string, details any) {
	s.audit(r.Context(), store.UserActor(userFrom(r.Context())), action, target, details)
}

func (s *server) auditUserTarget(ctx context.Context, id int64) string {
	u, err := s.cfg.Store.UserInfoByID(ctx, id)
	if err != nil {
		return store.UserTarget(id, "Пользователь")
	}
	return store.UserTarget(id, u.Name)
}

func (s *server) adminAuditList(w http.ResponseWriter, r *http.Request) {
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 1000 {
			jsonError(w, 400, "limit — от 1 до 1000")
			return
		}
		limit = n
	}
	entries, err := s.cfg.Store.AuditEntries(r.Context(), r.URL.Query().Get("action"), limit)
	if err != nil {
		s.fail(w, "list audit", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeValue(w, entries)
}

func (s *server) adminCourseUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.cfg.Store.CourseUsers(r.Context(), r.PathValue("id"))
	if s.notFound(w, err, "course users") {
		return
	}
	writeValue(w, map[string]any{"users": users})
}

func (s *server) adminSetCourseUsers(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Users []int64 `json:"users"`
	}
	if !readJSON(w, r, &req, 1<<16) {
		return
	}
	id := r.PathValue("id")
	before, err := s.cfg.Store.CourseUsers(r.Context(), id)
	if s.notFound(w, err, "course users") {
		return
	}
	if s.notFound(w, s.cfg.Store.SetCourseUsers(r.Context(), id, req.Users), "set course users") {
		return
	}
	after, err := s.cfg.Store.CourseUsers(r.Context(), id)
	if err != nil {
		s.log.Error("read course grants after update", "err", err)
	}
	s.adminAudit(r, store.AuditCourseUsers, id, map[string]any{"before": before, "after": after})
	writeValue(w, map[string]any{"users": after})
}
