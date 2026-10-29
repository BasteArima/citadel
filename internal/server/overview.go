package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"citadel/internal/course"
	"citadel/internal/store"
)

// Overview is a course as the catalog and the profile see it: the summary plus
// the signed-in user's progress in it.
type Overview struct {
	Summary
	Done    int        `json:"done"`    // lessons passed
	Solved  int        `json:"solved"`  // questions solved
	Due     int        `json:"due"`     // lessons with a review due today
	Started bool       `json:"started"` // any progress at all
	Next    *LessonRef `json:"next,omitempty"`
}

// LessonRef points at a lesson.
type LessonRef struct {
	ID    string `json:"id"`
	N     int    `json:"n"`
	Title string `json:"title"`
}

// overview answers GET /api/overview?today=YYYY-MM-DD. The client sends its own date,
// so "due today" matches what the course page shows around midnight too.
func (s *server) overview(w http.ResponseWriter, r *http.Request) {
	today, err := time.Parse(time.DateOnly, r.URL.Query().Get("today"))
	if err != nil {
		today, _ = time.Parse(time.DateOnly, time.Now().UTC().Format(time.DateOnly))
	}
	u := userFrom(r.Context())
	out := make([]Overview, 0, len(s.order))
	for _, id := range s.order {
		items, err := s.cfg.Store.Progress(r.Context(), u.ID, id)
		if err != nil {
			s.log.Error("read progress", "err", err)
			jsonError(w, http.StatusInternalServerError, "server error")
			return
		}
		out = append(out, overviewOf(s.parsed[id], items, today))
	}
	writeValue(w, map[string]any{"courses": out})
}

func overviewOf(c *course.Course, items map[string]store.Item, today time.Time) Overview {
	o := Overview{Summary: summarize(c), Started: len(items) > 0}
	review := c.Review
	if len(review) == 0 {
		review = []int{1, 3, 7}
	}
	for key := range items {
		if strings.HasPrefix(key, "q:") {
			o.Solved++
		}
	}
	c.Walk(func(n *course.Node, _ *course.Node) {
		if n.Kind != course.KindLesson || n.Planned {
			return
		}
		doneItem, ok := items["done:"+n.ID]
		if !ok {
			if o.Next == nil {
				o.Next = &LessonRef{ID: n.ID, N: n.N, Title: n.Title}
			}
			return
		}
		o.Done++
		var doneDate string
		if json.Unmarshal(doneItem.V, &doneDate) != nil {
			return
		}
		passed, err := time.Parse(time.DateOnly, doneDate)
		if err != nil {
			return
		}
		// the next review is the first stage without a mark; it is due on passed + interval
		for k, days := range review {
			if _, ok := items["rev:"+n.ID+":"+strconv.Itoa(k)]; ok {
				continue
			}
			if !today.Before(passed.AddDate(0, 0, days)) {
				o.Due++
			}
			break
		}
	})
	return o
}
