package store

import (
	"context"
	"strings"
	"unicode/utf8"
)

// UserMatch contains only the public account fields needed by administrative pickers.
type UserMatch struct {
	ID         int64  `json:"id"`
	Login      string `json:"login"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	Avatar     string `json:"avatar"`
	DisabledAt string `json:"disabledAt"`
}

const matchColumns = `u.id, COALESCE(u.login, ''), u.name, u.role,
 CASE WHEN a.user_id IS NULL THEN '' ELSE '/avatar/' || u.id || '?v=' || a.updated_at END,
 COALESCE(u.disabled_at, '')`

// Bind the entire escaped prefix: SQLite cannot turn LIKE (? || '%') into an
// index range. UNION allows both prefix searches to use their respective index.
const userPrefixIDs = `SELECT id FROM users WHERE login COLLATE NOCASE LIKE ? ESCAPE '\'
 UNION SELECT id FROM users WHERE name_search COLLATE NOCASE LIKE ? ESCAPE '\'`

func (s *Store) UserMatchByID(ctx context.Context, id int64) (*UserMatch, error) {
	users, err := s.userMatches(ctx, `SELECT `+matchColumns+` FROM users u LEFT JOIN avatars a ON a.user_id = u.id WHERE u.id = ?`, id)
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return nil, ErrNotFound
	}
	return &users[0], nil
}

func (s *Store) SearchUsers(ctx context.Context, query string, limit int, ownersOnly bool) ([]UserMatch, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	if utf8.RuneCountInString(query) < 2 {
		return []UserMatch{}, nil
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 20 {
		limit = 20
	}
	prefix := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query) + "%"
	return s.userMatches(ctx, `SELECT `+matchColumns+` FROM users u LEFT JOIN avatars a ON a.user_id = u.id
 WHERE u.id IN (`+userPrefixIDs+`) AND (? = 0 OR u.role IN ('admin', 'author'))
 ORDER BY (u.login = ? COLLATE NOCASE) DESC, u.login COLLATE NOCASE, u.id LIMIT ?`, prefix, prefix, ownersOnly, query, limit)
}

func (s *Store) CourseUserMatches(ctx context.Context, id string) ([]UserMatch, error) {
	if _, err := s.CourseOwner(ctx, id); err != nil {
		return nil, err
	}
	return s.userMatches(ctx, `SELECT `+matchColumns+` FROM course_access c JOIN users u ON u.id = c.user_id
 LEFT JOIN avatars a ON a.user_id = u.id WHERE c.course_id = ? ORDER BY u.login COLLATE NOCASE, u.id`, id)
}

func (s *Store) userMatches(ctx context.Context, query string, args ...any) ([]UserMatch, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserMatch{}
	for rows.Next() {
		var u UserMatch
		if err := rows.Scan(&u.ID, &u.Login, &u.Name, &u.Role, &u.Avatar, &u.DisabledAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetCourseUser changes just one relation; simultaneous additions cannot overwrite each other.
func (s *Store) SetCourseUser(ctx context.Context, courseID string, userID int64, granted bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?) AND EXISTS(SELECT 1 FROM users WHERE id = ?)`, courseID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if granted {
		_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO course_access (course_id, user_id) VALUES (?, ?)`, courseID, userID)
	} else {
		_, err = tx.ExecContext(ctx, `DELETE FROM course_access WHERE course_id = ? AND user_id = ?`, courseID, userID)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
