package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"path/filepath"
)

// SQLite's application_id persists in the database file, including backups.
// Only dev-seed sets this marker; opening a normal store never marks it.
const developmentApplicationID = 0x43495444 // CITD

func (s *Store) MarkDevelopment(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, fmt.Sprintf("PRAGMA application_id = %d", developmentApplicationID))
	return err
}

// IsDevelopmentDatabase inspects a closed file without migrations or writes.
// Ignoring a live WAL is deliberate: an uncertain marker must fail closed.
func IsDevelopmentDatabase(ctx context.Context, path string) (bool, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(abs), RawQuery: "mode=ro&immutable=1"}
	if filepath.VolumeName(abs) != "" {
		u.Path = "/" + u.Path
	}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return false, err
	}
	defer db.Close()
	var id int
	err = db.QueryRowContext(ctx, "PRAGMA application_id").Scan(&id)
	return err == nil && id == developmentApplicationID, err
}
