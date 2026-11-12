package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"strings"
	"text/tabwriter"

	"citadel/internal/store"
)

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func randomPassword() (string, error) {
	b := make([]byte, 20)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(passwordAlphabet))))
		if err != nil {
			return "", err
		}
		b[i] = passwordAlphabet[n.Int64()]
	}
	return string(b), nil
}

// Console recovery deliberately prints the generated password only to the caller's stdout.
func userCommand(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: citadel user list | reset-password | add | set-role | unblock [-data directory]")
	}
	command := args[0]
	if err := loadEnvFile(".env"); err != nil {
		return err
	}
	fs := flag.NewFlagSet("user "+command, flag.ContinueOnError)
	data := fs.String("data", envOr("CITADEL_DATA", "data"), "directory with the database")
	var role, name, login string
	var id int64
	switch command {
	case "add":
		fs.StringVar(&role, "role", store.RoleStudent, "student, author or admin")
		fs.StringVar(&name, "name", "", "display name (defaults to login)")
	case "reset-password":
		fs.Int64Var(&id, "id", 0, "legacy user id")
		fs.StringVar(&login, "login", "", "login for a legacy user")
	case "list", "set-role", "unblock":
	default:
		return errors.New("unknown user command")
	}
	// Accept -data and other flags both before and after the positional login.
	var flags, positional []string
	for i := 1; i < len(args); i++ {
		a := args[i]
		if !strings.HasPrefix(a, "-") {
			positional = append(positional, a)
			continue
		}
		flags = append(flags, a)
		if !strings.Contains(a, "=") && a != "-h" && a != "--help" {
			if i+1 >= len(args) {
				return errors.New("missing flag value")
			}
			i++
			flags = append(flags, args[i])
		}
	}
	if err := fs.Parse(flags); err != nil {
		return err
	}
	if command == "list" && len(positional) != 0 || command == "set-role" && len(positional) != 2 || (command == "add" || command == "unblock") && len(positional) != 1 {
		return errors.New("invalid user command arguments")
	}
	if command == "reset-password" && !(id > 0 && login != "" && len(positional) == 0 || id == 0 && login == "" && len(positional) == 1) {
		return errors.New("usage: user reset-password <login> OR user reset-password --id <id> --login <login>")
	}
	if command == "add" {
		if err := os.MkdirAll(*data, 0o755); err != nil {
			return err
		}
	} else if _, err := os.Stat(dbPath(*data)); err != nil {
		return fmt.Errorf("no database: %w", err)
	}
	s, err := store.Open(dbPath(*data))
	if err != nil {
		return err
	}
	defer s.Close()
	ctx := context.Background()
	if command == "list" {
		users, err := s.Users(ctx)
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
		fmt.Fprintln(w, "ID\tLOGIN\tNAME\tROLE\tDISABLED")
		for _, u := range users {
			fmt.Fprintf(w, "%d\t%s\t%s\t%s\t%t\n", u.ID, u.Login, u.Name, u.Role, u.DisabledAt != "")
		}
		return w.Flush()
	}
	if command == "add" {
		password, err := randomPassword()
		if err != nil {
			return err
		}
		if name == "" {
			name = positional[0]
		}
		if _, err := s.CreateUser(ctx, positional[0], name, password, role); err != nil {
			return err
		}
		_, err = fmt.Fprintln(out, password)
		return err
	}
	if id == 0 {
		u, err := s.UserByLogin(ctx, positional[0])
		if err != nil {
			return err
		}
		id = u.ID
	}
	switch command {
	case "set-role":
		return s.SetRole(ctx, id, positional[1])
	case "unblock":
		return s.SetDisabled(ctx, id, false)
	case "reset-password":
		password, err := randomPassword()
		if err != nil {
			return err
		}
		if login != "" {
			if err := s.SetLogin(ctx, id, login); err != nil {
				return err
			}
		}
		if err := s.SetPassword(ctx, id, password); err != nil {
			return err
		}
		_, err = fmt.Fprintln(out, password)
		return err
	}
	return nil
}
