package store

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Direction is platform metadata, independent of course versions.
type Direction struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Position int    `json:"position"`
}

var directionID = regexp.MustCompile(`^[a-zA-Z0-9-]{2,32}$`)
var ErrDirection = errors.New("некорректное направление: id — латиница, цифры и дефис, 2–32 символа; название — 1–40 символов, без повторов")

func readDirections(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}) ([]Direction, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, title, position FROM directions ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Direction{}
	for rows.Next() {
		var d Direction
		if err := rows.Scan(&d.ID, &d.Title, &d.Position); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) Directions(ctx context.Context) ([]Direction, error) {
	return readDirections(ctx, s.db)
}

// CourseMetadata reads current platform fields without decoding course versions.
func (s *Store) CourseMetadata(ctx context.Context) (map[string]CourseInfo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT c.id, COALESCE(c.direction, ''), COALESCE(u.name, '') FROM courses c LEFT JOIN users u ON u.id = c.owner_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]CourseInfo{}
	for rows.Next() {
		var c CourseInfo
		if err := rows.Scan(&c.ID, &c.Direction, &c.OwnerName); err != nil {
			return nil, err
		}
		out[c.ID] = c
	}
	return out, rows.Err()
}

func (s *Store) CreateDirection(ctx context.Context, id, title string) error {
	return s.writeDirection(ctx, id, &title, nil, true)
}

// UpdateDirection moves the direction to a zero-based position, shifting neighbours.
// Nil fields preserve their current values.
func (s *Store) UpdateDirection(ctx context.Context, id string, title *string, position *int) error {
	return s.writeDirection(ctx, id, title, position, false)
}

func (s *Store) writeDirection(ctx context.Context, id string, title *string, position *int, create bool) error {
	if !directionID.MatchString(id) {
		return ErrDirection
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	list, err := readDirections(ctx, tx)
	if err != nil {
		return err
	}
	at := -1
	for i, d := range list {
		if d.ID == id {
			at = i
		}
	}
	if create && at >= 0 {
		return ErrConflict
	}
	if !create && at < 0 {
		return ErrNotFound
	}
	d := Direction{ID: id}
	if at >= 0 {
		d = list[at]
	}
	if title != nil {
		d.Title = strings.TrimSpace(*title)
	}
	if utf8.RuneCountInString(d.Title) < 1 || utf8.RuneCountInString(d.Title) > 40 {
		return ErrDirection
	}
	for _, other := range list {
		if other.ID != id && strings.EqualFold(other.Title, d.Title) {
			return ErrDirection
		}
	}
	to := at
	if create {
		to = len(list)
	} else {
		list = append(list[:at], list[at+1:]...)
	}
	if position != nil {
		to = *position
	}
	if to < 0 || to > len(list) {
		return ErrDirection
	}
	list = append(list, Direction{})
	copy(list[to+1:], list[to:])
	list[to] = d
	if create {
		if _, err := tx.ExecContext(ctx, `INSERT INTO directions (id, title, position) VALUES (?, ?, ?)`, id, d.Title, to); err != nil {
			return err
		}
	}
	for i, item := range list {
		if _, err := tx.ExecContext(ctx, `UPDATE directions SET title = ?, position = ? WHERE id = ?`, item.Title, i, item.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteDirection(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM directions WHERE id = ?`, id)
	if err == nil {
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
	}
	return err
}

func (s *Store) SetCourseDirection(ctx context.Context, id, direction string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if direction != "" {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM directions WHERE id = ?)`, direction).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrDirection
		}
	}
	var value any
	if direction != "" {
		value = direction
	}
	res, err := tx.ExecContext(ctx, `UPDATE courses SET direction = ? WHERE id = ?`, value, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
