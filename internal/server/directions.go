package server

import (
	"errors"
	"net/http"

	"citadel/internal/store"
)

func (s *server) directionRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/directions", s.api(s.directions))
	mux.Handle("POST /api/admin/directions", s.admin(s.createDirection))
	mux.Handle("PUT /api/admin/directions/{id}", s.admin(s.updateDirection))
	mux.Handle("DELETE /api/admin/directions/{id}", s.admin(s.deleteDirection))
	mux.Handle("PUT /api/admin/courses/{id}/direction", s.staffCourse(s.setCourseDirection))
}

func (s *server) directions(w http.ResponseWriter, r *http.Request) {
	list, err := s.cfg.Store.Directions(r.Context())
	if err != nil {
		s.fail(w, "list directions", err)
		return
	}
	writeValue(w, list)
}

func (s *server) directionError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, store.ErrDirection) {
		jsonError(w, 400, err.Error())
		return true
	}
	if errors.Is(err, store.ErrConflict) {
		jsonError(w, 409, "id направления занят")
		return true
	}
	return s.notFound(w, err, "change direction")
}

func (s *server) createDirection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	if !readJSON(w, r, &req, 2048) {
		return
	}
	if s.directionError(w, s.cfg.Store.CreateDirection(r.Context(), req.ID, req.Title)) {
		return
	}
	s.adminAudit(r, store.AuditDirectionCreated, req.ID, map[string]any{"title": req.Title})
	s.directions(w, r)
}

func (s *server) updateDirection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title    *string `json:"title"`
		Position *int    `json:"position"`
	}
	if !readJSON(w, r, &req, 2048) {
		return
	}
	before, err := s.cfg.Store.Directions(r.Context())
	if s.directionError(w, err) {
		return
	}
	id := r.PathValue("id")
	if s.directionError(w, s.cfg.Store.UpdateDirection(r.Context(), id, req.Title, req.Position)) {
		return
	}
	after, err := s.cfg.Store.Directions(r.Context())
	if s.directionError(w, err) {
		return
	}
	s.adminAudit(r, store.AuditDirectionUpdated, id, map[string]any{"before": before, "after": after})
	writeValue(w, after)
}

func (s *server) deleteDirection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	before, err := s.cfg.Store.Directions(r.Context())
	if s.directionError(w, err) {
		return
	}
	if s.directionError(w, s.cfg.Store.DeleteDirection(r.Context(), id)) {
		return
	}
	s.reloadOrLog(r.Context())
	s.adminAudit(r, store.AuditDirectionDeleted, id, map[string]any{"before": before})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) setCourseDirection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Direction string `json:"direction"`
	}
	if !readJSON(w, r, &req, 2048) {
		return
	}
	id := r.PathValue("id")
	list, err := s.cfg.Store.CourseMetadata(r.Context())
	if s.directionError(w, err) {
		return
	}
	before := list[id].Direction
	if s.directionError(w, s.cfg.Store.SetCourseDirection(r.Context(), id, req.Direction)) {
		return
	}
	s.reloadOrLog(r.Context())
	s.adminAudit(r, store.AuditCourseDirection, id, map[string]any{"before": before, "after": req.Direction})
	writeValue(w, map[string]any{"direction": req.Direction})
}
