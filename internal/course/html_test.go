package course

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"citadel/web"
)

func TestHTML(t *testing.T) {
	for _, s := range []string{
		`<b class="hot">да</b><i>нет</i><br>`,
		`<table><thead><tr><th>Заголовок</th></tr></thead><tbody><tr><td>Текст</td></tr></tbody></table>`,
		`<a href="#lesson">Урок</a><a href="/c/go/">Go</a><a href="https://example.org/a?q=1&amp;b=2">Сайт</a>`,
		`{{термин}} {{термин|текст}} {{>id}} {{>id|<b>текст</b>}}`,
		`1 < 2; &lt;nil&gt;; <B CLASS="hot">текст</B>`,
		`<p>HTML допускает необязательные закрывающие теги<p>Второй абзац`,
	} {
		v := &validator{}
		v.html("поле", s)
		if len(v.out) != 0 {
			t.Errorf("allowed %q: %v", s, v.out)
		}
	}
	for _, s := range []string{
		`<script>alert(1)</script>`, `<script>`, `<img src=x onerror="alert(1)">`,
		`<iframe src="/">`, `<b style="color:red">x</b>`, `<b OnClIcK="alert(1)">x</b>`,
		`<a href="javascript:alert(1)">x</a>`, `<a href="data:text/html,x">x</a>`,
		`<a href="//evil">x</a>`, `<a href="/\evil">x</a>`,
		`<a HREF="jav&#x61;script:alert(1)">x</a>`, `<a href="java&#9;script:alert(1)">x</a>`,
		`<a href="javascript:alert(1)" href="#ok">x</a>`,
		`<scr<script>ipt>alert(1)</scr<script>ipt>`, `<nil>`, `</nil>`,
		`<svg><foreignObject><p onload="x">x</p></foreignObject></svg>`,
		`<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>`,
		`<html><body>x</body></html>`, `<!-- comment -->`, `<!doctype html>`,
		`<a href="https://">x</a>`, `<b title="unfinished`, `<script`,
	} {
		v := &validator{}
		v.html("поле", s)
		if len(v.out) == 0 {
			t.Errorf("accepted %q", s)
		}
		for _, p := range v.out {
			if p.Path != "поле" || p.Warning {
				t.Errorf("wrong problem: %+v", p)
			}
		}
	}
}

func TestHTMLPolicyMatchesBrowser(t *testing.T) {
	script, err := web.FS.ReadFile("static/engine/sanitize.js")
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]any{"HTML_TAGS": htmlTags, "HTML_ATTRIBUTES": htmlAttributes} {
		m := regexp.MustCompile(`export const ` + name + ` = (.*);`).FindSubmatch(script)
		if len(m) != 2 {
			t.Fatalf("missing JSON policy %s", name)
		}
		var got, expected any
		if err := json.Unmarshal(m[1], &got); err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(want)
		json.Unmarshal(b, &expected)
		if !reflect.DeepEqual(got, expected) {
			t.Errorf("%s: JS=%v Go=%v", name, got, expected)
		}
	}
	for _, tag := range htmlTags {
		v := &validator{}
		v.html("field", "<"+tag+` class="ok">`)
		if len(v.out) != 0 {
			t.Errorf("allowed tag %s: %v", tag, v.out)
		}
	}
}

func TestHTMLFields(t *testing.T) {
	// These fixtures follow the renderer, not the field-selector implementation.
	fixtures := []string{
		`{"type":"heading","level":2,"text":"<nil>"}`,
		`{"type":"text","html":"<nil>"}`,
		`{"type":"list","items":["<nil>"]}`,
		`{"type":"code","code":"<nil>","cap":"<nil>"}`,
		`{"type":"table","head":["<nil>"],"rows":[["<nil>"]]}`,
		`{"type":"callout","kind":"note","html":"<nil>"}`,
		`{"type":"scheme","title":"<nil>","html":"<nil>","cap":"<nil>"}`,
		`{"type":"steps","title":"<nil>","items":[{"t":"<nil>","d":"<nil>","code":"<nil>"}]}`,
		`{"type":"predict","code":"<nil>","out":"<nil>","q":"<nil>","after":"<nil>"}`,
		`{"type":"question","id":"q","kind":"text","q":"<nil>","opts":["<nil>"],"items":["<nil>"],"a":["<nil>"],"why":"<nil>"}`,
		`{"type":"hands","title":"<nil>","goal":"<nil>","steps":[{"t":"<nil>","d":"<nil>","after":"<nil>","cmd":"<nil>","out":"<nil>"}],"trouble":["<nil>"],"check":[{"id":"q","kind":"text","q":"<nil>","opts":["<nil>"],"items":["<nil>"],"a":["<nil>"],"why":"<nil>"}]}`,
		`{"type":"anim","title":"<nil>","els":[{"t":"<nil>"}],"side":{"title":"<nil>","rows":[["<nil>","<nil>","<nil>"]]},"steps":[{"cap":"<nil>","side":[["<nil>","<nil>","<nil>"]],"set":{"x":{"t":"<nil>"}}}]}`,
		`{"type":"spec","task":"<nil>","build":["<nil>"],"api":[{"req":"<nil>","res":"<nil>"}],"files":["<nil>"],"hints":[{"title":"plain","text":"<nil>","code":"<nil>"}],"done":["<nil>"],"traps":["<nil>"],"skip":["<nil>"],"viva":[{"id":"q","q":"<nil>","a":"<nil>"}]}`,
	}
	counts := []int{1, 1, 1, 1, 2, 1, 3, 3, 2, 5, 11, 7, 11}
	for i, f := range fixtures {
		var b Block
		if err := json.Unmarshal([]byte(f), &b); err != nil {
			t.Fatal(err)
		}
		v := &validator{qids: map[string]bool{}}
		v.block("block", b)
		if len(v.out) != counts[i] {
			t.Errorf("%s: got %d want %d: %v", b.Type(), len(v.out), counts[i], v.out)
		}
		for _, p := range v.out {
			if !strings.HasPrefix(p.Path, "block.") || !strings.Contains(p.Msg, "<nil>") {
				t.Errorf("field path/message: %+v", p)
			}
		}
	}
	c := &Course{Schema: SchemaVersion, ID: "test", Title: "Test", Metal: "iron", Tool: Tool{Name: "Go", Version: "1"}, About: "<nil>", Howto: []string{"<nil>"}, Glossary: map[string]Term{"term": {Title: "<nil>", Text: "<nil>"}}, Root: []*Node{{ID: "l", Kind: KindLesson, Title: "Title", Lead: "<nil>", About: "<nil>", Say: "<nil>", Simple: []string{"<nil>"}, Summary: []string{"<nil>"}, Blocks: []Block{{"type": "code", "code": "<script><nil>", "out": "<nil>"}}}}}
	if ps := Validate(c); len(ps) != 9 {
		t.Fatalf("passport/node/glossary: %v", ps)
	}
}
