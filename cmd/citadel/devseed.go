package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"citadel/internal/course"
	"citadel/internal/store"
)

func devSeed(args []string) error {
	fs := flag.NewFlagSet("dev-seed", flag.ContinueOnError)
	data := fs.String("data", "data-dev", "directory for development data")
	force := fs.Bool("force", false, "replace only a database marked by dev-seed; data is always forbidden")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("dev-seed takes only flags")
	}
	dir, err := filepath.Abs(*data)
	if err != nil {
		return err
	}
	if strings.EqualFold(strings.TrimRight(filepath.Base(dir), ". "), "data") {
		return errors.New("refusing to seed data, even with -force")
	}
	ctx := context.Background()
	path := dbPath(dir)
	if _, err := os.Stat(path); err == nil {
		if !*force {
			return errors.New("database already exists; -force replaces only a database marked by dev-seed")
		}
		marked, err := store.IsDevelopmentDatabase(ctx, path)
		if err != nil {
			return fmt.Errorf("not a test database: cannot read dev-seed marker: %w", err)
		}
		if !marked {
			return errors.New("not a test database: missing dev-seed marker")
		}
		// Only explicitly named, verified development database files are replaced.
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if err := os.Remove(path + suffix); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	} else {
		for _, suffix := range []string{"-wal", "-shm"} {
			if _, err := os.Lstat(path + suffix); err == nil {
				return errors.New("not a test database: sidecar exists without a marked development database")
			} else if !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	st, err := store.Open(path)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.MarkDevelopment(ctx); err != nil {
		return err
	}
	users := map[string]store.User{}
	var logins strings.Builder
	for _, spec := range []struct{ login, name, role string }{
		{"devadmin", "Админ", store.RoleAdmin}, {"ira", "Ира", store.RoleAuthor}, {"student", "Ученик", store.RoleStudent},
	} {
		var random [16]byte
		if _, err := rand.Read(random[:]); err != nil {
			return err
		}
		password := hex.EncodeToString(random[:])
		u, err := st.CreateUser(ctx, spec.login, spec.name, password, spec.role)
		if err != nil {
			return err
		}
		users[spec.login] = u
		fmt.Fprintf(&logins, "%s %s\n", spec.login, password)
	}
	if err := os.WriteFile(filepath.Join(dir, "dev-login.txt"), []byte(logins.String()), 0o600); err != nil {
		return err
	}
	for _, d := range []store.Direction{{ID: "programming", Title: "Программирование"}, {ID: "narrative", Title: "Нарратив и режиссура"}, {ID: "design", Title: "Дизайн"}} {
		if err := st.CreateDirection(ctx, d.ID, d.Title); err != nil {
			return err
		}
	}
	demos, err := course.LoadDir("content-demo")
	if err != nil {
		return err
	}
	if len(demos) != 2 {
		return errors.New("expected demo course and project in content-demo")
	}
	for _, c := range demos {
		if errs := course.Errors(course.Validate(c)); len(errs) > 0 {
			return fmt.Errorf("invalid demo %s: %s", c.ID, errs[0])
		}
	}
	if _, err := st.ImportContent(ctx, demos); err != nil {
		return err
	}
	for _, c := range demos {
		if err := st.SetCourseDirection(ctx, c.ID, "programming"); err != nil {
			return err
		}
		if err := st.SetCourseOwner(ctx, c.ID, users["devadmin"].ID); err != nil {
			return err
		}
	}
	// Nine generated courses plus the imported demo give exactly 6 / 3 / 1 catalog tiles.
	generated := seedCourses()
	for i, c := range generated {
		if errs := course.Errors(course.Validate(c)); len(errs) > 0 {
			return fmt.Errorf("invalid seed %s: %s", c.ID, errs[0])
		}
		encoded, err := course.Encode(c)
		if err != nil {
			return err
		}
		owner := users["devadmin"].ID
		if i >= 5 && i <= 7 {
			owner = users["ira"].ID
		}
		if i == 4 {
			owner = 0
		} // unpublished platform course is visible as «Скоро»
		if err := st.CreateOwnedCourse(ctx, c.ID, encoded, "dev-seed", owner); err != nil {
			return err
		}
		access := store.AccessPublic
		if i == 3 {
			access = store.AccessPrivate
		}
		if err := st.SetCourseAccess(ctx, c.ID, access); err != nil {
			return err
		}
		direction := ""
		if i < 5 {
			direction = "programming"
		} else if i < 8 {
			direction = "narrative"
		}
		if err := st.SetCourseDirection(ctx, c.ID, direction); err != nil {
			return err
		}
		if i != 4 {
			if err := st.Publish(ctx, c.ID, 1); err != nil {
				return err
			}
		}
	}
	if err := st.SetUserCourses(ctx, users["student"].ID, []string{generated[3].ID}); err != nil {
		return err
	}
	at := time.Now().UnixMilli()
	mark := func(v any) store.Item { b, _ := json.Marshal(v); return store.Item{V: b, At: at} }
	for i := 0; i < 3; i++ {
		c := generated[i]
		items := map[string]store.Item{}
		lessons := c.Root[0].Children
		for j, l := range lessons {
			if i != 0 && j != 0 {
				continue
			}
			items["done:"+l.ID] = mark(1)
			items["q:"+l.ID+":"+l.ID+".q"] = mark(1)
		}
		first := lessons[0].ID
		items["card:"+first+":"+first+".q"] = mark(map[string]any{"d": time.Now().Format(time.DateOnly), "i": 1, "s": 0})
		if _, err := st.MergeProgress(ctx, users["devadmin"].ID, c.ID, items); err != nil {
			return err
		}
	}
	if _, err := st.MergeProgress(ctx, users["devadmin"].ID, "demo-project", map[string]store.Item{"seen:notes.health:d0": mark(1)}); err != nil {
		return err
	}
	fmt.Printf("Development data created in %s; credentials saved to dev-login.txt\n", dir)
	return nil
}

func seedCourses() []*course.Course {
	titles := []string{"Основы Go", "HTTP в Go", "Работа с PostgreSQL", "Закрытый практикум", "Архитектура сервисов", "История и конфликт", "Режиссура сцены", "Диалоги персонажей", "Как учиться"}
	subtitles := []string{"Первые шаги", "От запроса до ответа: маршруты, обработчики и понятные ошибки", "Как хранить данные, находить нужные строки и выбирать индексы для повседневных задач бэкендера", "Небольшие задачи для самостоятельной работы", "Учимся разделять ответственность между компонентами, выбирать границы модулей и проверять решения на реальных сценариях растущего сервиса", "Замысел истории", "Ритм, движение и точка зрения: как собрать сцену, которая удерживает внимание зрителя", "Голос героя и скрытое действие в разговоре", "Практика осмысленного повторения и небольших шагов"}
	out := []*course.Course{}
	for i, title := range titles {
		c := &course.Course{Schema: course.SchemaVersion, ID: fmt.Sprintf("dev-course-%02d", i+1), Title: title, Subtitle: subtitles[i], Metal: []string{"iron", "copper", "bronze", "silver", "gold", "steel"}[i%6], Tool: course.Tool{Name: "Go", Version: "1.27"}, Review: []int{1, 3, 7}, Glossary: map[string]course.Term{}}
		if i >= 5 {
			c.Tool = course.Tool{Name: "Практика", Version: "2026"}
		}
		if i == 1 {
			c.Requires = []string{"dev-course-01"}
		}
		section := &course.Node{ID: "basics", Kind: course.KindSection, Title: "Знакомство"}
		for j := 1; j <= 2+i%2; j++ {
			id := fmt.Sprintf("lesson-%d", j)
			section.Children = append(section.Children, &course.Node{ID: id, Kind: course.KindLesson, N: j, Title: fmt.Sprintf("Разбор %d: %s", j, title), Children: []*course.Node{{ID: id + ".part", Kind: course.KindPart, Title: "Проверь себя", Blocks: []course.Block{
				{"type": "text", "html": "Это тестовый урок для проверки интерфейса. Начни с небольшой задачи, объясни своё решение и проверь результат."},
				{"type": "question", "id": id + ".q", "kind": "choice", "q": "Что помогает проверить понимание?", "opts": []any{"Объяснить решение своими словами", "Только перечитать заголовок"}, "a": 0, "why": "Объяснение позволяет заметить пробелы в понимании."},
			}}}})
		}
		c.Root = []*course.Node{section}
		if i == 0 {
			// One intentional omission makes the admin's explanation filter reviewable.
			delete(section.Children[0].Children[0].Blocks[1], "why")
		}
		out = append(out, c)
	}
	return out
}
