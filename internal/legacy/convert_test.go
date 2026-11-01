package legacy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"citadel/internal/course"
)

var legacyDir = filepath.Join("..", "..", "legacy", "go-course")

// needLegacy skips a test on a clean clone: the Go course is not in git (decision 0017).
func needLegacy(t *testing.T) {
	t.Helper()
	if _, err := os.Stat(legacyDir); err != nil {
		t.Skip("no legacy/go-course here")
	}
}

var goOptions = Options{ID: "go", Metal: "iron", Review: []int{1, 3, 7}, Pages: []string{"glossary", "notes", "exam", "tools"}}

// TestRoundTrip converts the real v0 course to v1, turns it back with toV0
// and checks that nothing was lost: every block, question and field.
func TestRoundTrip(t *testing.T) {
	needLegacy(t)
	raw, err := Load(legacyDir)
	if err != nil {
		t.Fatal(err)
	}
	c, err := Convert(raw, goOptions)
	if err != nil {
		t.Fatal(err)
	}
	if errs := course.Errors(course.Validate(c)); len(errs) > 0 {
		t.Fatalf("converted course is invalid: %v", errs)
	}
	v1, err := course.Encode(c)
	if err != nil {
		t.Fatal(err)
	}
	var want, back map[string]any
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	back = roundJSON(t, toV0(roundJSON(t, v1)))
	if path := diff("", want, back); path != "" {
		t.Fatalf("v0 → v1 → v0 differs at %s", path)
	}
}

func roundJSON(t *testing.T, v any) map[string]any {
	t.Helper()
	data, ok := v.([]byte)
	if !ok {
		var err error
		if data, err = json.Marshal(v); err != nil {
			t.Fatal(err)
		}
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// toV0 is the inverse of Convert, written only for this test.
func toV0(c map[string]any) map[string]any {
	tool := c["tool"].(map[string]any)
	out := map[string]any{"title": c["title"], "go": tool["version"], "glossary": c["glossary"]}
	if s, ok := c["subtitle"]; ok {
		out["sub"] = s
	}
	lessons := map[string]any{}
	var sections, pages []any
	for _, n := range c["root"].([]any) {
		node := n.(map[string]any)
		switch node["kind"] {
		case course.KindSection:
			var list []any
			for _, l := range node["children"].([]any) {
				les := l.(map[string]any)
				list = append(list, map[string]any{"n": les["n"], "id": les["id"], "t": les["title"]})
				if les["planned"] != true {
					lessons[les["id"].(string)] = lessonToV0(les)
				}
			}
			sections = append(sections, map[string]any{"id": node["id"], "name": node["title"], "kind": node["tag"], "about": node["about"], "lessons": list})
		case course.KindPage:
			pg := pick(node, "id", "title", "icon", "tag", "lead", "about")
			var blocks []any
			for _, b := range node["blocks"].([]any) {
				blocks = append(blocks, blockToV0(b.(map[string]any)))
			}
			pg["blocks"] = blocks
			pages = append(pages, pg)
		}
	}
	out["sections"], out["lessons"] = sections, lessons
	if pages != nil || c["about"] != nil {
		out["platform"] = map[string]any{"about": c["about"], "howto": c["howto"], "pages": pages}
	}
	return out
}

func lessonToV0(l map[string]any) map[string]any {
	les := pick(l, "time", "lead", "simple", "say", "summary", "videos")
	blocks := []any{}
	var test []map[string]any
	addQ := func(b map[string]any, part int) {
		q := without(b, "type", "kind")
		q["type"] = b["kind"]
		if part > 0 {
			q["part"] = float64(part)
		}
		test = append(test, q)
	}
	if children, ok := l["children"].([]any); ok {
		k := 0
		for _, p := range children {
			part := p.(map[string]any)
			pb, _ := part["blocks"].([]any)
			switch part["practice"] {
			case course.PracticeHands:
				les["hands"] = handsToV0(pb[0].(map[string]any))
			case course.PracticeTest:
				for _, b := range pb {
					addQ(b.(map[string]any), 0)
				}
			default:
				k++
				blocks = append(blocks, map[string]any{"part": part["title"]})
				for _, b := range pb {
					bm := b.(map[string]any)
					if bm["type"] == "question" {
						addQ(bm, k)
					} else {
						blocks = append(blocks, blockToV0(bm))
					}
				}
			}
		}
	} else {
		for _, b := range l["blocks"].([]any) {
			bm := b.(map[string]any)
			switch bm["type"] {
			case "hands":
				les["hands"] = handsToV0(bm)
			case "question":
				addQ(bm, 0)
			default:
				blocks = append(blocks, blockToV0(bm))
			}
		}
	}
	// The id keeps the v0 position: lesson.qN is test[N-1].
	sort.Slice(test, func(i, j int) bool { return qnum(test[i]["id"]) < qnum(test[j]["id"]) })
	tl := make([]any, len(test))
	for i, q := range test {
		delete(q, "id")
		tl[i] = q
	}
	les["blocks"], les["test"] = blocks, tl
	return les
}

func qnum(id any) int {
	s := id.(string)
	n, _ := strconv.Atoi(s[strings.LastIndex(s, ".q")+2:])
	return n
}

func blockToV0(b map[string]any) map[string]any {
	switch b["type"] {
	case "heading":
		if b["level"] == float64(3) {
			return map[string]any{"h3": b["text"]}
		}
		return map[string]any{"h": b["text"]}
	case "text":
		return map[string]any{"p": b["html"]}
	case "list":
		r := map[string]any{"list": b["items"]}
		if o, ok := b["ordered"]; ok {
			r["ordered"] = o
		}
		return r
	case "code":
		return without(b, "type")
	case "callout":
		r := map[string]any{b["kind"].(string): b["html"]}
		if t, ok := b["title"]; ok {
			r["title"] = t
		}
		return r
	}
	return map[string]any{b["type"].(string): without(b, "type")}
}

func handsToV0(b map[string]any) map[string]any {
	h := without(b, "type")
	if check, ok := h["check"].([]any); ok {
		out := make([]any, len(check))
		for i, q := range check {
			qm := q.(map[string]any)
			r := without(qm, "kind", "id")
			r["type"] = qm["kind"]
			out[i] = r
		}
		h["check"] = out
	}
	return h
}

func pick(m map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for _, k := range keys {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}

func without(m map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		out[k] = v
	}
	for _, k := range keys {
		delete(out, k)
	}
	return out
}

// diff returns the path of the first difference between a and b, or "".
func diff(path string, a, b any) string {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok {
			return path
		}
		keys := map[string]bool{}
		for k := range av {
			keys[k] = true
		}
		for k := range bv {
			keys[k] = true
		}
		sorted := make([]string, 0, len(keys))
		for k := range keys {
			sorted = append(sorted, k)
		}
		sort.Strings(sorted)
		for _, k := range sorted {
			if p := diff(path+"."+k, av[k], bv[k]); p != "" {
				return p
			}
		}
		return ""
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return fmt.Sprintf("%s (length %d vs %v)", path, len(av), lenOf(b))
		}
		for i := range av {
			if p := diff(fmt.Sprintf("%s[%d]", path, i), av[i], bv[i]); p != "" {
				return p
			}
		}
		return ""
	}
	if !reflect.DeepEqual(a, b) {
		return fmt.Sprintf("%s (%v vs %v)", path, a, b)
	}
	return ""
}

func lenOf(v any) any {
	if s, ok := v.([]any); ok {
		return len(s)
	}
	return v
}

func TestQuestionIDs(t *testing.T) {
	needLegacy(t)
	c, err := ConvertDir(legacyDir, goOptions)
	if err != nil {
		t.Fatal(err)
	}
	var lesson *course.Node
	c.Walk(func(n *course.Node, _ *course.Node) {
		if n.ID == "interfaces" {
			lesson = n
		}
	})
	if lesson == nil {
		t.Fatal("lesson interfaces not found")
	}
	ids := map[string]bool{}
	for _, p := range lesson.Children {
		for _, b := range p.Blocks {
			if b.Type() == "question" {
				ids[b["id"].(string)] = true
			}
			if b.Type() == "hands" {
				for _, q := range b["check"].([]any) {
					ids[q.(map[string]any)["id"].(string)] = true
				}
			}
		}
	}
	for _, id := range []string{"interfaces.q1", "interfaces.h1"} {
		if !ids[id] {
			t.Errorf("question %s not found, have %v", id, ids)
		}
	}
}

func TestConvertBlock(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    string
		wantErr string
	}{
		{name: "heading", in: `{"h":"Заголовок"}`, want: `{"type":"heading","level":2,"text":"Заголовок"}`},
		{name: "h3", in: `{"h3":"Малый"}`, want: `{"type":"heading","level":3,"text":"Малый"}`},
		{name: "callout", in: `{"warn":"Осторожно","title":"Т"}`, want: `{"type":"callout","html":"Осторожно","kind":"warn","title":"Т"}`},
		{name: "code with caption", in: `{"code":"x := 1","cap":"подпись"}`, want: `{"type":"code","cap":"подпись","code":"x := 1"}`},
		{name: "object block", in: `{"table":{"head":["a"],"rows":[["1"]]}}`, want: `{"type":"table","head":["a"],"rows":[["1"]]}`},
		{name: "unknown sibling", in: `{"p":"текст","color":"red"}`, wantErr: `unknown field "color"`},
		{name: "unknown block", in: `{"quiz":{}}`, wantErr: "unknown block"},
		{name: "two main keys", in: `{"p":"a","code":"b"}`, wantErr: "unknown block"},
		{name: "type clash", in: `{"anim":{"type":"x"}}`, wantErr: "clashes"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var in map[string]any
			dec := json.NewDecoder(strings.NewReader(tt.in))
			dec.UseNumber()
			if err := dec.Decode(&in); err != nil {
				t.Fatal(err)
			}
			got, err := convertBlock(in)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want it to contain %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			data, _ := json.Marshal(got)
			if s := string(data); s != tt.want {
				t.Errorf("got  %s\nwant %s", s, tt.want)
			}
		})
	}
}

// TestContentUpToDate fails when content/go/course.json was not regenerated after
// a change in legacy/go-course or in the converter.
func TestContentUpToDate(t *testing.T) {
	needLegacy(t)
	c, err := ConvertDir(legacyDir, goOptions)
	if err != nil {
		t.Fatal(err)
	}
	want, err := course.Encode(c)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join("..", "..", "content", "go", "course.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Error("content/go/course.json is stale: run task convert")
	}
}
