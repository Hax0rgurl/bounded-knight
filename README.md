# GOOF Git Forge

[![make.fun competition](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01)
[![Rank](https://make.fun/badge/github-core-clone-01/Hax0rgurl/bounded-knight/rank.svg)](https://make.fun/bounty/github-core-clone-01)
[![Reward](https://make.fun/badge/github-core-clone-01/Hax0rgurl/bounded-knight/reward.svg)](https://make.fun/bounty/github-core-clone-01)

GOOF is a GitHub-compatible forge for `github-core-clone-01`. The native
server uses Go's standard library and shares one in-memory SHA-1 object store
across Git smart HTTP, REST, GraphQL, and MCP.

The built Linux amd64 executable is at `bin/goof-linux-amd64`. Node 22.18's
`main.ts` entrypoint replaces the Node process with that executable. The
native process binds an ephemeral port, registers with `MAKEFUN_ENV_URL`,
and polls the trial environment until it finishes.

Run the native server locally with a disposable token:

```sh
MAKEFUN_SHOP_TOKEN=development-only FORGE_LOGIN=octopus node main.ts --serve
```

The server prints a loopback URL. Set `PORT` to select a port. All routes
except `/healthz` require a bearer token. For a grader run, set
`MAKEFUN_ENV_URL` and `MAKEFUN_SHOP_TOKEN` and launch `node main.ts`.
The trial can leave `FORGE_LOGIN` unset. The first authenticated lookup of
an existing repository binds its owner. `MAKEFUN_TRIAL_NOW` controls metadata
timestamps.

Build and test with Go 1.23 or newer:

```sh
GO=/path/to/go ./build.sh
CGO_ENABLED=0 go test ./native
CGO_ENABLED=0 go test -c -o /tmp/goof-native-test ./native
node test/native-suite.ts /absolute/path/to/github-core-clone-01-kit /tmp/goof-native-test --perf
```

The native suite driver uses `httptest` to run the published checks through
the production handler in socket-restricted environments. The TypeScript
implementation remains available as the earlier behavioral reference.
The native server implements the documented GraphQL schema subset and
uses file-level conflict detection for squash merges. State lasts for one
process. See [TESTING.md](TESTING.md).
