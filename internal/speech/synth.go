package speech

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ErrNoAnswer means the speech service did not answer in time on any try: usually it is not
// reachable from this network (docs/guides/self-hosting.md, CITADEL_TTS_PROXY).
var ErrNoAnswer = errors.New("the speech service did not answer")

// Synth turns text into MP3 with a voice.
type Synth interface {
	Speak(ctx context.Context, voice, text string) ([]byte, error)
}

// EdgeTTS runs the edge-tts program (the Python package edge-tts) — decision 0015.
// The program talks to the «Read aloud» service of Microsoft Edge; its access token changes
// with Edge versions, and following that is the package's job, not ours.
type EdgeTTS struct {
	Cmd     string        // path to edge-tts
	Timeout time.Duration // per attempt; the service sometimes hangs
	Tries   int
	Proxy   string // http://host:port when the service is not reachable directly; may hold a password, never logged
}

func (e EdgeTTS) Speak(ctx context.Context, voice, text string) ([]byte, error) {
	if e.Cmd == "" {
		return nil, errors.New("edge-tts is not configured: set CITADEL_TTS")
	}
	dir, err := os.MkdirTemp("", "citadel-tts-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	in, out := filepath.Join(dir, "text.txt"), filepath.Join(dir, "out.mp3")
	if err := os.WriteFile(in, []byte(text), 0o600); err != nil {
		return nil, err
	}
	tries, timeout := max(e.Tries, 1), e.Timeout
	if timeout == 0 {
		timeout = 90 * time.Second
	}
	var last error
	for try := 0; try < tries; try++ {
		if try > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(try) * 3 * time.Second):
			}
		}
		actx, cancel := context.WithTimeout(ctx, timeout)
		var stderr bytes.Buffer
		args := []string{"--voice", voice, "--file", in, "--write-media", out}
		if e.Proxy != "" {
			args = append(args, "--proxy", e.Proxy)
		}
		cmd := exec.CommandContext(actx, e.Cmd, args...)
		cmd.Stderr = &stderr
		err := cmd.Run()
		timedOut := errors.Is(actx.Err(), context.DeadlineExceeded)
		cancel()
		if err == nil {
			data, err := os.ReadFile(out)
			if err == nil && len(data) > 0 {
				return data, nil
			}
			last = fmt.Errorf("edge-tts wrote no audio")
			continue
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if timedOut {
			last = fmt.Errorf("%w: no answer in %s", ErrNoAnswer, timeout)
			continue
		}
		msg := lastLine(stderr.String())
		if e.Proxy != "" {
			msg = strings.ReplaceAll(msg, e.Proxy, "<proxy>")
		}
		last = fmt.Errorf("edge-tts: %v: %s", err, msg)
	}
	return nil, last
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// Recording is a narrated part: one MP3 and where each chapter starts.
type Recording struct {
	MP3      []byte
	Duration float64
	Starts   []float64 // seconds, one per chapter
}

// Record narrates a part chapter by chapter and joins the chapters into one MP3.
// MP3 frames can be joined as they are, so the start of a chapter is the length of the ones before.
func Record(ctx context.Context, s Synth, voice string, p Part) (Recording, error) {
	var rec Recording
	for i, ch := range p.Chapters {
		data, err := s.Speak(ctx, voice, ch.Text)
		if err != nil {
			return Recording{}, fmt.Errorf("chapter %d «%s»: %w", i+1, ch.Title, err)
		}
		rec.Starts = append(rec.Starts, rec.Duration)
		rec.Duration += Duration(data)
		rec.MP3 = append(rec.MP3, data[skipID3(data):]...)
	}
	return rec, nil
}
