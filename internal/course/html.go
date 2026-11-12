package course

import (
	"fmt"
	"io"
	"net/url"
	"slices"
	"strings"

	"golang.org/x/net/html"
)

// Keep these lists in sync with sanitize.js (TestHTMLPolicyMatchesBrowser).
var htmlTags = strings.Fields("b strong i em u s small sub sup mark code kbd pre br p span div ul ol li blockquote table thead tbody tr th td a")
var htmlAttributes = map[string][]string{"*": {"class"}, "a": {"href"}}

func safeHTMLHref(s string) bool {
	for _, c := range s {
		if c <= 32 || c == 127 || c == '\\' {
			return false
		}
	}
	if strings.HasPrefix(s, "#") || (strings.HasPrefix(s, "/") && !strings.HasPrefix(s, "//")) {
		return true
	}
	if !strings.HasPrefix(strings.ToLower(s), "https://") {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && u.Hostname() != ""
}

// Tokenize rather than only walking the repaired tree: the HTML tree builder can
// discard forbidden tags (e.g. html/body). Entity values
// and attribute/tag case are normalized by the same HTML5 tokenizer.
func (v *validator) html(path, source string) {
	z := html.NewTokenizer(strings.NewReader(source))
	for {
		kind := z.Next()
		switch kind {
		case html.ErrorToken:
			if z.Err() != io.EOF || len(z.Raw()) > 0 {
				v.errf(path, "незавершённая HTML-разметка — если это текст, напиши &lt; и &gt;")
			}
			return
		case html.TextToken:
			continue
		case html.StartTagToken, html.SelfClosingTagToken, html.EndTagToken:
			t := z.Token()
			if !slices.Contains(htmlTags, t.Data) {
				v.errf(path, "тег <%s> не разрешён — если это текст, напиши &lt;%s&gt;", t.Data, t.Data)
			}
			for _, a := range t.Attr {
				if !slices.Contains(htmlAttributes["*"], a.Key) && !slices.Contains(htmlAttributes[t.Data], a.Key) {
					v.errf(path, "атрибут %s не разрешён", a.Key)
				} else if a.Key == "href" && !safeHTMLHref(a.Val) {
					v.errf(path, "ссылка %q не разрешена: нужны #…, /… или https://…", a.Val)
				}
			}
		default:
			v.errf(path, "комментарии и декларации HTML не разрешены")
		}
	}
}

// HTML fields actually rendered by rich()/courseText(). Code, commands, output,
// SVG text and plain labels are deliberately absent. '*' traverses array items.
var blockHTMLFields = map[string][]string{
	"heading":  {"text"},
	"text":     {"html"},
	"list":     {"items.*"},
	"code":     {"cap"},
	"table":    {"head.*", "rows.*.*"},
	"callout":  {"html"},
	"scheme":   {"title", "html", "cap"},
	"steps":    {"title", "items.*.t", "items.*.d"},
	"predict":  {"q", "after"},
	"question": {"q", "opts.*", "items.*", "a.*", "why"},
	"hands":    {"title", "goal", "steps.*.t", "steps.*.d", "steps.*.after", "trouble.*", "check.*.q", "check.*.opts.*", "check.*.items.*", "check.*.a.*", "check.*.why"},
	"anim":     {"title", "side.title", "side.rows.*.0", "side.rows.*.1", "steps.*.cap", "steps.*.side.*.0", "steps.*.side.*.1"},
	"spec":     {"task", "build.*", "api.*.req", "api.*.res", "files.*", "hints.*.text", "done.*", "traps.*", "skip.*", "viva.*.q", "viva.*.a"},
}

func (v *validator) htmlField(path string, value any, parts []string) {
	if len(parts) == 0 {
		if s, ok := value.(string); ok {
			v.html(path, s)
		}
		return
	}
	switch x := value.(type) {
	case map[string]any:
		v.htmlField(path+"."+parts[0], x[parts[0]], parts[1:])
	case []any:
		for i, e := range x {
			if parts[0] == "*" || parts[0] == fmt.Sprint(i) {
				v.htmlField(fmt.Sprintf("%s[%d]", path, i), e, parts[1:])
			}
		}
	}
}
