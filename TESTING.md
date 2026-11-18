# Verification

Runtime: Node.js **v22.18.0**, using only built-in modules. No Git executable,
package installation, model calls, external services, or credentials were used.
All tests use disposable local bearer-token strings.

The public kit at `/tmp/makefun-forge.C8QlPe/github-core-clone-01-kit` supplied the
unmodified `sdk/run.ts` suite and its clients. `test/public-suite.ts` replaces only
its fetch transport: requests reach the application's actual Node HTTP request
listener, and the adapter returns its real status, headers, JSON or binary bytes.
It exercises the published wire encoders and decoders, including pack checksums.

The initial run passed 119/120. Its failed `repos.commits` assertion exposed a
trailing newline in the REST commit message. The REST representation now removes
that terminal newline while retaining the stored commit's original bytes.
Subsequent runs, including after object-store and routing hardening, passed:

| Group | Passed |
| --- | ---: |
| Git | 30/30 |
| Repositories | 15/15 |
| Issues | 15/15 |
| Pull requests | 20/20 |
| REST protocol | 5/5 |
| GraphQL | 20/20 |
| MCP | 15/15 |
| **Total** | **120/120** |

The four published benchmark workloads completed all three timed rounds and their
five warm-ups: 200 sequential pushes per round, 50 concurrent shallow clones,
2,000 issue reads, and 200 issue writes. Adapter timings are recorded in
`test/results.json` for diagnostics only. Socket/network costs are absent, so the
runner's computed performance points must not be presented as an official score.

The additional `node test/core.test.ts` run passed **14/14**. It checks independent
Git SHA framing, binary pack round trips, unusual tree names and executable modes,
REF_DELTA thin packs and forward bases, OFS_DELTA packs, malformed-pack isolation,
mixed push rejection, common-ancestor squash behavior, merge conflicts, stale SHA
and foreign-owner rejection, GraphQL execution, MCP argument validation, HTTP
authentication, malformed bodies, and reference-name validation.

To reproduce in this workspace:

```sh
NODE=/tmp/makefun-forge.C8QlPe/runtime/node_modules/node/bin/node
KIT=/tmp/makefun-forge.C8QlPe/github-core-clone-01-kit
"$NODE" test/core.test.ts
"$NODE" test/public-suite.ts "$KIT" --perf
```

For genuine TCP measurements in a socket-enabled environment, start `serve.ts`
with a disposable `MAKEFUN_SHOP_TOKEN` and no `FORGE_LOGIN`, then run the official
runner directly against the printed address:

```sh
node "$KIT/sdk/run.ts" --url http://127.0.0.1:PORT --token development-only --perf
```

The attempted TCP launch here failed before binding with `listen EPERM:
operation not permitted 127.0.0.1`. Network timings, real connection reuse, the
registration lifecycle against a running env, container grading, and official
live/replay equivalence remain unverified. No submission or packaging was done.

The submission coordinator subsequently tested the final source over loopback TCP
on Node 22.18.0, starting both the unmodified kit environment and the production
entrypoint. The entry registered and exited successfully after all 120 checks
and four benchmarks. The environment awarded 156/200 performance points in that
run for a local total of 956/1000.

## GOOF performance iteration

The same Node 22.18.0 runtime and unmodified published runner drove three
baseline and three optimized runs. Both builds used the same socket-free
adapter with HTTP body framing headers. Each value is the median of three
workload medians. The original live score supplied for this iteration was
123/200 performance and 588,034 µs at rank 4,632.

| Workload | Baseline (ms) | GOOF (ms) | Reduction |
| --- | ---: | ---: | ---: |
| 200 pushes | 197.520 | 140.274 | 29% |
| 50 concurrent shallow clones | 34.043 | 21.444 | 37% |
| 2,000 issue reads | 203.676 | 121.054 | 41% |
| 200 issue writes | 20.058 | 13.761 | 31% |

The geometric mean fell from 72,396 to 47,313 µs in the adapter. All measured
runs passed 120/120 published checks. The expanded unit suite passed 17/17.

V8 profiles of the full runner include both client and service costs. In the
baseline, garbage collection accounted for 148/2,329 samples and native zlib
processing for 112/2,329. In an optimized capture, the counts were 76/1,634 and
92/1,634 respectively. Zlib remained prominent after allocation work. The
forge uses Node's native zlib with a bounded initial buffer based on the
declared object size and uses Node's one-shot native SHA-1. There is no custom
native addon.

Fetch replies are reused by repository, wanted and held object IDs, shallow
boundaries, depth and protocol. New objects invalidate the bounded cache since
they can complete a previously missing edge. Pack encoding shares compressed
object bytes. Parsed commit and tree metadata is cached on immutable objects,
and traversal visits ancestry by generation. The HTTP handler avoids stream
iteration for unframed empty bodies and reuses single body buffers. Individual
issue reads reuse a bounded serialized snapshot invalidated by writes and
repository deletion.

The TCP listener still returned `EPERM` for this iteration. The table measures
the in-process workload only. The coordinator's network run can establish
actual scores and placement.

## Native Go branch

The native production path is `node main.ts`, which uses `process.execve`
to start the static Linux amd64 binary in the same process. The executable
handles registration, HTTP serving, and trial shutdown. The original Node
implementation and its tests remain as a behavioral reference.

The original public Node runner drives the native `net/http` handler through
a socket-free stdio adapter backed by Go's `httptest`. Its JSON and IPC overhead
is included in the workload elapsed times. Use the coordinator's TCP trial
for leaderboard measurements.

The Go CPU profile identified DEFLATE and SHA-1 work in pack processing,
and JSON and allocation costs in issue writes. The server pools zlib streams,
retains bounded standalone compressed entries from verified packs, and caches
framed upload replies by repository and fetch parameters. Ref updates validate
object connectivity and reuse previously validated immutable subgraphs.
The REST handler skips query parsing for unqueried routes and avoids copying
fixed-length small request bodies between read buffers.

The native-only benchmark uses the production handler with an in-memory
response writer. Median values over three runs on the workspace host:

| Path | Initial Go port | Tuned Go port | Allocation counts |
| --- | ---: | ---: | ---: |
| Warm issue GET | 794 ns | 616 ns | 8 → 6 |
| Issue create | 6.68 µs | 6.33 µs | 23 → 20 |
| Three-object pack inflate | 9.87 µs | 9.36 µs | 19 → 19 |

Pack timings overlap across runs. The native microbenchmarks isolate server
work and omit connection handling.

### Native follow-up

Four runs per revision on the same host, using the native benchmarks and a
five-thread Go runtime. Each value is the median per operation. A clone
operation runs a protocol v2 advertisement, ls-refs, and shallow fetch
through the production HTTP handler, with multiple clients in parallel.

| Path | Before | After | Allocations per operation |
| --- | ---: | ---: | ---: |
| Warm issue GET | 618 ns | 528 ns | 6 → 6 |
| Issue create | 5.25 µs | 4.49 µs | 20 → 19 |
| Concurrent warm clone | 5.14 µs | 1.28 µs | 48 → 26 |

The upload path remembers two small wire requests per repository and serves
hits under a shared read lock. Reply reuse checks the object-store generation,
and ref changes discard the repository's cached replies. Uncached requests
still use the existing protocol parser and semantic caches. These timings
measure the handler and omit TCP and client overhead.

### Small push allocation follow-up

The native small-push benchmark sends a real receive-pack POST through the
production handler with a new commit, tree, and roughly 1 KiB blob per update.
The parallel variant uses independent stores while sharing the process-wide
inflater pool. It checks the ref status on every push. Measurements below
are medians of five runs per revision with Go 1.27.4 and four Go workers.

| Receive-pack benchmark | Before | After | Bytes/op before → after | Allocations/op before → after |
| --- | ---: | ---: | ---: | ---: |
| Sequential | 15.19 µs | 15.22 µs | 4,360 → 3,667 | 45 → 31 |
| Parallel | 8.49 µs | 8.45 µs | 4,407 → 3,699 | 45 → 31 |

The baseline already pooled zlib readers across packs. The allocation profile
showed unpack bookkeeping and compressed-entry copies among the largest costs.
The updated pool also reuses its input reader and small entry table. Returning
it clears request references. Small packs share a single allocation for
their verified compressed entries, and receive-pack builds status output
with less temporary allocation. Small inflation requires the exact declared
size and verified zlib EOF. Large inflation grows with actual output up to the
declared limit plus one byte.

Allocation counts fell 31% and bytes allocated fell about 16%. Wall times
were effectively flat, and DEFLATE remained the leading CPU cost in both
profiles. These measurements exclude network overhead.

Native tests, the race run with parallel pushes, and `go vet` passed. The
unchanged public suite passed 120/120 through the native HTTP handler, and
two builds via `build.sh` produced byte-identical Linux amd64 binaries.
