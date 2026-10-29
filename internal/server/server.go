// Package server is the HTTP side of Citadel: the course API and the embedded frontend.
package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"citadel/internal/course"
	"citadel/web"
)

// Summary is a course as listed in the catalog.
type Summary struct {
	ID       string      `json:"id"`
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle,omitempty"`
	Metal    string      `json:"metal"`
	Tool     course.Tool `json:"tool"`
	Lessons  int         `json:"lessons"`
	Ready    int         `json:"ready"`
}

type server struct {
	log      *slog.Logger
	order    []string
	courses  map[string][]byte
	listJSON []byte
}

// New returns the HTTP handler for the given courses. Course JSON is encoded once here.
func New(courses []*course.Course, log *slog.Logger) http.Handler {
	s := &server{log: log, courses: map[string][]byte{}}
	list := make([]Summary, 0, len(courses))
	for _, c := range courses {
		data, err := json.Marshal(c)
		if err != nil {
			panic(err) // courses were decoded from JSON, so they always encode
		}
		s.courses[c.ID] = data
		s.order = append(s.order, c.ID)
		list = append(list, summarize(c))
	}
	s.listJSON, _ = json.Marshal(list)

	static, err := fs.Sub(web.FS, "static")
	if err != nil {
		panic(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /api/courses", s.listCourses)
	mux.HandleFunc("GET /api/courses/{id}", s.getCourse)
	mux.HandleFunc("GET /api/blocks", s.listBlocks)
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(static)))
	mux.HandleFunc("GET /c/{id}/", s.coursePage)
	mux.HandleFunc("GET /ladder.html", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, web.FS, "ladder.html")
	})
	mux.HandleFunc("GET /{$}", s.home)
	return s.logRequests(mux)
}

func summarize(c *course.Course) Summary {
	sum := Summary{ID: c.ID, Title: c.Title, Subtitle: c.Subtitle, Metal: c.Metal, Tool: c.Tool}
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

func (s *server) listCourses(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.listJSON)
}

func (s *server) getCourse(w http.ResponseWriter, r *http.Request) {
	data, ok := s.courses[r.PathValue("id")]
	if !ok {
		http.Error(w, "course not found", http.StatusNotFound)
		return
	}
	writeJSON(w, data)
}

func (s *server) listBlocks(w http.ResponseWriter, r *http.Request) {
	data, _ := json.Marshal(map[string]any{"schema": course.SchemaVersion, "blocks": course.Blocks})
	writeJSON(w, data)
}

// home opens the first course until the catalog exists (stage 3).
func (s *server) home(w http.ResponseWriter, r *http.Request) {
	if len(s.order) == 0 {
		http.Error(w, "no courses", http.StatusNotFound)
		return
	}
	http.Redirect(w, r, "/c/"+s.order[0]+"/", http.StatusFound)
}

func (s *server) coursePage(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.courses[r.PathValue("id")]; !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, web.FS, "course.html")
}

func writeJSON(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
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
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", sw.status, "dur", time.Since(start).Round(time.Microsecond).String())
	})
}
