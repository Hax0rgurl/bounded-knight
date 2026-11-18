package main

import (
	"bytes"
	"compress/zlib"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type oid = [20]byte

var zero oid

func hexID(id oid) string { return hex.EncodeToString(id[:]) }
func parseID(s string) (id oid) {
	if len(s) == 40 {
		if _, e := hex.Decode(id[:], []byte(s)); e == nil {
			return id
		}
	}
	return zero
}

var kindNames = [...]string{"", "commit", "tree", "blob", "tag"}

type object struct {
	kind             byte
	data, compressed []byte
	commit           *commitInfo
	tree             []treeEntry
	parsedTree       bool
	complete         bool
}
type commitInfo struct {
	tree    oid
	parents []oid
	message string
}
type treeEntry struct {
	name, mode string
	id         oid
}
type fileEntry struct {
	mode string
	id   oid
}
type objects struct {
	all         map[oid]*object
	generation  uint64
	packedBytes int
}

func objectID(kind byte, data []byte) oid {
	var header [48]byte
	h := append(header[:0], kindNames[kind]...)
	h = append(h, ' ')
	h = strconv.AppendInt(h, int64(len(data)), 10)
	h = append(h, 0)
	digest := sha1.New()
	digest.Write(h)
	digest.Write(data)
	var id oid
	digest.Sum(id[:0])
	return id
}
func (o *objects) put(kind byte, data []byte) oid {
	id := objectID(kind, data)
	if o.all[id] == nil {
		o.all[id] = &object{kind: kind, data: data}
		o.generation++
	}
	return id
}
func (o *objects) commit(id oid) *commitInfo {
	obj := o.all[id]
	if obj == nil || obj.kind != 1 {
		return nil
	}
	if obj.commit != nil {
		return obj.commit
	}
	header, msg, _ := strings.Cut(string(obj.data), "\n\n")
	c := &commitInfo{message: strings.TrimSuffix(msg, "\n")}
	for _, line := range strings.Split(header, "\n") {
		if v, ok := strings.CutPrefix(line, "tree "); ok {
			c.tree = parseID(v)
		}
		if v, ok := strings.CutPrefix(line, "parent "); ok {
			c.parents = append(c.parents, parseID(v))
		}
	}
	obj.commit = c
	return c
}
func (o *objects) entries(id oid) []treeEntry {
	obj := o.all[id]
	if obj == nil || obj.kind != 2 {
		return nil
	}
	if obj.parsedTree {
		return obj.tree
	}
	var entries []treeEntry
	for b := obj.data; len(b) > 0; {
		i := bytes.IndexByte(b, 0)
		if i < 0 || i+21 > len(b) {
			return nil
		}
		mode, name, ok := strings.Cut(string(b[:i]), " ")
		if !ok || name == "" || strings.Contains(name, "/") {
			return nil
		}
		var id oid
		copy(id[:], b[i+1:i+21])
		entries = append(entries, treeEntry{name, mode, id})
		b = b[i+21:]
	}
	obj.tree = entries
	obj.parsedTree = true
	return entries
}
func (o *objects) files(id oid) map[string]fileEntry {
	m := map[string]fileEntry{}
	var walk func(oid, string, int)
	walk = func(id oid, prefix string, depth int) {
		if depth > 256 {
			return
		}
		for _, e := range o.entries(id) {
			if e.mode == "40000" || e.mode == "040000" {
				walk(e.id, prefix+e.name+"/", depth+1)
			} else {
				m[prefix+e.name] = fileEntry{e.mode, e.id}
			}
		}
	}
	if c := o.commit(id); c != nil {
		walk(c.tree, "", 0)
	}
	return m
}
func (o *objects) makeCommit(files map[string]fileEntry, parent oid, message string) oid {
	type dir struct {
		files    map[string]fileEntry
		children map[string]*dir
	}
	newDir := func() *dir { return &dir{map[string]fileEntry{}, map[string]*dir{}} }
	root := newDir()
	for path, e := range files {
		d := root
		parts := strings.Split(path, "/")
		for _, p := range parts[:len(parts)-1] {
			if d.children[p] == nil {
				d.children[p] = newDir()
			}
			d = d.children[p]
		}
		d.files[parts[len(parts)-1]] = e
	}
	var build func(*dir) oid
	build = func(d *dir) oid {
		entries := make([]treeEntry, 0, len(d.files)+len(d.children))
		for name, e := range d.files {
			entries = append(entries, treeEntry{name, e.mode, e.id})
		}
		for name, sub := range d.children {
			entries = append(entries, treeEntry{name, "40000", build(sub)})
		}
		sort.Slice(entries, func(i, j int) bool {
			a, b := entries[i], entries[j]
			if a.mode == "40000" {
				a.name += "/"
			}
			if b.mode == "40000" {
				b.name += "/"
			}
			return a.name < b.name
		})
		var b []byte
		for _, e := range entries {
			b = append(b, e.mode...)
			b = append(b, ' ')
			b = append(b, e.name...)
			b = append(b, 0)
			b = append(b, e.id[:]...)
		}
		return o.put(2, b)
	}
	tree := build(root)
	b := []byte("tree " + hexID(tree) + "\n")
	if parent != zero {
		b = append(b, ("parent " + hexID(parent) + "\n")...)
	}
	b = append(b, "author GOOF Forge <forge@example.invalid> 1700000000 +0000\ncommitter GOOF Forge <forge@example.invalid> 1700000000 +0000\n\n"...)
	b = append(b, message...)
	return o.put(1, append(b, '\n'))
}
func (o *objects) ancestor(old, tip oid) bool {
	if old == tip {
		return true
	}
	c := o.commit(tip)
	if c == nil {
		return false
	}
	if len(c.parents) == 1 && c.parents[0] == old {
		return true
	}
	return o.walkParents([]oid{tip}, func(id oid) bool { return id == old })
}
func (o *objects) walkParents(todo []oid, visit func(oid) bool) bool {
	seen := map[oid]bool{}
	for i := 0; i < len(todo); i++ {
		id := todo[i]
		if seen[id] {
			continue
		}
		seen[id] = true
		if visit(id) {
			return true
		}
		if c := o.commit(id); c != nil {
			todo = append(todo, c.parents...)
		}
	}
	return false
}
func (o *objects) base(a, b oid) (result oid) {
	seen := map[oid]bool{}
	o.walkParents([]oid{a}, func(id oid) bool { seen[id] = true; return false })
	o.walkParents([]oid{b}, func(id oid) bool {
		if seen[id] {
			result = id
			return true
		}
		return false
	})
	return
}
func (o *objects) closure(tips []oid, depth int, shallow map[oid]bool) ([]oid, []oid, map[oid]bool) {
	current := append([]oid(nil), tips...)
	var next, ids, boundary []oid
	seen := make(map[oid]bool)
	for generation := 1; len(current) > 0; generation++ {
		for len(current) > 0 {
			id := current[len(current)-1]
			current = current[:len(current)-1]
			obj := o.all[id]
			if obj == nil || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
			switch obj.kind {
			case 1:
				c := o.commit(id)
				current = append(current, c.tree)
				if (depth == 0 || generation < depth) && !shallow[id] {
					next = append(next, c.parents...)
				} else if len(c.parents) > 0 {
					boundary = append(boundary, id)
				}
			case 2:
				for _, e := range o.entries(id) {
					if e.mode != "160000" {
						current = append(current, e.id)
					}
				}
			case 4:
				current = append(current, tagTarget(obj))
			}
		}
		current, next = next, current[:0]
	}
	return ids, boundary, seen
}
func tagTarget(obj *object) oid {
	if obj == nil || obj.kind != 4 || len(obj.data) < 47 || !bytes.HasPrefix(obj.data, []byte("object ")) {
		return zero
	}
	return parseID(string(obj.data[7:47]))
}

// Validate the closure before exposing a ref. Immutable subgraphs verified
// by earlier pushes don't need to be walked again on each fast-forward.
func (o *objects) connected(tip oid) bool {
	if obj := o.all[tip]; obj != nil && obj.complete {
		return true
	}
	type edge struct {
		id   oid
		kind byte
	}
	pending := []edge{{id: tip}}
	seen := make(map[oid]*object)
	for len(pending) != 0 {
		e := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		obj := o.all[e.id]
		if obj == nil || (e.kind != 0 && obj.kind != e.kind) {
			return false
		}
		if obj.complete || seen[e.id] != nil {
			continue
		}
		seen[e.id] = obj
		switch obj.kind {
		case 1:
			c := o.commit(e.id)
			pending = append(pending, edge{c.tree, 2})
			for _, id := range c.parents {
				pending = append(pending, edge{id, 1})
			}
		case 2:
			entries := o.entries(e.id)
			if !obj.parsedTree {
				return false
			}
			for _, child := range entries {
				switch child.mode {
				case "160000": // A submodule is an object in another repository.
				case "40000", "040000":
					pending = append(pending, edge{child.id, 2})
				case "100644", "100755", "120000", "100664":
					pending = append(pending, edge{child.id, 3})
				default:
					return false
				}
			}
		case 4:
			pending = append(pending, edge{id: tagTarget(obj)})
		}
	}
	for _, obj := range seen {
		obj.complete = true
	}
	return true
}

var inflatePool = sync.Pool{New: func() any { return new(packInflater) }}
var deflatePool sync.Pool

const maxInflated = 256 << 20

var badPack = errors.New("invalid pack")

type packedEntry struct {
	kind          byte
	data, encoded []byte
	base          int
	start         int
	ref           oid
	id            oid
	obj           *object
}

type packInflater struct {
	input   bytes.Reader
	reader  io.ReadCloser
	entries [8]packedEntry
}

func (p *packInflater) release() {
	if p.reader != nil {
		p.reader.Close()
	}
	// zlib and flate retain a pointer to input after Close. Clear the
	// bytes.Reader so a pooled inflater never pins or retains a request body.
	p.input.Reset(nil)
	clear(p.entries[:])
	inflatePool.Put(p)
}

func (p *packInflater) inflate(size int) ([]byte, error) {
	var err error
	if p.reader == nil {
		p.reader, err = zlib.NewReader(&p.input)
	} else {
		err = p.reader.(zlib.Resetter).Reset(&p.input, nil)
	}
	if err != nil {
		return nil, badPack
	}
	if size <= 32<<10 {
		// Read one extra byte to require a real EOF, which zlib reports
		// only after reading and verifying its checksum.
		data := make([]byte, size+1)
		for n := 0; n <= size; {
			got, err := p.reader.Read(data[n:])
			n += got
			if err == io.EOF && n == size {
				return data[:size:size], nil
			}
			if err != nil || got == 0 {
				break
			}
		}
		return nil, badPack
	}
	// Do not reserve a large buffer based on an unverified pack header.
	// Stop after at most size+1 output bytes and verify the exact size.
	data, err := io.ReadAll(io.LimitReader(p.reader, int64(size)+1))
	if err != nil || len(data) != size {
		return nil, badPack
	}
	return data, nil
}

func (o *objects) unpack(raw []byte) (map[oid]*object, error) {
	if len(raw) < 32 || string(raw[:4]) != "PACK" || (binary.BigEndian.Uint32(raw[4:8]) != 2 && binary.BigEndian.Uint32(raw[4:8]) != 3) {
		return nil, badPack
	}
	payload := raw[:len(raw)-20]
	sum := sha1.Sum(payload)
	if !bytes.Equal(sum[:], raw[len(payload):]) {
		return nil, errors.New("pack checksum mismatch")
	}
	count := int(binary.BigEndian.Uint32(raw[8:12]))
	if count > (len(payload)-12)/7 {
		return nil, badPack
	}
	if count == 0 {
		if len(payload) != 12 {
			return nil, badPack
		}
		return nil, nil
	}
	inflater := inflatePool.Get().(*packInflater)
	defer inflater.release()
	var entries []packedEntry
	if count <= len(inflater.entries) {
		entries = inflater.entries[:count]
	} else {
		entries = make([]packedEntry, count)
	}
	var offsets map[int]int
	// OFS deltas are uncommon. Allocate the offset index only when one occurs.
	staged := make(map[oid]*object, count)
	r := &inflater.input
	r.Reset(payload[12:])
	total := 0
	stage := func(e *packedEntry, k byte, data []byte) (bool, error) {
		if len(data) > maxInflated-total {
			return false, badPack
		}
		total += len(data)
		e.id = objectID(k, data)
		e.obj = staged[e.id]
		if e.obj == nil {
			e.obj = o.all[e.id]
		}
		if e.obj == nil {
			e.obj = &object{kind: k, data: data}
			staged[e.id] = e.obj
			return true, nil
		}
		return false, nil
	}
	unresolved := 0
	for i := range entries {
		start := len(payload) - r.Len()
		entries[i].start = start
		b, err := r.ReadByte()
		if err != nil {
			return nil, badPack
		}
		k := (b >> 4) & 7
		n := int(b & 15)
		for shift := 4; b&128 != 0; shift += 7 {
			if shift > 32 {
				return nil, badPack
			}
			b, err = r.ReadByte()
			if err != nil {
				return nil, badPack
			}
			n |= int(b&127) << shift
		}
		if n < 0 || n > maxInflated-total {
			return nil, badPack
		}
		e := &entries[i]
		e.kind = k
		switch k {
		case 1, 2, 3, 4:
		case 6:
			b, err = r.ReadByte()
			if err != nil {
				return nil, badPack
			}
			distance := int(b & 127)
			for b&128 != 0 {
				b, err = r.ReadByte()
				if err != nil || distance > start {
					return nil, badPack
				}
				distance = (distance+1)*128 + int(b&127)
			}
			if offsets == nil {
				offsets = make(map[int]int, i)
				for index := 0; index < i; index++ {
					offsets[entries[index].start] = index
				}
			}
			index, ok := offsets[start-distance]
			if !ok {
				return nil, badPack
			}
			e.base = index
		case 7:
			if _, err = io.ReadFull(r, e.ref[:]); err != nil {
				return nil, badPack
			}
		default:
			return nil, badPack
		}
		if offsets != nil {
			offsets[start] = i
		}
		data, err := inflater.inflate(n)
		if err != nil {
			return nil, err
		}
		if k <= 4 {
			added, err := stage(e, k, data)
			if err != nil {
				return nil, err
			}
			end := len(payload) - r.Len()
			// Retain small standalone encodings, without pinning their original pack.
			if added && end-start <= 8192 {
				e.encoded = payload[start:end]
			}
		} else {
			e.data = data
			unresolved++
			total += n
		}
	}
	if r.Len() != 0 {
		return nil, badPack
	}
	for unresolved > 0 {
		before := unresolved
		for i := range entries {
			e := &entries[i]
			if e.obj != nil {
				continue
			}
			var base *object
			if e.kind == 6 {
				base = entries[e.base].obj
			} else {
				base = staged[e.ref]
				if base == nil {
					base = o.all[e.ref]
				}
			}
			if base == nil {
				continue
			}
			data, err := applyDelta(base.data, e.data, maxInflated-total)
			if err != nil {
				return nil, err
			}
			if _, err = stage(e, base.kind, data); err != nil {
				return nil, err
			}
			unresolved--
		}
		if unresolved == before {
			return nil, errors.New("missing delta base")
		}
	}
	// Small packs share one backing allocation for their verified standalone
	// encodings. Larger packs continue to allocate only what the cache admits.
	var compressed []byte
	if count <= len(inflater.entries) {
		size := 0
		for i := range entries {
			if entries[i].obj.compressed == nil {
				size += len(entries[i].encoded)
			}
		}
		if size <= (16<<20)-o.packedBytes {
			compressed = make([]byte, size)
		}
	}
	for i := range entries {
		e := &entries[i]
		if len(e.encoded) > 0 && e.obj.compressed == nil && o.packedBytes+len(e.encoded) <= 16<<20 {
			if len(compressed) >= len(e.encoded) {
				size := len(e.encoded)
				copy(compressed[:size], e.encoded)
				e.obj.compressed = compressed[:size:size]
				compressed = compressed[size:]
			} else {
				e.obj.compressed = bytes.Clone(e.encoded)
			}
			o.packedBytes += len(e.encoded)
		}
	}
	return staged, nil
}
func applyDelta(base, delta []byte, limit int) ([]byte, error) {
	r := bytes.NewReader(delta)
	n, err := binary.ReadUvarint(r)
	if err != nil || n != uint64(len(base)) {
		return nil, badPack
	}
	n, err = binary.ReadUvarint(r)
	if err != nil || n > uint64(limit) {
		return nil, badPack
	}
	out := make([]byte, 0, int(n))
	for r.Len() > 0 {
		op, _ := r.ReadByte()
		if op&128 == 0 {
			if op == 0 || int(op) > r.Len() || len(out)+int(op) > cap(out) {
				return nil, badPack
			}
			pos := len(delta) - r.Len()
			out = append(out, delta[pos:pos+int(op)]...)
			r.Seek(int64(op), io.SeekCurrent)
			continue
		}
		at, size := 0, 0
		for i := 0; i < 4; i++ {
			if op&(1<<i) != 0 {
				b, e := r.ReadByte()
				if e != nil {
					return nil, badPack
				}
				at |= int(b) << (8 * i)
			}
		}
		for i := 0; i < 3; i++ {
			if op&(16<<i) != 0 {
				b, e := r.ReadByte()
				if e != nil {
					return nil, badPack
				}
				size |= int(b) << (8 * i)
			}
		}
		if size == 0 {
			size = 65536
		}
		if at+size > len(base) || len(out)+size > cap(out) {
			return nil, badPack
		}
		out = append(out, base[at:at+size]...)
	}
	if len(out) != cap(out) {
		return nil, badPack
	}
	return out, nil
}
func (o *objects) insert(staged map[oid]*object) {
	for id, obj := range staged {
		if o.all[id] == nil {
			o.all[id] = obj
			o.generation++
		}
	}
}
func (o *objects) pack(ids []oid) []byte {
	b := append([]byte("PACK"), 0, 0, 0, 2)
	b = binary.BigEndian.AppendUint32(b, uint32(len(ids)))
	for _, id := range ids {
		obj := o.all[id]
		if obj.compressed != nil {
			b = append(b, obj.compressed...)
			continue
		}
		var tmp bytes.Buffer
		n := len(obj.data)
		c := obj.kind<<4 | byte(n&15)
		n >>= 4
		for n > 0 {
			tmp.WriteByte(c | 128)
			c = byte(n & 127)
			n >>= 7
		}
		tmp.WriteByte(c)
		var z *zlib.Writer
		if v := deflatePool.Get(); v != nil {
			z = v.(*zlib.Writer)
			z.Reset(&tmp)
		} else {
			z, _ = zlib.NewWriterLevel(&tmp, zlib.BestSpeed)
		}
		z.Write(obj.data)
		z.Close()
		deflatePool.Put(z)
		encoded := tmp.Bytes()
		if o.packedBytes+len(encoded) <= 16<<20 {
			obj.compressed = encoded
			o.packedBytes += len(encoded)
		}
		b = append(b, encoded...)
	}
	digest := sha1.Sum(b)
	return append(b, digest[:]...)
}
