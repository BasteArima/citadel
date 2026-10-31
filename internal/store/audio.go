package store

import (
	"context"
	"encoding/json"
)

// Narration recordings. A recording is derived from the published text, not part of the course:
// the MP3 lies in the data directory, the row says which text (hash) and voice it was made from
// and where each chapter starts (docs/dev/AUDIO.md).

// Chapter is a chapter of a recording: its title and start in seconds.
type Chapter struct {
	Title string  `json:"t"`
	Start float64 `json:"s"`
}

// Audio is the recording of one part.
type Audio struct {
	Node     string    `json:"node"`
	Hash     string    `json:"hash"`
	Voice    string    `json:"voice"`
	File     string    `json:"file"`
	Duration float64   `json:"dur"`
	Chapters []Chapter `json:"ch"`
	Chars    int       `json:"chars"`
	MadeAt   string    `json:"madeAt"`
}

// Audio returns the recordings of a course by part id.
func (s *Store) Audio(ctx context.Context, courseID string) (map[string]Audio, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT node, hash, voice, file, dur, chapters, chars, made_at FROM audio WHERE course_id = ?`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Audio{}
	for rows.Next() {
		var a Audio
		var chs string
		if err := rows.Scan(&a.Node, &a.Hash, &a.Voice, &a.File, &a.Duration, &chs, &a.Chars, &a.MadeAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(chs), &a.Chapters); err != nil {
			return nil, err
		}
		out[a.Node] = a
	}
	return out, rows.Err()
}

// PutAudio saves the recording of a part and returns the file of the recording it replaced,
// so the caller can delete it.
func (s *Store) PutAudio(ctx context.Context, courseID string, a Audio) (old string, err error) {
	chs, err := json.Marshal(a.Chapters)
	if err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	tx.QueryRowContext(ctx, `SELECT file FROM audio WHERE course_id = ? AND node = ?`, courseID, a.Node).Scan(&old)
	if _, err := tx.ExecContext(ctx, `INSERT INTO audio (course_id, node, hash, voice, file, dur, chapters, chars, made_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (course_id, node) DO UPDATE SET hash = excluded.hash, voice = excluded.voice, file = excluded.file,
			dur = excluded.dur, chapters = excluded.chapters, chars = excluded.chars, made_at = excluded.made_at`,
		courseID, a.Node, a.Hash, a.Voice, a.File, a.Duration, string(chs), a.Chars, now()); err != nil {
		return "", err
	}
	if old == a.File {
		old = ""
	}
	return old, tx.Commit()
}
