# Complete Crawl4AI Integration Design

Date: 2026-06-27
Status: approved design, pending written-spec review

## Objective

Integrate upstream `crawl4ai==0.9.0` into ds4-studio as a production-grade local crawling subsystem shared by the native CLI, agent tools, HTTP API, and frontend. Version upgrades require a separate parity review and lockfile update.

For this project, “100%” means that every public declarative field exposed by the pinned Crawl4AI `BrowserConfig` and `CrawlerRunConfig` classes, and every public result field returned by that release, can be represented, validated, executed, and retrieved through ds4-studio. Python-only callbacks, hooks, and custom strategies that cannot be represented as JSON remain available through trusted local plugin entrypoints.

This design does not reimplement Crawl4AI algorithms in C or JavaScript. Crawl4AI remains the source of truth for crawling, extraction, browser automation, deep traversal, and Markdown generation.

## Scope

The integration includes:

- a persistent Python service with a shared browser pool;
- versioned local APIs for health, jobs, events, sessions, results, artifacts, cache, and maintenance;
- single-URL, multi-URL, streaming, and deep-crawl execution;
- complete declarative browser and crawler configuration pass-through;
- trusted local Python extensions for non-serializable upstream features;
- persistent jobs, sessions, cache metadata, and content-addressed artifacts;
- explicit dependency and browser installation, readiness checks, and migrations;
- clients for the native C REPL, Node server, agent runtime, and frontend;
- automated parity, unit, integration, browser, contract, and end-to-end tests;
- migration of the existing crawl helper and SQLite cache without retaining competing implementations.

Out of scope:

- rewriting Crawl4AI internals in C;
- supporting several Crawl4AI versions simultaneously;
- exposing the crawl service directly to an untrusted network;
- multi-tenant isolation for mutually untrusted users;
- silently falling back to a non-browser HTTP fetcher.

## Architecture

The new `ds4-crawl-service` is a long-lived Python process built with FastAPI, Pydantic, and Uvicorn and bound to loopback by default. It owns the Crawl4AI lifecycle and is the only component that imports the upstream package.

```text
Native CLI ---------+
Agent tools --------+--> versioned local API --> job scheduler --> Crawl4AI/browser pool
Frontend/Node ------+             |                    |
                                  |                    +--> sessions and plugins
                                  +--> SQLite metadata +--> content-addressed artifacts
```

The service provides one stable ds4-studio contract while Crawl4AI objects remain internal. The Node server proxies the API same-origin for the frontend. The native C client talks to the loopback API through a bounded HTTP client. All clients consume the same job and result representations. A random per-install bearer token, stored in a user-only file, authenticates direct local clients; the Node proxy attaches it server-side and never exposes it to browser JavaScript.

The service is installed and operated explicitly. Clients check readiness and return actionable errors; they never hide missing packages, missing browser binaries, schema drift, or service failures by switching to the legacy fetcher.

## Components

### Service runtime

The Python package contains narrowly scoped modules for:

- process configuration and startup;
- API request and response models;
- Crawl4AI configuration construction;
- strategy and plugin resolution;
- job scheduling and cancellation;
- session lifecycle;
- result serialization;
- SQLite repositories and migrations;
- artifact storage;
- event streaming;
- readiness and diagnostics.

The scheduler enforces configurable concurrency limits and keeps individual job failures isolated. Shutdown stops accepting jobs, cancels or drains active work according to policy, closes Crawl4AI sessions, flushes metadata, and closes the browser pool.

### Crawl4AI adapter

The adapter accepts JSON objects named `browser_config` and `crawler_config`. For the pinned release it:

1. introspects the public constructor fields;
2. rejects unknown fields with paths and expected types;
3. converts declared strategy objects into the corresponding Crawl4AI classes;
4. resolves enum values and nested configuration objects;
5. resolves trusted extension references when a value requires Python behavior;
6. constructs the upstream objects and executes the requested crawl mode.

Supported execution modes are single URL, batch, streaming batch, deep crawl, and persistent-session actions. The adapter does not maintain a manually curated allowlist of ordinary fields; parity tests compare accepted fields with the actual pinned constructors so upstream drift fails CI.

An extension reference contains a configured plugin name and exported object name. Plugins are loaded only from configured local directories. Request payloads cannot provide arbitrary filesystem paths or source code. Extension identity and version participate in cache keys.

### Job engine

Jobs have the states `queued`, `starting`, `running`, `cancelling`, `cancelled`, `succeeded`, `partially_succeeded`, and `failed`. State transitions are validated and persisted atomically.

Each job records:

- immutable request and normalized configuration;
- pinned Crawl4AI and adapter versions;
- timestamps and progress counters;
- per-URL status and errors;
- session identity where applicable;
- result manifest and artifact references;
- cache disposition;
- a bounded, structured event log.

Cancellation is cooperative first and forceful after a bounded grace period. Batch and deep-crawl jobs retain successful page results when other pages fail. Restart recovery marks orphaned running jobs as interrupted and makes their completed artifacts available; explicitly resumable modes may enqueue remaining work.

### Storage and cache

SQLite stores schemas, jobs, events, sessions, cache entries, and artifact metadata. Migrations are ordered, transactional, idempotent, and covered by forward-migration tests.

Large text and all binary values are stored in a content-addressed artifact directory. The database stores digest, size, MIME type, creation time, ownership references, and integrity state. Atomic temporary writes followed by rename prevent partial artifacts. Retrieval verifies the digest.

The cache key includes:

- normalized URL or URL set;
- normalized browser and crawler configuration;
- Crawl4AI and adapter versions;
- plugin identities and versions;
- output-selection policy.

The request controls cache behavior explicitly. Existing `crawl_cache` data is migrated when compatible and preserved in a backup table until migration is verified. The old standalone cache module is removed after all callers and tests use the new repository.

## API Contract

All endpoints live below `/v1/crawl`.

- `GET /health` returns service, Crawl4AI, browser, database, and artifact-store readiness.
- `POST /jobs` validates and creates a crawl job.
- `GET /jobs/{job_id}` returns status, progress, errors, and the result manifest.
- `GET /jobs/{job_id}/events` provides an SSE stream with replay from an event ID.
- `DELETE /jobs/{job_id}` requests cancellation idempotently.
- `POST /sessions` creates a persistent Crawl4AI session.
- `GET /sessions/{session_id}` returns session status without secrets.
- `DELETE /sessions/{session_id}` closes a session idempotently.
- `GET /artifacts/{artifact_id}` streams a verified artifact with its MIME type.
- `GET /cache` inspects cache metadata with bounded filters and pagination.
- `DELETE /cache` purges selected entries without deleting referenced artifacts prematurely.
- `POST /maintenance/gc` removes unreferenced artifacts using a dry-run-first contract.
- `GET /schema` returns request schemas, presets, and the parity manifest for the pinned version.

`POST /jobs` accepts:

- one URL or an ordered URL list;
- execution mode;
- `browser_config`;
- `crawler_config`;
- optional session ID;
- optional trusted extension references;
- cache policy;
- requested inline previews and artifact categories;
- client correlation metadata with bounded size.

The result manifest preserves every public upstream result field. JSON-safe scalar and structured values remain inline when bounded. Large strings and binary values become typed artifact references. Unknown result fields discovered at runtime are preserved through the generic serializer and cause the parity snapshot test to request an explicit schema update rather than being discarded.

## Events and output handling

Events include job state transitions, crawl start and completion, URL discovery, per-page completion, cache decisions, artifact creation, warnings, retries, cancellation, and terminal errors. Each event has a monotonic job-local ID and timestamp.

CLI and model-facing previews are generated from artifacts without mutating canonical results. Preview limits count UTF-8 bytes safely, never split a code point, and always include explicit truncation metadata. The model receives a compact manifest plus selected preview sections, not raw screenshots, PDFs, or unbounded HTML.

## Error model

Errors use stable codes, human-readable messages, retryability, affected URL or field paths, and an optional sanitized upstream detail object.

Required error categories include:

- dependency or browser not installed;
- service not ready;
- invalid or unsupported configuration;
- extension not configured or incompatible;
- navigation, extraction, timeout, or upstream failure;
- storage, migration, cache, or artifact integrity failure;
- cancellation and interrupted recovery;
- result serialization failure.

No exception from Crawl4AI is silently replaced with static HTTP output. Partial jobs expose successful results and structured failures. Logs and responses redact proxy credentials, cookies, authorization headers, API tokens, and configured secret fields.

## Security model

The deployment is local and trusted-user oriented. The service binds to loopback by default and rejects non-loopback binding unless explicitly configured. The Node proxy does not expose unrestricted artifact paths.

HTTP and HTTPS URLs are enabled by default. Local file access and other schemes require an explicit service setting. Redirect policies, maximum response and artifact sizes, crawl concurrency, depth, page count, and wall-clock duration are bounded by service limits even when request configuration asks for larger values.

Python extensions come only from administrator-configured plugin roots and named entrypoints. Requests cannot upload or evaluate Python or JavaScript outside the documented Crawl4AI configuration features. Secrets are accepted through configured secret references where possible and are never returned by read APIs.

## Client integration

### Native CLI

The REPL supports:

- `/crawl start URL [--config FILE] [--follow]`;
- `/crawl status JOB_ID`;
- `/crawl follow JOB_ID`;
- `/crawl cancel JOB_ID`;
- `/crawl result JOB_ID`;
- `/crawl session open|status|close`;
- `/crawl cache inspect|purge`;
- `/crawl doctor`.

The CLI validates local arguments, calls the API, displays structured progress, and submits only bounded result previews to the model. `/help` and the user documentation list every command. Shelling out to `tools/crawl4ai_fetch.py` is removed.

### Agent tool

A single `crawl` tool exposes actions `start`, `status`, `follow`, `cancel`, `result`, `artifact`, `session`, and `doctor`. The tool schema uses stable discriminated action payloads. Artifact reads require explicit section or byte limits so tool results remain bounded.

### Node API and frontend

The Node server proxies the versioned service endpoints with same-origin streaming and cancellation. It exposes service readiness through existing configuration/status surfaces.

The frontend includes:

- a JSON editor backed by `/schema`;
- versioned presets for common crawl, extraction, deep-crawl, dynamic-page, and capture scenarios;
- inline validation errors with field paths;
- job list and detail views;
- live progress and cancellation;
- Markdown and safe HTML previews;
- artifact inspection and retrieval;
- cache and service diagnostics appropriate for a local trusted installation.

## Packaging and lifecycle

The repository uses `pyproject.toml` and `uv.lock` to pin exact Python dependency versions and artifact hashes. Installation creates an isolated environment and installs the browser runtime required by `crawl4ai==0.9.0`. Supported commands include `install`, `serve`, `doctor`, and `migrate`.

`doctor` checks Python, pinned package versions, browser binaries, writable storage, schema parity, database migrations, loopback binding, and a local fixture crawl. It is read-only except when explicitly invoked with a repair option.

Service URL, storage directories, concurrency, resource limits, plugin roots, and logging are configurable through documented settings. Defaults follow XDG locations on Linux and the corresponding application-support locations on macOS.

## Testing strategy

Development follows red-green-refactor. Every new behavior starts with a failing test that demonstrates the intended public contract.

The suite includes:

- unit tests for models, normalization, state transitions, cache keys, storage, previews, redaction, and validation;
- migration tests from an empty database and the legacy cache schema;
- contract tests against real pinned Crawl4AI constructors, enums, strategy types, and result objects;
- a generated parity manifest that fails when any public declarative config or result field is uncovered;
- real-browser integration tests against local static and dynamic fixture sites;
- extraction tests for CSS, XPath, LLM-extension wiring, Markdown filters, tables, and media;
- deep-crawl tests for BFS, DFS, best-first, filters, scorers, limits, and streaming;
- session, JavaScript interaction, hooks, authentication-state, proxy-configuration, screenshot, PDF, MHTML, and cache tests;
- job tests for concurrency, partial success, retryable failures, cancellation, recovery, and event replay;
- C CLI end-to-end tests;
- Node proxy and agent-tool contract tests;
- frontend validation, progress, cancellation, and artifact-view tests;
- packaging and `doctor` tests for missing dependency, version drift, missing browser, and corrupted storage;
- regression tests for the legacy 24 KB truncation bug and UTF-8 boundaries.

Network-independent tests use local fixtures. Tests requiring an LLM or external proxy use explicit opt-in credentials and are not necessary for the deterministic default suite; adapter and plugin contracts remain fully tested locally.

## Definition of done

The integration is complete only when all of the following are true:

1. The generated parity manifest reports every public declarative `BrowserConfig` and `CrawlerRunConfig` field in Crawl4AI 0.9.0 as accepted and converted, or represented through a tested and documented trusted extension when JSON cannot express its Python value. Rejection of a valid upstream field is a parity failure.
2. Every public upstream result field is preserved inline or as an artifact reference.
3. All agreed feature categories have deterministic tests: single, batch, streaming, deep crawl, extraction, dynamic interaction, sessions, cache, captures, cancellation, and partial failure.
4. Native CLI, agent tool, Node API, and frontend use the same service contract.
5. No production code path imports or invokes the legacy helper or standalone cache implementation.
6. Dependency installation, browser bootstrap, migrations, service startup, diagnostics, and uninstall documentation are complete.
7. C builds, Python tests, Node tests, frontend tests, browser integration tests, and end-to-end tests pass from a clean checkout.
8. GitNexus change detection reports only expected symbols and flows for each implementation tranche, with high-risk changes reviewed before commit.
9. README, CLI help, API schema, presets, and operational documentation agree with actual behavior.

## Delivery sequence

Implementation is split into independently verifiable tranches:

1. pinned packaging, local fixture server, and service skeleton;
2. models, configuration adapter, parity manifest, and result serializer;
3. SQLite migrations, artifact store, cache, and job engine;
4. Crawl4AI execution modes, browser pool, sessions, events, and cancellation;
5. versioned API, diagnostics, and lifecycle commands;
6. native C CLI client and removal of the legacy helper path;
7. Node proxy and agent tool;
8. frontend editor, presets, job UI, previews, and artifacts;
9. cross-surface end-to-end tests, migration, documentation, and final parity verification.

Each tranche receives GitNexus impact analysis before existing symbols are edited, follows TDD, runs focused and regression suites, and is committed separately without absorbing unrelated working-tree changes.
