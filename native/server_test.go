package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

// TestPublishedBridge exposes the real handler to the published Node clients
// through stdio in environments where binding a socket is unavailable.
func TestPublishedBridge(t *testing.T) {
	if os.Getenv("GOOF_TEST_BRIDGE") != "1" {
		t.Skip("stdio bridge is opt-in")
	}
	forge := newForge("local-test", "", "")
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 65536), 96<<20)
	output := bufio.NewWriter(os.Stdout)
	for input.Scan() {
		var request struct {
			ID                int
			URL, Method, Body string
			Headers           map[string]string
		}
		if err := json.Unmarshal(input.Bytes(), &request); err != nil {
			t.Fatal(err)
		}
		body, err := base64.StdEncoding.DecodeString(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(request.Method, request.URL, bytes.NewReader(body))
		for k, v := range request.Headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		forge.ServeHTTP(w, req)
		json.NewEncoder(output).Encode(M{"id": request.ID, "status": w.Code, "headers": w.Header(), "body": w.Body.Bytes()})
		output.Flush()
	}
	if err := input.Err(); err != nil {
		t.Fatal(err)
	}
}
func request(f *Forge, m, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(m, "http://local"+path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer test")
	w := httptest.NewRecorder()
	f.ServeHTTP(w, r)
	return w
}
func TestCrossSurface(t *testing.T) {
	f := newForge("test", "octopus", "")
	if w := request(f, "POST", "/api/v3/user/repos", `{"name":"garden"}`); w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	rpc := `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"create_issue","arguments":{"owner":"octopus","repo":"garden","title":"Look"}}}`
	if w := request(f, "POST", "/mcp", rpc); w.Code != 200 || strings.Contains(w.Body.String(), `"isError":true`) {
		t.Fatal(w.Code, w.Body.String())
	}
	path := "/api/v3/repos/octopus/garden/issues/1"
	get := func() Issue {
		w := request(f, "GET", path, "")
		var i Issue
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &i) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		return i
	}
	a := get()
	if a.Title != "Look" || a.State != "open" {
		t.Fatal(a)
	}
	query := M{"query": "mutation { closeIssue(input: {issueId: " + strconv.Quote(a.Node) + "}) { issue { state } } }"}
	b, _ := json.Marshal(query)
	if w := request(f, "POST", "/api/graphql", string(b)); !strings.Contains(w.Body.String(), `"state":"CLOSED"`) {
		t.Fatal(w.Body.String())
	}
	if b := get(); b.State != "closed" || b.ID != a.ID {
		t.Fatal(b)
	}
	if w := request(f, "GET", "/api/v3/repos/foreign/garden", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestPackAndMixedRefUpdate(t *testing.T) {
	s := newStore("octopus", "")
	r, _ := s.create(M{"name": "garden"})
	o := &s.objects
	blob := o.put(3, []byte{0, 255, 128, 10})
	files := map[string]fileEntry{"leaf/file": {"100755", blob}}
	base := o.makeCommit(files, zero, "root")
	tip := o.makeCommit(files, base, "tip")
	ids, _, _ := o.closure([]oid{tip}, 0, nil)
	pack := o.pack(ids)
	recipient := newStore("octopus", "")
	staged, err := recipient.objects.unpack(pack)
	if err != nil {
		t.Fatal(err)
	}
	recipient.objects.insert(staged)
	if got := recipient.objects.files(tip)["leaf/file"]; got.id != blob || got.mode != "100755" {
		t.Fatal(got)
	}
	pack[len(pack)-1] ^= 1
	if _, err = recipient.objects.unpack(pack); err == nil {
		t.Fatal("invalid checksum accepted")
	}
	r.setRef("refs/heads/main", base)
	r.setRef("refs/heads/other", tip)
	commands := packet(nil, hexID(base)+" "+hexID(tip)+" refs/heads/main\x00report-status\n")
	commands = packet(commands, hexID(tip)+" "+hexID(base)+" refs/heads/other\n")
	reply := s.gitReceive(r, append(commands, flush...))
	if !bytes.Contains(reply, []byte("non-fast-forward")) || r.refs["refs/heads/main"] != tip || r.refs["refs/heads/other"] != tip {
		t.Fatal(string(reply))
	}
}
func TestFetchCacheScope(t *testing.T) {
	s := newStore("octopus", "")
	r, _ := s.create(M{"name": "garden"})
	o := &s.objects
	late := objectID(3, []byte("late"))
	id := o.makeCommit(map[string]fileEntry{"file": {"100644", late}}, zero, "root")
	r.setRef("refs/heads/main", id)
	fetch := func() []byte {
		p := append(packet(nil, "command=fetch\n"), delim...)
		p = packet(p, "want "+hexID(id)+"\n")
		return s.gitUpload(r, append(p, flush...))
	}
	a, b := fetch(), fetch()
	if &a[0] != &b[0] {
		t.Fatal("cache missed")
	}
	o.put(3, []byte("late"))
	c := fetch()
	if bytes.Equal(a, c) {
		t.Fatal("stale closure")
	}
}

type discardResponse struct {
	header http.Header
	status int
}

func (r *discardResponse) Header() http.Header         { return r.header }
func (r *discardResponse) WriteHeader(n int)           { r.status = n }
func (r *discardResponse) Write(b []byte) (int, error) { return len(b), nil }
func BenchmarkIssueRead(b *testing.B) {
	f := newForge("test", "octopus", "")
	request(f, "POST", "/api/v3/user/repos", `{"name":"garden"}`)
	request(f, "POST", "/api/v3/repos/octopus/garden/issues", `{"title":"Benchmark","body":"Useful body"}`)
	req := httptest.NewRequest("GET", "http://local/api/v3/repos/octopus/garden/issues/1", nil)
	req.Header.Set("Authorization", "Bearer test")
	w := &discardResponse{header: make(http.Header)}
	f.ServeHTTP(w, req)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		f.ServeHTTP(w, req)
	}
}
func BenchmarkIssueWrite(b *testing.B) {
	f := newForge("test", "octopus", "")
	request(f, "POST", "/api/v3/user/repos", `{"name":"garden"}`)
	req := httptest.NewRequest("POST", "http://local/api/v3/repos/octopus/garden/issues", nil)
	req.Header.Set("Authorization", "Bearer test")
	input := strings.NewReader("")
	req.Body = io.NopCloser(input)
	payload := `{"title":"Benchmark","body":"Useful body"}`
	req.ContentLength = int64(len(payload))
	w := &discardResponse{header: make(http.Header)}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		input.Reset(payload)
		f.ServeHTTP(w, req)
	}
}
func BenchmarkPackInflate(b *testing.B) {
	o := objects{all: map[oid]*object{}}
	files := map[string]fileEntry{"data.txt": {"100644", o.put(3, bytes.Repeat([]byte("test"), 256))}}
	id := o.makeCommit(files, zero, "sample")
	ids, _, _ := o.closure([]oid{id}, 0, nil)
	raw := o.pack(ids)
	r := objects{all: map[oid]*object{}}
	b.ReportAllocs()
	b.SetBytes(int64(len(raw)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := r.unpack(raw); err != nil {
			b.Fatal(err)
		}
	}
}

func TestPushRejectsMissingLinkedObject(t *testing.T) {
	s := newStore("octopus", "")
	r, _ := s.create(M{"name": "garden"})
	late := objectID(3, []byte("missing"))
	id := s.objects.makeCommit(map[string]fileEntry{"file": {"100644", late}}, zero, "root")
	data := append(packet(nil, zeroHex+" "+hexID(id)+" refs/heads/main\x00report-status\n"), flush...)
	first := s.gitReceive(r, data)
	if !bytes.Contains(first, []byte("missing linked object")) || r.refs["refs/heads/main"] != zero {
		t.Fatal(string(first))
	}
	s.objects.put(3, []byte("missing"))
	second := s.gitReceive(r, data)
	if !bytes.Contains(second, []byte("ok refs/heads/main")) || r.refs["refs/heads/main"] != id {
		t.Fatal(string(second))
	}
}

func BenchmarkConcurrentClone(b *testing.B) {
	f := newForge("test", "octopus", "")
	s := f.store
	repo, _ := s.create(M{"name": "garden"})
	files := map[string]fileEntry{"seed.txt": {"100644", s.objects.put(3, []byte("file bytes"))}}
	parent := s.objects.makeCommit(files, zero, "first")
	tip := s.objects.makeCommit(files, parent, "second")
	repo.setRef("refs/heads/main", tip)
	refs := append(packet(nil, "command=ls-refs\n"), delim...)
	refs = append(packet(refs, "symrefs\n"), flush...)
	fetch := append(packet(nil, "command=fetch\n"), delim...)
	fetch = packet(fetch, "want "+hexID(tip)+"\n")
	fetch = packet(fetch, "deepen 1\n")
	fetch = append(packet(fetch, "done\n"), flush...)
	remote := "http://local/octopus/garden.git/"
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(p *testing.PB) {
		w := &discardResponse{header: make(http.Header)}
		get := httptest.NewRequest("GET", remote+"info/refs?service=git-upload-pack", nil)
		get.Header.Set("Authorization", "Bearer test")
		get.Header.Set("Git-Protocol", "version=2")
		post := httptest.NewRequest("POST", remote+"git-upload-pack", nil)
		post.Header.Set("Authorization", "Bearer test")
		post.Header.Set("Git-Protocol", "version=2")
		reader := bytes.NewReader(nil)
		post.Body = io.NopCloser(reader)
		send := func(body []byte) { reader.Reset(body); post.ContentLength = int64(len(body)); f.ServeHTTP(w, post) }
		for p.Next() {
			f.ServeHTTP(w, get)
			send(refs)
			send(fetch)
		}
	})
}

func TestUploadReplyRefreshAndAuthorization(t *testing.T) {
	f := newForge("test", "octopus", "")
	s := f.store
	repo, _ := s.create(M{"name": "garden"})
	first := s.objects.makeCommit(nil, zero, "first")
	repo.setRef("refs/heads/main", first)
	remote := "/octopus/garden.git/git-upload-pack"
	body := append(packet(nil, "command=ls-refs\n"), delim...)
	body = append(packet(body, "symrefs\n"), flush...)
	if response := request(f, "POST", remote, string(body)); !strings.Contains(response.Body.String(), hexID(first)) {
		t.Fatal(response.Body.String())
	}
	noAuth := httptest.NewRequest("POST", "http://local"+remote, bytes.NewReader(body))
	w := httptest.NewRecorder()
	f.ServeHTTP(w, noAuth)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	if response := request(f, "PUT", "/api/v3/repos/octopus/garden/contents/seed.txt", `{"content":"dGVzdA==","message":"second"}`); response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	got := request(f, "POST", remote, string(body))
	latest := repo.refs["refs/heads/main"]
	if got.Code != 200 || !strings.Contains(got.Body.String(), hexID(latest)) || strings.Contains(got.Body.String(), hexID(first)) {
		t.Fatal(got.Code, got.Body.String())
	}
}
