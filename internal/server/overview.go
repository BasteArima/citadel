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
	Done   int `json:"done"`   // lessons passed
	Solved int `json:"solved"` // questions answered
	// questions answered right on the first attempt (decision 0008); old marks without
	// a first attempt count as right
	FirstRight int        `json:"firstRight"`
	Parts      int        `json:"parts"`   // parts closed; a one-page lesson counts as one part when passed
	Cards      int        `json:"cards"`   // review cards in the course
	Due        int        `json:"due"`     // review cards due today
	Week       [7]int     `json:"week"`    // cards due on each of the next 7 days, today first (overdue counted today)
	Started    bool       `json:"started"` // any progress at all
	Next       *LessonRef `json:"next,omitempty"`
}

// card is the value of a card:<lesson>:<ref> mark.
type card struct {
	Due string `json:"d"`
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
	for key, it := range items {
		switch {
		case strings.HasPrefix(key, "q:"):
			o.Solved++
			if string(it.V) != "2" {
				o.FirstRight++
			}
		case strings.HasPrefix(key, "card:"):
			var cd card
			if json.Unmarshal(it.V, &cd) != nil {
				continue
			}
			due, err := time.Parse(time.DateOnly, cd.Due)
			if err != nil {
				continue
			}
			o.Cards++
			day := int(due.Sub(today).Hours() / 24)
			if day <= 0 {
				o.Due++
				day = 0
			}
			if day < len(o.Week) {
				o.Week[day]++
			}
		}
	}
	c.Walk(func(n *course.Node, _ *course.Node) {
		if n.Kind != course.KindLesson || n.Planned {
			return
		}
		o.Parts += partsClosed(n, items)
		if _, ok := items["done:"+n.ID]; ok {
			o.Done++
		} else if o.Next == nil {
			o.Next = &LessonRef{ID: n.ID, N: n.N, Title: n.Title}
		}
	})
	return o
}

// partsClosed counts the closed parts of a lesson by the same rules as the engine:
// the final check — when the lesson is passed; a part with questions — when all are answered;
// a part without them — when it was read to the end.
func partsClosed(les *course.Node, items map[string]store.Item) int {
	has := func(key string) bool { _, ok := items[key]; return ok }
	if len(les.Children) == 0 {
		if has("done:" + les.ID) {
			return 1
		}
		return 0
	}
	n := 0
	for k, p := range les.Children {
		if p.Practice == course.PracticeTest {
			if has("done:" + les.ID) {
				n++
			}
			continue
		}
		var ids []string
		for _, b := range p.Blocks {
			switch b.Type() {
			case "question":
				if id, ok := b["id"].(string); ok {
					ids = append(ids, id)
				}
			case "hands":
				check, _ := b["check"].([]any)
				for _, q := range check {
					if m, ok := q.(map[string]any); ok {
						if id, ok := m["id"].(string); ok {
							ids = append(ids, id)
						}
					}
				}
			}
		}
		closed := len(ids) > 0
		for _, id := range ids {
			closed = closed && has("q:"+les.ID+":"+id)
		}
		if len(ids) == 0 {
			closed = has("seen:" + les.ID + ":" + strconv.Itoa(k))
		}
		if closed {
			n++
		}
	}
	return n
}
