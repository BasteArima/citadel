package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"citadel/internal/store"
)

func (s *server) canEdit(ctx context.Context, u store.User, id string) bool {
	owner, err := s.cfg.Store.CourseOwner(ctx, id)
	return err == nil && (u.Role == store.RoleAdmin || (u.Role == store.RoleAuthor && owner == u.ID))
}

func (s *server) editable(w http.ResponseWriter, r *http.Request, id string) bool {
	if !s.canEdit(r.Context(), userFrom(r.Context()), id) {
		jsonError(w, http.StatusNotFound, "course not found")
		return false
	}
	return true
}

// staff protects role access; resource wrappers additionally enforce ownership.
func (s *server) staff(h http.HandlerFunc) http.Handler {
	return s.api(func(w http.ResponseWriter, r *http.Request) {
		role := userFrom(r.Context()).Role
		if role != store.RoleAdmin && role != store.RoleAuthor {
			jsonError(w, http.StatusForbidden, "staff only")
			return
		}
		h(w, r)
	})
}

func (s *server) staffCourse(h http.HandlerFunc) http.Handler {
	return s.staff(func(w http.ResponseWriter, r *http.Request) {
		if s.editable(w, r, r.PathValue("id")) {
			h(w, r)
		}
	})
}

func (s *server) staffToken(h http.HandlerFunc) http.Handler {
	return s.staff(func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			jsonError(w, http.StatusNotFound, "token not found")
			return
		}
		t, err := s.cfg.Store.TokenByID(r.Context(), id)
		u := userFrom(r.Context())
		if err != nil || (u.Role != store.RoleAdmin && t.UserID != u.ID) {
			jsonError(w, http.StatusNotFound, "token not found")
			return
		}
		h(w, r)
	})
}

func (s *server) canReviewProposal(ctx context.Context, u store.User, p store.Proposal) bool {
	if u.Role == store.RoleAdmin {
		return true
	}
	if s.canEdit(ctx, u, p.CourseID) {
		return true
	}
	_, err := s.cfg.Store.CourseOwner(ctx, p.CourseID)
	return errors.Is(err, store.ErrNotFound) && p.NewCourse && u.Role == store.RoleAuthor && p.OwnerID == u.ID
}

func newOwner(u store.User) int64 {
	if u.Role == store.RoleAuthor {
		return u.ID
	}
	return 0
}

func (s *server) creationError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, store.ErrCourseLimit) {
		jsonError(w, http.StatusConflict, err.Error())
		return true
	}
	if errors.Is(err, store.ErrConflict) {
		jsonError(w, http.StatusConflict, "id занят")
		return true
	}
	return false
}

func (s *server) adminSetOwner(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OwnerID int64 `json:"ownerId"`
	}
	if !readJSON(w, r, &req, 1024) {
		return
	}
	id := r.PathValue("id")
	before, err := s.cfg.Store.CourseOwner(r.Context(), id)
	if s.notFound(w, err, "course owner") {
		return
	}
	if err := s.cfg.Store.SetCourseOwner(r.Context(), id, req.OwnerID); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.reloadOrLog(r.Context())
	s.adminAudit(r, store.AuditCourseOwner, id, map[string]any{"before": before, "after": req.OwnerID})
	writeValue(w, map[string]any{"ownerId": req.OwnerID})
}

func (s *server) adminSetCourseLimit(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		Limit *int `json:"courseLimit"`
	}
	if !readJSON(w, r, &req, 1024) {
		return
	}
	before, err := s.cfg.Store.UserInfoByID(r.Context(), id)
	if s.notFound(w, err, "course limit") {
		return
	}
	if err := s.cfg.Store.SetCourseLimit(r.Context(), id, req.Limit); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	after := 10
	if req.Limit != nil {
		after = *req.Limit
	}
	s.adminAudit(r, store.AuditUserCourseLimit, store.UserTarget(id, before.Name), map[string]any{"before": before.CourseLimit, "after": after})
	writeValue(w, map[string]any{"courseLimit": after})
}
