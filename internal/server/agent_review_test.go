package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestReviewerAcceptNewCourse(t *testing.T) {
	for _, transport := range []string{"rest", "mcp"} {
		for _, own := range []bool{false, true} {
			t.Run(transport+"/own="+strconv.FormatBool(own), func(t *testing.T) {
				ts := newTestServer(t)
				admin := signIn(t, ts, "Baste")
				creator := agentToken(t, ts.URL, admin, `{"name":"creator","create":true,"review":true}`)
				reviewer := creator
				if !own {
					// Reviewing another token's new course does not require CanCreate.
					reviewer = agentToken(t, ts.URL, admin, `{"name":"reviewer","review":true,"courses":["pg"]}`)
				}
				limited := agentToken(t, ts.URL, admin, `{"name":"limited","review":true,"courses":["go"]}`)
				c := `{"schema":1,"id":"pg","title":"Postgres","metal":"copper","tool":{"name":"PostgreSQL","version":"18"},"review":[1,3,7],"glossary":{},"root":[{"id":"l","kind":"lesson","title":"Урок","planned":true}]}`
				resp, body := doAgent(t, "POST", ts.URL+"/api/agent/courses", creator, `{"course":`+c+`}`)
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("propose: %d %s", resp.StatusCode, body)
				}
				var p struct{ ID int }
				if err := json.Unmarshal([]byte(body), &p); err != nil {
					t.Fatal(err)
				}
				id := strconv.Itoa(p.ID)
				if r, _ := doAgent(t, "POST", ts.URL+"/api/agent/proposals/"+id+"/accept", limited, `{}`); r.StatusCode != http.StatusNotFound {
					t.Fatalf("accepted outside scope: %d", r.StatusCode)
				}
				if transport == "rest" {
					resp, body = doAgent(t, "POST", ts.URL+"/api/agent/proposals/"+id+"/accept", reviewer, `{}`)
					if resp.StatusCode != http.StatusOK || !strings.Contains(body, `"version":1`) {
						t.Fatalf("accept: %d %s", resp.StatusCode, body)
					}
				} else {
					_, body = doAgent(t, "POST", ts.URL+"/mcp", reviewer, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"accept_proposal","arguments":{"id":`+id+`}}}`)
					if !strings.Contains(body, `"isError":false`) {
						t.Fatalf("MCP accept: %s", body)
					}
				}
				_, body = doAgent(t, "GET", ts.URL+"/api/agent/proposals/"+id, reviewer, "")
				if !strings.Contains(body, `"status":"accepted"`) || !strings.Contains(body, `"decidedBy":"агент `) {
					t.Fatalf("decision not recorded: %s", body)
				}
				_, body = do(t, admin, "GET", ts.URL+"/api/overview", "")
				if !strings.Contains(body, `"soon":[{"id":"pg"`) {
					t.Fatalf("accepted course must remain unpublished: %s", body)
				}
				resp, body = doAgent(t, "POST", ts.URL+"/api/agent/courses/pg/publish", reviewer, `{"version":1}`)
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("publish accepted course: %d %s", resp.StatusCode, body)
				}
			})
		}
	}
}

func TestReviewerCannotAcceptInvalidOwnCourse(t *testing.T) {
	ts := newTestServer(t)
	admin := signIn(t, ts, "Baste")
	token := agentToken(t, ts.URL, admin, `{"name":"reviewer","create":true,"review":true}`)
	_, body := doAgent(t, "POST", ts.URL+"/api/agent/courses", token, `{"course":{"schema":1,"id":"pg","title":"Invalid"}}`)
	var p struct {
		ID     int
		Status string
	}
	if err := json.Unmarshal([]byte(body), &p); err != nil || p.Status != "invalid" {
		t.Fatalf("expected invalid proposal: %s", body)
	}
	resp, body := doAgent(t, "POST", ts.URL+"/api/agent/proposals/"+strconv.Itoa(p.ID)+"/accept", token, `{}`)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("invalid course accepted: %d %s", resp.StatusCode, body)
	}
}
