package store

import (
	"context"
	"encoding/json"
	"fmt"
)

// Stable action names are shared by HTTP handlers and console recovery.
const (
	AuditUserCreated     = "user.created"
	AuditUserCourseLimit = "user.course_limit"
	AuditUserRole        = "user.role"
	AuditUserDisabled    = "user.disabled"
	AuditUserEnabled     = "user.enabled"
	AuditUserLogin       = "user.login"
	AuditResetLink       = "user.reset_link"
	AuditPasswordReset   = "user.password_reset"
	AuditInviteCreated   = "invite.created"
	AuditInviteRevoked   = "invite.revoked"
	AuditInviteDeleted   = "invite.deleted"
	AuditRegistered      = "user.registered"
	AuditUserCourses     = "user.courses"
	AuditCourseUsers     = "course.users"
	AuditCourseAccess    = "course.access"
	AuditCourseOwner     = "course.owner"
	AuditTokenCreated    = "token.created"
	AuditTokenRevoked    = "token.revoked"
	AuditTokenDeleted    = "token.deleted"
	AuditTokenReview     = "token.review"
)

type AuditEntry struct {
	ID      int64           `json:"id"`
	At      string          `json:"at"`
	Actor   string          `json:"actor"`
	Action  string          `json:"action"`
	Target  string          `json:"target"`
	Details json.RawMessage `json:"details"`
}

func UserActor(u User) string                 { return fmt.Sprintf("%s (#%d)", u.Name, u.ID) }
func UserTarget(id int64, name string) string { return fmt.Sprintf("%s (#%d)", name, id) }

// Audit only accepts explicitly selected metadata from callers, never request bodies,
// passwords, hashes, invitation codes, reset links or agent token secrets.
// Call after the action commits; an audit failure must not undo that action.
func (s *Store) Audit(ctx context.Context, actor, action, target string, details any) error {
	if details == nil {
		details = struct{}{}
	}
	data, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO audit (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)`, now(), actor, action, target, string(data))
	return err
}

// AuditEntries returns the newest entries; id breaks ties within the same second.
func (s *Store) AuditEntries(ctx context.Context, action string, limit int) ([]AuditEntry, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, at, actor, action, target, details FROM audit WHERE (? = '' OR action = ?) ORDER BY at DESC, id DESC LIMIT ?`, action, action, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		var data string
		if err := rows.Scan(&a.ID, &a.At, &a.Actor, &a.Action, &a.Target, &data); err != nil {
			return nil, err
		}
		a.Details = json.RawMessage(data)
		out = append(out, a)
	}
	return out, rows.Err()
}
