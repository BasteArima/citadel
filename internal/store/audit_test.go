package store

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"citadel/internal/course"
)

func TestAuditHistory(t *testing.T) {
	s, ctx := open(t), context.Background()
	for n := range 205 {
		action := AuditUserRole
		if n%2 == 0 {
			action = AuditUserDisabled
		}
		if err := s.Audit(ctx, "console", action, fmt.Sprint(n), map[string]string{"after": RoleAuthor}); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := s.AuditEntries(ctx, "", 0)
	if err != nil || len(entries) != 200 || entries[0].Target != "204" || entries[199].Target != "5" {
		t.Fatalf("default limit/order: %d %v", len(entries), err)
	}
	entries, err = s.AuditEntries(ctx, AuditUserDisabled, 2)
	if err != nil || len(entries) != 2 || entries[0].Target != "204" || entries[1].Target != "202" {
		t.Fatalf("filtered order: %+v %v", entries, err)
	}
	entries, err = s.AuditEntries(ctx, "unknown", 20)
	if err != nil || entries == nil || len(entries) != 0 {
		t.Fatal("empty result must be a JSON array")
	}
	if err := s.Audit(ctx, "console", AuditUserRole, "bad", make(chan int)); err == nil {
		t.Fatal("invalid JSON details accepted")
	}
}

func TestSetCourseUsersReplacesSameRelation(t *testing.T) {
	s, ctx := open(t), context.Background()
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Go")}); err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateUser(ctx, "alice", "Алиса", "test-password-long", RoleStudent)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateUser(ctx, "boris", "Борис", "test-password-long", RoleAuthor)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetCourseUsers(ctx, "go", []int64{a.ID, b.ID, a.ID, 99999}); err != nil {
		t.Fatal(err)
	}
	ids, err := s.CourseUsers(ctx, "go")
	if err != nil || !reflect.DeepEqual(ids, []int64{a.ID, b.ID}) {
		t.Fatalf("course users: %v %v", ids, err)
	}
	for _, u := range []User{a, b} {
		courses, err := s.UserCourses(ctx, u.ID)
		if err != nil || !reflect.DeepEqual(courses, []string{"go"}) {
			t.Fatalf("user grants: %v %v", courses, err)
		}
	}
	if err := s.SetUserCourses(ctx, a.ID, nil); err != nil {
		t.Fatal(err)
	}
	ids, _ = s.CourseUsers(ctx, "go")
	if !reflect.DeepEqual(ids, []int64{b.ID}) {
		t.Fatalf("user-side revoke: %v", ids)
	}
	if err := s.SetCourseUsers(ctx, "missing", []int64{a.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing course accepted")
	}
	ids, _ = s.CourseUsers(ctx, "go")
	if !reflect.DeepEqual(ids, []int64{b.ID}) {
		t.Fatal("failed update changed grants")
	}
	for _, access := range []string{AccessPrivate, AccessPublic, AccessPrivate} {
		if err := s.SetCourseAccess(ctx, "go", access); err != nil {
			t.Fatal(err)
		}
	}
	ids, _ = s.CourseUsers(ctx, "go")
	if !reflect.DeepEqual(ids, []int64{b.ID}) {
		t.Fatal("changing access lost saved grants")
	}
	if err := s.SetCourseUsers(ctx, "go", nil); err != nil {
		t.Fatal(err)
	}
	courses, _ := s.UserCourses(ctx, b.ID)
	if len(courses) != 0 {
		t.Fatal("course-side revoke did not change user grants")
	}
}
