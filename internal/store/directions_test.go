package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"citadel/internal/course"
)

func TestDirections(t *testing.T) {
	s, ctx := open(t), context.Background()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, d := range []Direction{{ID: "programming", Title: "Программирование"}, {ID: "narrative", Title: "Нарратив"}, {ID: "design", Title: "Дизайн"}} {
		must(s.CreateDirection(ctx, d.ID, d.Title))
	}
	for _, pair := range [][2]string{{"x", "Короткий id"}, {strings.Repeat("a", 33), "Длинный id"}, {"русский", "Название"}, {"bad_id", "Название"}, {"ok", " "}, {"ok", strings.Repeat("Я", 41)}, {"ok", "программирование"}} {
		if err := s.CreateDirection(ctx, pair[0], pair[1]); !errors.Is(err, ErrDirection) {
			t.Errorf("invalid direction accepted: %q / %q: %v", pair[0], pair[1], err)
		}
	}
	if err := s.CreateDirection(ctx, "programming", "Другое"); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate id accepted")
	}
	zero := 0
	title := "Нарратив и режиссура"
	must(s.UpdateDirection(ctx, "narrative", &title, &zero))
	list, err := s.Directions(ctx)
	must(err)
	if len(list) != 3 || list[0].ID != "narrative" || list[0].Title != title || list[1].ID != "programming" || list[2].Position != 2 {
		t.Fatalf("bad reorder: %+v", list)
	}
	duplicate := "дизайн"
	if err := s.UpdateDirection(ctx, "narrative", &duplicate, nil); !errors.Is(err, ErrDirection) {
		t.Fatal("duplicate rename accepted")
	}
	negative := -1
	if err := s.UpdateDirection(ctx, "narrative", nil, &negative); !errors.Is(err, ErrDirection) {
		t.Fatal("negative position accepted")
	}
	if err := s.UpdateDirection(ctx, "missing", &title, nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("updated missing direction")
	}
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Первый")}); err != nil {
		t.Fatal(err)
	}
	must(s.SetCourseDirection(ctx, "go", "programming"))
	if err := s.SetCourseDirection(ctx, "go", "missing"); !errors.Is(err, ErrDirection) {
		t.Fatal("unknown direction accepted")
	}
	if err := s.SetCourseDirection(ctx, "missing", ""); !errors.Is(err, ErrNotFound) {
		t.Fatal("unknown course accepted")
	}
	// Neither file import nor creating another course changes existing metadata.
	if _, err := s.ImportContent(ctx, []*course.Course{testCourse("Второй")}); err != nil {
		t.Fatal(err)
	}
	data, _ := course.Encode(testCourse("Новый"))
	must(s.CreateCourse(ctx, "another", data, "test"))
	courses, err := s.Courses(ctx)
	must(err)
	if courses[0].Direction != "" || courses[1].Direction != "programming" {
		t.Fatalf("import lost direction: %+v", courses)
	}
	must(s.SetCourseDirection(ctx, "go", ""))
	must(s.SetCourseDirection(ctx, "go", "programming"))
	must(s.DeleteDirection(ctx, "programming"))
	courses, err = s.Courses(ctx)
	must(err)
	if courses[1].Direction != "" {
		t.Fatal("deleted direction left on course")
	}
	if err := s.DeleteDirection(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted missing direction")
	}
}
