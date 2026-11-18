#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p bin
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1
export GOTOOLCHAIN=local
output=$(mktemp bin/.goof-linux-amd64.XXXXXX)
trap 'rm -f "$output"' EXIT HUP INT TERM
"${GO:-go}" build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "$output" ./native
chmod 755 "$output"
mv -f "$output" bin/goof-linux-amd64
