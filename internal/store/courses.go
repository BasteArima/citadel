package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"

	"citadel/internal/course"
)

// Imported reports what ImportContent did with one course.
type Imported struct {
	ID      string
	Version int  // the published version after import
	New     bool // a new version was stored
}

// ImportContent stores each course from content/ as a new published version when
// its JSON differs from the latest stored version. Until the editor exists (stage 5)
// the files in content/ are the source of courses, and every change becomes a version.
func (s *Store) ImportContent(ctx context.Context, courses []*course.Course) ([]Imported, error) {
	var out []Imported
	for _, c := range courses {
		data, err := course.Encode(c)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		hash := hex.EncodeToString(sum[:])
		res, err := s.importOne(ctx, c.ID, data, hash)
		if err != nil {
			return nil, fmt.Errorf("import %s: %w", c.ID, err)
		}
		out = append(out, res)
	}
	return out, nil
}

func (s *Store) importOne(ctx context.Context, id string, data []byte, hash string) (Imported, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Imported{}, err
	}
	defer tx.Rollback()

	var last int
	var lastHash string
	err = tx.QueryRowContext(ctx, `SELECT version, hash FROM course_versions WHERE course_id = ? ORDER BY version DESC LIMIT 1`, id).Scan(&last, &lastHash)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := tx.ExecContext(ctx, `INSERT INTO courses (id, created_at) VALUES (?, ?)`, id, now()); err != nil {
			return Imported{}, err
		}
	case err != nil:
		return Imported{}, err
	case lastHash == hash:
		return Imported{ID: id, Version: last}, tx.Commit()
	}
	v := last + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO course_versions (course_id, version, data, hash, author, note, created_at) VALUES (?, ?, ?, ?, 'content', 'из content/', ?)`,
		id, v, string(data), hash, now()); err != nil {
		return Imported{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE courses SET published_version = ? WHERE id = ?`, v, id); err != nil {
		return Imported{}, err
	}
	return Imported{ID: id, Version: v, New: true}, tx.Commit()
}

// Published returns the published version of every course, ordered by id.
func (s *Store) Published(ctx context.Context) ([]*course.Course, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT v.data FROM courses c
		JOIN course_versions v ON v.course_id = c.id AND v.version = c.published_version
		ORDER BY c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*course.Course
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		c, err := course.Decode([]byte(data))
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
