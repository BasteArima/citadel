// Package legacy converts the Go course from format v0 (legacy/go-course: JS files
// that fill window.COURSE) to course format v1.
package legacy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"

	"github.com/dop251/goja"

	"citadel/internal/course"
)

// Options are passport fields that v0 does not have.
type Options struct {
	ID     string
	Metal  string
	Review []int
	Pages  []string
}

// v0 shapes. Blocks and questions stay generic: they are converted key by key.
type v0Course struct {
	Title    string                 `json:"title"`
	Sub      string                 `json:"sub"`
	Go       string                 `json:"go"`
	Sections []v0Section            `json:"sections"`
	Lessons  map[string]v0Lesson    `json:"lessons"`
	Glossary map[string]course.Term `json:"glossary"`
	Platform *v0Platform            `json:"platform"`
}

// v0Platform holds what the old engine kept in its own code: the home page texts
// and course pages. It lives in data/platform.js; the old engine ignores it.
type v0Platform struct {
	About string   `json:"about"`
	Howto []string `json:"howto"`
	Pages []v0Page `json:"pages"`
}

type v0Page struct {
	ID     string           `json:"id"`
	Title  string           `json:"title"`
	Icon   string           `json:"icon"`
	Tag    string           `json:"tag"`
	Lead   string           `json:"lead"`
	About  string           `json:"about"`
	Blocks []map[string]any `json:"blocks"`
}

type v0Section struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	About   string `json:"about"`
	Lessons []struct {
		N  int    `json:"n"`
		ID string `json:"id"`
		T  string `json:"t"`
	} `json:"lessons"`
}

type v0Lesson struct {
	Time    string           `json:"time"`
	Lead    string           `json:"lead"`
	Simple  []string         `json:"simple"`
	Say     string           `json:"say"`
	Blocks  []map[string]any `json:"blocks"`
	Hands   map[string]any   `json:"hands"`
	Summary []string         `json:"summary"`
	Test    []map[string]any `json:"test"`
	Videos  []map[string]any `json:"videos"`
}

var scriptRe = regexp.MustCompile(`<script src="([^"?]+)`)

// Load runs the course scripts listed in dir/index.html, in their order,
// and returns the resulting window.COURSE as JSON.
func Load(dir string) ([]byte, error) {
	index, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil {
		return nil, err
	}
	vm := goja.New()
	if err := vm.Set("window", vm.GlobalObject()); err != nil {
		return nil, err
	}
	ran := 0
	for _, m := range scriptRe.FindAllSubmatch(index, -1) {
		src := string(m[1])
		if src == "app.js" {
			continue // the engine, not the content
		}
		code, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(src)))
		if err != nil {
			return nil, err
		}
		if _, err := vm.RunScript(src, string(code)); err != nil {
			return nil, fmt.Errorf("run %s: %w", src, err)
		}
		ran++
	}
	if ran == 0 {
		return nil, fmt.Errorf("%s: no course scripts in index.html", dir)
	}
	out, err := vm.RunString("JSON.stringify(window.COURSE)")
	if err != nil {
		return nil, fmt.Errorf("read window.COURSE: %w", err)
	}
	s, ok := out.Export().(string)
	if !ok {
		return nil, fmt.Errorf("window.COURSE is not set")
	}
	return []byte(s), nil
}

// ConvertDir loads a v0 course from dir and converts it.
func ConvertDir(dir string, opt Options) (*course.Course, error) {
	raw, err := Load(dir)
	if err != nil {
		return nil, err
	}
	return Convert(raw, opt)
}

// Convert converts v0 course JSON to v1. Unknown block fields are errors:
// the converter never drops content silently.
func Convert(raw []byte, opt Options) (*course.Course, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var src v0Course
	if err := dec.Decode(&src); err != nil {
		return nil, fmt.Errorf("decode v0: %w", err)
	}
	c := &course.Course{
		Schema:   course.SchemaVersion,
		ID:       opt.ID,
		Title:    src.Title,
		Subtitle: src.Sub,
		Metal:    opt.Metal,
		Tool:     course.Tool{Name: "Go", Version: src.Go},
		Labels:   map[string]string{"section": "Раздел", "lesson": "Урок", "part": "Часть"},
		Review:   opt.Review,
		Pages:    opt.Pages,
		Glossary: src.Glossary,
	}
	seen := map[string]bool{}
	for _, s := range src.Sections {
		sec := &course.Node{ID: s.ID, Kind: course.KindSection, Title: s.Name, Tag: s.Kind, About: s.About}
		for _, l := range s.Lessons {
			node := &course.Node{ID: l.ID, Kind: course.KindLesson, Title: l.T, N: l.N}
			les, ok := src.Lessons[l.ID]
			if !ok {
				node.Planned = true
			} else {
				if err := convertLesson(node, les); err != nil {
					return nil, fmt.Errorf("lesson %s: %w", l.ID, err)
				}
				seen[l.ID] = true
			}
			sec.Children = append(sec.Children, node)
		}
		c.Root = append(c.Root, sec)
	}
	for _, id := range slices.Sorted(maps.Keys(src.Lessons)) {
		if !seen[id] {
			return nil, fmt.Errorf("lesson %s has content but is not in any section", id)
		}
	}
	if p := src.Platform; p != nil {
		c.About, c.Howto = p.About, p.Howto
		for _, pg := range p.Pages {
			node := &course.Node{ID: pg.ID, Kind: course.KindPage, Title: pg.Title, Icon: pg.Icon, Tag: pg.Tag, Lead: pg.Lead, About: pg.About}
			for i, b := range pg.Blocks {
				nb, err := convertBlock(b)
				if err != nil {
					return nil, fmt.Errorf("page %s, block %d: %w", pg.ID, i+1, err)
				}
				node.Blocks = append(node.Blocks, nb)
			}
			c.Root = append(c.Root, node)
		}
	}
	return c, nil
}

func convertLesson(node *course.Node, les v0Lesson) error {
	node.Time, node.Lead, node.Simple, node.Say = les.Time, les.Lead, les.Simple, les.Say
	node.Summary, node.Videos = les.Summary, les.Videos

	split := slices.ContainsFunc(les.Blocks, func(b map[string]any) bool { return b["part"] != nil })

	// Theory: either one block list or parts started by { part } markers.
	var parts []*course.Node
	var flat []course.Block
	for i, b := range les.Blocks {
		if title, ok := b["part"]; ok {
			if len(b) != 1 {
				return fmt.Errorf("block %d: part marker with extra fields", i+1)
			}
			parts = append(parts, &course.Node{
				ID:    fmt.Sprintf("%s.%d", node.ID, len(parts)+1),
				Kind:  course.KindPart,
				Title: fmt.Sprint(title),
			})
			continue
		}
		nb, err := convertBlock(b)
		if err != nil {
			return fmt.Errorf("block %d: %w", i+1, err)
		}
		if !split {
			flat = append(flat, nb)
			continue
		}
		if len(parts) == 0 {
			// Same as the v0 engine: blocks before the first marker form an intro part.
			parts = append(parts, &course.Node{ID: node.ID + ".1", Kind: course.KindPart, Title: "Введение"})
		}
		p := parts[len(parts)-1]
		p.Blocks = append(p.Blocks, nb)
	}

	var hands course.Block
	if les.Hands != nil {
		var err error
		if hands, err = convertHands(node.ID, les.Hands); err != nil {
			return fmt.Errorf("hands: %w", err)
		}
	}

	// Questions: "check yourself" ones go to their part, the rest to the final check.
	// The id keeps the v0 position, so old progress (stored by position) maps onto it.
	var final []course.Block
	for i, q := range les.Test {
		nq, partN, err := convertQuestion(q, split)
		if err != nil {
			return fmt.Errorf("test %d: %w", i+1, err)
		}
		nq["id"] = fmt.Sprintf("%s.q%d", node.ID, i+1)
		if split && partN > 0 {
			if partN > len(parts) {
				return fmt.Errorf("test %d: part %d does not exist", i+1, partN)
			}
			p := parts[partN-1]
			p.Blocks = append(p.Blocks, nq)
			continue
		}
		final = append(final, nq)
	}

	if !split {
		node.Blocks = flat
		if hands != nil {
			node.Blocks = append(node.Blocks, hands)
		}
		node.Blocks = append(node.Blocks, final...)
		return nil
	}
	if hands != nil {
		parts = append(parts, &course.Node{
			ID: fmt.Sprintf("%s.%d", node.ID, len(parts)+1), Kind: course.KindPart,
			Title: "Сделай руками", Practice: course.PracticeHands, Blocks: []course.Block{hands},
		})
	}
	parts = append(parts, &course.Node{
		ID: fmt.Sprintf("%s.%d", node.ID, len(parts)+1), Kind: course.KindPart,
		Title: "Проверка", Practice: course.PracticeTest, Blocks: final,
	})
	node.Children = parts
	return nil
}

// Allowed sibling fields for blocks whose main key holds a scalar or list.
var scalarBlocks = map[string]struct {
	typ      string
	field    string
	siblings []string
}{
	"h":    {"heading", "text", nil},
	"h3":   {"heading", "text", nil},
	"p":    {"text", "html", nil},
	"list": {"list", "items", []string{"ordered"}},
	"code": {"code", "code", []string{"cap", "file", "go", "lang"}},
	"note": {"callout", "html", []string{"title"}},
	"warn": {"callout", "html", []string{"title"}},
	"cs":   {"callout", "html", []string{"title"}},
}

// Blocks whose main key holds an object: its fields become the block fields.
var objectBlocks = []string{"table", "scheme", "steps", "anim", "predict"}

func convertBlock(b map[string]any) (course.Block, error) {
	main := mainKey(b)
	if main == "" {
		return nil, fmt.Errorf("unknown block with fields %v", sortedKeys(b))
	}
	if sb, ok := scalarBlocks[main]; ok {
		out := course.Block{"type": sb.typ, sb.field: b[main]}
		switch main {
		case "h":
			out["level"] = json.Number("2")
		case "h3":
			out["level"] = json.Number("3")
		case "note", "warn", "cs":
			out["kind"] = main
		}
		for k, val := range b {
			if k == main {
				continue
			}
			if !slices.Contains(sb.siblings, k) {
				return nil, fmt.Errorf("%s block: unknown field %q", main, k)
			}
			out[k] = val
		}
		return out, nil
	}
	if len(b) != 1 {
		return nil, fmt.Errorf("%s block: unexpected fields %v", main, sortedKeys(b))
	}
	obj, ok := b[main].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s block: value is not an object", main)
	}
	if _, clash := obj["type"]; clash {
		return nil, fmt.Errorf("%s block: field \"type\" clashes with the block type", main)
	}
	out := course.Block{"type": main}
	maps.Copy(out, obj)
	return out, nil
}

// mainKey finds the field that defines the block type. A block with two such
// fields is ambiguous and gets none.
func mainKey(b map[string]any) string {
	var found []string
	for k := range b {
		if _, ok := scalarBlocks[k]; ok || slices.Contains(objectBlocks, k) {
			found = append(found, k)
		}
	}
	if len(found) != 1 {
		return ""
	}
	return found[0]
}

var questionFields = []string{"type", "q", "opts", "a", "why", "part", "items"}

// convertQuestion turns { type: 'choice', … } into { type: 'question', kind: 'choice', … }.
// The part number is returned separately when the lesson is split into parts.
func convertQuestion(q map[string]any, split bool) (course.Block, int, error) {
	out := course.Block{"type": "question"}
	partN := 0
	for k, val := range q {
		if !slices.Contains(questionFields, k) {
			return nil, 0, fmt.Errorf("question: unknown field %q", k)
		}
		switch k {
		case "type":
			out["kind"] = val
		case "part":
			n, err := val.(json.Number).Int64()
			if err != nil {
				return nil, 0, fmt.Errorf("question: part %v is not a number", val)
			}
			if split {
				partN = int(n)
			} else {
				out["part"] = val
			}
		default:
			out[k] = val
		}
	}
	return out, partN, nil
}

var handsFields = []string{"title", "goal", "steps", "trouble", "check"}

func convertHands(lessonID string, h map[string]any) (course.Block, error) {
	out := course.Block{"type": "hands"}
	for k, val := range h {
		if !slices.Contains(handsFields, k) {
			return nil, fmt.Errorf("unknown field %q", k)
		}
		out[k] = val
	}
	if check, ok := h["check"].([]any); ok {
		conv := make([]any, len(check))
		for i, q := range check {
			m, ok := q.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("check %d is not an object", i+1)
			}
			nq, _, err := convertQuestion(m, false)
			if err != nil {
				return nil, fmt.Errorf("check %d: %w", i+1, err)
			}
			delete(nq, "type")
			nq["id"] = fmt.Sprintf("%s.h%d", lessonID, i+1)
			conv[i] = map[string]any(nq)
		}
		out["check"] = conv
	}
	return out, nil
}

func sortedKeys(m map[string]any) []string {
	keys := slices.Collect(maps.Keys(m))
	sort.Strings(keys)
	return keys
}
