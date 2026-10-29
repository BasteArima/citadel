package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"citadel/internal/store"
	"citadel/web"
)

// Sign-in: a name plus the service access code (CITADEL_ACCESS_CODE). A new name
// creates a user. The session token lives in an HttpOnly cookie; the database keeps only its hash.
const (
	cookieName   = "citadel_session"
	rememberTTL  = 180 * 24 * time.Hour
	shortTTL     = 24 * time.Hour
	maxNameRunes = 40
)

type ctxKey struct{}

func userFrom(ctx context.Context) store.User { return ctx.Value(ctxKey{}).(store.User) }

func (s *server) currentUser(r *http.Request) (store.User, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" {
		return store.User{}, false
	}
	u, err := s.cfg.Store.UserBySession(r.Context(), c.Value)
	if err != nil {
		if !errors.Is(err, store.ErrNoSession) {
			s.log.Error("session lookup", "err", err)
		}
		return store.User{}, false
	}
	return u, true
}

// api wraps a JSON handler: no session — 401.
func (s *server) api(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.currentUser(r)
		if !ok {
			jsonError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

// page wraps a page handler: no session — redirect to /login and back.
func (s *server) page(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.currentUser(r)
		if !ok {
			http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusFound)
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

func (s *server) loginPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, web.FS, "login.html")
}

type loginRequest struct {
	Name     string `json:"name"`
	Code     string `json:"code"`
	Remember bool   `json:"remember"`
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if !isJSON(r) {
		jsonError(w, http.StatusUnsupportedMediaType, "expected application/json")
		return
	}
	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		jsonError(w, http.StatusTooManyRequests, "Слишком много неудачных попыток. Подожди несколько минут.")
		return
	}
	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "bad request")
		return
	}
	name, ok := cleanName(req.Name)
	if !ok {
		jsonError(w, http.StatusBadRequest, "Имя — от 1 до 40 букв, цифр, пробелов, точек, дефисов или подчёркиваний.")
		return
	}
	if !s.codeMatches(req.Code) {
		s.limiter.fail(ip)
		s.log.Warn("sign-in failed", "ip", ip)
		jsonError(w, http.StatusUnauthorized, "Код не подошёл. Проверь раскладку и попробуй ещё раз.")
		return
	}
	configAdmin := false
	for _, a := range s.cfg.Admins {
		if strings.EqualFold(a, name) {
			configAdmin = true
		}
	}
	u, err := s.cfg.Store.SignIn(r.Context(), name, configAdmin)
	if err != nil {
		s.log.Error("sign in", "err", err)
		jsonError(w, http.StatusInternalServerError, "server error")
		return
	}
	ttl := shortTTL
	if req.Remember {
		ttl = rememberTTL
	}
	token, err := s.cfg.Store.CreateSession(r.Context(), u.ID, ttl)
	if err != nil {
		s.log.Error("create session", "err", err)
		jsonError(w, http.StatusInternalServerError, "server error")
		return
	}
	cookie := &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r)}
	if req.Remember {
		cookie.MaxAge = int(rememberTTL / time.Second)
	}
	http.SetCookie(w, cookie)
	s.log.Info("signed in", "user", u.Name, "role", u.Role)
	writeValue(w, u)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		if err := s.cfg.Store.DeleteSession(r.Context(), c.Value); err != nil {
			s.log.Error("delete session", "err", err)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r)})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	writeValue(w, userFrom(r.Context()))
}

// codeMatches compares in constant time; hashing first makes the lengths equal.
func (s *server) codeMatches(code string) bool {
	a, b := sha256.Sum256([]byte(code)), sha256.Sum256([]byte(s.cfg.AccessCode))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

func cleanName(name string) (string, bool) {
	name = strings.Join(strings.Fields(name), " ")
	n := utf8.RuneCountInString(name)
	if n == 0 || n > maxNameRunes {
		return "", false
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && !strings.ContainsRune(" .-_", r) {
			return "", false
		}
	}
	return name, true
}

// isJSON guards state-changing requests: a cross-site HTML form cannot send application/json.
func isJSON(r *http.Request) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mt == "application/json"
}

// isHTTPS is true behind Nginx Proxy Manager with TLS, so the cookie gets Secure.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// limiter counts failed sign-ins per address and blocks after max within window.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	fails  map[string][]time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{max: max, window: window, fails: map[string][]time.Time{}}
}

func (l *limiter) recent(key string) []time.Time {
	cut := time.Now().Add(-l.window)
	var keep []time.Time
	for _, t := range l.fails[key] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	if keep == nil {
		delete(l.fails, key)
	} else {
		l.fails[key] = keep
	}
	return keep
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.recent(key)) < l.max
}

func (l *limiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fails[key] = append(l.recent(key), time.Now())
}
