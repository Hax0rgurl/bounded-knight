package main

import (
	"bytes"
	"errors"
	"sort"
	"strconv"
	"strings"
)

const flush = "0000"
const delim = "0001"
const hexDigits = "0123456789abcdef"
const zeroHex = "0000000000000000000000000000000000000000"

func packetHeader(b []byte, n int) []byte {
	return append(b, hexDigits[n>>12&15], hexDigits[n>>8&15], hexDigits[n>>4&15], hexDigits[n&15])
}
func packet(b []byte, s string) []byte { return append(packetHeader(b, len(s)+4), s...) }
func sideband(b, data []byte) []byte {
	for len(data) > 0 {
		n := min(len(data), 65515)
		b = append(packetHeader(b, n+5), 1)
		b = append(b, data[:n]...)
		data = data[n:]
	}
	return append(b, flush...)
}
func refNames(r *Repo) []string {
	names := make([]string, 0, len(r.refs))
	for name := range r.refs {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
func validRef(ref string) bool {
	if !strings.HasPrefix(ref, "refs/") || len(ref) > 1024 || strings.Contains(ref, "..") || strings.Contains(ref, "@{") || strings.HasSuffix(ref, ".") {
		return false
	}
	for remaining := ref; ; {
		part, tail, more := strings.Cut(remaining, "/")
		if part == "" || part[0] == '.' || strings.HasSuffix(part, ".lock") {
			return false
		}
		for _, c := range part {
			if c <= 32 || c == 127 || strings.ContainsRune("~^:?*[\\", c) {
				return false
			}
		}
		if !more {
			break
		}
		remaining = tail
	}
	return true
}
func packetLines(body []byte, receive bool) ([]string, []byte, error) {
	var lines []string
	for len(body) >= 4 {
		n := 0
		for _, x := range body[:4] {
			v := bytes.IndexByte([]byte(hexDigits), x|32)
			if v < 0 {
				return nil, nil, errors.New("invalid packet length")
			}
			n = n*16 + v
		}
		body = body[4:]
		if n == 0 && receive {
			return lines, body, nil
		}
		if n <= 2 {
			continue
		}
		if n < 4 || n > 65520 || n-4 > len(body) {
			break
		}
		lines = append(lines, strings.TrimSuffix(string(body[:n-4]), "\n"))
		body = body[n-4:]
	}
	if len(body) != 0 || receive {
		return nil, nil, errors.New("truncated packet")
	}
	return lines, nil, nil
}

const upload = "git-upload-pack"
const receive = "git-receive-pack"

// Keep two small wire requests per repository. The semantic caches still
// handle equivalent clients that frame or order their requests differently.
type uploadReply struct {
	request    string
	generation uint64
	response   []byte
}

func (r *Repo) cachedUpload(body []byte, generation uint64) []byte {
	for i := range r.uploadReplies {
		entry := &r.uploadReplies[i]
		if entry.response != nil && entry.generation == generation && entry.request == string(body) {
			return entry.response
		}
	}
	return nil
}

func (r *Repo) rememberUpload(body, response []byte, generation uint64) {
	if len(body) <= 4096 && len(response) <= 64<<10 {
		r.uploadReplies[r.nextUpload] = uploadReply{string(body), generation, response}
		r.nextUpload = (r.nextUpload + 1) % len(r.uploadReplies)
	}
}

var uploadV2 = func() []byte {
	var b []byte
	for _, line := range []string{"version 2\n", "agent=goof/1\n", "ls-refs=unborn\n", "fetch=shallow\n", "object-format=sha1\n"} {
		b = packet(b, line)
	}
	return append(b, flush...)
}()

func (s *Store) advertise(r *Repo, service string, v2 bool) []byte {
	if service == upload && v2 {
		return uploadV2
	}
	if service == receive && r.receive != nil {
		return r.receive
	}
	b := append(packet(nil, "# service="+service+"\n"), flush...)
	caps := "report-status side-band-64k delete-refs ofs-delta"
	if service == upload {
		caps = "multi_ack_detailed side-band-64k shallow ofs-delta symref=HEAD:refs/heads/" + r.DefaultBranch
	}
	first := true
	add := func(ref string, id oid) {
		line := hexID(id) + " " + ref
		if first {
			line += "\x00" + caps
			first = false
		}
		b = packet(b, line+"\n")
	}
	if service == upload {
		if id := r.refs["refs/heads/"+r.DefaultBranch]; id != zero {
			add("HEAD", id)
		}
	}
	for _, name := range refNames(r) {
		id := r.refs[name]
		add(name, id)
		if service == upload {
			if p := s.peel(id); p != id && p != zero {
				add(name+"^{}", p)
			}
		}
	}
	if first {
		add("capabilities^{}", zero)
	}
	b = append(b, flush...)
	if service == receive {
		r.receive = b
	}
	return b
}
func (s *Store) gitReceive(r *Repo, body []byte) []byte {
	lines, pack, err := packetLines(body, true)
	if err != nil {
		return append(packet(nil, "unpack invalid command list\n"), flush...)
	}
	if len(lines) == 0 {
		return []byte(flush)
	}
	first, caps, _ := strings.Cut(lines[0], "\x00")
	lines[0] = first
	band := false
	for _, c := range strings.Fields(caps) {
		if c == "side-band-64k" {
			band = true
		}
	}
	var staged map[oid]*object
	if len(pack) > 0 {
		staged, err = s.objects.unpack(pack)
	}
	// Most status reports fit in this scratch buffer. For a sideband reply
	// the only escaping allocation is the final outer packet stream.
	var scratch [256]byte
	report := scratch[:0]
	if err != nil {
		report = packet(report, "unpack "+err.Error()+"\n")
	} else {
		report = packet(report, "unpack ok\n")
		s.objects.insert(staged)
	}
	for _, line := range lines {
		oldstr, tail, _ := strings.Cut(line, " ")
		newstr, ref, _ := strings.Cut(tail, " ")
		old, id := parseID(oldstr), parseID(newstr)
		reason := ""
		switch {
		case err != nil:
			reason = "unpacker error"
		case !validRef(ref) || (old == zero && oldstr != zeroHex) || (id == zero && newstr != zeroHex):
			reason = "invalid ref command"
		case r.refs[ref] != old:
			reason = "stale info"
		case id != zero && s.objects.all[id] == nil:
			reason = "missing object"
		case id != zero && !s.validObjectRef(ref, id):
			reason = "not a commit"
		case old != zero && id != zero && old != id && (!strings.HasPrefix(ref, "refs/heads/") || !s.objects.ancestor(old, id)):
			reason = "non-fast-forward"
		case id != zero && !s.objects.connected(id):
			reason = "missing linked object"
		}
		if reason == "" {
			r.setRef(ref, id)
			report = packet(report, "ok "+ref+"\n")
		} else {
			if !validRef(ref) {
				ref = "(invalid)"
			}
			report = packet(report, "ng "+ref+" "+reason+"\n")
		}
	}
	report = append(report, flush...)
	if band {
		capacity := len(report) + 4 + 5*((len(report)+65514)/65515)
		return sideband(make([]byte, 0, capacity), report)
	}
	return bytes.Clone(report)
}
func hasLine(lines []string, want string) bool {
	for _, line := range lines {
		if line == want {
			return true
		}
	}
	return false
}
func (s *Store) lsRefs(r *Repo, lines []string) []byte {
	var prefixes []string
	key := ""
	for _, line := range lines {
		if p, ok := strings.CutPrefix(line, "ref-prefix "); ok {
			prefixes = append(prefixes, p)
			key += strconv.Itoa(len(p)) + ":" + p
		}
	}
	peel, sym, unborn := hasLine(lines, "peel"), hasLine(lines, "symrefs"), hasLine(lines, "unborn")
	key = strconv.FormatBool(peel) + strconv.FormatBool(sym) + strconv.FormatBool(unborn) + key
	if b := r.refReplies[key]; b != nil {
		return b
	}
	match := func(ref string) bool {
		if len(prefixes) == 0 {
			return true
		}
		for _, p := range prefixes {
			if strings.HasPrefix(ref, p) {
				return true
			}
		}
		return false
	}
	var b []byte
	add := func(name string, id oid, extra string) {
		if !match(name) {
			return
		}
		b = packet(b, hexID(id)+" "+name+extra+"\n")
	}
	head := "refs/heads/" + r.DefaultBranch
	if id := r.refs[head]; id != zero {
		extra := ""
		if sym {
			extra = " symref-target:" + head
		}
		add("HEAD", id, extra)
	} else if unborn && match("HEAD") {
		b = packet(b, "unborn HEAD symref-target:"+head+"\n")
	}
	for _, name := range refNames(r) {
		id := r.refs[name]
		extra := ""
		if peel {
			if p := s.peel(id); p != id && p != zero {
				extra = " peeled:" + hexID(p)
			}
		}
		add(name, id, extra)
	}
	b = append(b, flush...)
	if len(key) < 4096 && len(b) < 16384 && len(r.refReplies) < 8 {
		if r.refReplies == nil {
			r.refReplies = make(map[string][]byte)
		}
		r.refReplies[key] = b
	}
	return b
}
func (s *Store) gitUpload(r *Repo, body []byte) []byte {
	lines, _, err := packetLines(body, false)
	if err != nil {
		return packet(nil, "ERR invalid packet list\n")
	}
	if hasLine(lines, "command=ls-refs") {
		return s.lsRefs(r, lines)
	}
	v2 := hasLine(lines, "command=fetch")
	var wants, haves, shallow []oid
	depth := 0
	for _, line := range lines {
		k, v, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		if k == "deepen" {
			if n, _ := strconv.Atoi(v); n > 0 {
				depth = n
			}
			continue
		}
		if k != "want" && k != "have" && k != "shallow" {
			continue
		}
		if prefix, _, ok := strings.Cut(v, " "); ok {
			v = prefix
		}
		id := parseID(v)
		if id == zero {
			continue
		}
		switch k {
		case "want":
			wants = append(wants, id)
		case "have":
			haves = append(haves, id)
		case "shallow":
			shallow = append(shallow, id)
		}
	}
	cacheKey := ""
	if len(wants)+len(haves)+len(shallow) <= 64 {
		if s.fetchGeneration != s.objects.generation {
			s.fetch = nil
			s.fetchGeneration = s.objects.generation
			s.fetchBytes = 0
		}
		var key []byte
		key = strconv.AppendInt(key, int64(r.ID), 10)
		key = append(key, '/')
		key = strconv.AppendBool(key, v2)
		key = append(key, '/')
		key = strconv.AppendInt(key, int64(depth), 10)
		key = append(key, '/')
		for _, list := range [][]oid{wants, haves, shallow} {
			key = append(key, byte(len(list)))
			for _, id := range list {
				key = append(key, id[:]...)
			}
		}
		cacheKey = string(key)
		if b := s.fetch[cacheKey]; b != nil {
			return b
		}
	}
	var known map[oid]bool
	if len(haves) > 0 {
		stop := make(map[oid]bool, len(shallow))
		for _, id := range shallow {
			stop[id] = true
		}
		_, _, known = s.objects.closure(haves, 0, stop)
	}
	ids, boundary, visited := s.objects.closure(wants, depth, nil)
	kept := ids[:0]
	for _, id := range ids {
		if !known[id] {
			kept = append(kept, id)
		}
	}
	var b []byte
	if len(boundary) > 0 || len(shallow) > 0 {
		var deeper []byte
		bound := make(map[oid]bool, len(boundary))
		for _, id := range boundary {
			bound[id] = true
			deeper = packet(deeper, "shallow "+hexID(id)+"\n")
		}
		for _, id := range shallow {
			if visited[id] && !bound[id] {
				deeper = packet(deeper, "unshallow "+hexID(id)+"\n")
			}
		}
		if len(deeper) > 0 {
			if v2 {
				b = packet(b, "shallow-info\n")
			}
			b = append(b, deeper...)
			if v2 {
				b = append(b, delim...)
			} else {
				b = append(b, flush...)
			}
		}
	}
	if v2 {
		b = packet(b, "packfile\n")
	} else {
		b = packet(b, "NAK\n")
	}
	b = sideband(b, s.objects.pack(kept))
	if cacheKey != "" && len(b) <= 256<<10 {
		if len(s.fetch) >= 32 || s.fetchBytes+len(b) > 512<<10 {
			s.fetch = nil
			s.fetchBytes = 0
		}
		if s.fetch == nil {
			s.fetch = make(map[string][]byte)
		}
		s.fetch[cacheKey] = b
		s.fetchBytes += len(b)
	}
	return b
}
