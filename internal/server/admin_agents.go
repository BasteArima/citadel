package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"citadel/internal/course"
	"citadel/internal/store"
)

// Admin side of the agents: tokens and the proposal queue.

func (s *server) adminAgentRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/admin/tokens", s.admin(s.adminTokens))
	mux.Handle("POST /api/admin/tokens", s.admin(s.adminCreateToken))
	mux.Handle("POST /api/admin/tokens/{id}/revoke", s.admin(s.adminRevokeToken))
	mux.Handle("GET /api/admin/proposals", s.admin(s.adminProposals))
	mux.Handle("GET /api/admin/proposals/{id}", s.admin(s.adminProposal))
	mux.Handle("POST /api/admin/proposals/{id}/accept", s.admin(s.adminAccept))
	mux.Handle("POST /api/admin/proposals/{id}/reject", s.admin(s.adminReject))
}

func (s *server) adminTokens(w http.ResponseWriter, r *http.Request) {
	ts, err := s.cfg.Store.Tokens(r.Context())
	if err != nil {
		s.fail(w, "list tokens", err)
		return
	}
	writeValue(w, ts)
}

// adminCreateToken returns the secret once; it is never stored or logged.
func (s *server) adminCreateToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string   `json:"name"`
		Propose bool     `json:"propose"`
		Create  bool     `json:"create"`
		Courses []string `json:"courses"`
	}
	if !readJSON(w, r, &req, 1<<14) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len([]rune(req.Name)) > 60 {
		jsonError(w, http.StatusBadRequest, "название токена — от 1 до 60 символов")
		return
	}
	for _, c := range req.Courses {
		if !courseID.MatchString(c) {
			jsonError(w, http.StatusBadRequest, "неверный id курса: "+c)
			return
		}
	}
	t, secret, err := s.cfg.Store.CreateToken(r.Context(), store.Token{Name: req.Name, CanPropose: req.Propose || req.Create, CanCreate: req.Create,
		Courses: req.Courses, CreatedBy: userFrom(r.Context()).Name})
	if err != nil {
		s.fail(w, "create token", err)
		return
	}
	s.log.Info("token created", "id", t.ID, "name", t.Name, "by", t.CreatedBy)
	writeValue(w, map[string]any{"token": t, "secret": secret})
}

func (s *server) adminRevokeToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.cfg.Store.RevokeToken(r.Context(), id); s.notFound(w, err, "revoke token") {
		return
	}
	s.log.Info("token revoked", "id", id, "by", userFrom(r.Context()).Name)
	writeValue(w, map[string]any{"revoked": id})
}

func (s *server) adminProposals(w http.ResponseWriter, r *http.Request) {
	ps, err := s.cfg.Store.Proposals(r.Context(), store.ProposalFilter{Status: r.URL.Query().Get("status")})
	if err != nil {
		s.fail(w, "list proposals", err)
		return
	}
	writeValue(w, ps)
}

func (s *server) proposalFrom(w http.ResponseWriter, r *http.Request) (store.Proposal, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad id")
		return store.Proposal{}, false
	}
	p, err := s.cfg.Store.Proposal(r.Context(), id)
	if s.notFound(w, err, "read proposal") {
		return p, false
	}
	return p, true
}

// adminProposal returns the proposal and the course after its changes; the base version is read
// through the versions API, so the page can show the difference.
func (s *server) adminProposal(w http.ResponseWriter, r *http.Request) {
	p, ok := s.proposalFrom(w, r)
	if !ok {
		return
	}
	_, latest, err := s.cfg.Store.Version(r.Context(), p.CourseID, 0)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.fail(w, "read course", err)
		return
	}
	writeValue(w, map[string]any{"proposal": p, "course": p.Data, "latest": latest.Version})
}

// adminAccept puts the proposal into the draft as a new version. If the draft moved on since
// the agent read it, the changes are applied again on top of the newest version; if they no
// longer fit, the admin is told and nothing changes.
func (s *server) adminAccept(w http.ResponseWriter, r *http.Request) {
	p, ok := s.proposalFrom(w, r)
	if !ok {
		return
	}
	if p.Status != store.ProposalPending {
		jsonError(w, http.StatusConflict, "правка уже не ждёт решения или не прошла проверку")
		return
	}
	data, base := []byte(p.Data), p.Base
	if !p.NewCourse {
		latest, vi, err := s.cfg.Store.Version(r.Context(), p.CourseID, 0)
		if s.notFound(w, err, "read draft") {
			return
		}
		if vi.Version != p.Base {
			changes, err := course.DecodeChanges(p.Changes)
			c, err2 := course.Decode(latest)
			if err == nil {
				err = err2
			}
			if err == nil {
				err = course.Apply(c, changes)
			}
			if err != nil {
				jsonError(w, http.StatusConflict, "черновик изменился с тех пор, как агент его читал (v"+strconv.Itoa(p.Base)+" → v"+strconv.Itoa(vi.Version)+"), и правка на него не ложится: "+err.Error())
				return
			}
			if sum := check(c); sum.Errors > 0 {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "поверх нового черновика правка даёт ошибки проверки", "check": sum})
				return
			}
			data, _ = course.Encode(c)
			base = vi.Version
		}
	}
	admin := userFrom(r.Context()).Name
	v, err := s.cfg.Store.AcceptProposal(r.Context(), p.ID, p.CourseID, data, base, "agent:"+p.Agent, p.Title+" · принял "+admin, admin)
	if errors.Is(err, store.ErrConflict) {
		jsonError(w, http.StatusConflict, "черновик или правка изменились одновременно — обнови страницу")
		return
	}
	if err != nil {
		s.fail(w, "accept proposal", err)
		return
	}
	if p.NewCourse {
		s.reloadOrLog(r.Context()) // the new course appears in the catalog as «Скоро»
	}
	s.log.Info("proposal accepted", "id", p.ID, "course", p.CourseID, "version", v, "by", admin)
	writeValue(w, map[string]any{"version": v, "rebased": base != p.Base})
}

func (s *server) adminReject(w http.ResponseWriter, r *http.Request) {
	p, ok := s.proposalFrom(w, r)
	if !ok {
		return
	}
	var req struct {
		Comment string `json:"comment"`
	}
	if !readJSON(w, r, &req, 1<<14) {
		return
	}
	admin := userFrom(r.Context()).Name
	if err := s.cfg.Store.DecideProposal(r.Context(), p.ID, store.ProposalRejected, admin, strings.TrimSpace(req.Comment), 0); err != nil {
		if errors.Is(err, store.ErrConflict) {
			jsonError(w, http.StatusConflict, "правка уже не ждёт решения")
			return
		}
		s.fail(w, "reject proposal", err)
		return
	}
	s.log.Info("proposal rejected", "id", p.ID, "by", admin)
	writeValue(w, map[string]any{"status": store.ProposalRejected})
}
