package main

import "encoding/json"

type tool struct {
	name, description string
	fields            map[string]string
	required          []string
}

var tools = []tool{
	{"create_repo", "Create a repository.", map[string]string{"name": "string", "description": "string", "private": "boolean"}, []string{"name"}},
	{"get_repo", "Read a repository.", map[string]string{"owner": "string", "repo": "string"}, []string{"owner", "repo"}},
	{"create_issue", "Create an issue.", map[string]string{"owner": "string", "repo": "string", "title": "string", "body": "string"}, []string{"owner", "repo", "title"}},
	{"list_issues", "List repository issues.", map[string]string{"owner": "string", "repo": "string", "state": "string"}, []string{"owner", "repo"}},
	{"create_pull_request", "Open a pull request.", map[string]string{"owner": "string", "repo": "string", "title": "string", "body": "string", "head": "string", "base": "string"}, []string{"owner", "repo", "title", "head", "base"}},
	{"merge_pull_request", "Squash and merge a pull request.", map[string]string{"owner": "string", "repo": "string", "pull_number": "number"}, []string{"owner", "repo", "pull_number"}},
}
var toolList = func() []M {
	out := make([]M, 0, len(tools))
	for _, t := range tools {
		props := M{}
		for k, v := range t.fields {
			props[k] = M{"type": v}
		}
		out = append(out, M{"name": t.name, "description": t.description, "inputSchema": M{"type": "object", "properties": props, "required": t.required}})
	}
	return out
}()

func rpcError(id any, code int, message string) M {
	return M{"jsonrpc": "2.0", "id": id, "error": M{"code": code, "message": message}}
}
func (s *Store) mcp(doc any) answer {
	b := objectMap(doc)
	id := b["id"]
	method := str(b, "method")
	p := objectMap(b["params"])
	invalid := func(code int, msg string) answer { return ok(rpcError(id, code, msg)) }
	if str(b, "jsonrpc") != "2.0" || method == "" {
		return invalid(-32600, "Invalid Request")
	}
	var result any
	switch method {
	case "server/discover", "initialize":
		v := "2026-07-28"
		if method == "initialize" {
			if version := str(p, "protocolVersion"); version != "" && version <= "2025-11-25" {
				v = version
			}
		}
		result = M{"protocolVersion": v, "supportedVersions": []string{"2026-07-28", "2025-11-25"}, "serverInfo": M{"name": "GOOF Git Forge", "version": "1.0.0"}, "capabilities": M{"tools": M{"listChanged": false}}}
	case "notifications/initialized":
		return answer{status: 202, body: nil}
	case "ping":
		result = M{}
	case "tools/list":
		result = M{"tools": toolList}
	case "tools/call":
		name := str(p, "name")
		var t *tool
		for i := range tools {
			if tools[i].name == name {
				t = &tools[i]
				break
			}
		}
		if t == nil {
			return invalid(-32601, "Unknown tool")
		}
		args := objectMap(p["arguments"])
		for _, k := range t.required {
			if args[k] == nil || args[k] == "" {
				return invalid(-32602, "Missing required argument "+k)
			}
		}
		for k, v := range args {
			good := true
			switch t.fields[k] {
			case "string":
				_, good = v.(string)
			case "boolean":
				_, good = v.(bool)
			case "number":
				_, good = v.(float64)
			}
			if !good {
				return invalid(-32602, "Invalid type for "+k)
			}
		}
		var v any
		var err error
		if name == "create_repo" {
			v, err = s.create(args)
		} else if r := s.repo(str(args, "owner"), str(args, "repo")); r == nil {
			err = missing
		} else {
			switch name {
			case "get_repo":
				v = r
			case "create_issue":
				v, err = s.issue(r, args)
			case "list_issues":
				v = r.listIssues(str(args, "state"), false)
			case "create_pull_request":
				v, err = s.pull(r, args)
			case "merge_pull_request":
				v, err = s.merge(r, r.pulls[num(args, "pull_number")])
			}
		}
		var message string
		if err != nil {
			message = err.Error()
		} else {
			raw, _ := json.Marshal(v)
			message = string(raw)
		}
		result = M{"content": []M{{"type": "text", "text": message}}, "isError": err != nil}
	default:
		return invalid(-32601, "Method not found")
	}
	return ok(M{"jsonrpc": "2.0", "id": id, "result": result})
}
