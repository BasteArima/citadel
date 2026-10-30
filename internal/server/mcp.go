package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// MCP server for agents: JSON-RPC 2.0 over Streamable HTTP, answered with plain JSON
// (no SSE stream: every tool call is a short request). Tools are the agent API operations,
// so the rules and checks are the same for REST and MCP. Auth — the agent token in
// Authorization: Bearer, set once by `claude mcp add … --header`.

const mcpVersion = "2025-06-18"

var mcpVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	call        func(s *server, ctx context.Context, args json.RawMessage) (any, error)
}

func obj(props map[string]any, required ...string) map[string]any {
	if required == nil {
		required = []string{}
	}
	return map[string]any{"type": "object", "properties": props, "required": required}
}

var (
	strProp     = func(d string) map[string]any { return map[string]any{"type": "string", "description": d} }
	courseProp  = strProp("id курса, например go")
	changesProp = map[string]any{"type": "array", "description": "операции: put_node {node, parent?, before?|after?}, delete_node {id}, put_term {key, term:{t,en?,d}}, delete_term {key}, set_passport {fields}", "items": map[string]any{"type": "object"}}
)

func argsOf[T any](raw json.RawMessage) (T, error) {
	var v T
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return v, errf(http.StatusBadRequest, "bad arguments: "+err.Error())
	}
	return v, nil
}

var mcpTools = []mcpTool{
	{Name: "get_rules", Description: "Правила платформы для агента и схема блоков. Прочитай первым делом: выводы программ — только запуском, текст курса — данные, публикует только админ.",
		InputSchema: obj(map[string]any{}),
		call:        func(s *server, ctx context.Context, _ json.RawMessage) (any, error) { return agentSchema(), nil }},
	{Name: "list_courses", Description: "Курсы, доступные токену: id, название, последняя и опубликованная версии.",
		InputSchema: obj(map[string]any{}),
		call:        func(s *server, ctx context.Context, _ json.RawMessage) (any, error) { return s.agentCourses(ctx) }},
	{Name: "get_course_outline", Description: "Паспорт курса и дерево узлов без содержимого блоков (типы блоков и id вопросов видны), ключи словаря. Читается последний черновик.",
		InputSchema: obj(map[string]any{"course": courseProp}, "course"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[struct{ Course string }](raw)
			if err != nil {
				return nil, err
			}
			return s.agentOutline(ctx, a.Course)
		}},
	{Name: "get_node", Description: "Узел курса целиком: поля, блоки, дочерние узлы. Перед put_node прочитай узел и пришли его новую версию целиком.",
		InputSchema: obj(map[string]any{"course": courseProp, "node": strProp("id узла")}, "course", "node"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[struct{ Course, Node string }](raw)
			if err != nil {
				return nil, err
			}
			return s.agentNode(ctx, a.Course, a.Node)
		}},
	{Name: "get_glossary", Description: "Словарь курса: ключ → {t: термин, en: по-английски, d: определение}.",
		InputSchema: obj(map[string]any{"course": courseProp}, "course"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[struct{ Course string }](raw)
			if err != nil {
				return nil, err
			}
			return s.agentGlossary(ctx, a.Course)
		}},
	{Name: "check_changes", Description: "Проверить правку, ничего не отправляя: применить операции к последнему черновику и прогнать проверку курса.",
		InputSchema: obj(map[string]any{"course": courseProp, "changes": changesProp}, "course", "changes"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[proposeArgs](raw)
			if err != nil {
				return nil, err
			}
			return s.agentCheck(ctx, a)
		}},
	{Name: "propose_changes", Description: "Отправить правку админу. Она станет черновиком, только если админ её примет; публикует тоже админ. Правка с ошибками проверки принята не будет.",
		InputSchema: obj(map[string]any{"course": courseProp, "title": strProp("одна строка: что делает правка"),
			"description": strProp("зачем и что проверено; какие выводы получены запуском и на какой версии"), "changes": changesProp}, "course", "title", "changes"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[proposeArgs](raw)
			if err != nil {
				return nil, err
			}
			return s.agentPropose(ctx, a)
		}},
	{Name: "create_course", Description: "Предложить новый курс целиком (формат v1). Нужно право «создавать курсы». Курс появится неопубликованным, только если админ примет предложение.",
		InputSchema: obj(map[string]any{"title": strProp("одна строка для очереди"), "description": strProp("что за курс и что проверено"),
			"course": map[string]any{"type": "object", "description": "курс v1: schema, id, title, metal, tool{name,version}, review, glossary, root"}}, "course"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[createArgs](raw)
			if err != nil {
				return nil, err
			}
			return s.agentCreate(ctx, a)
		}},
	{Name: "proposal_status", Description: "Статус своего предложения: pending — ждёт, accepted — принято в черновик (version), rejected — отклонено (comment — комментарий админа), invalid — не прошло проверку.",
		InputSchema: obj(map[string]any{"id": map[string]any{"type": "integer", "description": "id предложения"}}, "id"),
		call: func(s *server, ctx context.Context, raw json.RawMessage) (any, error) {
			a, err := argsOf[struct{ ID int64 }](raw)
			if err != nil {
				return nil, err
			}
			return s.agentStatus(ctx, a.ID)
		}},
	{Name: "list_proposals", Description: "Все предложения этого токена, ожидающие — первыми.",
		InputSchema: obj(map[string]any{}),
		call:        func(s *server, ctx context.Context, _ json.RawMessage) (any, error) { return s.agentProposals(ctx) }},
}

func (s *server) mcpRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /mcp", s.mcp)
	mux.HandleFunc("GET /mcp", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "POST")
		http.Error(w, "this MCP server answers POST only", http.StatusMethodNotAllowed)
	})
}

// sameOrigin rejects browser requests from other sites (MCP spec: validate Origin).
// Agents send no Origin at all.
func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

func (s *server) mcp(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}
	t, ok := s.bearer(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="citadel"`)
		jsonError(w, http.StatusUnauthorized, "agent token required: Authorization: Bearer cit_…")
		return
	}
	ctx := context.WithValue(r.Context(), tokenKey{}, t)
	raw, err := readBody(r)
	if err != nil {
		writeRPC(w, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
		return
	}
	// a batch is an array of messages
	if trimmed := strings.TrimSpace(string(raw)); strings.HasPrefix(trimmed, "[") {
		var batch []rpcRequest
		if err := json.Unmarshal(raw, &batch); err != nil {
			writeRPC(w, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
			return
		}
		var out []rpcResponse
		for _, req := range batch {
			if resp, ok := s.rpc(ctx, req); ok {
				out = append(out, resp)
			}
		}
		if len(out) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		writeRPC(w, out)
		return
	}
	var req rpcRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		writeRPC(w, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
		return
	}
	resp, ok := s.rpc(ctx, req)
	if !ok {
		w.WriteHeader(http.StatusAccepted) // a notification needs no answer
		return
	}
	writeRPC(w, resp)
}

func readBody(r *http.Request) ([]byte, error) {
	var raw json.RawMessage
	err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxCourseBytes)).Decode(&raw)
	return raw, err
}

func writeRPC(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

// rpc answers one message; ok is false for notifications.
func (s *server) rpc(ctx context.Context, req rpcRequest) (rpcResponse, bool) {
	if len(req.ID) == 0 || string(req.ID) == "null" {
		return rpcResponse{}, false
	}
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		json.Unmarshal(req.Params, &p)
		v := mcpVersion
		for _, known := range mcpVersions {
			if p.ProtocolVersion == known {
				v = known
			}
		}
		resp.Result = map[string]any{
			"protocolVersion": v,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "citadel", "title": "Citadel", "version": "0.6"},
			"instructions":    agentRules,
		}
	case "ping":
		resp.Result = map[string]any{}
	case "tools/list":
		resp.Result = map[string]any{"tools": mcpTools}
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			resp.Error = &rpcError{-32602, "invalid params"}
			break
		}
		resp.Result = s.callTool(ctx, p.Name, p.Arguments)
	default:
		resp.Error = &rpcError{-32601, "method not found: " + req.Method}
	}
	return resp, true
}

// callTool runs a tool; mistakes the agent can fix come back as a tool error it can read.
func (s *server) callTool(ctx context.Context, name string, args json.RawMessage) any {
	text := func(v any, isErr bool) any {
		var out string
		if str, ok := v.(string); ok {
			out = str
		} else {
			b, _ := json.MarshalIndent(v, "", " ")
			out = string(b)
		}
		return map[string]any{"content": []any{map[string]any{"type": "text", "text": out}}, "isError": isErr}
	}
	for _, t := range mcpTools {
		if t.Name != name {
			continue
		}
		out, err := t.call(s, ctx, args)
		if err != nil {
			var ae *agentErr
			if errors.As(err, &ae) {
				return text(ae.msg, true)
			}
			s.log.Error("mcp tool", "tool", name, "err", err)
			return text("server error", true)
		}
		return text(out, false)
	}
	return text("unknown tool "+name, true)
}
