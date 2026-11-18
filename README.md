# Relay Git Forge

[![make.fun competition](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01)
[![Rank](https://make.fun/badge/github-core-clone-01/Hax0rgurl/bounded-knight/rank.svg)](https://make.fun/bounty/github-core-clone-01)
[![Reward](https://make.fun/badge/github-core-clone-01/Hax0rgurl/bounded-knight/reward.svg)](https://make.fun/bounty/github-core-clone-01)

An original, dependency-free GitHub-compatible forge for `github-core-clone-01`.
Node **22.18+**, standard library only; the service never invokes Git.

One in-memory SHA-1 object store connects Git smart HTTP (upload-pack v2/v0,
receive-pack v0), REST `/api/v3`, GraphQL `/api/graphql`, and MCP `/mcp`.
It supports shallow fetches, delta-pack ingestion, per-ref fast-forward checks,
contents commits, issues, comments, labels, PR files, and conflict-aware squash merges.
Compressed object bytes are cached for repeated fetches.

Run locally, with a disposable development token:

```sh
MAKEFUN_SHOP_TOKEN=development-only FORGE_LOGIN=octopus node serve.ts
```

The server prints its ephemeral loopback URL. `PORT` optionally selects a port.
All routes except `/healthz` require `Authorization: Bearer development-only`.
For the trial lifecycle, run `node main.ts` with `MAKEFUN_ENV_URL` and
`MAKEFUN_SHOP_TOKEN` supplied by the coordinator. It binds port 0, registers, polls
`/done`, and exits only when the suite finishes. Leave `FORGE_LOGIN` unset in trials:
the opaque token's single owner is bound by its first owner-qualified request.
`MAKEFUN_TRIAL_NOW` supplies deterministic metadata timestamps.

Tests, with no install step:

```sh
node test/core.test.ts
node test/public-suite.ts /path/to/github-core-clone-01-kit --perf
```

**Verified on Node 22.18.0:** 120/120 published checks and 14/14 additional tests.
The published suite ran unchanged through a socket-free adapter into the real HTTP
handler because this build sandbox rejects TCP listeners (`listen EPERM`). All four
published benchmark workloads completed; adapter timings exclude network overhead
and establish no official performance score. See [TESTING.md](TESTING.md) and
[test/results.json](test/results.json).

State lasts for one process. GraphQL implements the documented client schema subset;
merges conservatively reject files changed differently on both sides. This is a
single-tenant competition implementation, not a durable hosted GitHub replacement.
MIT licensed; starter lifecycle attribution is retained in [LICENSE](LICENSE).
