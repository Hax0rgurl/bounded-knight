package main

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

func (s *Store) rest(req *http.Request, b M) answer {
	path := strings.TrimPrefix(req.URL.Path, "/api/v3")
	method := req.Method
	if path == "" || path == "/" {
		if method == "GET" {
			return ok(M{"current_user_url": "/api/v3/user"})
		}
		return notFound()
	}
	if path == "/meta" && method == "GET" {
		return ok(M{"installed_version": "goof-1.0.0"})
	}
	if path == "/user" && method == "GET" {
		return ok(s.user())
	}
	var q url.Values
	if req.URL.RawQuery != "" {
		q = req.URL.Query()
	}
	if path == "/user/repos" {
		if method == "POST" {
			r, e := s.create(b)
			return from(r, e, 201)
		}
		if method == "GET" {
			rs := make([]*Repo, 0, len(s.repos))
			for _, r := range s.repos {
				rs = append(rs, r)
			}
			sort.Slice(rs, func(i, j int) bool { return rs[i].ID < rs[j].ID })
			return page(rs, q, req.URL.Path, req.Host)
		}
	}
	path, yes := strings.CutPrefix(path, "/repos/")
	if !yes {
		return notFound()
	}
	owner, tail, yes := strings.Cut(path, "/")
	if !yes {
		return notFound()
	}
	name, tail, _ := strings.Cut(tail, "/")
	r := s.repo(owner, name)
	if r == nil {
		return notFound()
	}
	if tail == "" {
		switch method {
		case "GET":
			return ok(r)
		case "PATCH":
			if v, ok := b["description"].(string); ok {
				r.Description = v
			}
			if v, ok := b["private"].(bool); ok {
				r.Private = v
			}
			if v, ok := b["has_issues"].(bool); ok {
				r.HasIssues = v
			}
			if v := str(b, "default_branch"); v != "" {
				if !validRef("refs/heads/" + v) {
					return from(nil, errAPI(422, "Invalid branch"), 422)
				}
				r.DefaultBranch = v
				r.refsChanged()
			}
			return ok(r)
		case "DELETE":
			delete(s.repos, name)
			delete(s.nodes, r.Node)
			for _, i := range r.issues {
				delete(s.nodes, i.Node)
				for _, c := range i.comments {
					delete(s.nodes, c.Node)
				}
			}
			for _, p := range r.pulls {
				delete(s.nodes, p.Node)
			}
			return answer{status: 204}
		}
	}
	resource, rest, _ := strings.Cut(tail, "/")
	switch resource {
	case "branches":
		if method != "GET" {
			break
		}
		branch := func(name string, id oid) M { return M{"name": name, "commit": M{"sha": hexID(id)}, "protected": false} }
		if rest != "" {
			if id := r.refs["refs/heads/"+rest]; id != zero {
				return ok(branch(rest, id))
			}
			return notFound()
		}
		bs := []M{}
		for _, ref := range refNames(r) {
			if name, ok := strings.CutPrefix(ref, "refs/heads/"); ok {
				bs = append(bs, branch(name, r.refs[ref]))
			}
		}
		return ok(bs)
	case "git":
		kind, ref, _ := strings.Cut(rest, "/")
		if kind != "refs" && kind != "ref" {
			break
		}
		if method == "POST" && ref == "" {
			id := parseID(str(b, "sha"))
			ref = str(b, "ref")
			if !validRef(ref) || !s.validObjectRef(ref, id) || !s.objects.connected(id) {
				return from(nil, errAPI(422, "Invalid reference"), 422)
			}
			if r.refs[ref] != zero {
				return from(nil, errAPI(422, "Reference already exists"), 422)
			}
			r.setRef(ref, id)
			return answer{status: 201, body: s.refResponse(ref, id)}
		}
		if !strings.HasPrefix(ref, "refs/") {
			ref = "refs/" + ref
		}
		id := r.refs[ref]
		if id == zero {
			return notFound()
		}
		switch method {
		case "GET":
			return ok(s.refResponse(ref, id))
		case "DELETE":
			r.setRef(ref, zero)
			return answer{status: 204}
		case "PATCH":
			newID := parseID(str(b, "sha"))
			if !s.validObjectRef(ref, newID) || (!flag(b, "force") && !s.objects.ancestor(id, newID)) || !s.objects.connected(newID) {
				return from(nil, errAPI(422, "Invalid update"), 422)
			}
			r.setRef(ref, newID)
			return ok(s.refResponse(ref, newID))
		}
	case "contents":
		return s.contents(r, rest, method, b, q)
	case "commits":
		if method != "GET" {
			break
		}
		id := s.tip(r, defaultString(q.Get("sha"), rest))
		if id == zero && rest != "" {
			return notFound()
		}
		list := []M{}
		if id != zero {
			s.objects.walkParents([]oid{id}, func(id oid) bool {
				c := s.objects.commit(id)
				if c == nil {
					return false
				}
				ps := make([]M, 0, len(c.parents))
				for _, p := range c.parents {
					ps = append(ps, M{"sha": hexID(p)})
				}
				list = append(list, M{"sha": hexID(id), "commit": M{"message": c.message, "tree": M{"sha": hexID(c.tree)}}, "parents": ps})
				return rest != ""
			})
		}
		if rest != "" {
			if len(list) > 0 {
				return ok(list[0])
			}
			return notFound()
		}
		return page(list, q, req.URL.Path, req.Host)
	case "labels":
		if rest != "" {
			break
		}
		if method == "POST" {
			name := str(b, "name")
			if name == "" {
				return from(nil, errAPI(422, "name is required"), 422)
			}
			s.seq++
			l := M{"id": s.seq, "name": name, "color": defaultString(str(b, "color"), "ededed"), "description": str(b, "description")}
			r.labels[name] = l
			return answer{status: 201, body: l}
		}
		if method == "GET" {
			ls := []M{}
			for _, l := range r.labels {
				ls = append(ls, l)
			}
			sort.Slice(ls, func(i, j int) bool { return num(ls[i], "id") < num(ls[j], "id") })
			return ok(ls)
		}
	case "issues":
		if rest == "" {
			if method == "POST" {
				i, e := s.issue(r, b)
				return from(i, e, 201)
			}
			if method == "GET" {
				return page(r.listIssues(q.Get("state"), q.Get("direction") == "asc"), q, req.URL.Path, req.Host)
			}
			break
		}
		number, sub, _ := strings.Cut(rest, "/")
		n, _ := strconv.Atoi(number)
		i := r.issues[n]
		if i == nil {
			return notFound()
		}
		if sub == "comments" {
			if method == "GET" {
				return page(i.comments, q, req.URL.Path, req.Host)
			}
			if method == "POST" {
				c, e := s.comment(r, i, b)
				return from(c, e, 201)
			}
		}
		if sub == "" {
			switch method {
			case "GET":
				return s.readIssue(i)
			case "PATCH":
				return from(i, s.updateIssue(i, b), 200)
			}
		}
	case "pulls":
		if rest == "" {
			if method == "POST" {
				p, e := s.pull(r, b)
				return from(p, e, 201)
			}
			if method == "GET" {
				list := []*Pull{}
				for _, p := range r.pulls {
					if stateMatch(q.Get("state"), p.State) {
						list = append(list, p)
					}
				}
				sort.Slice(list, func(i, j int) bool { return list[i].Number > list[j].Number })
				return page(list, q, req.URL.Path, req.Host)
			}
			break
		}
		number, sub, _ := strings.Cut(rest, "/")
		n, _ := strconv.Atoi(number)
		p := r.pulls[n]
		if p == nil {
			return notFound()
		}
		if sub == "files" && method == "GET" {
			return page(s.diff(r, p), q, req.URL.Path, req.Host)
		}
		if sub == "merge" && method == "PUT" {
			m, e := s.merge(r, p)
			return from(m, e, 200)
		}
		if sub == "" {
			if method == "GET" {
				return ok(p)
			}
			if method == "PATCH" {
				if v, ok := b["title"].(string); ok {
					p.Title = v
				}
				if v, ok := b["body"].(string); ok {
					p.Body = v
				}
				if v := str(b, "state"); v == "open" || v == "closed" {
					p.State = v
				}
				return ok(p)
			}
		}
	}
	return notFound()
}
func (s *Store) validObjectRef(ref string, id oid) bool {
	obj := s.objects.all[id]
	return obj != nil && (!strings.HasPrefix(ref, "refs/heads/") || obj.kind == 1)
}
func (s *Store) refResponse(ref string, id oid) M {
	return M{"ref": ref, "object": M{"sha": hexID(id), "type": kindNames[s.objects.all[id].kind]}}
}
func (s *Store) file(path string, e fileEntry) M {
	_, name := splitLast(path)
	var data []byte
	if o := s.objects.all[e.id]; o != nil {
		data = o.data
	}
	return M{"name": name, "path": path, "type": "file", "sha": hexID(e.id), "size": len(data), "encoding": "base64", "content": base64.StdEncoding.EncodeToString(data)}
}
func splitLast(s string) (string, string) {
	at := strings.LastIndexByte(s, '/')
	if at < 0 {
		return "", s
	}
	return s[:at], s[at+1:]
}
func (s *Store) contents(r *Repo, path, method string, b M, q url.Values) answer {
	branch := defaultString(str(b, "branch"), r.DefaultBranch)
	if method == "GET" {
		tip := s.tip(r, defaultString(q.Get("ref"), branch))
		c := s.objects.commit(tip)
		if c == nil {
			return notFound()
		}
		id := c.tree
		path = strings.Trim(path, "/")
		if path != "" {
			prefix := ""
			for _, part := range strings.Split(path, "/") {
				found := false
				for _, e := range s.objects.entries(id) {
					if e.name != part {
						continue
					}
					found = true
					if e.mode != "40000" && e.mode != "040000" {
						if prefix+part != path {
							return notFound()
						}
						return ok(s.file(path, fileEntry{e.mode, e.id}))
					}
					id = e.id
					break
				}
				if !found {
					return notFound()
				}
				prefix += part + "/"
			}
		}
		list := []M{}
		prefix := path
		if prefix != "" {
			prefix += "/"
		}
		for _, e := range s.objects.entries(id) {
			if e.mode == "40000" || e.mode == "040000" {
				list = append(list, M{"name": e.name, "path": prefix + e.name, "type": "dir", "sha": hexID(e.id), "size": 0})
			} else {
				list = append(list, s.file(prefix+e.name, fileEntry{e.mode, e.id}))
			}
		}
		return ok(list)
	}
	if method != "PUT" && method != "DELETE" {
		return notFound()
	}
	if !validRef("refs/heads/"+branch) || path == "" || strings.ContainsRune(path, 0) {
		return from(nil, errAPI(422, "Invalid path or branch"), 422)
	}
	for _, p := range strings.Split(path, "/") {
		if p == "" || p == "." || p == ".." {
			return from(nil, errAPI(422, "Invalid path"), 422)
		}
	}
	ref := "refs/heads/" + branch
	tip := r.refs[ref]
	files := s.objects.files(tip)
	old, exists := files[path]
	if method == "DELETE" && !exists {
		return notFound()
	}
	sha := str(b, "sha")
	if (exists && parseID(sha) != old.id) || (!exists && sha != "") {
		return from(nil, errAPI(409, "SHA does not match"), 409)
	}
	var content M
	status := 200
	if method == "DELETE" {
		delete(files, path)
	} else {
		encoded, valid := b["content"].(string)
		if !valid {
			return from(nil, errAPI(422, "content is required"), 422)
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(encoded)
		}
		if err != nil {
			return from(nil, errAPI(422, "Invalid base64"), 422)
		}
		for n := range files {
			if strings.HasPrefix(n, path+"/") || strings.HasPrefix(path, n+"/") {
				return from(nil, errAPI(422, "File and directory paths overlap"), 422)
			}
		}
		e := fileEntry{defaultString(old.mode, "100644"), s.objects.put(3, data)}
		files[path] = e
		content = s.file(path, e)
		if !exists {
			status = 201
		}
	}
	id := s.objects.makeCommit(files, tip, defaultString(str(b, "message"), "Update "+path))
	r.setRef(ref, id)
	return answer{status: status, body: M{"content": content, "commit": M{"sha": hexID(id)}}}
}
