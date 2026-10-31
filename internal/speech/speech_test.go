package speech

import (
	"strings"
	"testing"

	"citadel/internal/course"
)

func TestLexicon(t *testing.T) {
	l := newLexicon(map[string]string{"Go": "гоу", "Go runtime": "гоу рантайм", "nil": "нил"})
	cases := map[string]string{
		"Go и Google":         "гоу и Google",
		"Go runtime, а не go": "гоу рантайм, а не go",
		"вернёт nil.":         "вернёт нил.",
		"nilable и (nil)":     "nilable и (нил)",
		"Go_x и Go2 остались": "Go_x и Go2 остались",
	}
	for in, want := range cases {
		if got := l.apply(in); got != want {
			t.Errorf("apply(%q) = %q, want %q", in, got, want)
		}
	}
}

func testCourse() *course.Course {
	return &course.Course{
		ID:       "go",
		Glossary: map[string]course.Term{"iface": {Title: "интерфейс"}},
		Speech:   &course.Speech{Lexicon: map[string]string{"Go": "гоу"}},
		Root: []*course.Node{{ID: "s", Kind: course.KindSection, Children: []*course.Node{
			{ID: "l1", Kind: course.KindLesson, N: 1, Title: "Первый"},
			{ID: "l2", Kind: course.KindLesson, N: 2, Title: "Интерфейсы", Lead: "Что такое {{iface}} в Go", Children: []*course.Node{
				{ID: "l2.1", Kind: course.KindPart, Title: "Договор", Blocks: []course.Block{
					{"type": "text", "html": "Абзац с <code>Send</code> &amp; ссылкой на {{>l1|основы}}"},
					{"type": "code", "code": "a"},
					{"type": "code", "code": "b"},
					{"type": "heading", "level": 2, "text": "Наборы методов"},
					{"type": "list", "items": []any{"первый", "второй"}},
					{"type": "callout", "kind": "cs", "html": "C#"},
					{"type": "callout", "kind": "warn", "html": "Осторожно с nil"},
					{"type": "question", "id": "q", "kind": "choice", "q": "?"},
				}},
				{ID: "l2.2", Kind: course.KindPart, Title: "Задание", Practice: course.PracticeHands},
			}},
		}}},
	}
}

func TestParts(t *testing.T) {
	ps := Parts(testCourse())
	if len(ps) != 1 {
		t.Fatalf("parts = %d, want 1 (practice is not narrated)", len(ps))
	}
	p := ps[0]
	if len(p.Chapters) != 2 || p.Chapters[0].Title != "Начало" || p.Chapters[1].Title != "Наборы методов" {
		t.Fatalf("chapters = %+v", p.Chapters)
	}
	want0 := "Часть 1. Договор.\nЧто такое интерфейс в гоу.\nАбзац с Send & ссылкой на основы — урок 1 «Первый».\nПример кода — на экране."
	if p.Chapters[0].Text != want0 {
		t.Errorf("chapter 0:\n%s\nwant\n%s", p.Chapters[0].Text, want0)
	}
	want1 := "Наборы методов.\nпервый.\nвторой.\nОсторожно.\nОсторожно с nil."
	if p.Chapters[1].Text != want1 {
		t.Errorf("chapter 1:\n%s\nwant\n%s", p.Chapters[1].Text, want1)
	}
	if strings.Contains(p.Chapters[1].Text, "C#") {
		t.Error("C# side note is read")
	}

	c := testCourse()
	c.Speech.Lexicon["nil"] = "нил"
	if Parts(c)[0].Hash == p.Hash {
		t.Error("lexicon change keeps the hash: the recording would not go stale")
	}
	c = testCourse()
	c.Speech.Voice = "ru-RU-DmitryNeural"
	if Parts(c)[0].Hash == p.Hash {
		t.Error("voice change keeps the hash")
	}
}

func TestPartStartsWithHeading(t *testing.T) {
	c := testCourse()
	part := c.Root[0].Children[1].Children[0]
	part.Blocks = append([]course.Block{{"type": "heading", "level": 2, "text": "Сразу заголовок"}}, part.Blocks...)
	c.Root[0].Children[1].Lead = ""
	chs := Parts(c)[0].Chapters
	if chs[0].Title != "Сразу заголовок" || !strings.HasPrefix(chs[0].Text, "Часть 1. Договор.\nСразу заголовок.") {
		t.Errorf("first chapter = %q: %q", chs[0].Title, chs[0].Text)
	}
}

func TestDuration(t *testing.T) {
	// MPEG-2 Layer III, 48 kbit/s, 24 kHz, no padding: 144 bytes and 24 ms per frame
	h := []byte{0xFF, 0xF3, 0x64, 0xC4}
	f := make([]byte, 144)
	copy(f, h)
	var b []byte
	for range 125 {
		b = append(b, f...)
	}
	if d := Duration(b); d < 2.999 || d > 3.001 {
		t.Errorf("duration = %v, want 3", d)
	}
}
