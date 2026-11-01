package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSynth returns one silent MP3 frame (24 ms) per call and remembers what it was asked to read.
type fakeSynth struct {
	mu    sync.Mutex
	texts []string
}

func (f *fakeSynth) Speak(ctx context.Context, voice, text string) ([]byte, error) {
	f.mu.Lock()
	f.texts = append(f.texts, voice+"|"+text)
	f.mu.Unlock()
	frame := make([]byte, 144)
	copy(frame, []byte{0xFF, 0xF3, 0x64, 0xC4}) // MPEG-2 Layer III, 48 kbit/s, 24 kHz
	return frame, nil
}

func TestNarration(t *testing.T) {
	synth := &fakeSynth{}
	dir := t.TempDir()
	ts := newTestServerWith(t, func(c *Config) { c.Synth, c.AudioDir = synth, dir })
	admin, student := signIn(t, ts, "Baste"), signIn(t, ts, "Ученик")

	// a lesson with a theory part and a practice part; the lexicon reads «Go» as «гоу»
	saveAndPublish := func(text string, base int) {
		t.Helper()
		course := map[string]any{
			"schema": 1, "id": "go", "title": "Go", "metal": "iron", "tool": map[string]any{"name": "Go", "version": "1.27"}, "review": []int{1, 3, 7},
			"glossary": map[string]any{},
			"speech":   map[string]any{"lexicon": map[string]string{"Go": "гоу"}},
			"root": []any{map[string]any{"id": "s", "kind": "section", "title": "Раздел", "children": []any{
				map[string]any{"id": "a", "kind": "lesson", "title": "А", "children": []any{
					map[string]any{"id": "a.1", "kind": "part", "title": "Теория", "blocks": []any{
						map[string]any{"type": "text", "html": text},
						map[string]any{"type": "heading", "level": 2, "text": "Глава два"},
						map[string]any{"type": "text", "html": "Ещё абзац."},
					}},
					map[string]any{"id": "a.2", "kind": "part", "title": "Проверка", "practice": "test", "blocks": []any{
						map[string]any{"type": "question", "id": "q1", "kind": "choice", "q": "?", "opts": []any{"да", "нет"}, "a": 0},
					}},
				}},
			}}},
		}
		data, _ := json.Marshal(map[string]any{"base": base, "course": course})
		if resp, body := do(t, admin, "PUT", ts.URL+"/api/admin/courses/go/draft", string(data)); resp.StatusCode != 200 {
			t.Fatalf("save: %d %s", resp.StatusCode, body)
		}
		if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/go/publish", `{"version":`+itoa(base+1)+`}`); resp.StatusCode != 200 {
			t.Fatalf("publish: %d %s", resp.StatusCode, body)
		}
	}
	type row struct {
		Node, Status, URL string
		Dur               float64
	}
	adminParts := func() (rows []row, running bool) {
		t.Helper()
		_, body := do(t, admin, "GET", ts.URL+"/api/admin/courses/go/audio", "")
		var out struct {
			Parts []row
			Job   struct{ Running bool }
		}
		json.Unmarshal([]byte(body), &out)
		return out.Parts, out.Job.Running
	}
	wait := func() []row {
		t.Helper()
		for range 200 {
			rows, running := adminParts()
			if !running {
				return rows
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("narration job never finished")
		return nil
	}
	studentParts := func() map[string]playable {
		t.Helper()
		_, body := do(t, student, "GET", ts.URL+"/api/courses/go/audio", "")
		var out struct{ Parts map[string]playable }
		json.Unmarshal([]byte(body), &out)
		return out.Parts
	}

	saveAndPublish("Первый текст про Go.", 1)
	if rows, _ := adminParts(); len(rows) != 1 || rows[0].Node != "a.1" || rows[0].Status != "none" {
		t.Fatalf("before recording: %+v (only the theory part is narrated)", rows)
	}
	if resp, body := do(t, student, "POST", ts.URL+"/api/admin/courses/go/audio", `{}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("student starts narration: %d %s", resp.StatusCode, body)
	}
	if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/go/audio", `{}`); resp.StatusCode != 200 {
		t.Fatalf("start: %d %s", resp.StatusCode, body)
	}
	rows := wait()
	if rows[0].Status != "ok" || rows[0].Dur < 0.04 {
		t.Fatalf("after recording: %+v", rows)
	}
	if len(synth.texts) != 2 || !strings.Contains(synth.texts[0], "ru-RU-SvetlanaNeural|Часть 1. Теория.\nПервый текст про гоу.") {
		t.Fatalf("synth was asked: %q", synth.texts)
	}

	// the student gets the recording with chapters and can download it
	sp := studentParts()
	rec, ok := sp["a.1"]
	if !ok || len(rec.Chapters) != 2 || rec.Chapters[1].Title != "Глава два" || rec.Chapters[1].Start <= 0 {
		t.Fatalf("student audio: %+v", sp)
	}
	resp, body := do(t, student, "GET", ts.URL+rec.URL, "")
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "audio/mpeg" || len(body) != 288 {
		t.Fatalf("file: %d %s %d bytes", resp.StatusCode, resp.Header.Get("Content-Type"), len(body))
	}
	if resp, _ := do(t, student, "GET", ts.URL+"/audio/go/..%2Fcitadel.db", ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("path escape: %d", resp.StatusCode)
	}

	// the text changes: the recording is stale, the student falls back to the browser voice
	saveAndPublish("Второй текст.", 2)
	if rows, _ := adminParts(); rows[0].Status != "stale" {
		t.Fatalf("after edit: %+v", rows)
	}
	if sp := studentParts(); len(sp) != 0 {
		t.Fatalf("stale recording given to the student: %+v", sp)
	}
	do(t, admin, "POST", ts.URL+"/api/admin/courses/go/audio", `{}`)
	if rows := wait(); rows[0].Status != "ok" {
		t.Fatalf("after re-recording: %+v", rows)
	}
	// the old file is removed, the new one is served
	if resp, _ := do(t, student, "GET", ts.URL+rec.URL, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("old file still served: %d", resp.StatusCode)
	}
	if sp := studentParts(); sp["a.1"].URL == rec.URL || sp["a.1"].URL == "" {
		t.Fatalf("new recording: %+v", sp)
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

// TestAutoRecord: the service records a part by itself at the start and after a publish.
func TestAutoRecord(t *testing.T) {
	synth := &fakeSynth{}
	ts := newTestServerWith(t, func(c *Config) { c.Synth, c.AudioDir, c.AutoRecord = synth, t.TempDir(), true })
	admin := signIn(t, ts, "Baste")
	publish := func(text string, base int) {
		t.Helper()
		data, _ := json.Marshal(map[string]any{"base": base, "course": map[string]any{
			"schema": 1, "id": "go", "title": "Go", "metal": "iron", "tool": map[string]any{"name": "Go", "version": "1.27"}, "review": []int{1, 3, 7}, "glossary": map[string]any{},
			"root": []any{map[string]any{"id": "s", "kind": "section", "title": "Раздел", "children": []any{
				map[string]any{"id": "a", "kind": "lesson", "title": "А", "children": []any{
					map[string]any{"id": "a.1", "kind": "part", "title": "Теория", "blocks": []any{map[string]any{"type": "text", "html": text}}},
				}},
			}}},
		}})
		if resp, body := do(t, admin, "PUT", ts.URL+"/api/admin/courses/go/draft", string(data)); resp.StatusCode != 200 {
			t.Fatalf("save: %d %s", resp.StatusCode, body)
		}
		if resp, body := do(t, admin, "POST", ts.URL+"/api/admin/courses/go/publish", `{"version":`+itoa(base+1)+`}`); resp.StatusCode != 200 {
			t.Fatalf("publish: %d %s", resp.StatusCode, body)
		}
	}
	recorded := func(want string) {
		t.Helper()
		for range 300 {
			_, body := do(t, admin, "GET", ts.URL+"/api/courses/go/audio", "")
			synth.mu.Lock()
			last := ""
			if len(synth.texts) > 0 {
				last = synth.texts[len(synth.texts)-1]
			}
			synth.mu.Unlock()
			if strings.Contains(body, "a.1") && strings.Contains(last, want) {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("no recording of %q: %q", want, synth.texts)
	}
	publish("Первый текст.", 1)
	recorded("Первый текст.")
	publish("Второй текст.", 2)
	recorded("Второй текст.")
}
