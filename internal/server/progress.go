package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"citadel/internal/store"
)

// Progress keys:
//
//	q:<lesson>:<question id> solved question
//	seen:<lesson>:<part>     read part without questions
//	done:<lesson>            date the lesson was passed
//	rev:<lesson>:<n>         review n passed
var progressKey = regexp.MustCompile(`^(q|seen|done|rev):[A-Za-z0-9._:-]{1,200}$`)

const (
	maxProgressItems = 10000
	maxValueBytes    = 200
	maxClockSkew     = time.Minute
)

type progressBody struct {
	Items map[string]store.Item `json:"items"`
}

func (s *server) getProgress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("course")
	if _, ok := s.courses[id]; !ok {
		jsonError(w, http.StatusNotFound, "course not found")
		return
	}
	items, err := s.cfg.Store.Progress(r.Context(), userFrom(r.Context()).ID, id)
	if err != nil {
		s.log.Error("read progress", "err", err)
		jsonError(w, http.StatusInternalServerError, "server error")
		return
	}
	writeValue(w, progressBody{Items: items})
}

// postProgress merges the client's marks and returns the merged state, so the
// client learns about marks made on other devices in the same request.
func (s *server) postProgress(w http.ResponseWriter, r *http.Request) {
	if !isJSON(r) {
		jsonError(w, http.StatusUnsupportedMediaType, "expected application/json")
		return
	}
	id := r.PathValue("course")
	if _, ok := s.courses[id]; !ok {
		jsonError(w, http.StatusNotFound, "course not found")
		return
	}
	var body progressBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "bad request")
		return
	}
	if len(body.Items) > maxProgressItems {
		jsonError(w, http.StatusRequestEntityTooLarge, "too many items")
		return
	}
	// A client clock running ahead must not make its marks unbeatable forever.
	limit := time.Now().Add(maxClockSkew).UnixMilli()
	for k, it := range body.Items {
		if !progressKey.MatchString(k) || it.At <= 0 || len(it.V) == 0 || len(it.V) > maxValueBytes || !json.Valid(it.V) {
			jsonError(w, http.StatusBadRequest, "bad item "+k)
			return
		}
		if it.At > limit {
			it.At = limit
			body.Items[k] = it
		}
	}
	items, err := s.cfg.Store.MergeProgress(r.Context(), userFrom(r.Context()).ID, id, body.Items)
	if err != nil {
		s.log.Error("merge progress", "err", err)
		jsonError(w, http.StatusInternalServerError, "server error")
		return
	}
	writeValue(w, progressBody{Items: items})
}
