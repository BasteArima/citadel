package store

import (
	"context"
	"encoding/json"
)

// Item is one progress mark: a solved question, a read part, a passed lesson, a review.
// At is when it was set, in Unix milliseconds by the client clock.
type Item struct {
	V  json.RawMessage `json:"v"`
	At int64           `json:"at"`
}

// Progress returns all marks of a user in a course.
func (s *Store) Progress(ctx context.Context, userID int64, courseID string) (map[string]Item, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, value, at FROM progress WHERE user_id = ? AND course_id = ?`, userID, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Item{}
	for rows.Next() {
		var key, value string
		var at int64
		if err := rows.Scan(&key, &value, &at); err != nil {
			return nil, err
		}
		out[key] = Item{V: json.RawMessage(value), At: at}
	}
	return out, rows.Err()
}

// MergeProgress merges marks into the stored ones key by key: the newer mark wins,
// so two devices that worked offline do not overwrite each other's progress.
// It returns the merged state.
func (s *Store) MergeProgress(ctx context.Context, userID int64, courseID string, items map[string]Item) (map[string]Item, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO progress (user_id, course_id, key, value, at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, course_id, key) DO UPDATE SET value = excluded.value, at = excluded.at
		WHERE excluded.at > progress.at`)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	for key, it := range items {
		if _, err := stmt.ExecContext(ctx, userID, courseID, key, string(it.V), it.At); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Progress(ctx, userID, courseID)
}
