package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
)

var ErrCourseLimit = errors.New("достигнут лимит курсов")

func nullableID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

func (s *Store) CourseOwner(ctx context.Context, id string) (int64, error) {
	var owner int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(owner_id, 0) FROM courses WHERE id = ?`, id).Scan(&owner)
	return owner, accountError(err)
}

func (s *Store) CourseOwners(ctx context.Context) (map[string]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(owner_id, 0) FROM courses`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var id string
		var owner int64
		if err := rows.Scan(&id, &owner); err != nil {
			return nil, err
		}
		out[id] = owner
	}
	return out, rows.Err()
}

func (s *Store) SetCourseOwner(ctx context.Context, id string, owner int64) error {
	if owner != 0 {
		u, err := s.UserInfoByID(ctx, owner)
		if err != nil {
			return err
		}
		if u.Role != RoleAuthor && u.Role != RoleAdmin {
			return errors.New("владелец должен быть автором или админом")
		}
	}
	res, err := s.db.ExecContext(ctx, `UPDATE courses SET owner_id = ? WHERE id = ?`, nullableID(owner), id)
	if err == nil {
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
	}
	return err
}

func (s *Store) SetCourseLimit(ctx context.Context, id int64, limit *int) error {
	if limit != nil && *limit < 0 {
		return errors.New("лимит должен быть неотрицательным")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE users SET course_limit = ? WHERE id = ?`, limit, id)
	if err == nil {
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
	}
	return err
}

func (s *Store) CheckCourseLimit(ctx context.Context, owner int64) error {
	return checkCourseLimit(ctx, s.db, owner)
}

type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func checkCourseLimit(ctx context.Context, q rowQuerier, owner int64) error {
	if owner == 0 {
		return nil
	}
	var count, limit int
	var role, disabled string
	err := q.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM courses WHERE owner_id = users.id), COALESCE(course_limit, 10), role, COALESCE(disabled_at, '') FROM users WHERE id = ?`, owner).Scan(&count, &limit, &role, &disabled)
	if err != nil {
		return err
	}
	if disabled != "" || (role != RoleAuthor && role != RoleAdmin) {
		return ErrNoToken
	}
	if role == RoleAuthor && count >= limit {
		return ErrCourseLimit
	}
	return nil
}

// The limit and insert share a transaction; simultaneous requests cannot exceed it.
func insertOwnedCourse(ctx context.Context, tx *sql.Tx, id string, owner int64) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?)`, id).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrConflict
	}
	if err := checkCourseLimit(ctx, tx, owner); err != nil {
		return err
	}
	access := AccessPublic
	if owner != 0 {
		access = AccessPrivate
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO courses (id, created_at, owner_id, access) VALUES (?, ?, ?, ?)`, id, now(), nullableID(owner), access)
	return err
}

func (s *Store) TokenByID(ctx context.Context, id int64) (Token, error) {
	t, err := scanToken(s.db.QueryRowContext(ctx, `SELECT `+tokenCols+` FROM tokens WHERE id = ?`, id))
	return t, accountError(err)
}

// tokenAllowsOwner intersects the explicit scope with the owner's current role.
func (s *Store) tokenAllowsOwner(ctx context.Context, t Token, id string, owner int64) bool {
	if len(t.Courses) != 0 && !slices.Contains(t.Courses, id) {
		return false
	}
	role := RoleAdmin
	if t.UserID != 0 {
		u, err := s.UserInfoByID(ctx, t.UserID)
		if err != nil || u.DisabledAt != "" || (u.Role != RoleAuthor && u.Role != RoleAdmin) {
			return false
		}
		role = u.Role
	}
	if role == RoleAuthor {
		return owner == t.UserID
	}
	return len(t.Courses) != 0 || owner == 0 || owner == t.UserID
}

// TokenAllows is the single course scope rule for REST and MCP. Ownership is
// read at use time, so transferring a course immediately changes token access.
func (s *Store) TokenAllows(ctx context.Context, t Token, id string) bool {
	owner, err := s.CourseOwner(ctx, id)
	// Explicit admin scopes may name a course that has not been created yet.
	if errors.Is(err, ErrNotFound) {
		return len(t.Courses) != 0 && s.tokenAllowsOwner(ctx, t, id, -1)
	}
	return err == nil && s.tokenAllowsOwner(ctx, t, id, owner)
}

// New-course proposals have their own owner snapshot, before a course exists.
// Never infer that owner from a different proposal with the same requested id.
func (s *Store) TokenAllowsProposal(ctx context.Context, t Token, p Proposal) bool {
	owner, err := s.CourseOwner(ctx, p.CourseID)
	if errors.Is(err, ErrNotFound) && p.NewCourse {
		return s.tokenAllowsOwner(ctx, t, p.CourseID, p.OwnerID)
	}
	return err == nil && s.tokenAllowsOwner(ctx, t, p.CourseID, owner)
}
