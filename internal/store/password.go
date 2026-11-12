package store

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const passwordMemory = 19 * 1024

var ErrCredentials = errors.New("invalid credentials")
var ErrPasswordPolicy = errors.New("пароль — от 10 до 256 символов, не должен совпадать с логином")

func validatePassword(login, password string) error {
	n := utf8.RuneCountInString(password)
	if !utf8.ValidString(password) || n < 10 || n > 256 || strings.EqualFold(login, password) {
		return ErrPasswordPolicy
	}
	return nil
}

// HashPassword encodes Argon2id parameters, a random salt and a 32-byte key as PHC.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, 2, passwordMemory, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=2,p=1$%s$%s", passwordMemory,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// CheckPassword accepts the parameters stored in PHC, allowing future cost upgrades.
// Bounds reject damaged hashes without unbounded allocations or a panic in Argon2.
func CheckPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	params := strings.Split(parts[3], ",")
	if len(params) != 3 {
		return false
	}
	values := make(map[string]uint64, 3)
	for _, param := range params {
		k, v, ok := strings.Cut(param, "=")
		n, err := strconv.ParseUint(v, 10, 32)
		if !ok || err != nil || values[k] != 0 || n == 0 {
			return false
		}
		values[k] = n
	}
	m, t, p := values["m"], values["t"], values["p"]
	if p == 0 || p > 255 || t == 0 || t > 20 || m < 8*p || m > 256*1024 {
		return false
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return false
	}
	want, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, uint32(t), uint32(m), uint8(p), uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// Missing and not-yet-configured accounts still pay the normal Argon2 cost.
// The dummy salt and key are public constants, unrelated to any user's credentials.
const dummyPasswordHash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
