package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"citadel/internal/course"
	"citadel/internal/speech"
	"citadel/internal/store"
)

// Narration (docs/dev/AUDIO.md). Recordings are made from the published text by a background
// job the admin starts; the MP3 files lie in <data>/audio/<course>/. A student gets a recording
// only while its hash matches the published text, otherwise the engine reads with the browser voice.

func (s *server) audioRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/courses/{id}/audio", s.api(s.courseAudio))
	mux.Handle("GET /audio/{course}/{file}", s.api(s.audioFile))
	mux.Handle("GET /api/admin/courses/{id}/audio", s.staffCourse(s.adminAudio))
	mux.Handle("POST /api/admin/courses/{id}/audio", s.staffCourse(s.adminAudioMake))
	mux.Handle("POST /api/admin/courses/{id}/audio/cancel", s.staffCourse(s.adminAudioCancel))
	mux.Handle("POST /api/admin/speech/preview", s.staff(s.adminSpeechPreview))
}

var audioName = regexp.MustCompile(`^[A-Za-z0-9._-]+\.mp3$`)

// fileName is the MP3 of a recording: the hash in the name lets the browser cache it for good.
func fileName(node, hash string) string {
	safe := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, node)
	return safe + "-" + hash[:12] + ".mp3"
}

func (s *server) audioPath(courseID, file string) string {
	return filepath.Join(s.cfg.AudioDir, courseID, file)
}

func audioURL(courseID, file string) string { return "/audio/" + courseID + "/" + file }

type playable struct {
	URL      string          `json:"url"`
	Duration float64         `json:"dur"`
	Chapters []store.Chapter `json:"ch"`
}

// courseAudio lists the recordings a student can play: those made from the published text.
func (s *server) courseAudio(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.published(r, id); !ok {
		jsonError(w, http.StatusNotFound, "course not found")
		return
	}
	recs, err := s.cfg.Store.Audio(r.Context(), id)
	if err != nil {
		s.fail(w, "audio", err)
		return
	}
	out := map[string]playable{}
	for node, hash := range s.cat.Load().speech[id] {
		if a, ok := recs[node]; ok && a.Hash == hash {
			out[node] = playable{URL: audioURL(id, a.File), Duration: a.Duration, Chapters: a.Chapters}
		}
	}
	writeValue(w, map[string]any{"parts": out})
}

// audioFile serves an MP3 to those who may open the course. Range requests work, so the player can seek.
func (s *server) audioFile(w http.ResponseWriter, r *http.Request) {
	id, file := r.PathValue("course"), r.PathValue("file")
	if _, ok := s.published(r, id); !ok || !audioName.MatchString(file) || s.cfg.AudioDir == "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "audio/mpeg")
	http.ServeFile(w, r, s.audioPath(id, file))
}

// ── admin ──

// audioJob is the narration job of one course. Parts are recorded one after another.
type audioJob struct {
	Running  bool     `json:"running"`
	Total    int      `json:"total"`
	Done     int      `json:"done"`
	Current  string   `json:"current,omitempty"`
	Node     string   `json:"node,omitempty"` // the part being recorded
	Errors   []string `json:"errors"`
	Finished string   `json:"finished,omitempty"`
	cancel   context.CancelFunc
}

type audioJobs struct {
	recording chan struct{} // one shared recording job across all owners
	mu        sync.Mutex
	jobs      map[string]*audioJob
}

// stop cancels the running job of a course, if there is one.
func (j *audioJobs) stop(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if job := j.jobs[id]; job != nil && job.Running && job.cancel != nil {
		job.cancel()
	}
}

func (j *audioJobs) get(id string) audioJob {
	j.mu.Lock()
	defer j.mu.Unlock()
	if job := j.jobs[id]; job != nil {
		cp := *job
		cp.Errors = slices.Clone(job.Errors)
		return cp
	}
	return audioJob{Errors: []string{}}
}

func (j *audioJobs) update(id string, fn func(*audioJob)) {
	j.mu.Lock()
	defer j.mu.Unlock()
	fn(j.jobs[id])
}

type audioRow struct {
	Node     string  `json:"node"`
	Lesson   int     `json:"lesson"`
	LessonT  string  `json:"lessonTitle"`
	Index    int     `json:"index"`
	Title    string  `json:"title"`
	Chars    int     `json:"chars"`
	Chapters int     `json:"chapters"`
	Status   string  `json:"status"` // ok, stale, none
	Duration float64 `json:"dur,omitempty"`
	URL      string  `json:"url,omitempty"`
	MadeAt   string  `json:"madeAt,omitempty"`
}

func (s *server) adminAudio(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c := s.cat.Load().parsed[id]
	out := map[string]any{"tts": s.cfg.Synth != nil, "published": c != nil, "job": s.audio.get(id), "parts": []audioRow{}}
	if c == nil {
		writeValue(w, out)
		return
	}
	recs, err := s.cfg.Store.Audio(r.Context(), id)
	if err != nil {
		s.fail(w, "audio", err)
		return
	}
	rows := []audioRow{}
	for _, p := range speech.Parts(c) {
		row := audioRow{Node: p.Node, Lesson: p.Lesson, LessonT: p.LessonT, Index: p.Index, Title: p.Title, Chars: p.Chars(), Chapters: len(p.Chapters), Status: "none"}
		if a, ok := recs[p.Node]; ok {
			row.Status, row.Duration, row.URL, row.MadeAt = "stale", a.Duration, audioURL(id, a.File), a.MadeAt
			if a.Hash == p.Hash {
				row.Status = "ok"
			}
		}
		rows = append(rows, row)
	}
	out["parts"], out["voice"] = rows, speech.Voice(c)
	writeValue(w, out)
}

// adminAudioMake starts recording the given parts; without a list — every part that is stale or has no recording.
func (s *server) adminAudioMake(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Nodes []string `json:"nodes"`
	}
	if !readJSON(w, r, &req, 1<<16) {
		return
	}
	if s.cfg.Synth == nil || s.cfg.AudioDir == "" {
		jsonError(w, http.StatusConflict, "синтез речи не настроен: нужен edge-tts (CITADEL_TTS)")
		return
	}
	c := s.cat.Load().parsed[id]
	if c == nil {
		jsonError(w, http.StatusNotFound, "курс не опубликован: озвучивается опубликованный текст")
		return
	}
	todo, err := s.partsToRecord(r.Context(), c, req.Nodes)
	if err != nil {
		s.fail(w, "audio", err)
		return
	}
	if len(todo) == 0 {
		jsonError(w, http.StatusBadRequest, "нечего озвучивать: все части записаны по опубликованному тексту")
		return
	}
	if !s.startRecording(c, todo) {
		jsonError(w, http.StatusConflict, "озвучка этого курса уже идёт")
		return
	}
	writeValue(w, s.audio.get(id))
}

// partsToRecord returns the given parts; without a list — every part that is stale or has no recording.
func (s *server) partsToRecord(ctx context.Context, c *course.Course, nodes []string) ([]speech.Part, error) {
	recs, err := s.cfg.Store.Audio(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	var todo []speech.Part
	for _, p := range speech.Parts(c) {
		a, ok := recs[p.Node]
		if len(nodes) > 0 && slices.Contains(nodes, p.Node) || len(nodes) == 0 && (!ok || a.Hash != p.Hash) {
			todo = append(todo, p)
		}
	}
	return todo, nil
}

// startRecording starts the background job of a course; false — one is already running.
func (s *server) startRecording(c *course.Course, todo []speech.Part) bool {
	ctx, cancel := context.WithCancel(s.ctx)
	s.audio.mu.Lock()
	if job := s.audio.jobs[c.ID]; job != nil && job.Running {
		s.audio.mu.Unlock()
		cancel()
		return false
	}
	s.audio.jobs[c.ID] = &audioJob{Running: true, Total: len(todo), Errors: []string{}, cancel: cancel}
	s.audio.mu.Unlock()
	go s.recordParts(ctx, c.ID, speech.Voice(c), todo)
	return true
}

// recordMissing records what the published text of a course lacks. A running job is left alone:
// the hourly pass picks up whatever changed while it worked.
func (s *server) recordMissing(id string) {
	if !s.cfg.AutoRecord || s.cfg.Synth == nil || s.cfg.AudioDir == "" {
		return
	}
	c := s.cat.Load().parsed[id]
	if c == nil {
		return
	}
	todo, err := s.partsToRecord(s.ctx, c, nil)
	if err != nil {
		s.log.Error("narration", "course", id, "err", err)
		return
	}
	if len(todo) > 0 && s.startRecording(c, todo) {
		s.log.Info("narration started", "course", id, "parts", len(todo))
	}
}

// keepRecorded keeps recordings up to date without anyone pressing a button: at the start of the
// service and every hour, so a course recovers by itself after the speech service was down.
func (s *server) keepRecorded() {
	if !s.cfg.AutoRecord {
		return
	}
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		for _, id := range s.cat.Load().order {
			s.recordMissing(id)
		}
		select {
		case <-s.ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (s *server) recordParts(ctx context.Context, id, voice string, parts []speech.Part) {
	defer s.audio.update(id, func(j *audioJob) {
		j.Running, j.Current, j.Node, j.Finished = false, "", "", time.Now().UTC().Format(time.RFC3339)
		j.cancel()
	})
	select {
	case s.audio.recording <- struct{}{}:
		defer func() { <-s.audio.recording }()
	case <-ctx.Done():
		return
	}
	if ctx.Err() != nil {
		return
	}
	if err := os.MkdirAll(filepath.Join(s.cfg.AudioDir, id), 0o755); err != nil {
		s.audio.update(id, func(j *audioJob) { j.Errors = append(j.Errors, err.Error()) })
		return
	}
	for _, p := range parts {
		if ctx.Err() != nil {
			return
		}
		label := fmt.Sprintf("Урок %d · часть %d · %s", p.Lesson, p.Index, p.Title)
		s.audio.update(id, func(j *audioJob) { j.Current, j.Node = label, p.Node })
		err := s.recordPart(ctx, id, voice, p)
		if err != nil && ctx.Err() == nil {
			s.log.Error("narration", "course", id, "node", p.Node, "err", err)
			msg := err.Error()
			if errors.Is(err, speech.ErrNoAnswer) {
				msg = "сервис синтеза не ответил ни с одной попытки — проверь доступ сервера к speech.platform.bing.com или задай прокси CITADEL_TTS_PROXY"
			}
			s.audio.update(id, func(j *audioJob) { j.Errors = append(j.Errors, label+": "+msg) })
			if errors.Is(err, speech.ErrNoAnswer) {
				return // the rest would only wait for the same timeouts; the hourly pass tries again
			}
		}
		s.audio.update(id, func(j *audioJob) { j.Done++ })
	}
}

func (s *server) recordPart(ctx context.Context, id, voice string, p speech.Part) error {
	start := time.Now()
	rec, err := speech.Record(ctx, s.cfg.Synth, voice, p)
	if err != nil {
		return err
	}
	file := fileName(p.Node, p.Hash)
	path := s.audioPath(id, file)
	if err := os.WriteFile(path+".tmp", rec.MP3, 0o644); err != nil {
		return err
	}
	if err := os.Rename(path+".tmp", path); err != nil {
		return err
	}
	chs := make([]store.Chapter, len(p.Chapters))
	for i, ch := range p.Chapters {
		chs[i] = store.Chapter{Title: ch.Title, Start: math.Round(rec.Starts[i]*100) / 100}
	}
	old, err := s.cfg.Store.PutAudio(context.WithoutCancel(ctx), id, store.Audio{
		Node: p.Node, Hash: p.Hash, Voice: voice, File: file, Duration: math.Round(rec.Duration*100) / 100, Chapters: chs, Chars: p.Chars(),
	})
	if err != nil {
		return err
	}
	if old != "" && audioName.MatchString(old) {
		os.Remove(s.audioPath(id, old))
	}
	s.log.Info("narration", "course", id, "node", p.Node, "dur", rec.Duration, "took", time.Since(start).Round(time.Millisecond).String())
	return nil
}

func (s *server) adminAudioCancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.audio.mu.Lock()
	if job := s.audio.jobs[id]; job != nil && job.Running {
		job.cancel()
	}
	s.audio.mu.Unlock()
	writeValue(w, s.audio.get(id))
}

// adminSpeechPreview reads a short text with a voice and a lexicon: «послушать, как читается»
// before the lexicon is saved and published.
func (s *server) adminSpeechPreview(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Voice   string            `json:"voice"`
		Lexicon map[string]string `json:"lexicon"`
		Text    string            `json:"text"`
	}
	if !readJSON(w, r, &req, 1<<16) {
		return
	}
	if s.cfg.Synth == nil {
		jsonError(w, http.StatusConflict, "синтез речи не настроен: нужен edge-tts (CITADEL_TTS)")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" || len([]rune(text)) > 300 {
		jsonError(w, http.StatusBadRequest, "текст для прослушивания — от 1 до 300 символов")
		return
	}
	voice := req.Voice
	if voice == "" {
		voice = speech.DefaultVoice
	}
	if !course.ValidVoice(voice) {
		jsonError(w, http.StatusBadRequest, "голос: ожидается имя вида ru-RU-SvetlanaNeural")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	data, err := s.cfg.Synth.Speak(ctx, voice, speech.ApplyLexicon(req.Lexicon, text))
	if err != nil {
		s.log.Error("speech preview", "err", err)
		msg := "синтез не сработал: " + err.Error()
		if errors.Is(err, speech.ErrNoAnswer) || errors.Is(err, context.DeadlineExceeded) {
			msg = "сервис синтеза не ответил — проверь доступ сервера к speech.platform.bing.com или прокси CITADEL_TTS_PROXY"
		}
		jsonError(w, http.StatusBadGateway, msg)
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}
