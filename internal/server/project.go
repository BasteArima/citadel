package server

import (
	"net/http"

	"citadel/internal/course"
)

// A project (decision 0016) is stored as a course of a special type: versions, the editor, agents,
// access and progress are the same. Its own are the pages and the links to lessons of the courses.

func (s *server) projectPage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.published(r, id); !ok || !s.cat.Load().parsed[id].IsProject() {
		http.NotFound(w, r)
		return
	}
	withTop(w, r, "project.html", "projects", false)
}

// LessonLink is a lesson a step refers to, as the step page shows it.
type LessonLink struct {
	Course string `json:"course"`
	ID     string `json:"id"`
	N      int    `json:"n"`
	Title  string `json:"title"`
	Ready  bool   `json:"ready"` // false — the lesson is still planned
}

// lessonRefs calls fn for every link from the steps of a project to a lesson of a course.
func lessonRefs(p *course.Course, fn func(step *course.Node, ref map[string]any)) {
	p.Walk(func(n, _ *course.Node) {
		for _, b := range n.Blocks {
			if b.Type() != "spec" {
				continue
			}
			refs, _ := b["lessons"].([]any)
			for _, r := range refs {
				if m, ok := r.(map[string]any); ok {
					fn(n, m)
				}
			}
		}
	})
}

// stepLinks answers GET /api/courses/{id}/links: titles of the lessons the steps refer to, by
// «course:lesson». Lessons of courses the user cannot open, and missing ones, are left out.
func (s *server) stepLinks(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.published(r, id); !ok {
		jsonError(w, http.StatusNotFound, "course not found")
		return
	}
	cat := s.cat.Load()
	see, err := s.visible(r)
	if err != nil {
		s.fail(w, "course access", err)
		return
	}
	lessons := map[string]map[string]*course.Node{}
	byID := func(cid string) map[string]*course.Node {
		if m, ok := lessons[cid]; ok {
			return m
		}
		m := map[string]*course.Node{}
		if c := cat.parsed[cid]; c != nil && see(cid) {
			c.Walk(func(n, _ *course.Node) {
				if n.Kind == course.KindLesson {
					m[n.ID] = n
				}
			})
		}
		lessons[cid] = m
		return m
	}
	out := map[string]LessonLink{}
	lessonRefs(cat.parsed[id], func(_ *course.Node, ref map[string]any) {
		cid, _ := ref["course"].(string)
		lid, _ := ref["id"].(string)
		if n := byID(cid)[lid]; n != nil {
			out[cid+":"+lid] = LessonLink{Course: cid, ID: lid, N: n.N, Title: n.Title, Ready: !n.Planned}
		}
	})
	writeValue(w, out)
}

// AppliedStep is a project step a lesson leads to: «Применишь в проекте».
type AppliedStep struct {
	Project string `json:"project"`
	Step    string `json:"step"`
	Num     string `json:"num"`
	Title   string `json:"title"`
	Why     string `json:"why,omitempty"`
}

// appliedIn answers GET /api/courses/{id}/applied: lesson id → the steps of the projects the user
// can open that refer to it. A closed project does not show up in the lessons of others.
func (s *server) appliedIn(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.published(r, id); !ok {
		jsonError(w, http.StatusNotFound, "course not found")
		return
	}
	cat := s.cat.Load()
	see, err := s.visible(r)
	if err != nil {
		s.fail(w, "course access", err)
		return
	}
	out := map[string][]AppliedStep{}
	for _, pid := range cat.order {
		p := cat.parsed[pid]
		if !p.IsProject() || !see(pid) {
			continue
		}
		nums := p.StepNum()
		lessonRefs(p, func(step *course.Node, ref map[string]any) {
			if cid, _ := ref["course"].(string); cid != id {
				return
			}
			lid, _ := ref["id"].(string)
			why, _ := ref["why"].(string)
			out[lid] = append(out[lid], AppliedStep{Project: pid, Step: step.ID, Num: nums[step.ID], Title: step.Title, Why: why})
		})
	}
	writeValue(w, out)
}
