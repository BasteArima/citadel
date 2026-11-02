// Command citadel is the Citadel platform: the web server and course tools.
//
//	citadel serve       run the server
//	citadel check       validate courses in the content directory
//	citadel convert-v0  convert the legacy Go course to format v1
//	citadel backup      write a consistent copy of the database
//	citadel runner      run course code in throwaway containers (decision 0013)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"citadel/internal/course"
	"citadel/internal/legacy"
	"citadel/internal/runner"
	"citadel/internal/server"
	"citadel/internal/speech"
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
	case "runner":
		err = runRunner(os.Args[2:])
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
	fmt.Fprintln(os.Stderr, "usage: citadel serve | check | convert-v0 | backup | runner [flags]")
}

func dbPath(dataDir string) string { return filepath.Join(dataDir, "citadel.db") }

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", envOr("CITADEL_ADDR", ":8080"), "listen address")
	content := fs.String("content", envOr("CITADEL_CONTENT", defaultContent()), "directory with <id>/course.json")
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
		if im.Deleted {
			log.Info("course file skipped: the course was deleted in the admin panel, import it there to bring it back", "id", im.ID)
			continue
		}
		if im.Skipped {
			log.Info("course file skipped: edited in the admin panel, import it there to update", "id", im.ID, "version", im.Version)
			continue
		}
		log.Info("course", "id", im.ID, "version", im.Version, "new_version", im.New)
	}

	cfg := server.Config{Store: st, AccessCode: code, Admins: admins, Log: log,
		RunnerURL: os.Getenv("CITADEL_RUNNER_URL"), RunnerSecret: os.Getenv("CITADEL_RUNNER_SECRET"),
		AudioDir: filepath.Join(*data, "audio")}
	// narration is recorded by edge-tts (decision 0015): CITADEL_TTS or edge-tts from PATH
	tts := envOr("CITADEL_TTS", "edge-tts")
	if path, err := exec.LookPath(tts); err == nil {
		proxy := os.Getenv("CITADEL_TTS_PROXY")
		cfg.Synth = speech.EdgeTTS{Cmd: path, Timeout: 90 * time.Second, Tries: 3, Proxy: proxy}
		cfg.AutoRecord = true
		log.Info("narration", "tts", path, "proxy", proxy != "")
	} else {
		log.Info("narration off: edge-tts not found", "tts", tts)
	}
	h, err := server.New(ctx, cfg)
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
	content := fs.String("content", defaultContent(), "directory with <id>/course.json")
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

// defaultContent is content/ with the owner's courses, which is not in git (decision 0017),
// or the test course of the repository.
func defaultContent() string {
	if st, err := os.Stat("content"); err == nil && st.IsDir() {
		return "content"
	}
	return "content-demo"
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

// runRunner serves the runner: Citadel sends it code, it runs the code in a fresh container.
// Settings: CITADEL_RUNNER_SECRET (shared with Citadel), DOCKER_HOST (in compose — the socket
// proxy), CITADEL_RUNNER_RUNTIME (runsc for gVisor), CITADEL_GO_IMAGE.
func runRunner(args []string) error {
	fs := flag.NewFlagSet("runner", flag.ExitOnError)
	addr := fs.String("addr", envOr("CITADEL_RUNNER_ADDR", ":8090"), "listen address")
	envFile := fs.String("env", ".env", "file with KEY=VALUE settings; real environment variables win")
	fs.Parse(args)
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := loadEnvFile(*envFile); err != nil {
		return err
	}
	secret := os.Getenv("CITADEL_RUNNER_SECRET")
	if len(secret) < 24 {
		return errors.New("CITADEL_RUNNER_SECRET must be set, at least 24 characters (see .env.example)")
	}
	docker, err := runner.NewDocker(envOr("DOCKER_HOST", "unix:///var/run/docker.sock"))
	if err != nil {
		return err
	}
	goTC := runner.Go
	goTC.Image = envOr("CITADEL_GO_IMAGE", goTC.Image)
	rs := &runner.Server{Docker: docker, Secret: secret, Runtime: os.Getenv("CITADEL_RUNNER_RUNTIME"),
		Tools: map[string]runner.Toolchain{goTC.Tool: goTC}, Log: log}
	srv := &http.Server{Addr: *addr, Handler: rs.Handler(), ReadHeaderTimeout: 5 * time.Second}
	log.Info("runner listening", "addr", *addr, "runtime", rs.Runtime, "go_image", goTC.Image)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
