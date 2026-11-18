package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

const maxBody = 64 << 20

type Forge struct {
	store         *Store
	authorization string
	seq           atomic.Uint64
}

func newForge(token, login, now string) *Forge {
	auth := ""
	if token != "" {
		auth = "Bearer " + token
	}
	return &Forge{store: newStore(login, now), authorization: auth}
}

var bodyPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func (f *Forge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && r.URL.Path == "/healthz" {
		writeBytes(w, 200, "application/json", []byte("{\"ok\":true}"))
		return
	}
	w.Header().Set("X-GitHub-Request-Id", strconv.FormatUint(f.seq.Add(1), 16))
	if f.authorization == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(f.authorization)) != 1 {
		writeBytes(w, 401, "application/json", []byte("{\"message\":\"Bad credentials\"}"))
		return
	}
	path := r.URL.Path
	owner, name, service, isGit := gitRoute(r)
	if !isGit && path != "/api/v3" && !strings.HasPrefix(path, "/api/v3/") &&
		!((path == "/api/graphql" || path == "/mcp") && r.Method == "POST") {
		writeBytes(w, 404, "application/json", []byte("{\"message\":\"Not Found\"}"))
		return
	}
	var raw []byte
	if r.ContentLength > maxBody {
		writeBytes(w, 413, "application/json", []byte("{\"message\":\"Request too large\"}"))
		return
	}
	if r.Body != nil && r.Body != http.NoBody && r.ContentLength != 0 {
		buf := bodyPool.Get().(*bytes.Buffer)
		buf.Reset()
		defer func() {
			if buf.Cap() <= 64<<10 {
				bodyPool.Put(buf)
			}
		}()
		var err error
		if r.ContentLength > 0 && r.ContentLength <= 64<<10 {
			// net/http has already delimited a request with a known length.
			buf.Grow(int(r.ContentLength))
			raw = buf.AvailableBuffer()[:int(r.ContentLength)]
			_, err = io.ReadFull(r.Body, raw)
		} else {
			_, err = buf.ReadFrom(http.MaxBytesReader(w, r.Body, maxBody))
			raw = buf.Bytes()
		}
		if err != nil {
			var big *http.MaxBytesError
			if errors.As(err, &big) {
				writeBytes(w, 413, "application/json", []byte("{\"message\":\"Request too large\"}"))
			} else {
				writeBytes(w, 400, "application/json", []byte("{\"message\":\"Invalid request body\"}"))
			}
			return
		}
	}
	var doc any = M(nil)
	if !isGit && len(raw) > 0 && json.Unmarshal(raw, &doc) != nil {
		if path == "/mcp" {
			b, _ := json.Marshal(rpcError(nil, -32700, "Parse error"))
			writeBytes(w, 400, "application/json", b)
		} else {
			writeBytes(w, 400, "application/json", []byte("{\"message\":\"Malformed JSON\"}"))
		}
		return
	}
	if isGit {
		v2 := false
		for _, p := range strings.Split(r.Header.Get("Git-Protocol"), ":") {
			if p == "version=2" {
				v2 = true
				break
			}
		}
		b, ok := f.git(r, owner, name, service, v2, raw)
		if !ok {
			writeBytes(w, 404, "application/json", []byte("{\"message\":\"Not Found\"}"))
			return
		}
		kind := "-result"
		if r.Method == "GET" {
			kind = "-advertisement"
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeBytes(w, 200, "application/x-"+service+kind, b)
		return
	}
	status, body, link := f.api(r, doc)
	if link != "" {
		w.Header().Set("Link", link)
	}
	if r.Method == "GET" && (path == "/api/v3" || path == "/api/v3/") {
		w.Header().Set("X-OAuth-Scopes", "repo, read:org")
	}
	writeBytes(w, status, "application/json", body)
}
func writeBytes(w http.ResponseWriter, status int, ctype string, b []byte) {
	h := w.Header()
	h.Set("Content-Type", ctype)
	if status != 204 {
		h.Set("Content-Length", strconv.Itoa(len(b)))
	}
	if status != 200 {
		w.WriteHeader(status)
	}
	if status != 204 && len(b) > 0 {
		_, _ = w.Write(b)
	}
}
func gitRoute(r *http.Request) (string, string, string, bool) {
	if !(r.Method == "GET" || r.Method == "POST") || strings.HasPrefix(r.URL.Path, "/api/") {
		return "", "", "", false
	}
	path := strings.TrimPrefix(r.URL.Path, "/")
	owner, tail, ok := strings.Cut(path, "/")
	if !ok {
		return "", "", "", false
	}
	name, action, ok := strings.Cut(tail, "/")
	if !ok {
		return "", "", "", false
	}
	name, ok = strings.CutSuffix(name, ".git")
	if !ok || name == "" || owner == "" {
		return "", "", "", false
	}
	if r.Method == "GET" {
		if action != "info/refs" {
			return "", "", "", false
		}
		action = r.URL.Query().Get("service")
	}
	if action != upload && action != receive {
		return "", "", "", false
	}
	return owner, name, action, true
}
func (f *Forge) git(req *http.Request, owner, name, service string, v2 bool, body []byte) ([]byte, bool) {
	s := f.store
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.repo(owner, name)
	if r == nil {
		return nil, false
	}
	if req.Method == "GET" {
		return s.advertise(r, service, v2), true
	}
	if service == receive {
		return s.gitReceive(r, body), true
	}
	return s.gitUpload(r, body), true
}
func (f *Forge) api(req *http.Request, doc any) (int, []byte, string) {
	s := f.store
	s.mu.Lock()
	defer s.mu.Unlock()
	var reply answer
	switch req.URL.Path {
	case "/mcp":
		reply = s.mcp(doc)
	case "/api/graphql":
		reply = ok(s.graphql(doc))
	default:
		if b, ok := doc.(M); !ok {
			reply = from(nil, errAPI(400, "Expected a JSON object"), 400)
		} else {
			reply = s.rest(req, b)
		}
	}
	if reply.status != 204 && reply.wire == nil {
		var e error
		reply.wire, e = json.Marshal(reply.body)
		if e != nil {
			return 500, []byte("{\"message\":\"Internal server error\"}"), ""
		}
	}
	return reply.status, reply.wire, reply.link
}

var _ http.Handler = (*Forge)(nil)
