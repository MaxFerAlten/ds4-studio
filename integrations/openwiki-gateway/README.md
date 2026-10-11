# ds4-openwiki-gateway

Standalone Node service that sits between DS4 and the public OpenWiki MCP
server. It is a separate process: it is not linked into, built by, or started
implicitly with the DS4 native build.

Status: gateway runtime and offline tests are implemented; the end-to-end
security and process-supervision gates are still incomplete. See
`../../docs/openwiki-integration/00-audit.md` for verified results and remaining
limits, and `../../docs/openwiki/piano-esecutivo-openwiki-upstream-v3.md` for the
ordered work plan. Do not treat passing unit tests as release approval.

## DS4 JavaScript Agent

The JavaScript Agent can use the same read-only gateway over its Unix socket;
this does not depend on the model being a native DS4 backend. The UI exposes
OpenWiki as an explicit per-request toggle while Agent Mode is active. The
server advertises `openwiki_search` and `openwiki_read` only for an opted-in
turn, fixes the workspace from server configuration, and fails the request
before inference if the gateway is not ready.

The OpenWiki settings page can provision the pinned release from an upstream
checkout and configure its workspace. Provisioning checks out only the locked
Git commit in a temporary clean clone, so local dirty or untracked checkout
files never enter the release. The built release is MCP-smoke-tested before a
protected gateway config is saved. DS4 stores that config at
`~/.config/ds4-studio/openwiki.json` with mode `0600` and loads it on server
startup. The workspace may be any existing directory, including a worktree;
DS4 canonicalizes the selected directory and limits workspace writes to its
generated `openwiki/` directory. OpenWiki generation itself requires a Git
repository. For linked worktrees, the sandbox mounts only the selected
worktree's Git metadata and shared refs/objects read-only; it does not expose
the common `.git` root, hooks, or shared config. An explicit
`DS4_OPENWIKI_MODE=off` still disables the feature.

For managed deployments, the equivalent process settings are
`DS4_OPENWIKI_MODE=on`, `DS4_OPENWIKI_SOCKET=<absolute socket path>`,
`DS4_OPENWIKI_WORKSPACE=<allowlisted workspace id>`, and
`DS4_OPENWIKI_CONFIG=<absolute gateway config path>`. The workspace ID remains
an internal stable key. Search/read timeouts are optional
(`DS4_OPENWIKI_SEARCH_TIMEOUT_MS`, default 2000; and
`DS4_OPENWIKI_READ_TIMEOUT_MS`, default 3000). With the mode unset and no
DS4-managed config, the model tool catalog remains unchanged.

The gateway must pass its ownership, sandbox and MCP readiness checks before
the UI can use it. The JavaScript adapter does not bypass those checks or
start the gateway implicitly.

## Run the gateway

The gateway is an explicitly managed process. Its config file must be an
absolute path, owned by the gateway UID or root, mode `0600`, with a protected
parent directory. Start it with:

```bash
DS4_OPENWIKI_CONFIG=/absolute/path/gateway.json node src/daemon.mjs
```

The JSON uses schema 1 (`listen`, `upstream`, optional `sandbox`, and
`workspaces`) as validated by `src/config.mjs`. Configure exactly one workspace
per gateway process; its MCP child is sandboxed to that directory. The runner
checks the installed release manifest against the source commit and MCP
contract in `compatibility-v0.7.2.json`, then starts the certified
`mcp --host ds4-studio` command. Executable SHA-256 and package version are
informational; file type, path, inode, source commit, Node ABI, command,
protocol, tool allowlist, and schema fingerprint remain enforced. Use a separate config and socket for each
additional workspace. Do not put credentials in the config; the MCP child
receives a scrubbed environment.

## Requirements

- Node.js `>=22.22.0`
- Runtime dependency: `@modelcontextprotocol/sdk` 1.31.0.
- Tests use the built-in `node:test` runner.

## Commands

```bash
cd integrations/openwiki-gateway
npm ci                     # installs the pinned MCP SDK dependency
npm test                  # node --test
```

The complete suite includes security and sandbox tests that require a valid,
owned `bubblewrap` executable with working user namespaces. For offline unit
gates that do not start subprocesses, run:

```bash
node --test test/validators.test.mjs test/format-results.test.mjs
```

## Rules

- Talk to OpenWiki only through its public MCP interface; never import private
  OpenWiki modules.
- Changes here must not modify DS4 native sources or the DS4 build.
### Generazione gestita da DS4 e repository in sola lettura

Il processo ADMIN precarica `src/upstream-host-adapter.mjs`. L'adattamento resta
in memoria e non modifica la release OpenWiki: evita la creazione del workflow
standalone e le modifiche ad `AGENTS.md`/`CLAUDE.md`, gestite dal software host.
Una directory `openwiki/` vuota già creata da DS4 viene trattata come primo init,
senza rimuovere il punto di mount. Il comportamento upstream per wiki non vuote
resta invariato. Il processo READ non precarica l'adattamento.

Solo `openwiki/` resta scrivibile. Se cambia la struttura dei due moduli upstream,
l'adattamento fallisce esplicitamente anziché applicare una modifica parziale.

Il piano usa il contratto upstream: `instructions`, `seedPaths` e `relatedPages`
sono array di stringhe. Il controller fornisce al modello uno schema esplicito;
il worker ADMIN converte inoltre le `instructions` testuali del controller
precedente in un array, consentendo l'aggiornamento del worker senza riavviare
il server DS4. Una run già in fase `planning` conserva il proprio ID e può
riprendere tramite `init` nella stessa sessione.

