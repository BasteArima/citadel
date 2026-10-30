// Package server is the HTTP side of Citadel: sign-in, the course and progress API
// and the embedded frontend.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"citadel/internal/course"
	"citadel/internal/store"
	"citadel/web"
)

// Config is what the server needs to run.
type Config struct {
	Store      *store.Store
	AccessCode string   // the service access code, from CITADEL_ACCESS_CODE
	Admins     []string // names that get the admin role
	Log        *slog.Logger
}

// Summary is a course as listed in the catalog.
type Summary struct {
	ID       string      `json:"id"`
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle,omitempty"`
	Metal    string      `json:"metal"`
	Tool     course.Tool `json:"tool"`
	Requires []string    `json:"requires,omitempty"`
	Lessons  int         `json:"lessons"`
	Ready    int         `json:"ready"`
}

type server struct {
	cfg     Config
	log     *slog.Logger
	cat     atomic.Pointer[catalog]
	limiter *limiter
}

// catalog is a snapshot of the published courses. Publishing builds a new one and swaps it in,
// so requests never see a half-updated list.
type catalog struct {
	order    []string
	parsed   map[string]*course.Course
	courses  map[string][]byte
	listJSON []byte
	soon     []Soon
}

// Soon is a course that exists but was never published: the catalog shows it as «Скоро».
type Soon struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Metal string `json:"metal"`
}

// New returns the HTTP handler.
func New(ctx context.Context, cfg Config) (http.Handler, error) {
	if cfg.AccessCode == "" {
		return nil, errors.New("access code is empty")
	}
	s := &server{cfg: cfg, log: cfg.Log, limiter: newLimiter(10, 10*time.Minute)}
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
	mux.Handle("GET /api/courses", s.api(s.listCourses))
	mux.Handle("GET /api/overview", s.api(s.overview))
	mux.Handle("GET /api/courses/{id}", s.api(s.getCourse))
	mux.Handle("GET /api/blocks", s.api(s.listBlocks))
	mux.Handle("GET /api/search", s.api(s.search))
	mux.Handle("GET /api/progress/{course}", s.api(s.getProgress))
	mux.Handle("POST /api/progress/{course}", s.api(s.postProgress))
	mux.Handle("GET /c/{id}/", s.page(s.coursePage))
	mux.Handle("GET /ladder.html", s.page(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, web.FS, "ladder.html")
	}))
	mux.Handle("GET /{$}", s.page(sitePage("catalog.html")))
	mux.Handle("GET /profile", s.page(sitePage("profile.html")))
	mux.Handle("GET /review", s.page(sitePage("review.html")))
	// admins only
	s.adminRoutes(mux)
	// agents, by token
	s.agentRoutes(mux)
	s.mcpRoutes(mux)
	return s.logRequests(mux), nil
}

// noCache makes the browser re-check static files: embedded files carry no modification
// time, so without it an update of the service could leave a stale engine in the cache.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

// sitePage serves a page of the site around the courses: the catalog, the profile.
func sitePage(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, web.FS, name)
	}
}

func summarize(c *course.Course) Summary {
	sum := Summary{ID: c.ID, Title: c.Title, Subtitle: c.Subtitle, Metal: c.Metal, Tool: c.Tool, Requires: c.Requires}
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
	c := &catalog{parsed: map[string]*course.Course{}, courses: map[string][]byte{}, soon: []Soon{}}
	list := make([]Summary, 0, len(courses))
	for _, cr := range courses {
		data, err := json.Marshal(cr)
		if err != nil {
			return err
		}
		c.parsed[cr.ID] = cr
		c.courses[cr.ID] = data
		c.order = append(c.order, cr.ID)
		list = append(list, summarize(cr))
	}
	for _, ci := range all {
		if ci.Published == 0 {
			c.soon = append(c.soon, Soon{ID: ci.ID, Title: ci.Title, Metal: ci.Metal})
		}
	}
	c.listJSON, _ = json.Marshal(list)
	s.cat.Store(c)
	return nil
}

func (s *server) listCourses(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.cat.Load().listJSON)
}

func (s *server) getCourse(w http.ResponseWriter, r *http.Request) {
	data, ok := s.cat.Load().courses[r.PathValue("id")]
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
	if _, ok := s.cat.Load().courses[r.PathValue("id")]; !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, web.FS, "course.html")
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
