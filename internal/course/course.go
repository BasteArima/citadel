// Package course describes the course format v1: a passport and a tree of nodes
// made of typed blocks. See docs/dev/CONTENT-FORMAT.md.
package course

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// SchemaVersion is the current version of the course format.
const SchemaVersion = 1

// Course is one course: passport fields plus the node tree.
type Course struct {
	Schema   int               `json:"schema"`
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	Subtitle string            `json:"subtitle,omitempty"`
	Metal    string            `json:"metal"`
	Tool     Tool              `json:"tool"`
	Labels   map[string]string `json:"labels,omitempty"`
	Review   []int             `json:"review"`
	Pages    []string          `json:"pages,omitempty"`
	About    string            `json:"about,omitempty"`
	Howto    []string          `json:"howto,omitempty"`
	Glossary map[string]Term   `json:"glossary"`
	Root     []*Node           `json:"root"`
}

// Tool is the tool whose outputs the course shows, with the version they were obtained on.
type Tool struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Term is a glossary entry.
type Term struct {
	Title   string `json:"t"`
	English string `json:"en,omitempty"`
	Text    string `json:"d"`
}

// Node kinds.
const (
	KindSection = "section"
	KindLesson  = "lesson"
	KindPart    = "part"
	KindPage    = "page"
)

// Practice part types: a part made of a hands-on task or the final check.
const (
	PracticeHands = "hands"
	PracticeTest  = "test"
)

// Node is an element of the course tree. A node has either children or blocks;
// a planned lesson has neither.
type Node struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	N        int    `json:"n,omitempty"`
	Tag      string `json:"tag,omitempty"`
	Icon     string `json:"icon,omitempty"`
	About    string `json:"about,omitempty"`
	Planned  bool   `json:"planned,omitempty"`
	Practice string `json:"practice,omitempty"`
	Done     string `json:"done,omitempty"`

	Deps []string `json:"deps,omitempty"`

	// Lesson intro and wrap-up.
	Time    string           `json:"time,omitempty"`
	Lead    string           `json:"lead,omitempty"`
	Simple  []string         `json:"simple,omitempty"`
	Say     string           `json:"say,omitempty"`
	Summary []string         `json:"summary,omitempty"`
	Videos  []map[string]any `json:"videos,omitempty"`

	Children []*Node `json:"children,omitempty"`
	Blocks   []Block `json:"blocks,omitempty"`
}

// Block is a typed content block. Fields other than "type" depend on the type.
type Block map[string]any

// Type returns the block type.
func (b Block) Type() string {
	t, _ := b["type"].(string)
	return t
}

// MarshalJSON writes "type" first and the other fields in sorted order,
// so diffs between versions stay readable.
func (b Block) MarshalJSON() ([]byte, error) {
	keys := make([]string, 0, len(b))
	for k := range b {
		if k != "type" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	if _, ok := b["type"]; ok {
		keys = append([]string{"type"}, keys...)
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kj, _ := json.Marshal(k)
		vj, err := json.Marshal(b[k])
		if err != nil {
			return nil, fmt.Errorf("block field %q: %w", k, err)
		}
		buf.Write(kj)
		buf.WriteByte(':')
		buf.Write(vj)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// Walk calls fn for every node in depth-first order.
func (c *Course) Walk(fn func(n *Node, parent *Node)) {
	var walk func(ns []*Node, parent *Node)
	walk = func(ns []*Node, parent *Node) {
		for _, n := range ns {
			fn(n, parent)
			walk(n.Children, n)
		}
	}
	walk(c.Root, nil)
}

// Decode reads a course from JSON. Numbers stay json.Number so that
// re-encoding does not change them.
func Decode(data []byte) (*Course, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	dec.DisallowUnknownFields()
	var c Course
	if err := dec.Decode(&c); err != nil {
		return nil, err
	}
	return &c, nil
}

// Encode writes a course as indented JSON with a trailing newline.
func Encode(c *Course) ([]byte, error) {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

// LoadFile reads a course from a file.
func LoadFile(path string) (*Course, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	c, err := Decode(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

// LoadDir reads every content/<id>/course.json under dir.
func LoadDir(dir string) ([]*Course, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*", "course.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	courses := make([]*Course, 0, len(paths))
	for _, p := range paths {
		c, err := LoadFile(p)
		if err != nil {
			return nil, err
		}
		courses = append(courses, c)
	}
	return courses, nil
}
