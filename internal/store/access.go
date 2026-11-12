package store

import (
	"context"
	"fmt"
)

// Course access. A public course is open to every signed-in user; a private one only to admins
// and to the users it was granted to. Access is a setting of the service, not of the course
// content, so it lives here and not in the course JSON.

const (
	AccessPublic  = "public"
	AccessPrivate = "private"
)

// CourseAccess returns the access setting of every course.
func (s *Store) CourseAccess(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, access FROM courses`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, a string
		if err := rows.Scan(&id, &a); err != nil {
			return nil, err
		}
		out[id] = a
	}
	return out, rows.Err()
}

// SetCourseAccess makes a course public or private. Grants stay: making it private again
// restores the same list.
func (s *Store) SetCourseAccess(ctx context.Context, id, access string) error {
	if access != AccessPublic && access != AccessPrivate {
		return fmt.Errorf("unknown access %q", access)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE courses SET access = ? WHERE id = ?`, access, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UserCourses returns the ids of the courses granted to a user.
func (s *Store) UserCourses(ctx context.Context, userID int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT course_id FROM course_access WHERE user_id = ? ORDER BY course_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// Grants returns the granted courses of every user that has any.
func (s *Store) Grants(ctx context.Context) (map[int64][]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT user_id, course_id FROM course_access ORDER BY course_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]string{}
	for rows.Next() {
		var uid int64
		var id string
		if err := rows.Scan(&uid, &id); err != nil {
			return nil, err
		}
		out[uid] = append(out[uid], id)
	}
	return out, rows.Err()
}

// SetUserCourses replaces the courses granted to a user.
func (s *Store) SetUserCourses(ctx context.Context, userID int64, courses []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id = ?`, userID).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM course_access WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, id := range courses {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO course_access (course_id, user_id) SELECT id, ? FROM courses WHERE id = ?`, userID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// CourseUsers is the same grant relation as UserCourses, viewed from a course.
func (s *Store) CourseUsers(ctx context.Context, courseID string) ([]int64, error) {
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?)`, courseID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT user_id FROM course_access WHERE course_id = ? ORDER BY user_id`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetCourseUsers atomically replaces a course's grants. Unknown users are ignored,
// like unknown courses in SetUserCourses. Duplicate ids are harmless.
func (s *Store) SetCourseUsers(ctx context.Context, courseID string, users []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?)`, courseID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM course_access WHERE course_id = ?`, courseID); err != nil {
		return err
	}
	for _, id := range users {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO course_access (course_id, user_id) SELECT ?, id FROM users WHERE id = ?`, courseID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
