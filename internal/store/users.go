package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
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

// SignIn finds the user by name (case-insensitive) or creates one, and sets the role.
// The role comes from the server config on every sign-in, so it follows CITADEL_ADMINS.
func (s *Store) SignIn(ctx context.Context, name, role string) (User, error) {
	var u User
	t := now()
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO users (name, role, created_at, last_seen_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (name) DO UPDATE SET role = excluded.role, last_seen_at = excluded.last_seen_at
		RETURNING id, name, role`, name, role, t, t).Scan(&u.ID, &u.Name, &u.Role)
	return u, err
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
