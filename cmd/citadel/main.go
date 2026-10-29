// Command citadel is the Citadel platform: the web server and course tools.
//
//	citadel serve       run the server
//	citadel check       validate courses in the content directory
//	citadel convert-v0  convert the legacy Go course to format v1
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
	fmt.Fprintln(os.Stderr, "usage: citadel serve | check | convert-v0 [flags]")
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", envOr("CITADEL_ADDR", ":8080"), "listen address")
	content := fs.String("content", envOr("CITADEL_CONTENT", "content"), "directory with <id>/course.json")
	fs.Parse(args)

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	courses, err := course.LoadDir(*content)
	if err != nil {
		return err
	}
	for _, c := range courses {
		if errs := course.Errors(course.Validate(c)); len(errs) > 0 {
			return fmt.Errorf("course %s is invalid: %v (run citadel check)", c.ID, errs[0])
		}
	}
	log.Info("courses loaded", "count", len(courses), "dir", *content)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           server.New(courses, log),
		ReadHeaderTimeout: 5 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Info("listening", "addr", *addr)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("stopped")
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

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
