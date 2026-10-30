package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"citadel/internal/course"
	"citadel/internal/store"
	"citadel/web"
)

// Admin panel: courses, the draft editor, versions and users. Every route needs the admin role.
// A save is a new version; publishing makes a version visible to students (decision 0003:
// agents will propose drafts too, only an admin publishes).

var courseID = regexp.MustCompile(`^[a-z][a-z0-9-]{1,39}$`)

const maxCourseBytes = 8 << 20

// admin wraps an admin JSON handler: no session — 401, not an admin — 403.
func (s *server) admin(h http.HandlerFunc) http.Handler {
	return s.api(func(w http.ResponseWriter, r *http.Request) {
		if userFrom(r.Context()).Role != store.RoleAdmin {
			jsonError(w, http.StatusForbidden, "admins only")
			return
		}
		h(w, r)
	})
}

// adminPage serves the admin panel to admins and sends everyone else to the catalog.
func (s *server) adminPage(w http.ResponseWriter, r *http.Request) {
	if userFrom(r.Context()).Role != store.RoleAdmin {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, web.FS, "admin.html")
}

func (s *server) adminRoutes(mux *http.ServeMux) {
	mux.Handle("GET /admin", s.page(s.adminPage))
	mux.Handle("GET /api/admin/courses", s.admin(s.adminCourses))
	mux.Handle("POST /api/admin/courses", s.admin(s.adminCreate))
	mux.Handle("POST /api/admin/import", s.admin(s.adminImport))
	mux.Handle("POST /api/admin/check", s.admin(s.adminCheck))
	mux.Handle("GET /api/admin/courses/{id}/draft", s.admin(s.adminDraft))
	mux.Handle("PUT /api/admin/courses/{id}/draft", s.admin(s.adminSave))
	mux.Handle("POST /api/admin/courses/{id}/publish", s.admin(s.adminPublish))
	mux.Handle("POST /api/admin/courses/{id}/rollback", s.admin(s.adminRollback))
	mux.Handle("GET /api/admin/courses/{id}/versions", s.admin(s.adminVersions))
	mux.Handle("GET /api/admin/courses/{id}/versions/{v}", s.admin(s.adminVersion))
	mux.Handle("GET /api/admin/users", s.admin(s.adminUsers))
	mux.Handle("PUT /api/admin/users/{id}", s.admin(s.adminSetRole))
	s.adminAgentRoutes(mux)
}

// checkSummary is what the course list shows about the latest version.
type checkSummary struct {
	Errors   int              `json:"errors"`
	Warnings int              `json:"warnings"`
	Problems []course.Problem `json:"problems"`
}

func check(c *course.Course) checkSummary {
	ps := course.Validate(c)
	errs := len(course.Errors(ps))
	if ps == nil {
		ps = []course.Problem{}
	}
	return checkSummary{Errors: errs, Warnings: len(ps) - errs, Problems: ps}
}

func (s *server) adminCourses(w http.ResponseWriter, r *http.Request) {
	list, err := s.cfg.Store.Courses(r.Context())
	if err != nil {
		s.fail(w, "list courses", err)
		return
	}
	pending, err := s.cfg.Store.PendingByCourse(r.Context())
	if err != nil {
		s.fail(w, "count proposals", err)
		return
	}
	type row struct {
		store.CourseInfo
		Tool   string       `json:"tool"`
		Agents int          `json:"agents"` // proposals waiting for the admin
		Check  checkSummary `json:"check"`
	}
	out := make([]row, 0, len(list))
	for _, ci := range list {
		rw := row{CourseInfo: ci, Agents: pending[ci.ID]}
		if data, _, err := s.cfg.Store.Version(r.Context(), ci.ID, 0); err == nil {
			if c, err := course.Decode(data); err == nil {
				rw.Check = check(c)
				rw.Tool = c.Tool.Name + " " + c.Tool.Version
			} else {
				rw.Check = checkSummary{Errors: 1, Problems: []course.Problem{{Path: "курс", Msg: err.Error()}}}
			}
		}
		out = append(out, rw)
	}
	writeValue(w, out)
}

type newCourse struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Metal       string `json:"metal"`
	ToolName    string `json:"toolName"`
	ToolVersion string `json:"toolVersion"`
}

// adminCreate makes an unpublished course with one empty section to start from.
func (s *server) adminCreate(w http.ResponseWriter, r *http.Request) {
	var req newCourse
	if !readJSON(w, r, &req, 1<<14) {
		return
	}
	if !courseID.MatchString(req.ID) {
		jsonError(w, http.StatusBadRequest, "id — латиница, цифры и дефис, 2–40 символов, с буквы")
		return
	}
	if req.Title == "" || req.Metal == "" || req.ToolName == "" || req.ToolVersion == "" {
		jsonError(w, http.StatusBadRequest, "нужны название, металл звена, инструмент и его версия")
		return
	}
	c := &course.Course{
		Schema: course.SchemaVersion, ID: req.ID, Title: req.Title, Metal: req.Metal,
		Tool: course.Tool{Name: req.ToolName, Version: req.ToolVersion}, Review: []int{1, 3, 7},
		Pages: []string{"glossary", "notes", "exam"}, Glossary: map[string]course.Term{},
		Root: []*course.Node{{ID: "s1", Kind: course.KindSection, Title: "Раздел 1", Children: []*course.Node{
			{ID: "l1", Kind: course.KindLesson, Title: "Первый урок", N: 1, Planned: true},
		}}},
	}
	data, _ := course.Encode(c)
	if err := s.cfg.Store.CreateCourse(r.Context(), c.ID, data, userFrom(r.Context()).Name); err != nil {
		if errors.Is(err, store.ErrConflict) {
			jsonError(w, http.StatusConflict, "курс с таким id уже есть")
			return
		}
		s.fail(w, "create course", err)
		return
	}
	s.log.Info("course created", "id", c.ID, "by", userFrom(r.Context()).Name)
	s.reloadOrLog(r.Context())
	writeValue(w, map[string]any{"id": c.ID, "version": 1})
}

// adminImport takes a whole course JSON: a new course, or a new draft version of an existing one.
func (s *server) adminImport(w http.ResponseWriter, r *http.Request) {
	c, ok := s.readCourse(w, r)
	if !ok {
		return
	}
	data, _ := course.Encode(c)
	author := userFrom(r.Context()).Name
	_, vi, err := s.cfg.Store.Version(r.Context(), c.ID, 0)
	switch {
	case errors.Is(err, store.ErrNotFound):
		if !courseID.MatchString(c.ID) {
			jsonError(w, http.StatusBadRequest, "id курса — латиница, цифры и дефис")
			return
		}
		err = s.cfg.Store.CreateCourse(r.Context(), c.ID, data, author)
		vi.Version = 1
	case err == nil:
		vi.Version, err = s.cfg.Store.SaveDraft(r.Context(), c.ID, data, vi.Version, author, "импорт JSON")
	}
	if err != nil {
		s.fail(w, "import course", err)
		return
	}
	s.reloadOrLog(r.Context()) // a new course appears in the catalog as «Скоро»
	writeValue(w, map[string]any{"id": c.ID, "version": vi.Version, "check": check(c)})
}

func (s *server) adminCheck(w http.ResponseWriter, r *http.Request) {
	if c, ok := s.readCourse(w, r); ok {
		writeValue(w, check(c))
	}
}

func (s *server) adminDraft(w http.ResponseWriter, r *http.Request) {
	data, vi, err := s.cfg.Store.Version(r.Context(), r.PathValue("id"), 0)
	if s.notFound(w, err, "read draft") {
		return
	}
	writeValue(w, map[string]any{"version": vi, "course": json.RawMessage(data)})
}

type saveRequest struct {
	Base   int             `json:"base"`
	Note   string          `json:"note"`
	Course json.RawMessage `json:"course"`
}

// adminSave stores the editor's course as a new version. A draft with errors is saved too —
// half-done work must not be lost — but cannot be published until the errors are fixed.
func (s *server) adminSave(w http.ResponseWriter, r *http.Request) {
	var req saveRequest
	if !readJSON(w, r, &req, maxCourseBytes) {
		return
	}
	c, err := course.Decode(req.Course)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "курс не читается: "+err.Error())
		return
	}
	id := r.PathValue("id")
	if c.ID != id {
		jsonError(w, http.StatusBadRequest, "id курса в данных не совпадает с адресом")
		return
	}
	data, _ := course.Encode(c)
	v, err := s.cfg.Store.SaveDraft(r.Context(), id, data, req.Base, userFrom(r.Context()).Name, req.Note)
	if errors.Is(err, store.ErrConflict) {
		jsonError(w, http.StatusConflict, "черновик уже изменили после того, как ты его открыл — обнови страницу")
		return
	}
	if s.notFound(w, err, "save draft") {
		return
	}
	writeValue(w, map[string]any{"version": v, "check": check(c)})
}

type versionRequest struct {
	Version int `json:"version"`
	Base    int `json:"base"`
}

// adminPublish refuses a version with errors: students never see a broken course.
func (s *server) adminPublish(w http.ResponseWriter, r *http.Request) {
	var req versionRequest
	if !readJSON(w, r, &req, 1<<10) {
		return
	}
	id := r.PathValue("id")
	data, _, err := s.cfg.Store.Version(r.Context(), id, req.Version)
	if s.notFound(w, err, "read version") {
		return
	}
	c, err := course.Decode(data)
	if err != nil {
		jsonError(w, http.StatusUnprocessableEntity, "версия не читается: "+err.Error())
		return
	}
	if sum := check(c); sum.Errors > 0 {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]any{"error": "в версии есть ошибки — исправь их перед публикацией", "check": sum})
		return
	}
	if err := s.cfg.Store.Publish(r.Context(), id, req.Version); s.notFound(w, err, "publish") {
		return
	}
	if err := s.reload(r.Context()); err != nil {
		s.fail(w, "reload courses", err)
		return
	}
	s.log.Info("course published", "id", id, "version", req.Version, "by", userFrom(r.Context()).Name)
	writeValue(w, map[string]any{"published": req.Version})
}

// adminRollback puts an old version on top as a new draft; history is never rewritten.
func (s *server) adminRollback(w http.ResponseWriter, r *http.Request) {
	var req versionRequest
	if !readJSON(w, r, &req, 1<<10) {
		return
	}
	id := r.PathValue("id")
	data, _, err := s.cfg.Store.Version(r.Context(), id, req.Version)
	if s.notFound(w, err, "read version") {
		return
	}
	v, err := s.cfg.Store.SaveDraft(r.Context(), id, data, req.Base, userFrom(r.Context()).Name, "откат к v"+strconv.Itoa(req.Version))
	if errors.Is(err, store.ErrConflict) {
		jsonError(w, http.StatusConflict, "черновик изменился — обнови страницу")
		return
	}
	if s.notFound(w, err, "rollback") {
		return
	}
	writeValue(w, map[string]any{"version": v})
}

func (s *server) adminVersions(w http.ResponseWriter, r *http.Request) {
	vs, err := s.cfg.Store.Versions(r.Context(), r.PathValue("id"))
	if s.notFound(w, err, "list versions") {
		return
	}
	writeValue(w, vs)
}

func (s *server) adminVersion(w http.ResponseWriter, r *http.Request) {
	v, err := strconv.Atoi(r.PathValue("v"))
	if err != nil || v < 1 {
		jsonError(w, http.StatusBadRequest, "bad version")
		return
	}
	data, vi, err := s.cfg.Store.Version(r.Context(), r.PathValue("id"), v)
	if s.notFound(w, err, "read version") {
		return
	}
	writeValue(w, map[string]any{"version": vi, "course": json.RawMessage(data)})
}

func (s *server) adminUsers(w http.ResponseWriter, r *http.Request) {
	us, err := s.cfg.Store.Users(r.Context())
	if err != nil {
		s.fail(w, "list users", err)
		return
	}
	writeValue(w, map[string]any{"users": us, "configAdmins": s.cfg.Admins})
}

// adminSetRole changes another user's role. Your own role is not changed here, so an admin
// cannot lock everyone out; names from CITADEL_ADMINS get admin back on their next sign-in.
func (s *server) adminSetRole(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad id")
		return
	}
	if id == userFrom(r.Context()).ID {
		jsonError(w, http.StatusBadRequest, "свою роль здесь менять нельзя")
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if !readJSON(w, r, &req, 1<<10) {
		return
	}
	if err := s.cfg.Store.SetRole(r.Context(), id, req.Role); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			jsonError(w, http.StatusNotFound, "no such user")
			return
		}
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeValue(w, map[string]any{"role": req.Role})
}

// reloadOrLog refreshes the catalog after a change that is already stored: the change itself
// succeeded, so a failed reload is only logged and fixed by the next one.
func (s *server) reloadOrLog(ctx context.Context) {
	if err := s.reload(ctx); err != nil {
		s.log.Error("reload courses", "err", err)
	}
}

// readCourse reads a course JSON body (state-changing, so JSON only).
func (s *server) readCourse(w http.ResponseWriter, r *http.Request) (*course.Course, bool) {
	var raw json.RawMessage
	if !readJSON(w, r, &raw, maxCourseBytes) {
		return nil, false
	}
	c, err := course.Decode(raw)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "курс не читается: "+err.Error())
		return nil, false
	}
	return c, true
}

func readJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	if !isJSON(r) {
		jsonError(w, http.StatusUnsupportedMediaType, "expected application/json")
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(v); err != nil {
		jsonError(w, http.StatusBadRequest, "bad request: "+err.Error())
		return false
	}
	return true
}

func (s *server) notFound(w http.ResponseWriter, err error, what string) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		jsonError(w, http.StatusNotFound, "not found")
		return true
	}
	s.fail(w, what, err)
	return true
}

func (s *server) fail(w http.ResponseWriter, what string, err error) {
	s.log.Error(what, "err", err)
	jsonError(w, http.StatusInternalServerError, "server error")
}
