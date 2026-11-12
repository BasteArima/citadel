package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Agent tokens and proposals (decision 0003). A token is shown once; only its hash is stored.
// An agent's edit is a proposal: the admin accepts it into the draft or rejects it.

// TokenPrefix starts every agent token, so a leaked one is easy to recognise.
const TokenPrefix = "cit_"

// ErrNoToken means the token is unknown or revoked.
var ErrNoToken = errors.New("no such token")

// Token is an agent token without its secret.
type Token struct {
	UserID     int64    `json:"userId"`
	UserRole   string   `json:"-"`
	ID         int64    `json:"id"`
	Name       string   `json:"name"`
	Tail       string   `json:"tail"` // last characters, to tell tokens apart
	CanPropose bool     `json:"canPropose"`
	CanCreate  bool     `json:"canCreate"`
	CanReview  bool     `json:"canReview"` // may decide other agents' proposals and publish (decision 0019)
	Courses    []string `json:"courses"`   // empty — all courses
	CreatedBy  string   `json:"createdBy"`
	CreatedAt  string   `json:"createdAt"`
	LastUsedAt string   `json:"lastUsedAt"`
	RevokedAt  string   `json:"revokedAt"`
}

// CreateToken stores a new token and returns it with its secret, the only time the secret exists.
func (s *Store) CreateToken(ctx context.Context, t Token) (Token, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return Token{}, "", err
	}
	secret := TokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	t.Tail = secret[len(secret)-4:]
	t.CreatedAt = now()
	res, err := s.db.ExecContext(ctx, `INSERT INTO tokens (name, hash, tail, can_propose, can_create, can_review, courses, created_by, created_at, user_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, t.Name, tokenHash(secret), t.Tail, t.CanPropose, t.CanCreate, t.CanReview, strings.Join(t.Courses, ","), t.CreatedBy, t.CreatedAt, nullableID(t.UserID))
	if err != nil {
		return Token{}, "", err
	}
	t.ID, _ = res.LastInsertId()
	if t.Courses == nil {
		t.Courses = []string{}
	}
	return t, secret, nil
}

const tokenCols = `id, name, tail, can_propose, can_create, can_review, courses, created_by, created_at, COALESCE(last_used_at, ''), COALESCE(revoked_at, ''), COALESCE(user_id, 0)`

func scanToken(sc interface{ Scan(...any) error }) (Token, error) {
	var t Token
	var courses string
	err := sc.Scan(&t.ID, &t.Name, &t.Tail, &t.CanPropose, &t.CanCreate, &t.CanReview, &courses, &t.CreatedBy, &t.CreatedAt, &t.LastUsedAt, &t.RevokedAt, &t.UserID)
	t.Courses = []string{}
	if courses != "" {
		t.Courses = strings.Split(courses, ",")
	}
	return t, err
}

// TokenBySecret returns a live token and marks it used (at most once a minute, to spare writes).
func (s *Store) TokenBySecret(ctx context.Context, secret string) (Token, error) {
	if !strings.HasPrefix(secret, TokenPrefix) {
		return Token{}, ErrNoToken
	}
	t, err := scanToken(s.db.QueryRowContext(ctx, `SELECT `+tokenCols+` FROM tokens WHERE hash = ? AND revoked_at IS NULL`, tokenHash(secret)))
	if errors.Is(err, sql.ErrNoRows) {
		return Token{}, ErrNoToken
	}
	if err != nil {
		return Token{}, err
	}
	if t.UserID != 0 {
		u, err := s.UserInfoByID(ctx, t.UserID)
		if err != nil || u.DisabledAt != "" || (u.Role != RoleAdmin && u.Role != RoleAuthor) {
			return Token{}, ErrNoToken
		}
		t.UserRole = u.Role
	}
	n := time.Now().UTC()
	if last, err := time.Parse(time.RFC3339, t.LastUsedAt); err != nil || n.Sub(last) > time.Minute {
		t.LastUsedAt = n.Format(time.RFC3339)
		if _, err := s.db.ExecContext(ctx, `UPDATE tokens SET last_used_at = ? WHERE id = ?`, t.LastUsedAt, t.ID); err != nil {
			return Token{}, err
		}
	}
	return t, nil
}

// Tokens lists all tokens, revoked last.
func (s *Store) Tokens(ctx context.Context) ([]Token, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+tokenCols+` FROM tokens ORDER BY revoked_at IS NOT NULL, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Token{}
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RevokeToken makes a token unusable at once. Its proposals stay in the queue.
func (s *Store) RevokeToken(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetTokenReview gives a live token the right to decide proposals and publish, or takes it away.
func (s *Store) SetTokenReview(ctx context.Context, id int64, review bool) error {
	res, err := s.db.ExecContext(ctx, `UPDATE tokens SET can_review = ? WHERE id = ? AND revoked_at IS NULL`, review, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteToken removes a revoked token and its decided proposals. A token that still works, or has
// proposals waiting for a decision, is a conflict: nothing is lost silently.
func (s *Store) DeleteToken(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var revoked sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT revoked_at FROM tokens WHERE id = ?`, id).Scan(&revoked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if !revoked.Valid || revoked.String == "" {
		return fmt.Errorf("token is not revoked: %w", ErrConflict)
	}
	var pending int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM proposals WHERE token_id = ? AND status = ?`, id, ProposalPending).Scan(&pending); err != nil {
		return err
	}
	if pending > 0 {
		return fmt.Errorf("token has proposals waiting for a decision: %w", ErrConflict)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM proposals WHERE token_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM tokens WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// Proposal statuses.
const (
	ProposalPending  = "pending"
	ProposalAccepted = "accepted"
	ProposalRejected = "rejected"
	ProposalInvalid  = "invalid" // the server check found errors: it cannot be accepted
)

// Proposal is an agent's edit waiting for the admin.
type Proposal struct {
	OwnerID     int64           `json:"ownerId"`
	ID          int64           `json:"id"`
	CourseID    string          `json:"course"`
	TokenID     int64           `json:"tokenId"`
	Agent       string          `json:"agent"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	NewCourse   bool            `json:"newCourse"`
	Base        int             `json:"base"`              // the version the changes were made against; 0 for a new course
	Changes     json.RawMessage `json:"changes,omitempty"` // []course.Change; null for a new course
	Data        json.RawMessage `json:"-"`                 // the course after the changes, as of submission
	Status      string          `json:"status"`
	Checks      json.RawMessage `json:"checks"` // the server check summary
	Comment     string          `json:"comment"`
	DecidedBy   string          `json:"decidedBy"`
	DecidedAt   string          `json:"decidedAt"`
	Version     int             `json:"version"` // the draft version made on accept
	CreatedAt   string          `json:"createdAt"`
	Runs        json.RawMessage `json:"runs,omitempty"` // server runs of its «predict» blocks; empty — not run (yet)
}

// AddProposal stores a proposal and returns its id.
func (s *Store) AddProposal(ctx context.Context, p Proposal) (int64, error) {
	changes := string(p.Changes)
	if changes == "" {
		changes = "null"
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO proposals (course_id, token_id, agent, title, description, new_course, base, changes, data, status, checks, created_at, owner_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.CourseID, p.TokenID, p.Agent, p.Title, p.Description, p.NewCourse, p.Base, changes, string(p.Data), p.Status, string(p.Checks), now(), nullableID(p.OwnerID))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

const proposalCols = `id, course_id, token_id, agent, title, description, new_course, base, changes, status, checks, comment, decided_by, decided_at, version, created_at, runs, COALESCE(owner_id, 0)`

func scanProposal(sc interface{ Scan(...any) error }, withData bool) (Proposal, error) {
	var p Proposal
	var changes, checks, data, runs string
	dest := []any{&p.ID, &p.CourseID, &p.TokenID, &p.Agent, &p.Title, &p.Description, &p.NewCourse, &p.Base, &changes, &p.Status, &checks, &p.Comment, &p.DecidedBy, &p.DecidedAt, &p.Version, &p.CreatedAt, &runs, &p.OwnerID}
	if withData {
		dest = append(dest, &data)
	}
	if err := sc.Scan(dest...); err != nil {
		return p, err
	}
	p.Changes, p.Checks, p.Data = json.RawMessage(changes), json.RawMessage(checks), json.RawMessage(data)
	if runs != "" {
		p.Runs = json.RawMessage(runs)
	}
	return p, nil
}

// Proposal returns one proposal with the course data.
func (s *Store) Proposal(ctx context.Context, id int64) (Proposal, error) {
	p, err := scanProposal(s.db.QueryRowContext(ctx, `SELECT `+proposalCols+`, data FROM proposals WHERE id = ?`, id), true)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// ProposalFilter narrows Proposals; zero values match everything.
type ProposalFilter struct {
	OwnerID int64 // apply ownership before the shared result limit
	Status  string
	TokenID int64
}

// Proposals lists proposals without their course data, newest first; pending ones go first.
func (s *Store) Proposals(ctx context.Context, f ProposalFilter) ([]Proposal, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+proposalCols+` FROM proposals
		WHERE (? = '' OR status = ?) AND (? = 0 OR token_id = ?)
 AND (? = 0 OR EXISTS (SELECT 1 FROM courses c WHERE c.id = proposals.course_id AND c.owner_id = ?)
 OR (new_course = 1 AND owner_id = ? AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = proposals.course_id)))
		ORDER BY status != 'pending', id DESC LIMIT 500`, f.Status, f.Status, f.TokenID, f.TokenID, f.OwnerID, f.OwnerID, f.OwnerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Proposal{}
	for rows.Next() {
		p, err := scanProposal(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DecideProposal closes a pending or invalid proposal: accepted (with the version it became)
// or rejected with a comment. A proposal is decided once.
func (s *Store) DecideProposal(ctx context.Context, id int64, status, by, comment string, version int) error {
	res, err := s.db.ExecContext(ctx, `UPDATE proposals SET status = ?, decided_by = ?, decided_at = ?, comment = ?, version = ?
		WHERE id = ? AND status IN ('pending', 'invalid')`, status, by, now(), comment, version, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrConflict
	}
	return nil
}

// PendingByCourse counts proposals waiting for the admin, by course.
func (s *Store) PendingByCourse(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT course_id, COUNT(*) FROM proposals WHERE status = 'pending' GROUP BY course_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// AcceptProposal stores data as a new draft version on top of base (or as a new unpublished
// course) and marks the proposal accepted, in one transaction: a proposal never becomes two versions.
func (s *Store) AcceptProposal(ctx context.Context, id int64, courseID string, data []byte, base int, author, note, by string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var last int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM course_versions WHERE course_id = ?`, courseID).Scan(&last); err != nil {
		return 0, err
	}
	if last != base {
		return 0, ErrConflict
	}
	if base == 0 {
		var ownerID int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(owner_id, 0) FROM proposals WHERE id = ?`, id).Scan(&ownerID); err != nil {
			return 0, err
		}
		if err := insertOwnedCourse(ctx, tx, courseID, ownerID); err != nil {
			return 0, err
		}
	}
	if err := insertVersion(ctx, tx, courseID, last+1, data, author, note); err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `UPDATE proposals SET status = 'accepted', decided_by = ?, decided_at = ?, version = ?
		WHERE id = ? AND status = 'pending'`, by, now(), last+1, id)
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, ErrConflict
	}
	return last + 1, tx.Commit()
}

// SetProposalRuns stores the results of running a proposal's «predict» blocks.
func (s *Store) SetProposalRuns(ctx context.Context, id int64, runs []byte) error {
	_, err := s.db.ExecContext(ctx, `UPDATE proposals SET runs = ? WHERE id = ?`, string(runs), id)
	return err
}
