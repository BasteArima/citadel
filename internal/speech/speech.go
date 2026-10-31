// Package speech turns course text into narration: what is read in each part, split into
// chapters by headings, and the hash a recording is checked against (docs/dev/AUDIO.md).
package speech

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"citadel/internal/course"
)

// DefaultVoice is used when the course passport names none (decision 0014).
const DefaultVoice = "ru-RU-SvetlanaNeural"

// Chapter is a stretch of a part between headings. The first one is «Начало».
type Chapter struct {
	Title string `json:"t"`
	Text  string `json:"-"`
}

// Part is the narration of one theory part of a lesson.
type Part struct {
	Node     string    // id of the part node
	Lesson   int       // lesson number
	LessonT  string    // lesson title
	Index    int       // part number in the lesson, from 1
	Title    string    // part title
	Chapters []Chapter // text after the lexicon
	Hash     string    // of the voice and the text: a recording made from another text is stale
}

// Chars is how many characters the part reads.
func (p Part) Chars() int {
	n := 0
	for _, c := range p.Chapters {
		n += utf8.RuneCountInString(c.Text)
	}
	return n
}

// Voice returns the voice of a course.
func Voice(c *course.Course) string {
	if c.Speech != nil && c.Speech.Voice != "" {
		return c.Speech.Voice
	}
	return DefaultVoice
}

// Parts returns the narration of every theory part of the course, in course order.
// Practice parts (hands, test) and lessons without parts are not narrated.
func Parts(c *course.Course) []Part {
	lessons := map[string]*course.Node{}
	c.Walk(func(n, _ *course.Node) { lessons[n.ID] = n })
	var lex map[string]string
	if c.Speech != nil {
		lex = c.Speech.Lexicon
	}
	r := newReader(c, lessons, lex)
	voice := Voice(c)
	var out []Part
	c.Walk(func(l, _ *course.Node) {
		if l.Kind != course.KindLesson || l.Planned {
			return
		}
		for i, p := range l.Children {
			if p.Kind != course.KindPart || p.Practice != "" {
				continue
			}
			part := Part{Node: p.ID, Lesson: l.N, LessonT: l.Title, Index: i + 1, Title: p.Title}
			part.Chapters = r.part(l, p, i+1)
			part.Hash = hash(voice, part.Chapters)
			out = append(out, part)
		}
	})
	return out
}

// Find returns the narration of one part.
func Find(c *course.Course, node string) (Part, bool) {
	for _, p := range Parts(c) {
		if p.Node == node {
			return p, true
		}
	}
	return Part{}, false
}

func hash(voice string, chs []Chapter) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00", voice)
	for _, c := range chs {
		fmt.Fprintf(h, "%s\x01%s\x02", c.Title, c.Text)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// reader collects what is read aloud. It reads what a student reads on the screen:
// headings, paragraphs, list items, «Важно» and «Осторожно» callouts and the lesson intro.
// Code, tables, schemes and animations stay on the screen: the recording points at them
// with a short phrase. Questions, tasks and C# side notes are not read.
type reader struct {
	c       *course.Course
	lessons map[string]*course.Node
	lex     *lexicon
}

func newReader(c *course.Course, lessons map[string]*course.Node, lex map[string]string) *reader {
	return &reader{c: c, lessons: lessons, lex: newLexicon(lex)}
}

// Phrases that point at what is on the screen.
var onScreen = map[string]string{
	"code":    "Пример кода — на экране.",
	"predict": "Дальше задача: предскажи, что выведет программа. Она на экране.",
	"table":   "Таблица — на экране.",
	"scheme":  "Схема — на экране.",
	"anim":    "Анимация — на экране.",
	"steps":   "Пошаговый разбор — на экране.",
}

var sayRe = regexp.MustCompile(`^\s*<b>\s*Как сказать на собесе:?\s*</b>\s*`)

func (r *reader) part(l, p *course.Node, n int) []Chapter {
	chs := []Chapter{{Title: "Начало"}}
	var lines []string
	last := ""
	add := func(s string) {
		if s = sentence(s); s != "" {
			lines = append(lines, s)
		}
	}
	flush := func() {
		chs[len(chs)-1].Text = r.lex.apply(strings.Join(lines, "\n"))
		lines = nil
	}
	add(fmt.Sprintf("Часть %d. %s", n, p.Title))
	if n == 1 {
		add(r.plain(l.Lead))
		for _, s := range l.Simple {
			if sayRe.MatchString(s) {
				add("Как сказать на собесе: " + r.plain(sayRe.ReplaceAllString(s, "")))
			} else {
				add(r.plain(s))
			}
		}
		if l.Say != "" {
			add("Как сказать на собесе: " + r.plain(l.Say))
		}
	}
	for _, b := range p.Blocks {
		typ := b.Type()
		if phrase, ok := onScreen[typ]; ok {
			if last != typ { // a run of code blocks gets one phrase
				add(phrase)
			}
			last = typ
			continue
		}
		last = typ
		switch typ {
		case "heading":
			title := r.plain(str(b["text"]))
			if title == "" {
				continue
			}
			if len(chs) == 1 && len(lines) == 1 {
				// the part starts with a heading: its title opens the first chapter, no «Начало» of one phrase
				chs[0].Title = title
			} else {
				flush()
				chs = append(chs, Chapter{Title: title})
			}
			add(title)
		case "text":
			add(r.plain(str(b["html"])))
		case "list":
			items, _ := b["items"].([]any)
			for _, it := range items {
				add(r.plain(str(it)))
			}
		case "callout":
			kind := str(b["kind"])
			if kind == "cs" {
				continue
			}
			label := str(b["title"])
			if label == "" {
				label = map[string]string{"note": "Важно", "warn": "Осторожно"}[kind]
			}
			if label != "" {
				add(label)
			}
			add(r.plain(str(b["html"])))
		}
	}
	flush()
	// a heading followed by nothing but another heading would be a chapter of one word
	out := chs[:0]
	for _, c := range chs {
		if c.Text != "" {
			out = append(out, c)
		}
	}
	return out
}

var (
	termRe  = regexp.MustCompile(`\{\{([a-z0-9-]+)(?:\|([^}]+))?\}\}`)
	xrefRe  = regexp.MustCompile(`\{\{>([a-z0-9-]+)(?:\|([^}]+))?\}\}`)
	tagRe   = regexp.MustCompile(`<[^>]*>`)
	spaceRe = regexp.MustCompile(`\s+`)
)

// plain turns course rich text into plain text, as rich.js shows it.
func (r *reader) plain(s string) string {
	s = xrefRe.ReplaceAllStringFunc(s, func(m string) string {
		g := xrefRe.FindStringSubmatch(m)
		l, ok := r.lessons[g[1]]
		if !ok {
			return firstOf(g[2], g[1])
		}
		name := fmt.Sprintf("урок %d «%s»", l.N, l.Title)
		if g[2] != "" {
			return g[2] + " — " + name
		}
		return name
	})
	s = termRe.ReplaceAllStringFunc(s, func(m string) string {
		g := termRe.FindStringSubmatch(m)
		if g[2] != "" {
			return g[2]
		}
		if t, ok := r.c.Glossary[g[1]]; ok {
			return t.Title
		}
		return g[1]
	})
	s = strings.NewReplacer("<br>", " ", "<br/>", " ", "<br />", " ", "</p>", " ", "</li>", " ").Replace(s)
	s = tagRe.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	return strings.TrimSpace(spaceRe.ReplaceAllString(s, " "))
}

// sentence ends a line with a stop, so the voice pauses after a heading or a list item.
func sentence(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	last, _ := utf8.DecodeLastRuneInString(s)
	if !strings.ContainsRune(".!?…:;", last) {
		if last == '»' || last == ')' || last == '"' || unicode.IsLetter(last) || unicode.IsDigit(last) {
			s += "."
		}
	}
	return s
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func firstOf(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
