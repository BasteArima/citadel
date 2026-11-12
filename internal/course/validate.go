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
	if c.IsProject() {
		v.project()
	}
	for key, t := range c.Glossary {
		v.text("словарь "+key+".d", t.Text)
		v.html("словарь "+key+".d", t.Text)
		v.html("словарь "+key+".t", t.Title)
	}
	v.text("паспорт.about", c.About)
	v.html("паспорт.about", c.About)
	for i, s := range c.Howto {
		path := fmt.Sprintf("паспорт.howto[%d]", i)
		v.text(path, s)
		v.html(path, s)
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
	if c.Type != "" && c.Type != TypeProject {
		v.errf("паспорт", "неизвестный вид %q: бывает только %q", c.Type, TypeProject)
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
	if sp := c.Speech; sp != nil {
		if sp.Voice != "" && !ValidVoice(sp.Voice) {
			v.errf("паспорт", "голос озвучки %q: ожидается имя вида ru-RU-SvetlanaNeural", sp.Voice)
		}
		for from, to := range sp.Lexicon {
			if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
				v.errf("паспорт", "словарь произношения: пустое слово или чтение у %q", from)
			}
		}
	}
}

var voiceName = regexp.MustCompile(`^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$`)

// ValidVoice tells whether a narration voice name looks like ru-RU-SvetlanaNeural.
func ValidVoice(v string) bool { return voiceName.MatchString(v) }

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
	for field, s := range map[string]string{"lead": n.Lead, "about": n.About, "say": n.Say} {
		v.text(path+"."+field, s)
		v.html(path+"."+field, s)
	}
	for field, items := range map[string][]string{"simple": n.Simple, "summary": n.Summary} {
		for i, s := range items {
			p := fmt.Sprintf("%s.%s[%d]", path, field, i)
			v.text(p, s)
			v.html(p, s)
		}
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
	case "spec":
		v.spec(path, b)
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
	for _, field := range blockHTMLFields[b.Type()] {
		v.htmlField(path, map[string]any(b), strings.Split(field, "."))
	}
}

// project checks the shape of a project: levels of steps, every step is a task to build.
func (v *validator) project() {
	for _, s := range v.c.Root {
		if s.Kind != KindSection {
			v.errf("узел "+s.ID, "в проекте в корне лежат только уровни (section)")
			continue
		}
		if s.Tag != "" && !slices.Contains(ProjectHelp, s.Tag) {
			v.errf("узел "+s.ID, "неизвестная степень помощи %q: бывает %s", s.Tag, strings.Join(ProjectHelp, ", "))
		}
		for _, l := range s.Children {
			if l.Kind != KindLesson || len(l.Children) > 0 {
				v.errf("узел "+l.ID, "шаг проекта — узел lesson с блоками, без частей")
				continue
			}
			specs := 0
			for _, b := range l.Blocks {
				if b.Type() == "spec" {
					specs++
				}
			}
			if !l.Planned && specs != 1 {
				v.errf("узел "+l.ID, "у шага должен быть один блок spec, а их %d", specs)
			}
		}
	}
}

// spec checks the task of a project step. Links to lessons of other courses are not checked here:
// courses are validated one by one; a link to a missing lesson just does not show.
func (v *validator) spec(path string, b Block) {
	if k, _ := b["kind"].(string); k != "" && k != "incident" {
		v.errf(path, "неизвестный вид шага %q", k)
	}
	need := func(field string, keys ...string) {
		items, _ := b[field].([]any)
		for i, it := range items {
			m, ok := it.(map[string]any)
			if !ok {
				v.errf(path, "%s, пункт %d: ожидается объект", field, i+1)
				continue
			}
			for _, k := range keys {
				if isEmpty(m[k]) {
					v.errf(path, "%s, пункт %d: нет поля %q", field, i+1, k)
				}
			}
		}
	}
	need("api", "req", "res")
	need("hints", "title", "text")
	need("lessons", "course", "id")
	need("viva", "id", "q", "a")
	viva, _ := b["viva"].([]any)
	for _, it := range viva {
		m, _ := it.(map[string]any)
		id, _ := m["id"].(string)
		if id == "" {
			continue
		}
		if v.qids[id] {
			v.errf(path, "id вопроса %q повторяется", id)
		}
		v.qids[id] = true
	}
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
