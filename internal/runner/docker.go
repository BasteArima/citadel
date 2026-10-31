package runner

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Docker is a minimal client of the Docker Engine API: create, start, wait, logs, kill, remove.
// In compose it talks to docker-socket-proxy, which lets only container calls through.
type Docker struct {
	base   string // http://docker-proxy:2375
	client *http.Client
}

// NewDocker connects to tcp://host:port or unix:///path/docker.sock.
func NewDocker(host string) (*Docker, error) {
	u, err := url.Parse(host)
	if err != nil {
		return nil, err
	}
	switch u.Scheme {
	case "tcp", "http":
		return &Docker{base: "http://" + u.Host, client: &http.Client{}}, nil
	case "unix":
		path := u.Path
		tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", path)
		}}
		return &Docker{base: "http://docker", client: &http.Client{Transport: tr}}, nil
	}
	return nil, fmt.Errorf("unsupported docker host %q", host)
}

func (d *Docker) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.base+path, rd)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		resp.Body.Close()
		return nil, fmt.Errorf("docker %s %s: %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return resp, nil
}

// Create makes a container and returns its id.
func (d *Docker) Create(ctx context.Context, config map[string]any) (string, error) {
	resp, err := d.do(ctx, "POST", "/containers/create", config)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct{ Id string }
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.Id, nil
}

func (d *Docker) Start(ctx context.Context, id string) error {
	resp, err := d.do(ctx, "POST", "/containers/"+id+"/start", nil)
	if err == nil {
		resp.Body.Close()
	}
	return err
}

// Wait blocks until the container stops and returns its exit code.
func (d *Docker) Wait(ctx context.Context, id string) (int, error) {
	resp, err := d.do(ctx, "POST", "/containers/"+id+"/wait", nil)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	var out struct{ StatusCode int }
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, err
	}
	return out.StatusCode, nil
}

func (d *Docker) Kill(ctx context.Context, id string) error {
	resp, err := d.do(ctx, "POST", "/containers/"+id+"/kill", nil)
	if err == nil {
		resp.Body.Close()
	}
	return err
}

func (d *Docker) Remove(ctx context.Context, id string) error {
	resp, err := d.do(ctx, "DELETE", "/containers/"+id+"?force=1", nil)
	if err == nil {
		resp.Body.Close()
	}
	return err
}

// Logs reads stdout and stderr in the order they were written, at most limit bytes.
// The stream is multiplexed: an 8-byte header (stream, 0, 0, 0, size) before every frame.
func (d *Docker) Logs(ctx context.Context, id string, limit int) (string, bool, error) {
	resp, err := d.do(ctx, "GET", "/containers/"+id+"/logs?stdout=1&stderr=1", nil)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	var out bytes.Buffer
	hdr := make([]byte, 8)
	for {
		if _, err := io.ReadFull(resp.Body, hdr); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return out.String(), false, nil
			}
			return "", false, err
		}
		n := int(binary.BigEndian.Uint32(hdr[4:]))
		if out.Len()+n > limit {
			io.CopyN(&out, resp.Body, int64(limit-out.Len()))
			return out.String(), true, nil
		}
		if _, err := io.CopyN(&out, resp.Body, int64(n)); err != nil {
			return "", false, err
		}
	}
}
