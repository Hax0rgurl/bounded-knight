package main

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type M = map[string]any
type User struct {
	Login string `json:"login"`
	ID    int    `json:"id"`
	Type  string `json:"type"`
}
type Identity struct {
	ID   int    `json:"id"`
	Node string `json:"node_id"`
}
type Issue struct {
	Identity
	Number   int    `json:"number"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	State    string `json:"state"`
	Labels   []M    `json:"labels"`
	User     User   `json:"user"`
	Created  string `json:"created_at"`
	Updated  string `json:"updated_at"`
	Comments int    `json:"comments"`
	comments []*Comment
	snapshot []byte
}
type Comment struct {
	Identity
	Body    string `json:"body"`
	User    User   `json:"user"`
	Created string `json:"created_at"`
	Updated string `json:"updated_at"`
}
type RefView struct {
	Ref string `json:"ref"`
	SHA string `json:"sha"`
}
type Pull struct {
	Identity
	Number   int     `json:"number"`
	Title    string  `json:"title"`
	Body     string  `json:"body"`
	State    string  `json:"state"`
	Merged   bool    `json:"merged"`
	Head     RefView `json:"head"`
	Base     RefView `json:"base"`
	User     User    `json:"user"`
	Created  string  `json:"created_at"`
	Updated  string  `json:"updated_at"`
	MergeSHA *string `json:"merge_commit_sha"`
	MergedAt *string `json:"merged_at"`
	base     oid
}
type Repo struct {
	Identity
	Name          string `json:"name"`
	FullName      string `json:"full_name"`
	Owner         User   `json:"owner"`
	Private       bool   `json:"private"`
	Description   string `json:"description"`
	DefaultBranch string `json:"default_branch"`
	HasIssues     bool   `json:"has_issues"`
	Created       string `json:"created_at"`
	Updated       string `json:"updated_at"`
	refs          map[string]oid
	issues        map[int]*Issue
	pulls         map[int]*Pull
	labels        map[string]M
	serial        int
	receive       []byte
	refReplies    map[string][]byte
	uploadReplies [2]uploadReply
	nextUpload    int
}
type node struct {
	repo  *Repo
	value any
}
type Store struct {
	mu              sync.RWMutex
	login, now      string
	seq             int
	repos           map[string]*Repo
	nodes           map[string]node
	objects         objects
	fetch           map[string][]byte
	fetchGeneration uint64
	fetchBytes      int
}

func newStore(login, now string) *Store {
	if now == "" {
		now = "2026-01-01T00:00:00.000Z"
	}
	return &Store{login: login, now: now, repos: map[string]*Repo{}, nodes: map[string]node{}, objects: objects{all: map[oid]*object{}}}
}
func (s *Store) user() User {
	login := s.login
	if login == "" {
		login = "relay"
	}
	return User{login, 1, "User"}
}
func (s *Store) repo(owner, name string) *Repo {
	if owner == "" {
		return nil
	}
	if s.login == "" && s.repos[name] != nil {
		s.login = owner
		for _, r := range s.repos {
			r.Owner.Login = owner
			r.FullName = owner + "/" + r.Name
		}
	}
	if owner != s.login {
		return nil
	}
	return s.repos[name]
}
func (s *Store) identify(kind string) Identity {
	s.seq++
	var plain [48]byte
	b := append(plain[:0], kind...)
	b = strconv.AppendInt(append(b, ':'), int64(s.seq), 10)
	var encoded [64]byte
	return Identity{s.seq, string(base64.StdEncoding.AppendEncode(encoded[:0], b))}
}
func str(m M, key string) string { v, _ := m[key].(string); return v }
func flag(m M, key string) bool  { v, _ := m[key].(bool); return v }
func num(m M, key string) int {
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}
func defaultString(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

type apiError struct {
	code int
	text string
}

func (e apiError) Error() string   { return e.text }
func errAPI(c int, m string) error { return apiError{c, m} }

var missing = apiError{404, "Not Found"}

func validName(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > 100 {
		return false
	}
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-') {
			return false
		}
	}
	return true
}
func (s *Store) create(b M) (*Repo, error) {
	name := str(b, "name")
	if !validName(name) {
		return nil, errAPI(422, "Invalid repository name")
	}
	if s.repos[name] != nil {
		return nil, errAPI(422, "Repository already exists")
	}
	branch := defaultString(str(b, "default_branch"), "main")
	if !validRef("refs/heads/" + branch) {
		return nil, errAPI(422, "Invalid branch")
	}
	user := s.user()
	r := &Repo{Identity: s.identify("Repository"), Name: name, FullName: user.Login + "/" + name, Owner: user, Private: flag(b, "private"), Description: str(b, "description"), DefaultBranch: branch, HasIssues: true, Created: s.now, Updated: s.now, refs: map[string]oid{}, issues: map[int]*Issue{}, pulls: map[int]*Pull{}, labels: map[string]M{}}
	s.repos[name] = r
	s.nodes[r.Node] = node{r, r}
	if flag(b, "auto_init") {
		id := s.objects.put(3, []byte("# "+name+"\n"))
		r.setRef("refs/heads/"+branch, s.objects.makeCommit(map[string]fileEntry{"README.md": {"100644", id}}, zero, "Initial commit"))
	}
	return r, nil
}
func (r *Repo) setRef(name string, id oid) {
	if r.refs[name] == id {
		return
	}
	if id == zero {
		delete(r.refs, name)
	} else {
		r.refs[name] = id
	}
	r.refsChanged()
}
func (r *Repo) refsChanged() {
	r.receive = nil
	r.refReplies = nil
	r.uploadReplies = [2]uploadReply{}
}
func (s *Store) tip(r *Repo, ref string) oid {
	ref = defaultString(ref, r.DefaultBranch)
	for _, name := range []string{ref, "refs/heads/" + ref, "refs/tags/" + ref} {
		if id := r.refs[name]; id != zero {
			return s.peel(id)
		}
	}
	id := parseID(ref)
	if s.objects.all[id] != nil {
		return s.peel(id)
	}
	return zero
}
func (s *Store) peel(id oid) oid {
	for i := 0; i < 32; i++ {
		o := s.objects.all[id]
		if o == nil || o.kind != 4 {
			return id
		}
		id = tagTarget(o)
	}
	return zero
}
func (s *Store) issue(r *Repo, b M) (*Issue, error) {
	title := str(b, "title")
	if title == "" {
		return nil, errAPI(422, "title is required")
	}
	labels := []M{}
	if v := b["labels"]; v != nil {
		list, ok := v.([]any)
		if !ok {
			return nil, errAPI(422, "labels must be an array")
		}
		for _, v := range list {
			name, _ := v.(string)
			if m, ok := v.(M); ok {
				name = str(m, "name")
			}
			label := r.labels[name]
			if label == nil {
				return nil, errAPI(422, "Label does not exist")
			}
			labels = append(labels, label)
		}
	}
	r.serial++
	i := &Issue{Identity: s.identify("Issue"), Number: r.serial, Title: title, Body: str(b, "body"), State: "open", Labels: labels, User: s.user(), Created: s.now, Updated: s.now, comments: []*Comment{}}
	r.issues[i.Number] = i
	s.nodes[i.Node] = node{r, i}
	return i, nil
}
func (s *Store) updateIssue(i *Issue, b M) error {
	state := str(b, "state")
	if state != "" && state != "open" && state != "closed" {
		return errAPI(422, "Invalid issue state")
	}
	if state != "" {
		i.State = state
	}
	if v, ok := b["title"].(string); ok {
		i.Title = v
	}
	if v, ok := b["body"].(string); ok {
		i.Body = v
	}
	i.Updated = s.now
	i.snapshot = nil
	return nil
}
func (s *Store) comment(r *Repo, i *Issue, b M) (*Comment, error) {
	body, ok := b["body"].(string)
	if !ok {
		return nil, errAPI(422, "body is required")
	}
	c := &Comment{s.identify("Comment"), body, s.user(), s.now, s.now}
	i.comments = append(i.comments, c)
	i.Comments++
	i.snapshot = nil
	s.nodes[c.Node] = node{r, c}
	return c, nil
}
func (s *Store) pull(r *Repo, b M) (*Pull, error) {
	head, base := str(b, "head"), defaultString(str(b, "base"), r.DefaultBranch)
	if owner, name, ok := strings.Cut(head, ":"); ok {
		if owner != r.Owner.Login {
			return nil, errAPI(422, "Invalid head owner")
		}
		head = name
	}
	h, a := r.refs["refs/heads/"+head], r.refs["refs/heads/"+base]
	if s.objects.commit(h) == nil || s.objects.commit(a) == nil || str(b, "title") == "" {
		return nil, errAPI(422, "Invalid head, base or title")
	}
	r.serial++
	p := &Pull{Identity: s.identify("PullRequest"), Number: r.serial, Title: str(b, "title"), Body: str(b, "body"), State: "open", Head: RefView{head, hexID(h)}, Base: RefView{base, hexID(a)}, User: s.user(), Created: s.now, Updated: s.now, base: s.objects.base(h, a)}
	r.pulls[p.Number] = p
	s.nodes[p.Node] = node{r, p}
	return p, nil
}

type Diff struct {
	Path    string `json:"filename"`
	State   string `json:"status"`
	A       int    `json:"additions"`
	D       int    `json:"deletions"`
	Changes int    `json:"changes"`
}

func (s *Store) diff(r *Repo, p *Pull) []Diff {
	prior, next := s.objects.files(p.base), s.objects.files(s.pullHead(r, p))
	diff := []Diff{}
	for _, k := range union(prior, next) {
		a, b := prior[k], next[k]
		if a == b {
			continue
		}
		state := "modified"
		if a.id == zero {
			state = "added"
		}
		if b.id == zero {
			state = "removed"
		}
		count := func(id oid) int {
			o := s.objects.all[id]
			if o == nil || len(o.data) == 0 {
				return 0
			}
			n := strings.Count(string(o.data), "\n")
			if o.data[len(o.data)-1] != '\n' {
				n++
			}
			return n
		}
		additions, deletions := count(b.id), count(a.id)
		diff = append(diff, Diff{k, state, additions, deletions, additions + deletions})
	}
	return diff
}
func union(a, b map[string]fileEntry) []string {
	keys := make([]string, 0, len(a)+len(b))
	for k := range a {
		keys = append(keys, k)
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}
func (s *Store) pullHead(r *Repo, p *Pull) oid {
	if id := r.refs["refs/heads/"+p.Head.Ref]; id != zero {
		return id
	}
	return parseID(p.Head.SHA)
}
func (s *Store) merge(r *Repo, p *Pull) (M, error) {
	if p == nil {
		return nil, missing
	}
	if p.Merged {
		return M{"sha": *p.MergeSHA, "merged": true, "message": "Already merged"}, nil
	}
	cur, old, err := s.mergeFiles(r, p)
	if err != nil {
		return nil, err
	}
	id := s.objects.makeCommit(cur, old, p.Title)
	sha := hexID(id)
	r.setRef("refs/heads/"+p.Base.Ref, id)
	p.State = "closed"
	p.Merged = true
	p.MergeSHA = &sha
	p.MergedAt = &s.now
	return M{"sha": sha, "merged": true, "message": "Pull Request successfully merged"}, nil
}

func (s *Store) mergeFiles(r *Repo, p *Pull) (map[string]fileEntry, oid, error) {
	old, h := r.refs["refs/heads/"+p.Base.Ref], r.refs["refs/heads/"+p.Head.Ref]
	if old == zero || h == zero || p.State != "open" {
		return nil, zero, errAPI(405, "Pull request is not mergeable")
	}
	orig, cur, in := s.objects.files(p.base), s.objects.files(old), s.objects.files(h)
	for _, path := range union(orig, in) {
		a, b, c := orig[path], in[path], cur[path]
		if a == b {
			continue
		}
		if c != a && c != b {
			return nil, zero, errAPI(405, "Pull request is not mergeable")
		}
		if b.id == zero {
			delete(cur, path)
		} else {
			cur[path] = b
		}
	}
	if !pathsValid(cur) {
		return nil, zero, errAPI(405, "File and directory conflict")
	}
	return cur, old, nil
}
func pathsValid(files map[string]fileEntry) bool {
	for path := range files {
		for j := strings.LastIndexByte(path, '/'); j >= 0; j = strings.LastIndexByte(path[:j], '/') {
			if _, ok := files[path[:j]]; ok {
				return false
			}
		}
	}
	return true
}
func stateMatch(want, actual string) bool {
	return want == "all" || defaultString(want, "open") == actual
}
func (r *Repo) listIssues(state string, asc bool) []*Issue {
	list := []*Issue{}
	for _, i := range r.issues {
		if stateMatch(state, i.State) {
			list = append(list, i)
		}
	}
	sort.Slice(list, func(a, b int) bool {
		if asc {
			return list[a].Number < list[b].Number
		}
		return list[a].Number > list[b].Number
	})
	return list
}

type answer struct {
	status int
	body   any
	wire   []byte
	link   string
}

func ok(body any) answer { return answer{status: 200, body: body} }
func from(body any, err error, status int) answer {
	if err != nil {
		if e, yes := err.(apiError); yes {
			return answer{status: e.code, body: M{"message": e.text}}
		}
		return answer{status: 500, body: M{"message": "Internal server error"}}
	}
	return answer{status: status, body: body}
}
func notFound() answer { return from(nil, missing, 404) }
func page[T any](vals []T, q url.Values, path, host string) answer {
	size, _ := strconv.Atoi(q.Get("per_page"))
	if size <= 0 {
		size = 30
	}
	size = min(size, 100)
	p, _ := strconv.Atoi(q.Get("page"))
	p = max(p, 1)
	if p > (len(vals)/size)+1 {
		return ok(vals[:0])
	}
	low, high := min((p-1)*size, len(vals)), min(p*size, len(vals))
	out := ok(vals[low:high])
	if high < len(vals) {
		if q == nil {
			q = make(url.Values, 2)
		}
		q.Set("page", strconv.Itoa(p+1))
		q.Set("per_page", strconv.Itoa(size))
		out.link = "<http://" + host + path + "?" + q.Encode() + ">; rel=\"next\""
	}
	return out
}
func (s *Store) readIssue(i *Issue) answer {
	if i.snapshot != nil {
		return answer{status: 200, wire: i.snapshot}
	}
	b, _ := json.Marshal(i)
	if len(b) <= 4096 {
		i.snapshot = b
	}
	return answer{status: 200, wire: b}
}
