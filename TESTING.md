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
