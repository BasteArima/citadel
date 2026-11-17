package store

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestUserSearchIndexesAndUpdates(t *testing.T) {
	s, ctx := open(t), context.Background() // Use the production candidate query: both branches must be range searches,
	// rather than scans of either index or the users table.
	rows, err := s.db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+userPrefixIDs, "al%", "ал%")
	if err != nil {
		t.Fatal(err)
	}
	var plan strings.Builder
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintln(&plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	for _, index := range []string{"users_login", "users_name_search"} {
		if !strings.Contains(plan.String(), index+" (") {
			t.Fatalf("no index range on %s: %s", index, plan.String())
		}
	}
	if strings.Contains(plan.String(), "SCAN users") {
		t.Fatal(plan.String())
	}
	u, err := s.CreateUser(ctx, "aleksey", "АЛЕКСЕЙ", "search-test-password", RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	users, err := s.SearchUsers(ctx, "ал", 10, false)
	if err != nil || len(users) != 1 || users[0].ID != u.ID {
		t.Fatalf("Cyrillic: %+v %v", users, err)
	}
	if err := s.SetName(ctx, u.ID, "Борис"); err != nil {
		t.Fatal(err)
	}
	users, err = s.SearchUsers(ctx, "БО", 10, true)
	if err != nil || len(users) != 1 {
		t.Fatalf("renamed: %+v %v", users, err)
	}
	users, err = s.SearchUsers(ctx, "ал", 10, false)
	if err != nil || len(users) != 0 {
		t.Fatalf("old name: %+v %v", users, err)
	}
}

func TestSearchNameMigration(t *testing.T) {
	s, ctx := open(t), context.Background()
	// Recreate the previous migration boundary with an existing Unicode name.
	if _, err := s.db.Exec(`DROP INDEX users_name_search; ALTER TABLE users DROP COLUMN name_search;
 UPDATE schema_version SET version = 13; INSERT INTO users (name, role, created_at) VALUES ('ИВАН', 'student', 'old')`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	users, err := s.SearchUsers(ctx, "ив", 10, false)
	if err != nil || len(users) != 1 || users[0].Name != "ИВАН" {
		t.Fatalf("backfill: %+v %v", users, err)
	}
}
