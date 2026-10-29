// Command citadel is the Citadel platform: the web server and course tools.
//
//	citadel serve       run the server
//	citadel check       validate courses in the content directory
//	citadel convert-v0  convert the legacy Go course to format v1
//	citadel backup      write a consistent copy of the database
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"citadel/internal/course"
	"citadel/internal/legacy"
	"citadel/internal/server"
	"citadel/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(os.Args[2:])
	case "check":
		err = check(os.Args[2:])
	case "convert-v0":
		err = convertV0(os.Args[2:])
	case "backup":
		err = backup(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "citadel:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: citadel serve | check | convert-v0 | backup [flags]")
}

func dbPath(dataDir string) string { return filepath.Join(dataDir, "citadel.db") }

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", envOr("CITADEL_ADDR", ":8080"), "listen address")
	content := fs.String("content", envOr("CITADEL_CONTENT", "content"), "directory with <id>/course.json")
	data := fs.String("data", envOr("CITADEL_DATA", "data"), "directory for the database")
	envFile := fs.String("env", ".env", "file with KEY=VALUE settings; real environment variables win")
	fs.Parse(args)

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := loadEnvFile(*envFile); err != nil {
		return err
	}
	code := os.Getenv("CITADEL_ACCESS_CODE")
	if code == "" {
		return errors.New("CITADEL_ACCESS_CODE is not set: put it in .env (see .env.example)")
	}
	var admins []string
	for _, a := range strings.Split(os.Getenv("CITADEL_ADMINS"), ",") {
		if a = strings.TrimSpace(a); a != "" {
			admins = append(admins, a)
		}
	}

	courses, err := course.LoadDir(*content)
	if err != nil {
		return err
	}
	for _, c := range courses {
		if errs := course.Errors(course.Validate(c)); len(errs) > 0 {
			return fmt.Errorf("course %s is invalid: %v (run citadel check)", c.ID, errs[0])
		}
	}
	if err := os.MkdirAll(*data, 0o755); err != nil {
		return err
	}
	st, err := store.Open(dbPath(*data))
	if err != nil {
		return err
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	imported, err := st.ImportContent(ctx, courses)
	if err != nil {
		return err
	}
	for _, im := range imported {
		if im.Skipped {
			log.Info("course file skipped: edited in the admin panel, import it there to update", "id", im.ID, "version", im.Version)
			continue
		}
		log.Info("course", "id", im.ID, "version", im.Version, "new_version", im.New)
	}

	h, err := server.New(ctx, server.Config{Store: st, AccessCode: code, Admins: admins, Log: log})
	if err != nil {
		return err
	}
	srv := &http.Server{Addr: *addr, Handler: h, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Info("listening", "addr", *addr, "db", dbPath(*data), "admins", len(admins))
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("stopped")
	return nil
}

func backup(args []string) error {
	fs := flag.NewFlagSet("backup", flag.ExitOnError)
	data := fs.String("data", envOr("CITADEL_DATA", "data"), "directory with the database")
	out := fs.String("out", "", "output file (default: <data>/backup-<time>.db)")
	fs.Parse(args)

	if *out == "" {
		*out = filepath.Join(*data, "backup-"+time.Now().Format("2006-01-02-150405")+".db")
	}
	if _, err := os.Stat(dbPath(*data)); err != nil {
		return fmt.Errorf("no database: %w", err)
	}
	st, err := store.Open(dbPath(*data))
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Backup(context.Background(), *out); err != nil {
		return err
	}
	fmt.Println("wrote", *out)
	return nil
}

func check(args []string) error {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	content := fs.String("content", "content", "directory with <id>/course.json")
	fs.Parse(args)

	courses, err := course.LoadDir(*content)
	if err != nil {
		return err
	}
	if len(courses) == 0 {
		return fmt.Errorf("no courses in %s", *content)
	}
	failed := 0
	for _, c := range courses {
		ps := course.Validate(c)
		errs := course.Errors(ps)
		fmt.Printf("%s: %d ошибок, %d предупреждений\n", c.ID, len(errs), len(ps)-len(errs))
		for _, p := range ps {
			fmt.Println("  " + p.String())
		}
		if len(errs) > 0 {
			failed++
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d course(s) have errors", failed)
	}
	return nil
}

func convertV0(args []string) error {
	fs := flag.NewFlagSet("convert-v0", flag.ExitOnError)
	in := fs.String("in", filepath.Join("legacy", "go-course"), "v0 course directory")
	out := fs.String("out", filepath.Join("content", "go", "course.json"), "output file")
	id := fs.String("id", "go", "course id")
	metal := fs.String("metal", "iron", "metal of the course link")
	review := fs.String("review", "1,3,7", "review intervals in days")
	pages := fs.String("pages", "glossary,notes,exam,tools", "reference pages of the course")
	fs.Parse(args)

	var days []int
	for _, s := range strings.Split(*review, ",") {
		d, err := strconv.Atoi(strings.TrimSpace(s))
		if err != nil {
			return fmt.Errorf("bad -review: %w", err)
		}
		days = append(days, d)
	}
	c, err := legacy.ConvertDir(*in, legacy.Options{ID: *id, Metal: *metal, Review: days, Pages: strings.Split(*pages, ",")})
	if err != nil {
		return err
	}
	if errs := course.Errors(course.Validate(c)); len(errs) > 0 {
		for _, p := range errs {
			fmt.Fprintln(os.Stderr, p)
		}
		return fmt.Errorf("converted course has %d error(s)", len(errs))
	}
	data, err := course.Encode(c)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		return err
	}
	fmt.Printf("wrote %s (%d bytes)\n", *out, len(data))
	return nil
}

// loadEnvFile sets variables from a KEY=VALUE file for local runs. A missing file is fine:
// in Docker the variables come from compose. Variables already set are not overwritten.
func loadEnvFile(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for i, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("%s:%d: expected KEY=VALUE", path, i+1)
		}
		key, val = strings.TrimSpace(key), strings.Trim(strings.TrimSpace(val), `"'`)
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, val)
		}
	}
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
