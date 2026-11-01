package course

import (
	"path/filepath"
	"strings"
	"testing"
)

func validCourse() *Course {
	return &Course{
		Schema: SchemaVersion, ID: "t", Title: "Тест", Metal: "iron",
		Tool:     Tool{Name: "Go", Version: "1.27"},
		Review:   []int{1, 3, 7},
		Glossary: map[string]Term{"iface": {Title: "Интерфейс", Text: "Набор методов."}},
		Root: []*Node{{
			ID: "s", Kind: KindSection, Title: "Раздел",
			Children: []*Node{
				{ID: "a", Kind: KindLesson, Title: "Урок А", Blocks: []Block{
					{"type": "text", "html": "Про {{iface}} и {{iface|интерфейсы}}, дальше — {{>b}}."},
					{"type": "question", "id": "a.q1", "kind": "choice", "q": "Да?", "opts": []any{"да", "нет"}, "a": 0.0},
				}},
				{ID: "b", Kind: KindLesson, Title: "Урок Б", Planned: true, Deps: []string{"a"}},
			},
		}},
	}
}

func TestValidateOK(t *testing.T) {
	if ps := Validate(validCourse()); len(ps) > 0 {
		t.Fatalf("unexpected problems: %v", ps)
	}
}

func TestValidateProblems(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(c *Course)
		want   string
	}{
		{"unknown term", func(c *Course) { lessonA(c).Blocks[0]["html"] = "{{nope}}" }, `термина "nope" нет`},
		{"unknown node link", func(c *Course) { lessonA(c).Blocks[0]["html"] = "{{>zzz|туда}}" }, `несуществующий узел "zzz"`},
		{"bad dep", func(c *Course) { c.Root[0].Children[1].Deps = []string{"zzz"} }, `опирается на несуществующий`},
		{"duplicate id", func(c *Course) { c.Root[0].Children[1].ID = "a" }, "id повторяется"},
		{"unknown block", func(c *Course) { lessonA(c).Blocks[0] = Block{"type": "quiz"} }, `неизвестный тип блока "quiz"`},
		{"missing field", func(c *Course) { lessonA(c).Blocks[0] = Block{"type": "code"} }, `нет обязательного поля "code"`},
		{"answer out of range", func(c *Course) { lessonA(c).Blocks[1]["a"] = 5.0 }, "вне вариантов"},
		{"predict without output", func(c *Course) {
			lessonA(c).Blocks[0] = Block{"type": "predict", "code": "fmt.Println(1)"}
		}, "нет ни вывода, ни ошибки"},
		{"no tool version", func(c *Course) { c.Tool.Version = "" }, "версия"},
		{"requires itself", func(c *Course) { c.Requires = []string{"t"} }, "сам на себя"},
		{"question without id", func(c *Course) { delete(lessonA(c).Blocks[1], "id") }, `нет обязательного поля "id"`},
		{"duplicate question id", func(c *Course) {
			lessonA(c).Blocks = append(lessonA(c).Blocks, Block{"type": "question", "id": "a.q1", "kind": "text", "q": "?", "a": []any{"x"}})
		}, `id вопроса "a.q1" повторяется`},
		{"children and blocks", func(c *Course) {
			lessonA(c).Children = []*Node{{ID: "p", Kind: KindPart, Title: "Ч", Blocks: []Block{{"type": "text", "html": "x"}}}}
		}, "одновременно"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := validCourse()
			tt.mutate(c)
			errs := Errors(Validate(c))
			for _, p := range errs {
				if strings.Contains(p.Msg, tt.want) {
					return
				}
			}
			t.Errorf("no error containing %q, got %v", tt.want, errs)
		})
	}
}

func lessonA(c *Course) *Node { return c.Root[0].Children[0] }

func TestBlockTypeFirst(t *testing.T) {
	data, err := Block{"zeta": 1, "type": "text", "html": "x"}.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), `{"type":"text","html":"x","zeta":1}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

// TestContent checks every course in the repository, the same as `citadel check`.
func TestContent(t *testing.T) {
	courses, err := LoadDir(filepath.Join("..", "..", "content"))
	if err != nil {
		t.Fatal(err)
	}
	if len(courses) == 0 {
		t.Fatal("no courses in content/")
	}
	for _, c := range courses {
		for _, p := range Errors(Validate(c)) {
			t.Errorf("%s: %s", c.ID, p)
		}
	}
}

func TestValidateProject(t *testing.T) {
	step := func(id string, b Block) *Node {
		return &Node{ID: id, Kind: KindLesson, Title: id, Blocks: []Block{b}}
	}
	base := func(steps ...*Node) *Course {
		return &Course{Schema: SchemaVersion, Type: TypeProject, ID: "p", Title: "П", Metal: "steel", Tool: Tool{Name: "Go", Version: "1.27"},
			Root: []*Node{{ID: "l", Kind: KindSection, Title: "Уровень", Tag: "guided", Children: steps}}}
	}
	good := Block{"type": "spec", "task": "Задача", "done": []any{"готово"},
		"viva":  []any{map[string]any{"id": "v1", "q": "?", "a": "ответ"}},
		"hints": []any{map[string]any{"title": "Начни", "text": "так"}},
		"api":   []any{map[string]any{"req": "GET /", "res": "200"}}}
	if errs := Errors(Validate(base(step("a", good)))); len(errs) > 0 {
		t.Fatalf("good project: %v", errs)
	}
	bad := map[string]*Course{
		"unknown type":  {Schema: SchemaVersion, Type: "game", ID: "p", Title: "П", Metal: "steel", Tool: Tool{Name: "Go", Version: "1"}, Root: []*Node{{ID: "x", Kind: KindPage, Title: "С", Blocks: []Block{{"type": "text", "html": "x"}}}}},
		"no spec":       base(step("a", Block{"type": "text", "html": "x"})),
		"no done":       base(step("a", Block{"type": "spec", "task": "Задача"})),
		"viva answer":   base(step("a", Block{"type": "spec", "task": "З", "done": []any{"г"}, "viva": []any{map[string]any{"id": "v", "q": "?"}}})),
		"viva repeated": base(step("a", Block{"type": "spec", "task": "З", "done": []any{"г"}, "viva": []any{map[string]any{"id": "v", "q": "?", "a": "о"}}}), step("b", Block{"type": "spec", "task": "З", "done": []any{"г"}, "viva": []any{map[string]any{"id": "v", "q": "?", "a": "о"}}})),
		"hint":          base(step("a", Block{"type": "spec", "task": "З", "done": []any{"г"}, "hints": []any{map[string]any{"title": "x"}}})),
		"kind":          base(step("a", Block{"type": "spec", "kind": "bug", "task": "З", "done": []any{"г"}})),
		"page in root":  {Schema: SchemaVersion, Type: TypeProject, ID: "p", Title: "П", Metal: "steel", Tool: Tool{Name: "Go", Version: "1"}, Root: []*Node{{ID: "x", Kind: KindPage, Title: "С", Blocks: []Block{{"type": "text", "html": "x"}}}}},
	}
	for name, c := range bad {
		if len(Errors(Validate(c))) == 0 {
			t.Errorf("%s: no errors", name)
		}
	}
	nums := base(step("a", good), step("b", good)).StepNum()
	if nums["b"] != "1.2" {
		t.Errorf("step number: %v", nums)
	}
}
