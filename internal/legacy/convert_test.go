package legacy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/dop251/goja"

	"citadel/internal/course"
)

var (
	legacyDir   = filepath.Join("..", "..", "legacy", "go-course")
	adapterPath = filepath.Join("..", "..", "web", "static", "engine", "adapter.js")
)

var goOptions = Options{ID: "go", Metal: "iron", Review: []int{1, 3, 7}}

// TestRoundTrip converts the real v0 course to v1, turns it back with the browser
// adapter and checks that nothing was lost: every block, question and field.
func TestRoundTrip(t *testing.T) {
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
	back := runAdapter(t, v1)

	want, got := normalize(t, raw), normalize(t, back)
	for _, key := range []string{"title", "sub", "go", "sections", "glossary"} {
		if !reflect.DeepEqual(want[key], got[key]) {
			t.Errorf("%s differs after round trip", key)
		}
	}
	wl, gl := want["lessons"].(map[string]any), got["lessons"].(map[string]any)
	if len(wl) != len(gl) {
		t.Fatalf("lessons: %d before, %d after", len(wl), len(gl))
	}
	for id, w := range wl {
		wm, gm := w.(map[string]any), gl[id].(map[string]any)
		for field := range union(wm, gm) {
			if !reflect.DeepEqual(wm[field], gm[field]) {
				t.Errorf("lesson %s: field %q differs after round trip", id, field)
			}
		}
	}
}

func runAdapter(t *testing.T, v1 []byte) []byte {
	t.Helper()
	src, err := os.ReadFile(adapterPath)
	if err != nil {
		t.Fatal(err)
	}
	vm := goja.New()
	if _, err := vm.RunScript("adapter.js", string(src)); err != nil {
		t.Fatal(err)
	}
	vm.Set("v1json", string(v1))
	out, err := vm.RunString("JSON.stringify(citadelV1ToV0(JSON.parse(v1json)))")
	if err != nil {
		t.Fatal(err)
	}
	return []byte(out.String())
}

// normalize decodes v0 JSON, drops empty fields and sorts each lesson's questions:
// v1 groups questions by part, so their order in the flat v0 list may change.
func normalize(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	for _, les := range m["lessons"].(map[string]any) {
		lm := les.(map[string]any)
		for k, v := range lm {
			if v == nil || reflect.DeepEqual(v, []any{}) {
				delete(lm, k)
			}
		}
		if test, ok := lm["test"].([]any); ok {
			sort.Slice(test, func(i, j int) bool { return jsonString(test[i]) < jsonString(test[j]) })
		}
	}
	return m
}

func jsonString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func union(a, b map[string]any) map[string]bool {
	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	return keys
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
			if s := jsonString(got); s != tt.want {
				t.Errorf("got  %s\nwant %s", s, tt.want)
			}
		})
	}
}

// TestContentUpToDate fails when content/go/course.json was not regenerated after
// a change in legacy/go-course or in the converter.
func TestContentUpToDate(t *testing.T) {
	c, err := ConvertDir(legacyDir, Options{ID: "go", Metal: "iron", Review: []int{1, 3, 7}, Pages: []string{"glossary", "notes", "exam", "tools"}})
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
