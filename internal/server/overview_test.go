package server

import (
	"encoding/json"
	"testing"

	"citadel/internal/course"
	"citadel/internal/store"
)

func TestPartsClosed(t *testing.T) {
	les := &course.Node{ID: "l", Kind: course.KindLesson, Title: "Урок", Children: []*course.Node{
		{ID: "l.1", Kind: course.KindPart, Title: "С вопросами", Blocks: []course.Block{
			{"type": "text", "html": "x"},
			{"type": "question", "id": "l.q1"}, {"type": "question", "id": "l.q2"},
		}},
		{ID: "l.2", Kind: course.KindPart, Title: "Без вопросов", Blocks: []course.Block{{"type": "text", "html": "y"}}},
		{ID: "l.3", Kind: course.KindPart, Title: "Руками", Practice: course.PracticeHands, Blocks: []course.Block{
			{"type": "hands", "check": []any{map[string]any{"id": "l.h1"}}},
		}},
		{ID: "l.4", Kind: course.KindPart, Title: "Проверка", Practice: course.PracticeTest},
	}}
	mark := func(keys ...string) map[string]store.Item {
		m := map[string]store.Item{}
		for _, k := range keys {
			m[k] = store.Item{V: json.RawMessage(`1`), At: 1}
		}
		return m
	}
	tests := []struct {
		name  string
		items map[string]store.Item
		want  int
	}{
		{"nothing", mark(), 0},
		{"one of two questions", mark("q:l:l.q1"), 0},
		{"both questions", mark("q:l:l.q1", "q:l:l.q2"), 1},
		{"read part without questions", mark("seen:l:1"), 1},
		{"hands check", mark("q:l:l.h1"), 1},
		{"everything", mark("q:l:l.q1", "q:l:l.q2", "seen:l:1", "q:l:l.h1", "done:l"), 4},
	}
	// done: read — the part with questions closes by reading; done: manual — by the seen mark too
	read := *les
	read.Children = append([]*course.Node{}, les.Children...)
	p1 := *les.Children[0]
	p1.Done = "read"
	read.Children[0] = &p1
	if got := partsClosed(&read, mark("seen:l:0")); got != 1 {
		t.Errorf("done: read, read to the end: %d", got)
	}
	if got := partsClosed(&read, mark("q:l:l.q1", "q:l:l.q2")); got != 0 {
		t.Errorf("done: read, questions answered but not read: %d", got)
	}
	for _, tt := range tests {
		if got := partsClosed(les, tt.items); got != tt.want {
			t.Errorf("%s: got %d, want %d", tt.name, got, tt.want)
		}
	}
	one := &course.Node{ID: "o", Kind: course.KindLesson, Title: "Одной страницей"}
	if partsClosed(one, mark("done:o")) != 1 || partsClosed(one, mark()) != 0 {
		t.Error("a one-page lesson counts as one part when passed")
	}
}
