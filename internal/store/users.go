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
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Roles.
const (
	RoleStudent = "student"
	RoleAuthor  = "author"
	RoleAdmin   = "admin"
)

// User is a person with a persistent account.
type User struct {
	ID           int64  `json:"-"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	Login        string `json:"login"`
	InviteID     int64  `json:"-"`
	passwordHash string // authentication snapshot; never serialized
}

// ErrNoSession means the token is unknown or expired.
var ErrNoSession = errors.New("no session")

var loginPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)

func CleanLogin(login string) (string, error) {
	login = strings.ToLower(login)
	if !loginPattern.MatchString(login) {
		return "", errors.New("логин — 3–32 символа: латиница, цифры, точка, дефис, подчёркивание; первый символ — буква или цифра")
	}
	return login, nil
}

func CleanName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 40 {
		return "", errors.New("имя — от 1 до 40 символов")
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && !strings.ContainsRune(" .-_", r) {
			return "", errors.New("имя — буквы, цифры, пробелы, точки, дефисы или подчёркивания")
		}
	}
	return name, nil
}

func validRole(role string) bool {
	return role == RoleAdmin || role == RoleAuthor || role == RoleStudent
}

func (s *Store) CreateUser(ctx context.Context, login, name, password, role string) (User, error) {
	login, err := CleanLogin(login)
	if err != nil {
		return User{}, err
	}
	name, err = CleanName(name)
	if err != nil {
		return User{}, err
	}
	if !validRole(role) {
		return User{}, errors.New("unknown role")
	}
	if err := validatePassword(login, password); err != nil {
		return User{}, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	u := User{Name: name, Login: login, Role: role}
	err = s.db.QueryRowContext(ctx, `INSERT INTO users (login, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`, login, name, hash, role, now()).Scan(&u.ID)
	return u, accountError(err)
}

func accountError(err error) error {
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return ErrConflict
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (s *Store) Authenticate(ctx context.Context, login, password string) (User, error) {
	var u User
	var hash, disabled string
	err := s.db.QueryRowContext(ctx, `SELECT id, name, role, login, COALESCE(password_hash, ''), COALESCE(disabled_at, '') FROM users WHERE login = ?`, strings.ToLower(login)).Scan(&u.ID, &u.Name, &u.Role, &u.Login, &hash, &disabled)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return User{}, err
	}
	if hash == "" {
		hash = dummyPasswordHash
	}
	match := CheckPassword(hash, password)
	if err != nil || !match || disabled != "" {
		return User{}, ErrCredentials
	}
	_, err = s.db.ExecContext(ctx, `UPDATE users SET last_seen_at = ? WHERE id = ?`, now(), u.ID)
	u.passwordHash = hash
	return u, err
}

func (s *Store) UserByLogin(ctx context.Context, login string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `SELECT id, name, role, login FROM users WHERE login = ?`, strings.ToLower(login)).Scan(&u.ID, &u.Name, &u.Role, &u.Login)
	return u, accountError(err)
}

func (s *Store) SetLogin(ctx context.Context, id int64, login string) error {
	login, err := CleanLogin(login)
	if err != nil {
		return err
	}
	return accountError(s.db.QueryRowContext(ctx, `UPDATE users SET login = ? WHERE id = ? RETURNING id`, login, id).Scan(&id))
}

func (s *Store) SetName(ctx context.Context, id int64, name string) error {
	name, err := CleanName(name)
	if err != nil {
		return err
	}
	return accountError(s.db.QueryRowContext(ctx, `UPDATE users SET name = ? WHERE id = ? RETURNING id`, name, id).Scan(&id))
}

// SetPassword is a console reset. Password and session revocation commit together.
func (s *Store) SetPassword(ctx context.Context, id int64, password string) error {
	return s.replacePassword(ctx, id, "", password, "", false)
}

func (s *Store) ChangePassword(ctx context.Context, id int64, old, password, keepSession string) error {
	return s.replacePassword(ctx, id, old, password, keepSession, true)
}

func (s *Store) replacePassword(ctx context.Context, id int64, old, password, keep string, checkOld bool) error {
	var login, previous string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(login, ''), COALESCE(password_hash, '') FROM users WHERE id = ?`, id).Scan(&login, &previous)
	if err != nil {
		return accountError(err)
	}
	if login == "" {
		return errors.New("сначала задай логин")
	}
	if checkOld && !CheckPassword(previous, old) {
		return ErrCredentials
	}
	if err := validatePassword(login, password); err != nil {
		return err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Compare-and-swap prevents a simultaneous reset from accepting a stale password.
	res, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ? AND COALESCE(password_hash, '') = ? AND login = ?`, hash, id, previous, login)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, id, tokenHash(keep)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, now(), id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteUserSessions(ctx context.Context, id int64, keep string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, id, tokenHash(keep))
	return err
}

// SetDisabled also revokes all sessions. The last active admin is protected atomically.
func (s *Store) SetDisabled(ctx context.Context, id int64, disabled bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var at any
	if disabled {
		if _, err := tx.ExecContext(ctx, `UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, now(), id); err != nil {
			return err
		}
		at = now()
	}
	res, err := tx.ExecContext(ctx, `UPDATE users SET disabled_at = ? WHERE id = ? AND (? = 0 OR role != 'admin' OR disabled_at IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id != ?))`, at, id, disabled, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return ErrConflict
	}
	if disabled {
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) HasSignInAdmin(ctx context.Context) (bool, error) {
	var ok bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE role = 'admin' AND disabled_at IS NULL AND login IS NOT NULL AND COALESCE(password_hash, '') != '')`).Scan(&ok)
	return ok, err
}

// UserInfo is a user as the admin list sees it.
type UserInfo struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	Created    string `json:"createdAt"`
	LastSeen   string `json:"lastSeenAt"`
	Login      string `json:"login"`
	DisabledAt string `json:"disabledAt"`
}

// Users lists everyone who has signed in.
func (s *Store) Users(ctx context.Context) ([]UserInfo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, role, created_at, COALESCE(last_seen_at, ''), COALESCE(login, ''), COALESCE(disabled_at, '') FROM users ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserInfo
	for rows.Next() {
		var u UserInfo
		if err := rows.Scan(&u.ID, &u.Name, &u.Role, &u.Created, &u.LastSeen, &u.Login, &u.DisabledAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetRole changes a user's role.
func (s *Store) SetRole(ctx context.Context, id int64, role string) error {
	if !validRole(role) {
		return fmt.Errorf("unknown role %q", role)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ? AND (? = 'admin' OR role != 'admin' OR disabled_at IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id != ?))`, role, id, role, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return ErrConflict
	}
	return nil
}

// CreateSession returns a new random session token for the user. Only its hash is stored.
func (s *Store) CreateSession(ctx context.Context, userID int64, ttl time.Duration) (string, error) {
	return s.createSession(ctx, userID, ttl, nil)
}

// CreateAuthenticatedSession rejects a password reset that raced authentication.
func (s *Store) CreateAuthenticatedSession(ctx context.Context, u User, ttl time.Duration) (string, error) {
	if u.passwordHash == "" {
		return "", ErrCredentials
	}
	return s.createSession(ctx, u.ID, ttl, u.passwordHash)
}

func (s *Store) createSession(ctx context.Context, userID int64, ttl time.Duration, expectedHash any) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	n := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, n.Format(time.RFC3339)); err != nil {
		return "", err
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) SELECT ?, id, ?, ? FROM users WHERE id = ? AND disabled_at IS NULL AND (? IS NULL OR password_hash = ?)`,
		tokenHash(token), n.Format(time.RFC3339), n.Add(ttl).Format(time.RFC3339), userID, expectedHash, expectedHash)
	if err == nil {
		if count, _ := res.RowsAffected(); count != 1 {
			return "", ErrCredentials
		}
	}
	return token, err
}

// UserBySession returns the user of a live session.
func (s *Store) UserBySession(ctx context.Context, token string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.name, u.role, COALESCE(u.login, '') FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`, tokenHash(token), now()).Scan(&u.ID, &u.Name, &u.Role, &u.Login)
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
