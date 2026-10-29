package course

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// Problem is one finding of the course check. Errors block saving;
// warnings are shown to the author but do not.
type Problem struct {
	Path    string `json:"path"`
	Msg     string `json:"msg"`
	Warning bool   `json:"warning,omitempty"`
}

func (p Problem) String() string {
	level := "ошибка"
	if p.Warning {
		level = "предупреждение"
	}
	return fmt.Sprintf("%s: %s: %s", level, p.Path, p.Msg)
}

// Errors returns only the problems that are errors.
func Errors(ps []Problem) []Problem {
	var out []Problem
	for _, p := range ps {
		if !p.Warning {
			out = append(out, p)
		}
	}
	return out
}

// refRe matches {{term}}, {{term|text}}, {{>node}} and {{>node|text}} inside course text.
var refRe = regexp.MustCompile(`\{\{(>?)([^}|]+)(?:\|[^}]*)?\}\}`)

var nodeKinds = []string{KindSection, KindLesson, KindPart, KindPage}

// Validate checks the course: passport, tree shape, block types and fields,
// links to terms and nodes, and questions.
func Validate(c *Course) []Problem {
	v := &validator{c: c, ids: map[string]bool{}, qids: map[string]bool{}}
	v.passport()
	c.Walk(func(n *Node, _ *Node) {
		if n.ID == "" {
			return
		}
		if v.ids[n.ID] {
			v.errf("узел "+n.ID, "id повторяется")
		}
		v.ids[n.ID] = true
	})
	c.Walk(v.node)
	for key, t := range c.Glossary {
		v.text("словарь "+key, t.Text)
	}
	for _, s := range append([]string{c.About}, c.Howto...) {
		v.text("паспорт", s)
	}
	return v.out
}

type validator struct {
	c    *Course
	ids  map[string]bool
	qids map[string]bool // question ids: progress is stored by them
	out  []Problem
}

func (v *validator) errf(path, format string, args ...any) {
	v.out = append(v.out, Problem{Path: path, Msg: fmt.Sprintf(format, args...)})
}

func (v *validator) warnf(path, format string, args ...any) {
	v.out = append(v.out, Problem{Path: path, Msg: fmt.Sprintf(format, args...), Warning: true})
}

func (v *validator) passport() {
	c := v.c
	if c.Schema != SchemaVersion {
		v.errf("паспорт", "версия схемы %d, ожидается %d", c.Schema, SchemaVersion)
	}
	if c.ID == "" {
		v.errf("паспорт", "нет id курса")
	}
	if c.Title == "" {
		v.errf("паспорт", "нет названия")
	}
	if c.Metal == "" {
		v.errf("паспорт", "не указан металл звена")
	}
	if c.Tool.Name == "" || c.Tool.Version == "" {
		v.errf("паспорт", "не указан инструмент и его версия: выводы программ должны быть получены запуском на известной версии")
	}
	if len(c.Root) == 0 {
		v.errf("паспорт", "в курсе нет ни одного узла")
	}
	// Courses from requires may live elsewhere, so only the shape is checked here.
	seen := map[string]bool{}
	for _, r := range c.Requires {
		switch {
		case r == "":
			v.errf("паспорт", "пустой id в requires")
		case r == c.ID:
			v.errf("паспорт", "курс не может опираться сам на себя")
		case seen[r]:
			v.errf("паспорт", "курс %q в requires повторяется", r)
		}
		seen[r] = true
	}
}

func (v *validator) node(n *Node, parent *Node) {
	path := "узел " + n.ID
	if n.ID == "" {
		path = "узел «" + n.Title + "»"
		v.errf(path, "нет id")
	}
	if !slices.Contains(nodeKinds, n.Kind) {
		v.errf(path, "неизвестный вид узла %q", n.Kind)
	}
	if n.Title == "" {
		v.errf(path, "нет заголовка")
	}
	if len(n.Children) > 0 && len(n.Blocks) > 0 {
		v.errf(path, "у узла одновременно и дочерние узлы, и блоки")
	}
	if !n.Planned && len(n.Children) == 0 && len(n.Blocks) == 0 && n.Practice == "" {
		v.warnf(path, "пустой узел: нет ни блоков, ни дочерних узлов")
	}
	if n.Practice != "" && n.Practice != PracticeHands && n.Practice != PracticeTest {
		v.errf(path, "неизвестный вид практики %q", n.Practice)
	}
	for _, d := range n.Deps {
		if !v.ids[d] {
			v.errf(path, "опирается на несуществующий узел %q", d)
		}
	}
	for _, s := range append([]string{n.Lead, n.About, n.Say}, append(n.Simple, n.Summary...)...) {
		v.text(path, s)
	}
	for i, b := range n.Blocks {
		v.block(fmt.Sprintf("%s, блок %d (%s)", path, i+1, b.Type()), b)
	}
}

func (v *validator) block(path string, b Block) {
	spec, ok := Spec(b.Type())
	if !ok {
		v.errf(path, "неизвестный тип блока %q", b.Type())
		return
	}
	for _, f := range spec.Required {
		if isEmpty(b[f]) {
			v.errf(path, "нет обязательного поля %q", f)
		}
	}
	switch b.Type() {
	case "callout":
		if k, _ := b["kind"].(string); !slices.Contains(CalloutKinds, k) {
			v.errf(path, "неизвестный вид врезки %q", k)
		}
	case "predict":
		if isEmpty(b["out"]) && isEmpty(b["err"]) {
			v.errf(path, "нет ни вывода, ни ошибки: их нужно получить запуском")
		}
	case "question":
		v.question(path, b)
	case "hands":
		if check, ok := b["check"].([]any); ok {
			for i, q := range check {
				m, ok := q.(map[string]any)
				if !ok {
					continue
				}
				qpath := fmt.Sprintf("%s, вопрос %d", path, i+1)
				if isEmpty(m["id"]) {
					v.errf(qpath, "у вопроса нет id: по нему хранится прогресс")
				}
				v.question(qpath, m)
			}
		}
	}
	v.strings(path, map[string]any(b))
}

func (v *validator) question(path string, q map[string]any) {
	// A missing id of a question block is already reported as a required field.
	if id, _ := q["id"].(string); id != "" {
		if v.qids[id] {
			v.errf(path, "id вопроса %q повторяется", id)
		}
		v.qids[id] = true
	}
	kind, _ := q["kind"].(string)
	switch kind {
	case "choice":
		opts, _ := q["opts"].([]any)
		if len(opts) < 2 {
			v.errf(path, "у вопроса с выбором меньше двух вариантов")
			return
		}
		a, ok := toInt(q["a"])
		if !ok || a < 0 || a >= len(opts) {
			v.errf(path, "верный ответ %v вне вариантов 0–%d", q["a"], len(opts)-1)
		}
	case "text":
		if a, _ := q["a"].([]any); len(a) == 0 {
			v.errf(path, "у вопроса с вводом нет ни одного верного ответа")
		}
	case "order":
		if items, _ := q["items"].([]any); len(items) < 2 {
			v.errf(path, "в вопросе на порядок меньше двух пунктов")
		}
	default:
		v.errf(path, "неизвестный вид вопроса %q", kind)
	}
}

// strings checks term and node links in every string inside a value.
func (v *validator) strings(path string, val any) {
	switch x := val.(type) {
	case string:
		v.text(path, x)
	case map[string]any:
		for _, e := range x {
			v.strings(path, e)
		}
	case []any:
		for _, e := range x {
			v.strings(path, e)
		}
	}
}

func (v *validator) text(path, s string) {
	if !strings.Contains(s, "{{") {
		return
	}
	for _, m := range refRe.FindAllStringSubmatch(s, -1) {
		key := strings.TrimSpace(m[2])
		if m[1] == ">" {
			if !v.ids[key] {
				v.errf(path, "ссылка на несуществующий узел %q", key)
			}
			continue
		}
		if _, ok := v.c.Glossary[key]; !ok {
			v.errf(path, "термина %q нет в словаре", key)
		}
	}
}

func isEmpty(x any) bool {
	switch t := x.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

func toInt(x any) (int, bool) {
	switch t := x.(type) {
	case json.Number:
		i, err := t.Int64()
		return int(i), err == nil
	case float64:
		return int(t), t == float64(int(t))
	case int:
		return t, true
	}
	return 0, false
}
