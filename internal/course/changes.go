package course

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
)

// Change is one step of an agent's edit. An agent sends a list of changes instead of the whole
// course: a 250 KB course does not fit an agent's context well, and a node-sized edit can be
// applied again on top of a newer draft when the admin accepts it later.
type Change struct {
	// Op is put_node, delete_node, put_term, delete_term or set_passport.
	Op string `json:"op"`

	// put_node: a node with this id is replaced in place (with its children and blocks);
	// a new id is inserted under Parent ("" — the root) before Before, after After, or at the end.
	Node   *Node  `json:"node,omitempty"`
	Parent string `json:"parent,omitempty"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`

	// delete_node
	ID string `json:"id,omitempty"`

	// put_term, delete_term
	Key  string `json:"key,omitempty"`
	Term *Term  `json:"term,omitempty"`

	// set_passport: passport fields to replace, see PassportFields.
	Fields map[string]json.RawMessage `json:"fields,omitempty"`
}

// PassportFields are the passport fields set_passport may change. id, schema, the tree
// and the glossary have their own operations or never change.
var PassportFields = []string{"type", "title", "subtitle", "metal", "tool", "labels", "review", "pages", "about", "howto", "requires", "speech"}

// Apply applies changes to c in order. It stops at the first change that cannot be applied;
// c is then partly changed, so callers apply to a fresh copy. Lessons are renumbered afterwards,
// as the editor does.
func Apply(c *Course, changes []Change) error {
	for i, ch := range changes {
		if err := apply(c, ch); err != nil {
			return fmt.Errorf("change %d (%s): %w", i+1, ch.Op, err)
		}
	}
	n := 0
	c.Walk(func(nd *Node, _ *Node) {
		if nd.Kind == KindLesson {
			n++
			nd.N = n
		}
	})
	return nil
}

func apply(c *Course, ch Change) error {
	switch ch.Op {
	case "put_node":
		if ch.Node == nil || ch.Node.ID == "" {
			return fmt.Errorf("node with an id is required")
		}
		if list, i := c.find(ch.Node.ID); list != nil {
			(*list)[i] = ch.Node
			return nil
		}
		list := &c.Root
		if ch.Parent != "" {
			pl, pi := c.find(ch.Parent)
			if pl == nil {
				return fmt.Errorf("no parent node %q", ch.Parent)
			}
			list = &(*pl)[pi].Children
		}
		at := len(*list)
		if ref := ch.Before + ch.After; ref != "" {
			at = slices.IndexFunc(*list, func(n *Node) bool { return n.ID == ref })
			if at < 0 {
				return fmt.Errorf("no node %q under parent %q", ref, ch.Parent)
			}
			if ch.After != "" {
				at++
			}
		}
		*list = slices.Insert(*list, at, ch.Node)
	case "delete_node":
		list, i := c.find(ch.ID)
		if list == nil {
			return fmt.Errorf("no node %q", ch.ID)
		}
		*list = slices.Delete(*list, i, i+1)
	case "put_term":
		if ch.Key == "" || ch.Term == nil || ch.Term.Title == "" {
			return fmt.Errorf("key and term with t are required")
		}
		if c.Glossary == nil {
			c.Glossary = map[string]Term{}
		}
		c.Glossary[ch.Key] = *ch.Term
	case "delete_term":
		if _, ok := c.Glossary[ch.Key]; !ok {
			return fmt.Errorf("no term %q", ch.Key)
		}
		delete(c.Glossary, ch.Key)
	case "set_passport":
		return c.setPassport(ch.Fields)
	default:
		return fmt.Errorf("unknown op; known: put_node, delete_node, put_term, delete_term, set_passport")
	}
	return nil
}

// find returns the slice holding the node with id and its index there, or nil.
func (c *Course) find(id string) (*[]*Node, int) {
	var search func(list *[]*Node) (*[]*Node, int)
	search = func(list *[]*Node) (*[]*Node, int) {
		for i, n := range *list {
			if n.ID == id {
				return list, i
			}
			if l, j := search(&n.Children); l != nil {
				return l, j
			}
		}
		return nil, 0
	}
	return search(&c.Root)
}

// FindNode returns the node with id, or nil.
func (c *Course) FindNode(id string) *Node {
	if list, i := c.find(id); list != nil {
		return (*list)[i]
	}
	return nil
}

func (c *Course) setPassport(fields map[string]json.RawMessage) error {
	if len(fields) == 0 {
		return fmt.Errorf("fields are required")
	}
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	for k, v := range fields {
		if !slices.Contains(PassportFields, k) {
			return fmt.Errorf("field %q cannot be changed here; allowed: %v", k, PassportFields)
		}
		m[k] = v
	}
	data, err = json.Marshal(m)
	if err != nil {
		return err
	}
	nc, err := Decode(data)
	if err != nil {
		return err
	}
	*c = *nc
	return nil
}

// DecodeChanges reads a list of changes; unknown fields are an error, as in a course.
func DecodeChanges(data []byte) ([]Change, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	dec.DisallowUnknownFields()
	var out []Change
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}
