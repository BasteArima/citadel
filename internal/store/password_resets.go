package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// CreatePasswordReset assigns a missing legacy login and invalidates previous links atomically.
func (s *Store) CreatePasswordReset(ctx context.Context, id, createdBy int64, login string) (string, error) {
	if login != "" {
		var err error
		login, err = CleanLogin(login)
		if err != nil {
			return "", err
		}
	}
	token, err := randomCode(32)
	if err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, now(), id); err != nil {
		return "", err
	}
	var current, disabled string
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(login, ''), COALESCE(disabled_at, '') FROM users WHERE id = ?`, id).Scan(&current, &disabled)
	if err != nil {
		return "", accountError(err)
	}
	if disabled != "" {
		return "", ErrUserDisabled
	}
	if current == "" {
		if login == "" {
			return "", errors.New("сначала задай логин")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE users SET login = ? WHERE id = ?`, login, id); err != nil {
			return "", accountError(err)
		}
	} else if login != "" && current != login {
		return "", errors.New("логин уже задан")
	}
	created := time.Now().UTC()
	_, err = tx.ExecContext(ctx, `INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`, tokenHash(token), id, createdBy, created.Format(time.RFC3339), created.Add(24*time.Hour).Format(time.RFC3339))
	if err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return token, nil
}

// ApplyPasswordReset consumes the link, replaces the password and all sessions in one transaction.
func (s *Store) ApplyPasswordReset(ctx context.Context, token, password string, ttl time.Duration) (User, string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, "", err
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(ctx, `UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM users WHERE id = user_id AND disabled_at IS NULL) RETURNING user_id`, now(), tokenHash(token), now()).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrResetInvalid
	}
	if err != nil {
		return User{}, "", err
	}
	var u User
	err = tx.QueryRowContext(ctx, `SELECT id, name, role, COALESCE(login, '') FROM users WHERE id = ?`, id).Scan(&u.ID, &u.Name, &u.Role, &u.Login)
	if err != nil {
		return User{}, "", err
	}
	if u.Login == "" {
		return User{}, "", ErrResetInvalid
	}
	if err = validatePassword(u.Login, password); err != nil {
		return User{}, "", err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, "", err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET password_hash = ?, last_seen_at = ? WHERE id = ?`, hash, now(), id); err != nil {
		return User{}, "", err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
		return User{}, "", err
	}
	session, err := sessionInTx(ctx, tx, id, ttl)
	if err != nil {
		return User{}, "", err
	}
	if err = tx.Commit(); err != nil {
		return User{}, "", err
	}
	return u, session, nil
}
