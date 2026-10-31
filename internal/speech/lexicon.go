package speech

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// lexicon replaces words by how they are read: «Go» → «гоу». A word matches whole and with
// its case, so «Go» does not touch «Google» or «go». Longer entries win: «Go runtime» before «Go».
type lexicon struct {
	keys []string
	to   map[string]string
}

func newLexicon(m map[string]string) *lexicon {
	l := &lexicon{to: map[string]string{}}
	for k, v := range m {
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		l.keys = append(l.keys, k)
		l.to[k] = v
	}
	sort.Slice(l.keys, func(i, j int) bool {
		if len(l.keys[i]) != len(l.keys[j]) {
			return len(l.keys[i]) > len(l.keys[j])
		}
		return l.keys[i] < l.keys[j]
	})
	return l
}

// ApplyLexicon reads a text through a lexicon, as the narration of a part does.
func ApplyLexicon(lex map[string]string, s string) string { return newLexicon(lex).apply(s) }

func isWord(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' }

func (l *lexicon) apply(s string) string {
	if len(l.keys) == 0 {
		return s
	}
	var b strings.Builder
	prev := rune(-1)
	for i := 0; i < len(s); {
		if prev == -1 || !isWord(prev) {
			if k := l.match(s[i:]); k != "" {
				b.WriteString(l.to[k])
				i += len(k)
				prev, _ = utf8.DecodeLastRuneInString(k)
				continue
			}
		}
		r, n := utf8.DecodeRuneInString(s[i:])
		b.WriteRune(r)
		prev = r
		i += n
	}
	return b.String()
}

// match returns the longest entry that starts s and ends on a word boundary.
func (l *lexicon) match(s string) string {
	for _, k := range l.keys {
		if !strings.HasPrefix(s, k) {
			continue
		}
		next, _ := utf8.DecodeRuneInString(s[len(k):])
		if len(s) == len(k) || !isWord(next) {
			return k
		}
	}
	return ""
}
