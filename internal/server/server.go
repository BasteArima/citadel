// Package server is the HTTP side of Citadel: sign-in, the course and progress API
// and the embedded frontend.
package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"sync/atomic"
	"time"

	"citadel/internal/course"
	"citadel/internal/speech"
	"citadel/internal/store"
	"citadel/web"
)

// Config is what the server needs to run.
type Config struct {
	Store *store.Store
	Log   *slog.Logger
	// the runner of course code (decision 0013); empty URL — running is off
	RunnerURL    string
	RunnerSecret string
	// narration (docs/dev/AUDIO.md): where the MP3 files lie and what makes them; nil Synth — recording is off
	AudioDir string
	Synth    speech.Synth
	// record new and changed parts without a button (decision 0018)
	AutoRecord bool
}

// Summary is a course as listed in the catalog.
type Summary struct {
	ID       string      `json:"id"`
	Type     string      `json:"type,omitempty"` // "project" — a project (decision 0016)
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle,omitempty"`
	Metal    string      `json:"metal"`
	Tool     course.Tool `json:"tool"`
	Requires []string    `json:"requires,omitempty"`
	Lessons  int         `json:"lessons"`
	Ready    int         `json:"ready"`
}

type server struct {
	cfg          Config
	log          *slog.Logger
	cat          atomic.Pointer[catalog]
	limiter      *limiter
	loginLimiter *limiter
	runs         runLocks
	audio        audioJobs
	ctx          context.Context // lives as long as the service: background jobs stop with it
}

// catalog is a snapshot of the published courses. Publishing builds a new one and swaps it in,
// so requests never see a half-updated list.
type catalog struct {
	order   []string
	parsed  map[string]*course.Course
	courses map[string][]byte
	list    map[string]Summary
	soon    []Soon
	access  map[string]string            // course id → public or private (decision 0012)
	speech  map[string]map[string]string // course id → part id → hash of its narration text
}

// Soon is a course that exists but was never published: the catalog shows it as «Скоро».
type Soon struct {
	ID    string `json:"id"`
	Type  string `json:"type,omitempty"`
	Title string `json:"title"`
	Metal string `json:"metal"`
}

// New returns the HTTP handler.
func New(ctx context.Context, cfg Config) (http.Handler, error) {
	s := &server{cfg: cfg, log: cfg.Log, limiter: newLimiter(10, 10*time.Minute), loginLimiter: newLimiter(10, 15*time.Minute), ctx: ctx, audio: audioJobs{jobs: map[string]*audioJob{}}}
	if ok, err := cfg.Store.HasSignInAdmin(ctx); err != nil {
		return nil, err
	} else if !ok {
		s.log.Warn(`no admin can sign in: run "citadel user reset-password <login>" or "citadel user add --role admin …"`)
	}
	if err := s.reload(ctx); err != nil {
		return nil, err
	}

	static, err := fs.Sub(web.FS, "static")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	// open to everyone
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.Handle("GET /static/", noCache(http.StripPrefix("/static/", http.FileServerFS(static))))
	mux.HandleFunc("GET /login", s.loginPage)
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	// signed-in only
	mux.Handle("GET /api/me", s.api(s.me))
	mux.Handle("PUT /api/me/name", s.api(s.changeName))
	mux.Handle("PUT /api/me/password", s.api(s.changePassword))
	mux.Handle("POST /api/me/logout-all", s.api(s.logoutAll))
	mux.Handle("GET /api/courses", s.api(s.listCourses))
	mux.Handle("GET /api/overview", s.api(s.overview))
	mux.Handle("GET /api/courses/{id}", s.api(s.getCourse))
	mux.Handle("GET /api/blocks", s.api(s.listBlocks))
	mux.Handle("GET /api/search", s.api(s.search))
	mux.Handle("GET /api/progress/{course}", s.api(s.getProgress))
	mux.Handle("POST /api/progress/{course}", s.api(s.postProgress))
	mux.Handle("GET /c/{id}/", s.page(s.coursePage))
	mux.Handle("GET /{$}", s.page(sitePage("catalog.html", "catalog")))
	mux.Handle("GET /profile", s.page(sitePage("profile.html", "profile")))
	mux.Handle("GET /review", s.page(sitePage("review.html", "review")))
	mux.Handle("GET /projects", s.page(sitePage("projects.html", "projects")))
	mux.Handle("GET /p/{id}/", s.page(s.projectPage))
	mux.Handle("GET /api/courses/{id}/links", s.api(s.stepLinks))
	mux.Handle("GET /api/courses/{id}/applied", s.api(s.appliedIn))
	// admins only
	s.adminRoutes(mux)
	// agents, by token
	s.agentRoutes(mux)
	s.mcpRoutes(mux)
	// running course code: admins and agents (decision 0013)
	s.runRoutes(mux)
	// narration recordings: students play, admins record
	s.audioRoutes(mux)
	go s.keepRecorded()
	return s.logRequests(securityHeaders(mux)), nil
}

// noCache makes the browser re-check static files: embedded files carry no modification
// time, so without it an update of the service could leave a stale engine in the cache.
// An ETag from the file content turns the re-check into a short 304 instead of a full download,
// so moving between pages stays fast.
func noCache(h http.Handler) http.Handler {
	etags := map[string]string{}
	fs.WalkDir(web.FS, "static", func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if data, err := web.FS.ReadFile(path); err == nil {
				sum := sha256.Sum256(data)
				etags["/"+path] = `"` + hex.EncodeToString(sum[:8]) + `"`
			}
		}
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if tag, ok := etags[r.URL.Path]; ok {
			w.Header().Set("ETag", tag)
		}
		h.ServeHTTP(w, r)
	})
}

// sitePage serves a page of the site around the courses with the header filled in (top.go).
func sitePage(name, current string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { withTop(w, r, name, current, false) }
}

func summarize(c *course.Course) Summary {
	sum := Summary{ID: c.ID, Type: c.Type, Title: c.Title, Subtitle: c.Subtitle, Metal: c.Metal, Tool: c.Tool, Requires: c.Requires}
	c.Walk(func(n *course.Node, _ *course.Node) {
		if n.Kind == course.KindLesson {
			sum.Lessons++
			if !n.Planned {
				sum.Ready++
			}
		}
	})
	return sum
}

// reload reads the published courses from the store into a fresh catalog snapshot.
func (s *server) reload(ctx context.Context) error {
	courses, err := s.cfg.Store.Published(ctx)
	if err != nil {
		return err
	}
	all, err := s.cfg.Store.Courses(ctx)
	if err != nil {
		return err
	}
	access, err := s.cfg.Store.CourseAccess(ctx)
	if err != nil {
		return err
	}
	c := &catalog{parsed: map[string]*course.Course{}, courses: map[string][]byte{}, list: map[string]Summary{}, soon: []Soon{}, access: access, speech: map[string]map[string]string{}}
	for _, cr := range courses {
		data, err := json.Marshal(cr)
		if err != nil {
			return err
		}
		c.parsed[cr.ID] = cr
		c.courses[cr.ID] = data
		c.order = append(c.order, cr.ID)
		c.list[cr.ID] = summarize(cr)
		hashes := map[string]string{}
		for _, p := range speech.Parts(cr) {
			hashes[p.Node] = p.Hash
		}
		c.speech[cr.ID] = hashes
	}
	for _, ci := range all {
		if ci.Published == 0 {
			c.soon = append(c.soon, Soon{ID: ci.ID, Type: ci.Type, Title: ci.Title, Metal: ci.Metal})
		}
	}
	s.cat.Store(c)
	return nil
}

// visible tells which courses the user may open: admins — all, others — public courses and
// the private ones granted to them. A course the user may not open looks the same as a missing one.
func (s *server) visible(r *http.Request) (func(id string) bool, error) {
	cat, u := s.cat.Load(), userFrom(r.Context())
	if u.Role == store.RoleAdmin {
		return func(string) bool { return true }, nil
	}
	grants, err := s.cfg.Store.UserCourses(r.Context(), u.ID)
	if err != nil {
		return nil, err
	}
	return func(id string) bool { return cat.access[id] != store.AccessPrivate || slices.Contains(grants, id) }, nil
}

// published returns the published course the user may open, or false. If access cannot be
// read, the course is treated as closed: the caller answers 404, the error goes to the log.
func (s *server) published(r *http.Request, id string) ([]byte, bool) {
	data, ok := s.cat.Load().courses[id]
	if !ok {
		return nil, false
	}
	see, err := s.visible(r)
	if err != nil {
		s.log.Error("course access", "err", err)
		return nil, false
	}
	return data, see(id)
}

func (s *server) listCourses(w http.ResponseWriter, r *http.Request) {
	cat := s.cat.Load()
	see, err := s.visible(r)
	if err != nil {
		s.fail(w, "course access", err)
		return
	}
	out := []Summary{}
	for _, id := range cat.order {
		if see(id) {
			out = append(out, cat.list[id])
		}
	}
	writeValue(w, out)
}

func (s *server) getCourse(w http.ResponseWriter, r *http.Request) {
	data, ok := s.published(r, r.PathValue("id"))
	if !ok {
		jsonError(w, http.StatusNotFound, "course not found")
		return
	}
	writeJSON(w, data)
}

func (s *server) listBlocks(w http.ResponseWriter, r *http.Request) {
	data, _ := json.Marshal(map[string]any{"schema": course.SchemaVersion, "blocks": course.Blocks})
	writeJSON(w, data)
}

func (s *server) coursePage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.published(r, id); !ok {
		http.NotFound(w, r)
		return
	}
	// links to a project from search, cards and the profile come here: the #step survives the redirect
	if s.cat.Load().parsed[id].IsProject() {
		http.Redirect(w, r, "/p/"+url.PathEscape(id)+"/", http.StatusFound)
		return
	}
	withTop(w, r, "course.html", "catalog", true)
}

func writeJSON(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}

func writeValue(w http.ResponseWriter, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "encode failed")
		return
	}
	writeJSON(w, data)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		if r.Method == http.MethodHead || r.URL.Path == "/healthz" {
			return // health probes would drown the log
		}
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", sw.status, "dur", time.Since(start).Round(time.Microsecond).String())
	})
}
