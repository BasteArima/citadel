package server

import (
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"citadel/internal/course"
)

// Search over the published courses: lesson, part and page titles and glossary terms.
// The course page searches its own course in the browser (it works offline); this endpoint
// serves «all courses» and the site pages, which do not load courses.

// Hit is one search result. Href is a site path, ready to open.
type Hit struct {
	Kind   string `json:"kind"` // lesson, part, page, term, course
	Title  string `json:"title"`
	Sub    string `json:"sub"`
	Href   string `json:"href"`
	Course string `json:"course"`
}

const (
	maxPlaceHits = 12
	maxTermHits  = 8
)

var tagRe = regexp.MustCompile(`<[^>]+>|\{\{>?[^}|]*\|?|\}\}`)

// normText is what search compares: no tags or link braces, lower case, ё as е.
func normText(s string) string {
	s = tagRe.ReplaceAllString(s, " ")
	return strings.ReplaceAll(strings.ToLower(s), "ё", "е")
}

func (s *server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(normText(r.URL.Query().Get("q")))
	only := r.URL.Query().Get("course")
	cat := s.cat.Load()
	see, err := s.visible(r)
	if err != nil {
		s.fail(w, "course access", err)
		return
	}
	places, terms, defs := []Hit{}, []Hit{}, []Hit{}
	for _, id := range cat.order {
		if (only != "" && id != only) || !see(id) {
			continue
		}
		c := cat.parsed[id]
		base := "/c/" + id + "/"
		if q == "" {
			places = append(places, Hit{Kind: "course", Title: c.Title, Sub: c.Subtitle, Href: base, Course: c.Title})
			continue
		}
		label := c.Labels["lesson"]
		if label == "" {
			label = "Урок"
		}
		c.Walk(func(n *course.Node, parent *course.Node) {
			switch {
			case n.Kind == course.KindLesson && !n.Planned:
				if strings.Contains(normText(n.Title), q) {
					sec := ""
					if parent != nil {
						sec = parent.Title + " · "
					}
					places = append(places, Hit{Kind: "lesson", Title: n.Title, Sub: sec + label + " " + strconv.Itoa(n.N), Href: base + "#" + n.ID, Course: c.Title})
				}
				for k, p := range n.Children {
					if strings.Contains(normText(p.Title), q) {
						places = append(places, Hit{Kind: "part", Title: p.Title, Sub: label + " " + strconv.Itoa(n.N) + " · часть " + strconv.Itoa(k+1),
							Href: base + "#" + n.ID + "/" + strconv.Itoa(k+1), Course: c.Title})
					}
				}
			case n.Kind == course.KindPage && parent == nil:
				if strings.Contains(normText(n.Title), q) {
					places = append(places, Hit{Kind: "page", Title: n.Title, Sub: "Страница курса", Href: base + "#" + n.ID, Course: c.Title})
				}
			}
		})
		if !hasPage(c, "glossary") {
			continue
		}
		for key, t := range c.Glossary {
			h := Hit{Kind: "term", Title: t.Title, Sub: t.Text, Href: base + "#glossary/" + key, Course: c.Title}
			if strings.Contains(normText(t.Title+" "+t.English+" "+key), q) {
				terms = append(terms, h)
			} else if strings.Contains(normText(t.Text), q) {
				defs = append(defs, h) // a match in the definition only ranks below
			}
		}
	}
	terms = append(sortHits(terms), sortHits(defs)...)
	writeValue(w, map[string]any{"places": limit(places, maxPlaceHits), "terms": limit(terms, maxTermHits)})
}

func hasPage(c *course.Course, page string) bool {
	return c.Pages == nil || slices.Contains(c.Pages, page)
}

// sortHits orders terms by title: glossary maps have no order of their own.
func sortHits(hs []Hit) []Hit {
	slices.SortStableFunc(hs, func(a, b Hit) int { return strings.Compare(a.Title, b.Title) })
	return hs
}

func limit(hs []Hit, n int) []Hit {
	if len(hs) > n {
		return hs[:n]
	}
	return hs
}
