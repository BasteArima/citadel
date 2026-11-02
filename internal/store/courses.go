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

// Course versions. Every save in the editor is a new version; students see the published one.
// The newest version above the published one is the draft.

// ErrConflict means the draft changed since the editor loaded it.
var ErrConflict = errors.New("draft changed since it was loaded")

// ErrNotFound means there is no such course or version.
var ErrNotFound = errors.New("not found")

// AuthorContent marks versions imported from content/.
const AuthorContent = "content"

// Imported reports what ImportContent did with one course.
type Imported struct {
	ID      string
	Version int  // the published version after import
	New     bool // a new version was stored
	Skipped bool // the course was edited in the editor, so content/ no longer overrides it
	Deleted bool // an admin deleted the course, so content/ does not bring it back
}

// ImportContent stores each course from content/ as a new published version when its JSON
// differs from the latest stored version. Once a course is edited in the editor, the editor
// is its source: content/ stops overriding it and the skip is reported.
func (s *Store) ImportContent(ctx context.Context, courses []*course.Course) ([]Imported, error) {
	var out []Imported
	for _, c := range courses {
		data, err := course.Encode(c)
		if err != nil {
			return nil, err
		}
		res, err := s.importOne(ctx, c, data, hashOf(data))
		if err != nil {
			return nil, fmt.Errorf("import %s: %w", c.ID, err)
		}
		out = append(out, res)
	}
	return out, nil
}

func hashOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s *Store) importOne(ctx context.Context, c *course.Course, data []byte, hash string) (Imported, error) {
	id := c.ID
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Imported{}, err
	}
	defer tx.Rollback()

	var last int
	var lastHash, lastAuthor string
	err = tx.QueryRowContext(ctx, `SELECT version, hash, author FROM course_versions WHERE course_id = ? ORDER BY version DESC LIMIT 1`, id).Scan(&last, &lastHash, &lastAuthor)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		var gone string
		if err := tx.QueryRowContext(ctx, `SELECT id FROM deleted_courses WHERE id = ?`, id).Scan(&gone); err == nil {
			return Imported{ID: id, Deleted: true}, tx.Commit()
		}
		// a new project stays closed until an admin opens it: its tasks are still being tried out (decision 0016)
		access := AccessPublic
		if c.IsProject() {
			access = AccessPrivate
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO courses (id, created_at, access) VALUES (?, ?, ?)`, id, now(), access); err != nil {
			return Imported{}, err
		}
	case err != nil:
		return Imported{}, err
	case lastHash == hash:
		return Imported{ID: id, Version: last}, tx.Commit()
	case lastAuthor != AuthorContent:
		return Imported{ID: id, Version: last, Skipped: true}, tx.Commit()
	}
	v := last + 1
	if err := insertVersion(ctx, tx, id, v, data, AuthorContent, "из content/"); err != nil {
		return Imported{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE courses SET published_version = ? WHERE id = ?`, v, id); err != nil {
		return Imported{}, err
	}
	return Imported{ID: id, Version: v, New: true}, tx.Commit()
}

func insertVersion(ctx context.Context, tx *sql.Tx, id string, v int, data []byte, author, note string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO course_versions (course_id, version, data, hash, author, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, v, string(data), hashOf(data), author, note, now())
	return err
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

// VersionInfo describes one stored version.
type VersionInfo struct {
	Version   int    `json:"version"`
	Author    string `json:"author"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
	Published bool   `json:"published"`
}

// CourseInfo is a course as the admin list sees it.
type CourseInfo struct {
	ID        string      `json:"id"`
	Title     string      `json:"title"` // from the latest version
	Metal     string      `json:"metal"`
	Type      string      `json:"type,omitempty"`
	Published int         `json:"published"` // 0 — never published
	Latest    VersionInfo `json:"latest"`
}

// Courses lists every course with its published and latest versions.
func (s *Store) Courses(ctx context.Context) ([]CourseInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, COALESCE(c.published_version, 0), v.version, v.author, v.note, v.created_at, v.data
		FROM courses c
		JOIN course_versions v ON v.course_id = c.id
		  AND v.version = (SELECT MAX(version) FROM course_versions WHERE course_id = c.id)
		ORDER BY c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CourseInfo
	for rows.Next() {
		var ci CourseInfo
		var data string
		if err := rows.Scan(&ci.ID, &ci.Published, &ci.Latest.Version, &ci.Latest.Author, &ci.Latest.Note, &ci.Latest.CreatedAt, &data); err != nil {
			return nil, err
		}
		ci.Latest.Published = ci.Latest.Version == ci.Published
		if c, err := course.Decode([]byte(data)); err == nil {
			ci.Title, ci.Metal, ci.Type = c.Title, c.Metal, c.Type
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}

// Versions lists the versions of a course, newest first.
func (s *Store) Versions(ctx context.Context, id string) ([]VersionInfo, error) {
	var pub int
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(published_version, 0) FROM courses WHERE id = ?`, id).Scan(&pub)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT version, author, note, created_at FROM course_versions WHERE course_id = ? ORDER BY version DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VersionInfo
	for rows.Next() {
		var vi VersionInfo
		if err := rows.Scan(&vi.Version, &vi.Author, &vi.Note, &vi.CreatedAt); err != nil {
			return nil, err
		}
		vi.Published = vi.Version == pub
		out = append(out, vi)
	}
	return out, rows.Err()
}

// Version returns the data of one version; v = 0 means the latest.
func (s *Store) Version(ctx context.Context, id string, v int) ([]byte, VersionInfo, error) {
	q := `SELECT v.version, v.author, v.note, v.created_at, v.data, COALESCE(c.published_version, 0)
		FROM course_versions v JOIN courses c ON c.id = v.course_id WHERE v.course_id = ? AND v.version = ?`
	args := []any{id, v}
	if v == 0 {
		q = `SELECT v.version, v.author, v.note, v.created_at, v.data, COALESCE(c.published_version, 0)
			FROM course_versions v JOIN courses c ON c.id = v.course_id WHERE v.course_id = ? ORDER BY v.version DESC LIMIT 1`
		args = []any{id}
	}
	var vi VersionInfo
	var data string
	var pub int
	err := s.db.QueryRowContext(ctx, q, args...).Scan(&vi.Version, &vi.Author, &vi.Note, &vi.CreatedAt, &data, &pub)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, VersionInfo{}, ErrNotFound
	}
	if err != nil {
		return nil, VersionInfo{}, err
	}
	vi.Published = vi.Version == pub
	return []byte(data), vi, nil
}

// CreateCourse stores the first version of a new, unpublished course.
func (s *Store) CreateCourse(ctx context.Context, id string, data []byte, author string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO courses (id, created_at) VALUES (?, ?)`, id, now()); err != nil {
		return fmt.Errorf("course %s already exists: %w", id, ErrConflict)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM deleted_courses WHERE id = ?`, id); err != nil {
		return err
	}
	if err := insertVersion(ctx, tx, id, 1, data, author, "новый курс"); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteCourse removes a course with everything that belongs to it: versions, access, progress of
// all users, proposals and narration records. The files of the recordings are the caller's.
func (s *Store) DeleteCourse(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"course_versions", "course_access", "audio", "progress", "proposals"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE course_id = ?`, id); err != nil {
			return err
		}
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM courses WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `INSERT OR REPLACE INTO deleted_courses (id, deleted_at) VALUES (?, ?)`, id, now()); err != nil {
		return err
	}
	return tx.Commit()
}

// SaveDraft stores data as a new version. base is the version the editor started from:
// if someone saved after it, ErrConflict, so one save never silently overwrites another.
func (s *Store) SaveDraft(ctx context.Context, id string, data []byte, base int, author, note string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var last int
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM course_versions WHERE course_id = ?`, id).Scan(&last)
	if err != nil {
		return 0, err
	}
	if last == 0 {
		return 0, ErrNotFound
	}
	if base != last {
		return 0, ErrConflict
	}
	if err := insertVersion(ctx, tx, id, last+1, data, author, note); err != nil {
		return 0, err
	}
	return last + 1, tx.Commit()
}

// Publish makes version v the one students see.
func (s *Store) Publish(ctx context.Context, id string, v int) error {
	res, err := s.db.ExecContext(ctx, `UPDATE courses SET published_version = ?
		WHERE id = ? AND EXISTS (SELECT 1 FROM course_versions WHERE course_id = ? AND version = ?)`, v, id, id, v)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
