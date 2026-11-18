package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Prepare the client payloads outside the measured region. Push distinct
// blob, tree and commit objects with each update, followed by the next pack.
func BenchmarkSmallPackPush(b *testing.B) {
	const batch = 128
	makeBatch := func() [][]byte {
		client := objects{all: map[oid]*object{}}
		var parent oid
		out := make([][]byte, 0, batch)
		for i := 0; i < batch; i++ {
			data := bytes.Repeat([]byte("a small source file\n"), 60)
			data[0] = byte(i)
			blob := client.put(3, data)
			tip := client.makeCommit(map[string]fileEntry{"main.txt": {"100644", blob}}, parent, "update")
			tree := client.commit(tip).tree
			cmd := packet(nil, hexID(parent)+" "+hexID(tip)+" refs/heads/main\x00report-status side-band-64k\n")
			out = append(out, append(append(cmd, flush...), client.pack([]oid{tip, tree, blob})...))
			parent = tip
		}
		return out
	}
	payloads := makeBatch()
	for _, parallel := range []bool{false, true} {
		name := "Sequential"
		if parallel {
			name = "Parallel"
		}
		b.Run(name, func(b *testing.B) {
			run := func(next func() bool) {
				f := newForge("test", "owner", "")
				input := bytes.NewReader(nil)
				req := httptest.NewRequest("POST", "http://local/owner/project.git/git-receive-pack", nil)
				req.Body = io.NopCloser(input)
				req.Header.Set("Authorization", "Bearer test")
				w := &pushResponse{header: make(http.Header)}
				for i := 0; next(); i++ {
					if i%batch == 0 {
						f.store = newStore("owner", "")
						f.store.create(M{"name": "project"})
					}
					payload := payloads[i%batch]
					input.Reset(payload)
					req.ContentLength = int64(len(payload))
					w.ok = false
					f.ServeHTTP(w, req)
					if !w.ok {
						b.Error("push was refused")
						return
					}
				}
			}
			b.ReportAllocs()
			if parallel {
				b.RunParallel(func(pb *testing.PB) { run(pb.Next) })
			} else {
				left := b.N
				run(func() bool { left--; return left >= 0 })
			}
		})
	}
}

type pushResponse struct {
	header http.Header
	ok     bool
}

func (w *pushResponse) Header() http.Header { return w.header }
func (w *pushResponse) WriteHeader(int)     {}
func (w *pushResponse) Write(body []byte) (int, error) {
	w.ok = bytes.Contains(body, []byte("unpack ok\n")) && bytes.Contains(body, []byte("ok refs/heads/main\n"))
	return len(body), nil
}
