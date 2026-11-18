package main

import (
	"bytes"
	"crypto/sha1"
	"testing"
)

func TestPooledInflaterValidatesEachStream(t *testing.T) {
	source := objects{all: map[oid]*object{}}
	pack := func(data []byte) []byte { return source.pack([]oid{source.put(3, data)}) }
	good := pack([]byte("hello"))
	fixTrailer := func(raw []byte) []byte {
		end := len(raw) - sha1.Size
		sum := sha1.Sum(raw[:end])
		copy(raw[end:], sum[:])
		return raw
	}
	checksum := bytes.Clone(good)
	checksum[len(checksum)-sha1.Size-1] ^= 1
	short := bytes.Clone(good)
	short[12]--
	long := bytes.Clone(good)
	long[12]++
	truncated := append(bytes.Clone(good[:len(good)-sha1.Size-1]), make([]byte, sha1.Size)...)
	target := objects{all: map[oid]*object{}}
	for name, invalid := range map[string][]byte{"checksum": checksum, "short size": short, "long size": long, "trailer": truncated} {
		t.Run(name, func(t *testing.T) {
			if _, err := target.unpack(fixTrailer(invalid)); err == nil {
				t.Fatal("invalid stream was accepted")
			}
			if target.packedBytes != 0 || len(target.all) != 0 {
				t.Fatal("failed pack changed store")
			}
			objects, err := target.unpack(good)
			if obj := objects[objectID(3, []byte("hello"))]; err != nil || obj == nil || !bytes.Equal(obj.data, []byte("hello")) {
				t.Fatalf("valid stream after failure: %v", err)
			}
			target.packedBytes = 0
		})
	}
	for _, size := range []int{0, 1, 32 << 10, (32 << 10) + 1, 96 << 10} {
		data := bytes.Repeat([]byte("x"), size)
		staged, err := target.unpack(pack(data))
		if obj := staged[objectID(3, data)]; err != nil || obj == nil || !bytes.Equal(obj.data, data) {
			t.Fatalf("size %d: %v", size, err)
		}
	}
}
