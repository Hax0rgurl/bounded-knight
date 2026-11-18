package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var gqlLex = regexp.MustCompile(`"(?:\\.|[^"\\])*"|#[^\r\n]*|\.\.\.|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s,]`)
var gqlName = regexp.MustCompile(`^[A-Za-z_][A-Za-z_0-9]*$`)

type field struct {
	name, alias, fragment, on string
	args                      M
	children                  []field
}
type operation struct {
	name, kind string
	fields     []field
}
type gqlParser struct {
	tokens    []string
	i, depth  int
	vars      M
	fragments map[string]field
}
type gqlError string

func (e gqlError) Error() string { return string(e) }
func (p *gqlParser) peek() string {
	if p.i < len(p.tokens) {
		return p.tokens[p.i]
	}
	return ""
}
func (p *gqlParser) take() string {
	t := p.peek()
	if t == "" {
		panic(gqlError("Unexpected end of document"))
	}
	p.i++
	return t
}
func (p *gqlParser) expect(w string) {
	if p.take() != w {
		panic(gqlError("Expected " + w))
	}
}
func (p *gqlParser) name() string {
	t := p.take()
	if !gqlName.MatchString(t) {
		panic(gqlError("Expected name"))
	}
	return t
}
func (p *gqlParser) enter() func() {
	p.depth++
	if p.depth > 80 {
		panic(gqlError("Document nesting limit exceeded"))
	}
	return func() { p.depth-- }
}
func (p *gqlParser) value() any {
	defer p.enter()()
	t := p.take()
	switch t {
	case "$":
		return p.vars[p.name()]
	case "{":
		m := M{}
		for p.peek() != "}" {
			n := p.name()
			p.expect(":")
			m[n] = p.value()
		}
		p.take()
		return m
	case "[":
		a := []any{}
		for p.peek() != "]" {
			a = append(a, p.value())
		}
		p.take()
		return a
	case "null":
		return nil
	case "true":
		return true
	case "false":
		return false
	}
	if t[0] == '"' {
		var v string
		if json.Unmarshal([]byte(t), &v) != nil {
			panic(gqlError("Invalid string literal"))
		}
		return v
	}
	if n, err := strconv.ParseFloat(t, 64); err == nil {
		return n
	}
	if !gqlName.MatchString(t) {
		panic(gqlError("Invalid value"))
	}
	return t
}
func (p *gqlParser) args() M {
	if p.peek() != "(" {
		return nil
	}
	p.take()
	m := M{}
	for p.peek() != ")" {
		key := p.name()
		p.expect(":")
		m[key] = p.value()
	}
	p.take()
	return m
}
func (p *gqlParser) include() bool {
	include := true
	for p.peek() == "@" {
		p.take()
		name := p.name()
		a := p.args()
		if (name == "skip" && flag(a, "if")) || (name == "include" && !flag(a, "if")) {
			include = false
		}
	}
	return include
}
func (p *gqlParser) selection() []field {
	defer p.enter()()
	p.expect("{")
	var a []field
	for p.peek() != "}" {
		var f field
		if p.peek() == "..." {
			p.take()
			name := p.name()
			if name == "on" {
				f.on = p.name()
				include := p.include()
				f.children = p.selection()
				if !include {
					continue
				}
			} else {
				f.fragment = name
				if !p.include() {
					continue
				}
			}
		} else {
			f.name = p.name()
			f.alias = f.name
			if p.peek() == ":" {
				p.take()
				f.name = p.name()
			}
			f.args = p.args()
			include := p.include()
			if p.peek() == "{" {
				f.children = p.selection()
			}
			if !include {
				continue
			}
		}
		a = append(a, f)
	}
	p.take()
	return a
}
func (p *gqlParser) typeExpr() {
	defer p.enter()()
	if p.peek() == "[" {
		p.take()
		p.typeExpr()
		p.expect("]")
	} else {
		p.name()
	}
	if p.peek() == "!" {
		p.take()
	}
}
func (p *gqlParser) parse(opName string) (operation, map[string]field) {
	var ops []operation
	for p.peek() != "" {
		if p.peek() == "fragment" {
			p.take()
			key := p.name()
			p.expect("on")
			on := p.name()
			p.include()
			p.fragments[key] = field{on: on, children: p.selection()}
			continue
		}
		op := operation{kind: "Query"}
		if p.peek() != "{" {
			switch p.take() {
			case "query":
			case "mutation":
				op.kind = "Mutation"
			default:
				panic(gqlError("Unsupported operation"))
			}
			if gqlName.MatchString(p.peek()) {
				op.name = p.name()
			}
			if p.peek() == "(" {
				p.take()
				for p.peek() != ")" {
					p.expect("$")
					key := p.name()
					p.expect(":")
					p.typeExpr()
					if p.peek() == "=" {
						p.take()
						value := p.value()
						if _, ok := p.vars[key]; !ok && (opName == "" || op.name == opName) {
							p.vars[key] = value
						}
					}
				}
				p.take()
			}
		}
		p.include()
		op.fields = p.selection()
		ops = append(ops, op)
	}
	if opName == "" && len(ops) == 1 {
		return ops[0], p.fragments
	}
	if opName != "" {
		for _, op := range ops {
			if op.name == opName {
				return op, p.fragments
			}
		}
	}
	panic(gqlError("Operation name required or unknown"))
}

var gqlFields = map[string]string{
	"Issue":       "id number title state body",
	"PullRequest": "id number headRefName baseRefName mergeable state merged files",
	"Repository":  "id databaseId name nameWithOwner owner defaultBranchRef viewerPermission hasIssuesEnabled issue issues pullRequests pullRequest",
}
var gqlEnums = map[string]string{
	"SearchType": "ISSUE REPOSITORY USER", "IssueState": "OPEN CLOSED", "PullRequestState": "OPEN CLOSED MERGED", "MergeableState": "MERGEABLE CONFLICTING UNKNOWN",
	"OrderDirection": "ASC DESC", "IssueOrderField": "CREATED_AT UPDATED_AT COMMENTS", "PullRequestMergeMethod": "MERGE SQUASH REBASE", "RepositoryPermission": "ADMIN MAINTAIN WRITE TRIAGE READ",
}

type gqlObject struct {
	kind  string
	value any
	repo  *Repo
}

func gobj(kind string, value any, repo *Repo) gqlObject { return gqlObject{kind, value, repo} }
func gqlNames(names string) []any {
	out := []any{}
	for _, name := range strings.Fields(names) {
		out = append(out, M{"name": name})
	}
	return out
}
func objectMap(a any) M { m, _ := a.(M); return m }
func (s *Store) graphql(doc any) (out any) {
	if batch, ok := doc.([]any); ok {
		out := make([]any, 0, len(batch))
		for _, d := range batch {
			out = append(out, s.graphql(d))
		}
		return out
	}
	defer func() {
		if e := recover(); e != nil {
			if g, ok := e.(gqlError); ok {
				out = gqlFailure(g)
			} else {
				panic(e)
			}
		}
	}()
	d := objectMap(doc)
	source := str(d, "query")
	if len(source) > 1<<20 {
		return gqlFailure(errors.New("GraphQL document too large"))
	}
	p := gqlParser{vars: M{}, fragments: map[string]field{}}
	for k, v := range objectMap(d["variables"]) {
		p.vars[k] = v
	}
	for _, t := range gqlLex.FindAllString(source, -1) {
		if t[0] != '#' {
			p.tokens = append(p.tokens, t)
		}
	}
	op, fragments := p.parse(str(d, "operationName"))
	budget := 100000
	data, err := s.execute(gobj(op.kind, nil, nil), op.fields, fragments, 0, &budget)
	if err != nil {
		return gqlFailure(err)
	}
	return M{"data": data}
}
func gqlFailure(e error) M { return M{"data": nil, "errors": []M{{"message": e.Error()}}} }
func (s *Store) execute(obj any, selection []field, fragments map[string]field, depth int, budget *int) (any, error) {
	if obj == nil {
		return nil, nil
	}
	if len(selection) == 0 {
		return obj, nil
	}
	*budget -= len(selection)
	if depth > 80 || *budget < 0 {
		return nil, errors.New("GraphQL execution limit exceeded")
	}
	if list, ok := obj.([]any); ok {
		a := make([]any, 0, len(list))
		for _, v := range list {
			x, e := s.execute(v, selection, fragments, depth+1, budget)
			if e != nil {
				return nil, e
			}
			a = append(a, x)
		}
		return a, nil
	}
	result := M{}
	for _, f := range selection {
		if f.fragment != "" || f.on != "" {
			if f.fragment != "" {
				v, ok := fragments[f.fragment]
				if !ok {
					return nil, errors.New("Unknown fragment " + f.fragment)
				}
				f = v
			}
			if g, ok := obj.(gqlObject); ok && f.on != "" && g.kind != f.on && f.on != "Node" {
				continue
			}
			x, e := s.execute(obj, f.children, fragments, depth+1, budget)
			if e != nil {
				return nil, e
			}
			for k, v := range objectMap(x) {
				result[k] = v
			}
			continue
		}
		v, e := s.resolve(obj, f)
		if e != nil {
			return nil, e
		}
		v, e = s.execute(v, f.children, fragments, depth+1, budget)
		if e != nil {
			return nil, e
		}
		result[f.alias] = v
	}
	return result, nil
}
func nodeObject(n node) any {
	switch v := n.value.(type) {
	case *Repo:
		return gobj("Repository", v, v)
	case *Issue:
		return gobj("Issue", v, n.repo)
	case *Pull:
		return gobj("PullRequest", v, n.repo)
	case *Comment:
		return gobj("Comment", v, n.repo)
	}
	return nil
}
func (s *Store) mutate(name string, b M) (any, error) {
	switch name {
	case "createIssue", "createPullRequest":
		r, ok := s.nodes[str(b, "repositoryId")].value.(*Repo)
		if !ok {
			return nil, missing
		}
		if name == "createIssue" {
			i, e := s.issue(r, b)
			return M{"issue": gobj("Issue", i, r)}, e
		}
		p, e := s.pull(r, M{"head": str(b, "headRefName"), "base": str(b, "baseRefName"), "title": str(b, "title"), "body": str(b, "body")})
		return M{"pullRequest": gobj("PullRequest", p, r)}, e
	case "closeIssue", "addComment":
		key := "issueId"
		if name == "addComment" {
			key = "subjectId"
		}
		n := s.nodes[str(b, key)]
		i, ok := n.value.(*Issue)
		if !ok {
			return nil, missing
		}
		if name == "closeIssue" {
			e := s.updateIssue(i, M{"state": "closed"})
			return M{"issue": gobj("Issue", i, n.repo)}, e
		}
		c, e := s.comment(n.repo, i, b)
		return M{"commentEdge": M{"node": gobj("Comment", c, n.repo)}}, e
	case "mergePullRequest":
		n := s.nodes[str(b, "pullRequestId")]
		p, ok := n.value.(*Pull)
		if !ok {
			return nil, missing
		}
		_, e := s.merge(n.repo, p)
		return M{"pullRequest": gobj("PullRequest", p, n.repo)}, e
	}
	return nil, fmt.Errorf("Cannot query field %q on type Mutation", name)
}
func (s *Store) resolve(obj any, f field) (any, error) {
	name, a := f.name, f.args
	if m, ok := obj.(M); ok {
		if v, yes := m[name]; yes {
			return v, nil
		}
		return nil, fmt.Errorf("Unknown field %q", name)
	}
	x, ok := obj.(gqlObject)
	if !ok {
		return nil, fmt.Errorf("Cannot select field %q", name)
	}
	if name == "__typename" {
		return x.kind, nil
	}
	switch x.kind {
	case "Query":
		switch name {
		case "viewer":
			return gobj("User", s.user(), nil), nil
		case "repository":
			r := s.repo(str(a, "owner"), str(a, "name"))
			if r == nil {
				return nil, nil
			}
			return gobj("Repository", r, r), nil
		case "node":
			return nodeObject(s.nodes[str(a, "id")]), nil
		case "__type":
			n := str(a, "name")
			if gqlFields[n] == "" && gqlEnums[n] == "" {
				return nil, nil
			}
			return gobj("__Type", n, nil), nil
		}
	case "Mutation":
		return s.mutate(name, objectMap(a["input"]))
	case "__Type":
		n := x.value.(string)
		switch name {
		case "name":
			return n, nil
		case "kind":
			if gqlEnums[n] != "" {
				return "ENUM", nil
			}
			return "OBJECT", nil
		case "fields":
			return gqlNames(gqlFields[n]), nil
		case "enumValues":
			return gqlNames(gqlEnums[n]), nil
		}
	case "User":
		u := x.value.(User)
		switch name {
		case "login":
			return u.Login, nil
		case "id":
			return strconv.Itoa(u.ID), nil
		}
	case "Repository":
		r := x.repo
		switch name {
		case "id":
			return r.Node, nil
		case "databaseId":
			return r.ID, nil
		case "name":
			return r.Name, nil
		case "description":
			return r.Description, nil
		case "nameWithOwner":
			return r.FullName, nil
		case "owner":
			return gobj("User", r.Owner, r), nil
		case "defaultBranchRef":
			return M{"name": r.DefaultBranch}, nil
		case "viewerPermission":
			return "ADMIN", nil
		case "hasIssuesEnabled":
			return r.HasIssues, nil
		case "isPrivate":
			return r.Private, nil
		case "issue":
			if i := r.issues[num(a, "number")]; i != nil {
				return gobj("Issue", i, r), nil
			}
			return nil, nil
		case "pullRequest":
			if p := r.pulls[num(a, "number")]; p != nil {
				return gobj("PullRequest", p, r), nil
			}
			return nil, nil
		case "issues", "pullRequests":
			return connection(r, name, a), nil
		}
	case "Issue":
		i := x.value.(*Issue)
		switch name {
		case "id":
			return i.Node, nil
		case "number":
			return i.Number, nil
		case "title":
			return i.Title, nil
		case "body":
			return i.Body, nil
		case "state":
			return strings.ToUpper(i.State), nil
		case "createdAt":
			return i.Created, nil
		case "updatedAt":
			return i.Updated, nil
		}
	case "Comment":
		c := x.value.(*Comment)
		switch name {
		case "id":
			return c.Node, nil
		case "body":
			return c.Body, nil
		}
	case "PullRequest":
		p := x.value.(*Pull)
		switch name {
		case "id":
			return p.Node, nil
		case "number":
			return p.Number, nil
		case "title":
			return p.Title, nil
		case "body":
			return p.Body, nil
		case "headRefName":
			return p.Head.Ref, nil
		case "baseRefName":
			return p.Base.Ref, nil
		case "merged":
			return p.Merged, nil
		case "state":
			if p.Merged {
				return "MERGED", nil
			}
			return strings.ToUpper(p.State), nil
		case "mergeable":
			if p.State != "open" {
				return "UNKNOWN", nil
			}
			if _, _, err := s.mergeFiles(x.repo, p); err != nil {
				return "CONFLICTING", nil
			}
			return "MERGEABLE", nil
		case "files":
			fs := s.diff(x.repo, p)
			n := len(fs)
			if _, ok := a["first"]; ok {
				n = min(n, max(0, num(a, "first")))
			}
			ns := make([]any, 0, n)
			for _, f := range fs[:n] {
				ns = append(ns, M{"path": f.Path})
			}
			return M{"nodes": ns, "totalCount": len(fs)}, nil
		}
	}
	return nil, fmt.Errorf("Cannot query field %q on type %q", name, x.kind)
}
func connection(r *Repo, name string, a M) M {
	type value struct {
		number, comments int
		object           gqlObject
	}
	var list []value
	states, _ := a["states"].([]any)
	allowed := func(state string) bool {
		if states == nil {
			return true
		}
		for _, v := range states {
			if state == v {
				return true
			}
		}
		return false
	}
	if name == "issues" {
		for _, i := range r.issues {
			if allowed(strings.ToUpper(i.State)) {
				list = append(list, value{i.Number, i.Comments, gobj("Issue", i, r)})
			}
		}
	} else {
		for _, p := range r.pulls {
			state := strings.ToUpper(p.State)
			if p.Merged {
				state = "MERGED"
			}
			if allowed(state) {
				list = append(list, value{p.Number, 0, gobj("PullRequest", p, r)})
			}
		}
	}
	order := objectMap(a["orderBy"])
	desc := str(order, "direction") == "DESC"
	byComments := str(order, "field") == "COMMENTS"
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if desc {
			a, b = b, a
		}
		if byComments && a.comments != b.comments {
			return a.comments < b.comments
		}
		return a.number < b.number
	})
	after, _ := base64.StdEncoding.DecodeString(str(a, "after"))
	offset, _ := strconv.Atoi(string(after))
	offset = min(len(list), max(0, offset))
	first := 30
	if _, ok := a["first"]; ok {
		first = max(0, num(a, "first"))
	}
	end := offset + min(first, len(list)-offset)
	ns, edges := make([]any, 0, end-offset), make([]any, 0, end-offset)
	for i, x := range list[offset:end] {
		ns = append(ns, x.object)
		edges = append(edges, M{"node": x.object, "cursor": base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(offset + i + 1)))})
	}
	return M{"nodes": ns, "edges": edges, "totalCount": len(list), "pageInfo": M{"hasNextPage": end < len(list), "endCursor": base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(end)))}}
}
