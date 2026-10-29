package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// Roles.
const (
	RoleStudent = "student"
	RoleAdmin   = "admin"
)

// User is a person who signs in by name.
type User struct {
	ID   int64  `json:"-"`
	Name string `json:"name"`
	Role string `json:"role"`
}

// ErrNoSession means the token is unknown or expired.
var ErrNoSession = errors.New("no session")

// SignIn finds the user by name (case-insensitive) or creates one. A name from CITADEL_ADMINS
// (configAdmin) is always an admin; anyone else keeps the role given in the admin panel,
// a new user starts as a student.
func (s *Store) SignIn(ctx context.Context, name string, configAdmin bool) (User, error) {
	role := RoleStudent
	if configAdmin {
		role = RoleAdmin
	}
	var u User
	t := now()
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO users (name, role, created_at, last_seen_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (name) DO UPDATE SET
			role = CASE WHEN ? THEN 'admin' ELSE users.role END,
			last_seen_at = excluded.last_seen_at
		RETURNING id, name, role`, name, role, t, t, configAdmin).Scan(&u.ID, &u.Name, &u.Role)
	return u, err
}

// UserInfo is a user as the admin list sees it.
type UserInfo struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Created  string `json:"createdAt"`
	LastSeen string `json:"lastSeenAt"`
}

// Users lists everyone who has signed in.
func (s *Store) Users(ctx context.Context) ([]UserInfo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, role, created_at, COALESCE(last_seen_at, '') FROM users ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserInfo
	for rows.Next() {
		var u UserInfo
		if err := rows.Scan(&u.ID, &u.Name, &u.Role, &u.Created, &u.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetRole changes a user's role.
func (s *Store) SetRole(ctx context.Context, id int64, role string) error {
	if role != RoleAdmin && role != RoleStudent {
		return fmt.Errorf("unknown role %q", role)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, role, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateSession returns a new random session token for the user. Only its hash is stored.
func (s *Store) CreateSession(ctx context.Context, userID int64, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	n := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, n.Format(time.RFC3339)); err != nil {
		return "", err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		tokenHash(token), userID, n.Format(time.RFC3339), n.Add(ttl).Format(time.RFC3339))
	return token, err
}

// UserBySession returns the user of a live session.
func (s *Store) UserBySession(ctx context.Context, token string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash(token), now()).Scan(&u.ID, &u.Name, &u.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNoSession
	}
	return u, err
}

// DeleteSession ends a session.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash(token))
	return err
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
