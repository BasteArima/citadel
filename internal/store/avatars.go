package store

import (
	"context"
	"time"
)

// SetAvatar accepts a normalized PNG, never the original upload.
func (s *Store) SetAvatar(ctx context.Context, userID int64, png []byte) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO avatars (user_id, png, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET png = excluded.png, updated_at = MAX(avatars.updated_at + 1, excluded.updated_at)`, userID, png, time.Now().UnixNano())
	return err
}

func (s *Store) Avatar(ctx context.Context, userID int64) ([]byte, int64, error) {
	var png []byte
	var updated int64
	err := s.db.QueryRowContext(ctx, `SELECT png, updated_at FROM avatars WHERE user_id = ?`, userID).Scan(&png, &updated)
	return png, updated, accountError(err)
}

func (s *Store) DeleteAvatar(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM avatars WHERE user_id = ?`, userID)
	return err
}
