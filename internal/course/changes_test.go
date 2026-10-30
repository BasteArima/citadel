package course

import (
	"strings"
	"testing"
)

func changesCourse() *Course {
	return &Course{Schema: SchemaVersion, ID: "go", Title: "Go", Metal: "iron", Tool: Tool{Name: "Go", Version: "1.27"},
		Glossary: map[string]Term{"nil": {Title: "nil", Text: "ноль"}},
		Root: []*Node{{ID: "core", Kind: KindSection, Title: "Ядро", Children: []*Node{
			{ID: "a", Kind: KindLesson, Title: "А", N: 1, Planned: true},
			{ID: "b", Kind: KindLesson, Title: "Б", N: 2, Planned: true},
		}}}}
}

func TestApplyChanges(t *testing.T) {
	c := changesCourse()
	changes, err := DecodeChanges([]byte(`[
		{"op":"put_node","parent":"core","before":"a","node":{"id":"intro","kind":"lesson","title":"Введение","blocks":[{"type":"text","html":"{{nil}}"}]}},
		{"op":"put_node","node":{"id":"b","kind":"lesson","title":"Б, переписан","blocks":[{"type":"text","html":"x"}]}},
		{"op":"put_node","parent":"core","after":"a","node":{"id":"a2","kind":"lesson","title":"А2","planned":true}},
		{"op":"delete_node","id":"a"},
		{"op":"put_term","key":"itab","term":{"t":"itab","d":"таблица методов"}},
		{"op":"delete_term","key":"nil"},
		{"op":"set_passport","fields":{"subtitle":"\"путь\"","tool":{"name":"Go","version":"1.27.1"}}}
	]`))
	if err != nil {
		t.Fatal(err)
	}
	if err := Apply(c, changes); err != nil {
		t.Fatal(err)
	}
	var got []string
	c.Walk(func(n *Node, _ *Node) {
		if n.Kind == KindLesson {
			got = append(got, n.ID+":"+n.Title+":"+string(rune('0'+n.N)))
		}
	})
	if strings.Join(got, ",") != "intro:Введение:1,a2:А2:2,b:Б, переписан:3" {
		t.Fatalf("lessons: %v", got)
	}
	if _, ok := c.Glossary["itab"]; !ok || len(c.Glossary) != 1 {
		t.Fatalf("glossary: %v", c.Glossary)
	}
	if c.Subtitle != `"путь"` || c.Tool.Version != "1.27.1" || c.ID != "go" {
		t.Fatalf("passport: %q %+v", c.Subtitle, c.Tool)
	}
	// the term link in intro now points nowhere: the check reports it, Apply does not
	if ps := Errors(Validate(c)); len(ps) != 1 || !strings.Contains(ps[0].Msg, "nil") {
		t.Fatalf("validate: %v", ps)
	}
}

func TestApplyChangesErrors(t *testing.T) {
	for _, tt := range []struct{ changes, want string }{
		{`[{"op":"rename"}]`, "unknown op"},
		{`[{"op":"delete_node","id":"zz"}]`, `no node "zz"`},
		{`[{"op":"put_node","parent":"zz","node":{"id":"n","kind":"lesson","title":"x"}}]`, `no parent node "zz"`},
		{`[{"op":"put_node","parent":"core","after":"zz","node":{"id":"n","kind":"lesson","title":"x"}}]`, `no node "zz"`},
		{`[{"op":"set_passport","fields":{"id":"\"other\""}}]`, `field "id" cannot be changed`},
		{`[{"op":"put_term","key":"k","term":{"d":"x"}}]`, "term with t"},
	} {
		changes, err := DecodeChanges([]byte(tt.changes))
		if err == nil {
			err = Apply(changesCourse(), changes)
		}
		if err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("%s: %v", tt.changes, err)
		}
	}
	if _, err := DecodeChanges([]byte(`[{"op":"put_node","node":{"id":"n","kind":"lesson","title":"x","colour":"red"}}]`)); err == nil {
		t.Error("an unknown node field must be an error")
	}
}
