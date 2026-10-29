// Package store keeps Citadel data in SQLite: course versions, users, sessions and progress.
// One file, WAL mode, one writer at a time — see docs/dev/decisions/0002.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"time"

	_ "modernc.org/sqlite"
)

// Store is the database.
type Store struct {
	db *sql.DB
}

// Open opens (or creates) the database file and applies migrations.
func Open(path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite writes one transaction at a time; a single connection keeps it simple and safe.
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// migrations are applied in order; the index + 1 is the schema version. Never edit an applied one.
var migrations = []string{
	`CREATE TABLE courses (
		id                TEXT PRIMARY KEY,
		published_version INTEGER,
		created_at        TEXT NOT NULL
	);
	CREATE TABLE course_versions (
		course_id  TEXT NOT NULL REFERENCES courses(id),
		version    INTEGER NOT NULL,
		data       TEXT NOT NULL,
		hash       TEXT NOT NULL,
		author     TEXT NOT NULL,
		note       TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		PRIMARY KEY (course_id, version)
	);
	CREATE TABLE users (
		id           INTEGER PRIMARY KEY,
		name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
		role         TEXT NOT NULL DEFAULT 'student',
		created_at   TEXT NOT NULL,
		last_seen_at TEXT
	);
	CREATE TABLE sessions (
		token_hash TEXT PRIMARY KEY,
		user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL,
		expires_at TEXT NOT NULL
	);
	CREATE INDEX sessions_user ON sessions(user_id);
	CREATE TABLE progress (
		user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		course_id TEXT NOT NULL,
		key       TEXT NOT NULL,
		value     TEXT NOT NULL,
		at        INTEGER NOT NULL,
		PRIMARY KEY (user_id, course_id, key)
	);`,
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	var v int
	err := s.db.QueryRowContext(ctx, `SELECT version FROM schema_version`).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO schema_version (version) VALUES (0)`); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if v > len(migrations) {
		return fmt.Errorf("database schema %d is newer than this program (%d)", v, len(migrations))
	}
	for i := v; i < len(migrations); i++ {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE schema_version SET version = ?`, i+1); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// Backup writes a consistent copy of the database to path while it is in use.
// VACUUM INTO goes through SQLite itself, unlike copying the file, so a write
// in progress cannot leave the copy half-done.
func (s *Store) Backup(ctx context.Context, path string) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("%s already exists", path)
	}
	_, err := s.db.ExecContext(ctx, `VACUUM INTO ?`, path)
	return err
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }
