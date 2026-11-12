package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrInviteExpired   = errors.New("Срок приглашения истёк")
	ErrInviteExhausted = errors.New("Приглашение исчерпано")
	ErrInviteRevoked   = errors.New("Приглашение отозвано")
	ErrInviteMissing   = errors.New("Приглашение не найдено")
	ErrResetInvalid    = errors.New("Ссылка сброса недействительна или её срок истёк. Попроси админа выдать новую.")
	ErrUserDisabled    = errors.New("Сначала разблокируй пользователя")
)

type Invite struct {
	ID        int64    `json:"id"`
	Code      string   `json:"code"`
	Note      string   `json:"note"`
	Role      string   `json:"role"`
	Courses   []string `json:"courses"`
	MaxUses   *int64   `json:"maxUses"`
	Uses      int64    `json:"uses"`
	ExpiresAt string   `json:"expiresAt"`
	CreatedBy int64    `json:"createdBy"`
	CreatedAt string   `json:"createdAt"`
	RevokedAt string   `json:"revokedAt"`
	Status    string   `json:"status"`
	Users     []string `json:"users"`
}

func (i Invite) live() error {
	switch i.Status {
	case "revoked":
		return ErrInviteRevoked
	case "expired":
		return ErrInviteExpired
	case "exhausted":
		return ErrInviteExhausted
	}
	return nil
}

func scanInvite(row interface{ Scan(...any) error }) (Invite, error) {
	var i Invite
	var courses string
	err := row.Scan(&i.ID, &i.Code, &i.Note, &i.Role, &courses, &i.MaxUses, &i.Uses, &i.ExpiresAt, &i.CreatedBy, &i.CreatedAt, &i.RevokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return i, ErrInviteMissing
	}
	if err != nil {
		return i, err
	}
	if err = json.Unmarshal([]byte(courses), &i.Courses); err != nil {
		return i, err
	}
	i.Users = []string{}
	i.Status = "active"
	if i.MaxUses != nil && i.Uses >= *i.MaxUses {
		i.Status = "exhausted"
	}
	if i.ExpiresAt != "" && i.ExpiresAt <= now() {
		i.Status = "expired"
	}
	if i.RevokedAt != "" {
		i.Status = "revoked"
	}
	return i, nil
}

const inviteColumns = `id, code, note, role, courses, max_uses, uses, COALESCE(expires_at, ''), created_by, created_at, COALESCE(revoked_at, '')`

func randomCode(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Store) CreateInvite(ctx context.Context, i Invite) (Invite, error) {
	if i.Role != RoleStudent && i.Role != RoleAuthor {
		return Invite{}, errors.New("приглашение может дать только роль ученика или автора")
	}
	if i.MaxUses != nil && *i.MaxUses < 1 {
		return Invite{}, errors.New("число использований должно быть положительным")
	}
	var expires any
	if i.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, i.ExpiresAt)
		if err != nil || !t.After(time.Now()) {
			return Invite{}, errors.New("срок должен быть датой в будущем")
		}
		expires = t.UTC().Format(time.RFC3339)
	}
	code, err := randomCode(16)
	if err != nil {
		return Invite{}, err
	}
	if i.Courses == nil {
		i.Courses = []string{}
	}
	courses, err := json.Marshal(i.Courses)
	if err != nil {
		return Invite{}, err
	}
	return scanInvite(s.db.QueryRowContext(ctx, `INSERT INTO invites (code, note, role, courses, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING `+inviteColumns, code, i.Note, i.Role, string(courses), i.MaxUses, expires, i.CreatedBy, now()))
}

func (s *Store) InviteByCode(ctx context.Context, code string) (Invite, error) {
	i, err := scanInvite(s.db.QueryRowContext(ctx, `SELECT `+inviteColumns+` FROM invites WHERE code = ?`, code))
	if err != nil {
		return i, err
	}
	return i, i.live()
}

func (s *Store) Invites(ctx context.Context) ([]Invite, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+inviteColumns+` FROM invites ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	out := []Invite{}
	for rows.Next() {
		i, err := scanInvite(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, i)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for n := range out {
		rows, err := s.db.QueryContext(ctx, `SELECT name FROM users WHERE invite_id = ? ORDER BY id`, out[n].ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			out[n].Users = append(out[n].Users, name)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) RevokeInvite(ctx context.Context, id int64) error {
	return accountError(s.db.QueryRowContext(ctx, `UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? RETURNING id`, now(), id).Scan(&id))
}

func (s *Store) DeleteInvite(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, `DELETE FROM invites WHERE id = ? AND (revoked_at IS NOT NULL OR expires_at <= ? OR uses >= max_uses) RETURNING id`, id, now()).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrConflict
	}
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET invite_id = NULL WHERE invite_id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// Registration, access grants, bounded consumption and session creation commit together.
func (s *Store) RegisterInvite(ctx context.Context, code, login, name, password string, ttl time.Duration) (User, string, error) {
	login, err := CleanLogin(login)
	if err != nil {
		return User{}, "", err
	}
	name, err = CleanName(name)
	if err != nil {
		return User{}, "", err
	}
	if err = validatePassword(login, password); err != nil {
		return User{}, "", err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, "", err
	}
	defer tx.Rollback()
	// The first statement takes SQLite's writer lock even across separate Store instances.
	var id int64
	err = tx.QueryRowContext(ctx, `UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses) RETURNING id`, code, now()).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		i, e := scanInvite(tx.QueryRowContext(ctx, `SELECT `+inviteColumns+` FROM invites WHERE code = ?`, code))
		if e != nil {
			return User{}, "", e
		}
		if err := i.live(); err != nil {
			return User{}, "", err
		}
		return User{}, "", ErrConflict
	}
	if err != nil {
		return User{}, "", err
	}
	i, err := scanInvite(tx.QueryRowContext(ctx, `SELECT `+inviteColumns+` FROM invites WHERE id = ?`, id))
	if err != nil {
		return User{}, "", err
	}
	if i.Role != RoleStudent && i.Role != RoleAuthor {
		return User{}, "", ErrInviteRevoked
	}
	u := User{Login: login, Name: name, Role: i.Role, InviteID: id}
	err = tx.QueryRowContext(ctx, `INSERT INTO users (login, name, password_hash, role, invite_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, login, name, hash, i.Role, id, now(), now()).Scan(&u.ID)
	if err != nil {
		return User{}, "", accountError(err)
	}
	for _, course := range i.Courses {
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO course_access (course_id, user_id) SELECT id, ? FROM courses WHERE id = ?`, u.ID, course); err != nil {
			return User{}, "", err
		}
	}
	token, err := sessionInTx(ctx, tx, u.ID, ttl)
	if err != nil {
		return User{}, "", err
	}
	if err = tx.Commit(); err != nil {
		return User{}, "", err
	}
	return u, token, nil
}

func sessionInTx(ctx context.Context, tx *sql.Tx, id int64, ttl time.Duration) (string, error) {
	token, err := randomCode(32)
	if err != nil {
		return "", err
	}
	created := time.Now().UTC()
	_, err = tx.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, tokenHash(token), id, created.Format(time.RFC3339), created.Add(ttl).Format(time.RFC3339))
	return token, err
}
