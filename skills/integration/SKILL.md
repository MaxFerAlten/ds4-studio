---
name: ds4-universal-tool-integration-engineering
description: Evidence-driven audit and implementation planning for integrating any external tool, CLI, compiler, prover, runtime, SDK, service, API, model, or executable capability into ds4-studio. Trigger whenever the user asks to evaluate, design, improve, review, certify, or plan a tool integration. Produces two mandatory artifacts: a critical evaluation of the proposed integration and a phase-gated executable plan suitable for a modest-capability LLM. Enforces repository-grounded claims, official-tool semantics, versioned contracts, lifecycle completeness, fail-closed security, production-coupled tests, observability, rollout, rollback, and anti-regression gates.
---

# DS4 Universal Tool Integration Engineering Skill

## 0. Mission

This skill defines a reusable engineering method for integrating a new tool into ds4-studio without relying on architectural guesses, superficial pattern copying, invented helpers, fake tests, or unverified assumptions about the external tool.

The method MUST work for integrations such as:

- local command-line tools;
- compilers and interpreters;
- theorem provers and computer algebra systems;
- static analyzers and linters;
- OCR, media, conversion, or document-processing tools;
- local model runtimes;
- HTTP or RPC services;
- SDK-backed services;
- database, search, crawling, or research providers;
- privileged or hardware-facing utilities;
- tools that create persistent artifacts;
- tools that execute user-supplied or model-generated code.

The skill MUST produce an integration that is:

1. grounded in the actual repository;
2. semantically correct for the external tool;
3. complete across every host-system registration surface;
4. secure according to the tool's real capabilities;
5. deterministic and reproducible where technically possible;
6. testable through production code rather than test-only copies;
7. observable, cancellable, bounded, and diagnosable;
8. deployable through explicit rollout and rollback gates;
9. described precisely enough that a modest-capability LLM can execute it without filling gaps by imagination.

This skill is not merely a code-generation prompt. It is an engineering-control protocol.

---

# 1. Mandatory final deliverables

For every integration-analysis request, produce exactly these two primary artifacts unless the user explicitly asks for only one:

## Deliverable A — Critical evaluation

Suggested filename:

```text
critical-evaluation-<tool>-integration-ds4-studio.md
```

It MUST contain:

- executive verdict;
- approval state;
- total score and weighted scoring table;
- verified strengths to retain;
- blocking defects;
- major and minor defects;
- claims that could not be verified;
- repository evidence matrix;
- external-tool semantic corrections;
- security verdict;
- testing verdict;
- reproducibility verdict;
- list of invented, stale, or missing symbols;
- list of missing integration surfaces;
- minimal conditions required before implementation may begin.

## Deliverable B — Executable implementation plan

Suggested filename:

```text
executable-plan-<tool>-integration-ds4-studio.md
```

It MUST contain:

- measurable objective;
- non-goals and deferred scope;
- immutable decisions;
- baseline procedure;
- proposed architecture;
- exact integration surfaces;
- versioned request/result contracts;
- lifecycle and state machine;
- configuration and preflight;
- security and threat model;
- exact file-by-file work packages;
- phase order and dependencies;
- a test contract for every modification;
- certification script;
- rollout stages;
- rollback procedure;
- global Definition of Done;
- compact execution protocol for a modest LLM.

The two deliverables MUST agree. A defect identified as blocking in Deliverable A cannot silently disappear from Deliverable B.

---

# 2. Operating mode

## 2.1 Default mode

Default to:

```text
AUDIT -> CORRECT -> PLAN -> CERTIFY
```

Do not modify source code unless the user explicitly requests implementation.

## 2.2 Evidence-before-design rule

Never propose an exact modification before locating the real production symbol, module, route, schema, registry, state structure, or lifecycle hook that the modification depends on.

Wrong:

```text
Add toolFoo() near line 1500.
```

Correct:

```text
Locate the exported production dispatcher that currently handles sibling tools.
Verify its current symbol name and module path.
Anchor the task to that symbol, not to a guessed line number.
Record the current line range only as observational evidence, never as a stable identifier.
```

## 2.3 No-background-work rule

Complete the analysis and artifacts in the current run. Do not promise later delivery. When information is incomplete, produce a bounded partial result and explicitly mark unresolved items.

## 2.4 Best-effort rule

Do not interrupt a large repository-analysis task for minor missing details. Resolve them from the repository, build files, tests, official documentation, configuration, or existing sibling integrations whenever possible.

Ask the user only when a genuinely non-resolvable choice changes the requested product, security posture, or deployment environment.

---

# 3. Normative language

Interpret these terms strictly:

- **MUST / SHALL**: mandatory; failure blocks the phase.
- **MUST NOT / SHALL NOT**: prohibited.
- **SHOULD**: expected unless a documented reason justifies deviation.
- **MAY**: optional.
- **BLOCKER**: implementation cannot safely begin or cannot be accepted.
- **GATE**: a verifiable condition that must pass before the next phase.
- **EVIDENCE**: repository content, executable output, official specification, or reproducible test result.
- **ASSUMPTION**: an unverified proposition that cannot be treated as fact.
- **INFERENCE**: a conclusion derived from cited evidence; it must be labelled as an inference.
- **PRODUCTION-COUPLED TEST**: a test that imports, invokes, or exercises production code rather than a rewritten copy.

---

# 4. Core anti-hallucination laws

## 4.1 Repository truth hierarchy

Use this priority order:

1. current production source code;
2. current build and runtime configuration;
3. current production tests;
4. generated schemas or protocol definitions;
5. executable runtime behavior;
6. repository documentation;
7. prior plans or reports;
8. comments and historical notes;
9. model memory.

A prior plan is never proof that a symbol exists or that a change was applied.

## 4.2 External-tool truth hierarchy

Use this priority order:

1. official versioned documentation;
2. official command help for the installed or pinned version;
3. official source code or API schema;
4. official release notes;
5. reproducible local experiments;
6. reputable primary technical references;
7. secondary sources;
8. model memory.

For technical semantics, do not rely on blogs when official documentation exists.

## 4.3 Symbol existence rule

Before naming any helper, class, function, route, environment variable, command, test fixture, schema, or module as existing:

1. search the repository;
2. open the defining code;
3. identify its callers or registration path;
4. record whether it is production, test-only, dead, generated, or documentation-only.

If no definition is found, write:

```text
NOT FOUND IN EXAMINED REPOSITORY
```

Then choose one of two explicit actions:

- define it as a new artifact with a complete contract; or
- replace it with an existing verified mechanism.

Never invoke an invented helper as though it already exists.

## 4.4 Line-number rule

Line numbers are volatile observations, not implementation anchors.

Every task MUST identify:

- file path;
- enclosing symbol or unique code marker;
- insertion or replacement relationship;
- present behavior;
- desired behavior.

A task that says only “modify around line N” is invalid.

## 4.5 Copy-pattern rule

A sibling integration is a reference, not a template to clone blindly.

For every copied concept, compare:

- execution semantics;
- trust boundary;
- lifecycle;
- success criteria;
- artifacts;
- cancellation behavior;
- resource profile;
- dependency model;
- security capabilities;
- output structure.

The plan MUST list:

```text
REUSE AS-IS
ADAPT
DO NOT REUSE
```

for each major sibling pattern.

## 4.6 No placeholder implementation rule

The final executable plan MUST NOT contain implementation gaps such as:

```text
// ...
// similar to existing code
// handle errors
// add tests
// cleanup here
```

Pseudocode is allowed only when it specifies all branches, inputs, outputs, invariants, and error behavior needed by the implementer.

## 4.7 Claim labelling

Every material claim in the audit notes MUST be labelled internally as one of:

```text
VERIFIED_REPOSITORY
VERIFIED_RUNTIME
VERIFIED_OFFICIAL_DOC
INFERRED
ASSUMED
UNRESOLVED
```

Only the first four may support an implementation decision. `INFERRED` claims require the supporting premises.

---

# 5. Integration classes and risk classification

Classify the proposed tool before designing the integration.

## 5.1 Tool classes

### Class A — Pure remote API

Examples:

- stateless HTTP search API;
- hosted inference endpoint;
- read-only metadata service.

Primary risks:

- credentials;
- privacy;
- network timeout;
- rate limits;
- SSRF through user-controlled URLs;
- response poisoning;
- provider drift.

### Class B — Local read-only analyzer

Examples:

- linter;
- parser;
- metadata extractor;
- static inspection CLI.

Primary risks:

- malformed input;
- decompression bombs;
- resource exhaustion;
- unsafe parser bugs;
- filesystem overreach.

### Class C — Local compiler/interpreter/runtime

Examples:

- Python, Node, Lean, Sage, shell, compiler, notebook engine.

Primary risks:

- arbitrary code execution;
- process spawning;
- filesystem access;
- network access;
- environment leakage;
- denial of service;
- persistence outside workspace.

### Class D — Persistent state mutator

Examples:

- database writer;
- Git publisher;
- cloud storage uploader;
- issue or email creator.

Primary risks:

- irreversible or externally visible actions;
- duplicate writes;
- permission escalation;
- incorrect target resolution;
- replay.

### Class E — Privileged or hardware-facing tool

Examples:

- package manager;
- kernel, device, GPU, firmware, mount, network configuration utility.

Primary risks:

- system damage;
- privilege boundary violation;
- host instability;
- data loss;
- device unavailability.

### Class F — Hybrid

A tool may belong to more than one class. Use the strictest applicable controls.

## 5.2 Risk tier

Assign one tier:

| Tier | Meaning | Default posture |
|---|---|---|
| R0 | Pure deterministic transformation, no I/O beyond supplied data | bounded execution |
| R1 | Read-only local or remote access | allowlisted access |
| R2 | Processes files or untrusted structured input | isolated workspace |
| R3 | Executes code, spawns processes, or performs network access | sandbox and fail-closed |
| R4 | Mutates external state or host configuration | explicit authorization and idempotency |
| R5 | Privileged, destructive, or safety-critical | separate privileged service; default deny |

The plan MUST justify the tier with concrete tool capabilities.

---

# 6. Required inputs and discovery ledger

## 6.1 Required evidence set

Collect, where available:

- proposed integration plan;
- proposed implementation instructions;
- current repository snapshot;
- build instructions;
- runtime instructions;
- current tests;
- sibling integration source;
- official external-tool documentation;
- installed version output or version lock;
- user constraints;
- deployment OS and architecture;
- security constraints;
- performance constraints.

## 6.2 Evidence ledger

Create a working table:

| ID | Claim or question | Source sought | Evidence found | Status | Consequence |
|---|---|---|---|---|---|
| E-001 | Where are tools registered? | repository | `<path>:<symbol>` | verified | modify registry |
| E-002 | What command performs validation? | official docs/runtime | `<command>` | verified | executor semantics |
| E-003 | Does the tool spawn processes? | official API/source | yes/no | verified | sandbox tier |

Rules:

- One row per material uncertainty.
- Do not delete rows when resolved; update their status.
- Every blocker in the critical evaluation MUST map to at least one evidence row.
- Every major architectural decision MUST map to evidence or an explicit design choice.

## 6.3 Search discipline

For each concept:

1. search semantically for the subsystem;
2. search exact sibling tool names;
3. locate definitions;
4. locate all call sites;
5. locate tests;
6. locate build/config references;
7. locate environment-variable documentation;
8. detect duplicate or stale implementations.

Do not stop after finding the first matching file.

## 6.4 Truncated-repository rule

When the repository is supplied as a packed or truncated document:

- distinguish `not visible in current snippet` from `not present`;
- use exact in-file search for symbols;
- expand the containing ranges;
- avoid conclusions based only on a directory listing;
- record excluded paths and ignored file patterns;
- state whether binaries, generated files, vendor directories, or JSON schemas were omitted.

---

# 7. Phase A — Establish the baseline

No design work is accepted before the baseline is recorded.

## 7.1 Baseline report

Record:

```text
Repository revision:
Branch:
Working tree status:
Build command:
Build result:
Unit test command:
Unit test result:
Integration test command:
Integration test result:
Runtime smoke command:
Runtime smoke result:
External tool version:
External tool path:
Deployment OS/architecture:
Known existing failures:
```

## 7.2 Baseline commands

The plan MUST provide exact commands adapted to the repository.

Generic pattern:

```bash
git rev-parse HEAD
git status --short
<build-command>
<existing-fast-test-command>
<runtime-status-command>
<external-tool> --version
command -v <external-tool>
```

## 7.3 Baseline gate

Gate `G0_BASELINE` passes only when:

- revision is recorded;
- build state is known;
- pre-existing failing tests are separated from new failures;
- external tool availability is known;
- no uncommitted integration changes are mistaken for baseline behavior.

If baseline build is already broken, the plan MUST:

1. document the failure;
2. determine whether it touches the integration surface;
3. prevent attribution of that failure to future integration work;
4. define a limited baseline exception.

---

# 8. Phase B — Model the external tool correctly

## 8.1 Semantic operation table

Do not reduce every tool to one vague `execute` operation.

List its distinct operations:

| Operation | Meaning | Side effects | Required input | Success criterion | Default enabled |
|---|---|---|---|---|---|
| validate | parse/typecheck/analyze | none expected | source/config | no validation errors | yes |
| build | produce build artifacts | filesystem writes | project | build completes | optional |
| run | execute program or workflow | arbitrary effects possible | executable input | process contract | no by default |
| query | inspect tool state | read-only | identifier | structured response | yes |
| mutate | change external state | persistent | action payload | committed result | explicit only |

Use names appropriate to the actual tool.

## 8.2 Success taxonomy

Define distinct success levels. Generic example:

```text
TRANSPORT_SUCCESS
PROCESS_STARTED
PROCESS_EXITED_ZERO
OUTPUT_PARSED
TOOL_VALIDATION_PASSED
POLICY_VALIDATION_PASSED
ARTIFACTS_PERSISTED
RESULT_PUBLISHABLE
```

Never equate exit code zero with a domain-level certified result unless the tool specification proves that equivalence.

## 8.3 Failure taxonomy

At minimum distinguish:

```text
CONFIG_UNAVAILABLE
DEPENDENCY_UNAVAILABLE
VERSION_MISMATCH
INVALID_REQUEST
POLICY_MISMATCH
PATH_REJECTED
SANDBOX_UNAVAILABLE
SPAWN_FAILED
TIMEOUT
CANCELLED
OUTPUT_LIMIT
PROCESS_FAILED
PARSE_FAILED
DOMAIN_VALIDATION_FAILED
PLACEHOLDER_OR_INCOMPLETE_RESULT
ARTIFACT_WRITE_FAILED
INTERNAL_CONTRACT_VIOLATION
```

Tool-specific errors MUST be added.

## 8.4 Reproducibility

Determine whether the external tool requires:

- a pinned binary version;
- a lockfile;
- a project manifest;
- plugins or packages;
- model or ruleset versions;
- compiler flags;
- locale or timezone;
- environment variables;
- network-fetched dependencies;
- generated caches.

Prohibit unpinned `latest` in the executable plan unless the user explicitly requests rolling updates and accepts nondeterminism.

## 8.5 Preflight contract

Define a read-only preflight that checks:

- binary or service reachability;
- version compatibility;
- required project files;
- required sandbox/runtime;
- write permission to controlled workspace;
- credentials without printing secrets;
- optional dependency profiles;
- incompatible configuration.

Preflight MUST return a structured result and MUST NOT perform the main tool action.

---

# 9. Phase C — Map the real ds4-studio integration surface

For ds4-studio, inspect every applicable surface below. Mark each one:

```text
REQUIRED
NOT_REQUIRED_WITH_REASON
DEFERRED_WITH_REASON
```

## 9.1 Native agent/worker surface

Inspect:

- tool-call parser;
- native tool schema exposed to the model;
- dispatcher;
- request encoding;
- HTTP or IPC transport;
- response parser;
- per-turn counters;
- state machine;
- finalization gate;
- error mapping;
- cancellation;
- cleanup;
- worker initialization;
- worker destruction;
- session reset/switch/new behavior;
- bash interception or duplicate execution path prevention.

## 9.2 Node/server surface

Inspect:

- production route registration;
- route factory or importability;
- request validation;
- authentication/loopback boundary;
- rate and body-size limits;
- run workspace creation;
- executor;
- process lifecycle;
- timeout;
- cancellation;
- output buffers;
- result contract;
- artifact persistence;
- structured logging;
- retention cleanup.

## 9.3 Agent tool registry surface

Inspect:

- tool catalog;
- schema;
- capability list;
- session allowlist;
- tool gate/policy;
- runtime rules;
- UI exposure;
- model-visible tool description;
- tool result compression or truncation;
- audit logging.

## 9.4 Skill and prompt surface

Inspect:

- `skills/<tool>/SKILL.md`;
- default-skill constants;
- auto-load environment variables;
- system-prompt construction;
- policy revision/hash;
- slash command start/stop/status/preflight;
- startup GUI/config;
- missing-skill behavior;
- prompt rebuild;
- session lifecycle;
- cleanup.

## 9.5 Build and deployment surface

Inspect:

- build targets;
- object lists for every platform variant;
- package manifests;
- startup scripts;
- environment documentation;
- installation/preparation script;
- CI jobs;
- container or sandbox dependencies;
- architecture-specific behavior.

## 9.6 Test surface

Inspect:

- C/native unit tests;
- Node unit tests;
- route tests;
- production executor tests;
- real external-tool integration tests;
- security tests;
- agent end-to-end tests;
- regression tests for sibling tools;
- certification script.

## 9.7 Surface completeness matrix

Produce:

| Surface | Existing pattern | Proposed modification | Test | Status |
|---|---|---|---|---|
| Catalog | `<verified symbol>` | add descriptor | catalog unit test | required |
| Schema | `<verified symbol>` | versioned input schema | schema test | required |
| Dispatcher | `<verified symbol>` | route tool call | native unit test | required |
| Executor | none/new | controlled process | executor test | required |

An integration is incomplete if a required row lacks either a modification or a test.

---

# 10. Phase D — Architecture decision

## 10.1 Candidate architectures

Evaluate at least the candidates that are technically plausible:

1. skill-only, using an existing generic shell/tool path;
2. native tool via C-to-HTTP-to-Node;
3. Node-only tool in the server agent pipeline;
4. local native execution in C;
5. dedicated sidecar service;
6. remote provider adapter;
7. plugin/connector integration.

## 10.2 Decision criteria

Score each candidate on:

- semantic fit;
- security isolation;
- cancellation;
- output handling;
- testability;
- artifact management;
- observability;
- portability;
- implementation complexity;
- maintenance burden;
- consistency with current architecture;
- ability to disable cleanly;
- effect on server mode and agent mode.

## 10.3 Decision record

Write an ADR-style block:

```text
Decision ID: ADR-TOOL-001
Chosen architecture:
Status:
Context:
Alternatives considered:
Decision drivers:
Why chosen:
Why alternatives rejected:
Security consequences:
Operational consequences:
Migration consequences:
Revisit conditions:
```

## 10.4 Responsibility boundaries

Assign each responsibility to exactly one authoritative layer.

Generic example:

| Responsibility | Authority |
|---|---|
| model-visible schema | tool registry/schema module |
| turn budget | native worker or central agent gate |
| request validation | server route/contract module |
| process creation | executor/process module |
| sandbox command | sandbox module |
| result interpretation | contract/diagnostics module |
| final publishability | one state machine authority |
| artifacts | run store/workspace module |

Do not maintain two independent authorities for the same transition unless a consistency protocol is specified and tested.

---

# 11. Phase E — Define versioned contracts first

Implementation MUST begin with contracts, not process spawning.

## 11.1 Request contract template

```json
{
  "contractVersion": "<tool>_request_v1",
  "operation": "validate",
  "input": {},
  "timeoutSec": 30,
  "sessionId": "session-id",
  "runId": "immutable-run-id",
  "attempt": 1,
  "policyRevision": "sha-or-version",
  "options": {}
}
```

Define for every field:

- type;
- required/optional;
- minimum/maximum;
- normalization;
- default;
- security constraints;
- whether user-controlled;
- whether immutable across retries.

## 11.2 Result contract template

```json
{
  "contractVersion": "<tool>_result_v1",
  "ok": false,
  "status": "PROCESS_FAILED",
  "operation": "validate",
  "runId": "immutable-run-id",
  "attempt": 1,
  "exitCode": 1,
  "signal": null,
  "timedOut": false,
  "cancelled": false,
  "durationMs": 123,
  "stdout": "",
  "stderr": "",
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "diagnostics": [],
  "artifacts": [],
  "toolVersion": "",
  "policyRevision": "",
  "publishable": false,
  "error": {
    "code": "PROCESS_FAILED",
    "message": "bounded public message"
  }
}
```

## 11.3 Contract invariants

At minimum:

- `ok=true` implies a success status;
- `publishable=true` implies `ok=true` plus all domain-policy gates;
- timeout and cancellation cannot both be silently reported as generic process failure;
- run ID is immutable through all layers;
- attempt is monotonic within the run;
- policy revision sent by the caller is checked where policy enforcement occurs;
- truncated output is explicitly marked;
- artifacts use relative, validated references rather than arbitrary host paths;
- internal exceptions do not leak secrets or stack traces to the model by default;
- unknown contract versions fail closed.

## 11.4 Diagnostic contract

Each diagnostic SHOULD include:

```json
{
  "severity": "error",
  "code": "tool-specific-code",
  "message": "human-readable message",
  "file": "relative/path",
  "line": 10,
  "column": 5,
  "endLine": 10,
  "endColumn": 9,
  "raw": "bounded raw fragment"
}
```

Do not promise structured fields that the external tool cannot reliably provide.

## 11.5 Schema compatibility

Specify:

- behavior for missing version;
- behavior for newer unknown version;
- behavior for optional new fields;
- migration strategy to v2;
- tests for incompatible versions.

---

# 12. Phase F — Lifecycle and state machine

## 12.1 State model

Define explicit states appropriate to the tool. Generic model:

```text
IDLE
PREPARED
RUNNING
RESULT_RECEIVED
DOMAIN_VALIDATED
READY
FAILED
CANCELLED
```

For iterative repair tools:

```text
IDLE -> PREPARED -> RUNNING -> FAILED_REPAIRABLE -> RUNNING
RUNNING -> DOMAIN_VALIDATED -> READY
ANY_ACTIVE -> CANCELLED
ANY_ACTIVE -> FAILED
```

## 12.2 Transition table

| Current | Event | Guard | Next | Counter/action |
|---|---|---|---|---|
| IDLE | start | policy loaded | PREPARED | create run ID |
| PREPARED | execute | budget available | RUNNING | increment attempts |
| RUNNING | result_ok | contract valid | RESULT_RECEIVED | store result |
| RESULT_RECEIVED | validate | domain checks pass | READY | publishable=true |
| RUNNING | timeout | none | FAILED | kill process group |
| any active | cancel | run ID matches | CANCELLED | kill and cleanup |

## 12.3 Counter rules

For every counter specify:

- increment point;
- reset point;
- maximum;
- error code on limit;
- whether transport retries consume the budget;
- whether user-requested new run resets it.

A counter field that is never incremented is a blocker.

## 12.4 Finalization rule

Final output MUST NOT be released merely because no failure string exists.

Define a positive predicate, for example:

```text
can_finalize =
  state == READY
  AND result_contract_valid
  AND domain_validation_passed
  AND policy_revision_matched
  AND required_artifacts_persisted
  AND no_pending_process
```

## 12.5 Reset and cleanup matrix

| Event | Reset turn state | Preserve artifacts | Kill process | Clear policy | Rebuild prompt |
|---|---:|---:|---:|---:|---:|
| new user turn | yes | yes | if active | no | no |
| new session | yes | policy-dependent | yes | reload | yes |
| session switch | yes | yes | yes | preserve/reload | verify |
| tool stop | yes | yes | yes | yes | yes |
| worker destroy | n/a | retention policy | yes | free | n/a |

Adapt this table to the actual host lifecycle.

---

# 13. Phase G — Security design

## 13.1 Threat model is mandatory

List:

### Assets

- model/system prompt;
- user files;
- repository;
- credentials;
- network identity;
- host process;
- GPU/CPU/RAM availability;
- persistent workspace;
- external accounts;
- audit logs.

### Attackers and untrusted inputs

- model-generated tool arguments;
- user-supplied code;
- uploaded files;
- remote API content;
- malicious project dependencies;
- crafted paths and symlinks;
- oversized output;
- cancellation races;
- replayed requests.

### Threats

- arbitrary command execution;
- path traversal;
- symlink escape;
- environment/secret leakage;
- network exfiltration;
- SSRF;
- fork bombs;
- memory/CPU exhaustion;
- output flooding;
- artifact overwrite;
- cross-session access;
- duplicate external mutation;
- policy downgrade;
- stale dependency execution.

## 13.2 Local process rules

For R2 or higher local tools:

- prefer direct `spawn(executable, argv)` over a shell string;
- never interpolate untrusted input into shell commands;
- use a per-run directory;
- canonicalize and validate paths;
- reject symlinks where they violate the containment model;
- use an environment allowlist;
- apply timeout;
- kill the entire process group;
- bound stdout and stderr separately;
- bound file count and artifact size;
- clean temporary resources deterministically;
- record whether cleanup succeeded.

## 13.3 Sandbox rules

For R3 code-executing tools:

- sandbox is required by default;
- absence of the sandbox MUST produce `SANDBOX_UNAVAILABLE`;
- no silent unsandboxed fallback;
- disable network unless the operation explicitly requires allowlisted network access;
- mount only required read-only runtime paths;
- mount a dedicated writable run directory;
- hide home, repository secrets, SSH, cloud credentials, and unrelated files;
- limit CPU, address space, file size, open files, and process count;
- use a new process/session namespace when supported;
- prevent privilege escalation;
- test actual denial behavior.

## 13.4 Remote API rules

For remote tools:

- credentials come from server-side configuration, never model arguments;
- redact credentials in logs;
- allowlist scheme/host where URLs are configurable;
- implement connect and total timeouts;
- cap response size;
- validate content type;
- distinguish provider error from local contract error;
- define retry eligibility;
- use idempotency keys for mutations;
- avoid retrying non-idempotent calls automatically;
- record provider/version metadata when available.

## 13.5 External mutation rules

For R4/R5:

- separate read and write tools when possible;
- require explicit user authorization for consequential actions;
- provide a dry-run or preview;
- resolve target identity before write;
- make retries idempotent;
- return externally assigned IDs;
- log the action without leaking secrets;
- provide compensation/rollback where possible;
- never present an uncommitted action as completed.

## 13.6 Security test minimum

Test actual production behavior for:

- path traversal rejection;
- symlink escape rejection;
- environment-secret non-visibility;
- network denial or allowlist enforcement;
- process timeout and process-group kill;
- output truncation;
- resource-limit behavior;
- cross-session isolation;
- sandbox-unavailable fail-closed behavior;
- replay/idempotency for mutating tools.

Mock-only security tests are insufficient.

---

# 14. Phase H — Process and transport engineering

## 14.1 Process controller contract

The process controller MUST own:

- spawn;
- stdout buffer;
- stderr buffer;
- timeout timer;
- cancellation signal;
- process-group termination;
- exit/signal capture;
- exactly-once settlement;
- cleanup callback;
- duration measurement.

## 14.2 Exactly-once settlement

Guard against races among:

- `error` event;
- `exit` event;
- `close` event;
- timeout;
- cancellation;
- client disconnect.

Use one settlement guard. Every terminal path MUST clear timers and remove listeners as appropriate.

## 14.3 Output buffers

Use bounded head/tail or bounded total buffers.

Result MUST indicate:

- bytes observed;
- bytes retained;
- truncation flag;
- which portion was retained.

Do not allow unbounded concatenation of process output.

## 14.4 Timeout semantics

Define:

- minimum;
- default;
- maximum;
- operation-specific limit;
- grace period between TERM and KILL, if used;
- result code;
- cleanup behavior.

Never accept arbitrary multi-hour timeouts simply because a generic parser supports them.

## 14.5 Retry semantics

Separate:

- transport retry;
- process rerun;
- model repair attempt;
- user-requested new run.

State which ones:

- reuse run ID;
- increment attempt;
- consume turn budget;
- may be automatic;
- are safe for mutating operations.

## 14.6 Transport contract

When C calls Node over HTTP:

- use loopback or authenticated local transport;
- validate frontend port;
- encode request from structured values;
- do not build JSON through unsafe string concatenation without escaping;
- set content type;
- bound body size;
- define status-code behavior;
- parse the versioned result;
- reject HTML or malformed JSON responses;
- preserve immutable run ID;
- map transport failure separately from tool failure.

---

# 15. Phase I — Workspace and artifact model

## 15.1 Directory hierarchy

Use a deterministic hierarchy such as:

```text
<workspace-root>/tools/<tool>/sessions/<session-id>/runs/<run-id>/
```

Each run directory MAY contain:

```text
request.json
input/
work/
stdout.log
stderr.log
result.json
artifacts/
metadata.json
```

## 15.2 Path invariants

- session and run IDs are sanitized with strict allowlists;
- resolved paths remain beneath the canonical root;
- user input cannot select arbitrary host directories;
- artifact references returned to the model are relative IDs or controlled URLs;
- pre-existing paths are handled according to idempotency policy;
- cross-session lookup is denied by default.

## 15.3 Artifact contract

For each artifact define:

```json
{
  "id": "artifact-id",
  "kind": "report",
  "relativePath": "artifacts/report.json",
  "mimeType": "application/json",
  "sizeBytes": 1234,
  "sha256": "...",
  "retention": "session"
}
```

## 15.4 Retention

Specify:

- temporary-file deletion;
- successful-run retention;
- failed-run retention;
- maximum total storage;
- age-based cleanup;
- user-visible artifact handling;
- cleanup test.

Do not delete evidence required for debugging before the result is safely persisted.

---

# 16. Phase J — Agent-facing design

## 16.1 Tool name

Tool name MUST be:

- unambiguous;
- stable;
- distinct from slash commands;
- consistent across C, Node, schema, logs, tests, and skill.

Create a naming table:

| Concept | Required name |
|---|---|
| model tool name | `<tool>` |
| HTTP route | `/api/tools/<tool>/exec` or verified project convention |
| result contract | `<tool>_result_v1` |
| environment prefix | `DS4_<TOOL>_` |
| skill directory | `skills/<tool>/` |
| log event | `<tool>_call` |

## 16.2 Model-visible schema

The schema MUST:

- expose only supported operations;
- mark required fields;
- bound strings and arrays where the schema system permits;
- describe side effects;
- distinguish validate/run/mutate modes;
- avoid fields the server ignores;
- avoid server-only fields such as credentials or workspace paths;
- include safe defaults.

## 16.3 Tool description

The description MUST tell the model:

- when to use the tool;
- when not to use it;
- what counts as success;
- how many attempts are allowed;
- whether the operation executes code or mutates state;
- how to respond to diagnostics;
- what evidence is required before asserting success.

## 16.4 Skill policy

`skills/<tool>/SKILL.md` MUST contain:

- trigger conditions;
- operation selection rules;
- mandatory preflight conditions;
- input-construction rules;
- prohibition on bypass paths;
- repair-loop budget;
- success criteria;
- publication gate;
- failure-reporting format;
- security restrictions;
- examples of correct and incorrect use;
- tool-specific semantic traps.

Do not encode false blanket rules. Example: do not ban a valid language construct merely because it can sometimes be misused. Ban the misuse and define the acceptance criterion.

## 16.5 Policy lifecycle

Specify:

- auto-load flag;
- default value;
- startup loading;
- missing-file behavior;
- policy hash/revision;
- injection delimiters;
- prompt rebuild;
- slash start/stop/status/preflight;
- cleanup;
- session switch behavior;
- test coverage.

## 16.6 Duplicate execution path prevention

When a dedicated tool exists, decide whether generic bash/shell execution of that tool must be intercepted.

If interception is required:

- match verified executable forms;
- avoid false positives on unrelated text;
- return a stable error directing the model to the native tool;
- test allowed and blocked cases;
- document administrator escape hatch, if any.

---

# 17. Phase K — Configuration and capability exposure

## 17.1 Configuration object

Define server-side configuration for:

- enabled/disabled;
- executable or endpoint;
- version requirement;
- timeout defaults and max;
- output limits;
- workspace root;
- sandbox requirement;
- optional profiles/plugins;
- network policy;
- retention;
- call budget.

## 17.2 Environment-variable consistency

For each variable, search all of:

- source reads;
- startup scripts;
- help text;
- GUI settings;
- tests;
- documentation.

Produce a table:

| Variable | Read by | Set by | Documented by | Default | Test |
|---|---|---|---|---|---|

A variable name mismatch between documentation and code is a blocker.

## 17.3 Capability state

A tool can be:

```text
NOT_CONFIGURED
CONFIGURED_UNAVAILABLE
AVAILABLE_DISABLED
AVAILABLE_ENABLED
DEGRADED
```

Do not advertise the tool to the model when it cannot execute, unless the architecture intentionally exposes unavailable tools with a deterministic preflight error.

## 17.4 Optional dependency rule

The absence of the new external tool MUST NOT break unrelated ds4-studio modes unless the user explicitly chooses a hard dependency.

Test:

- server starts without the tool;
- generic agent remains usable;
- tool capability reports unavailable;
- invoking the tool returns the correct bounded error;
- sibling tools still work.

---

# 18. Phase L — Observability

## 18.1 Structured call log

Log at least:

```json
{
  "type": "<tool>_call",
  "contractVersion": "<tool>_result_v1",
  "sessionId": "redacted-or-safe-id",
  "runId": "run-id",
  "attempt": 1,
  "operation": "validate",
  "status": "SUCCESS",
  "durationMs": 100,
  "exitCode": 0,
  "timedOut": false,
  "cancelled": false,
  "stdoutBytes": 0,
  "stderrBytes": 0,
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "toolVersion": "x.y.z",
  "policyRevision": "..."
}
```

## 18.2 Logging prohibitions

Do not log by default:

- credentials;
- authorization headers;
- full environment;
- private uploaded content;
- full model prompt;
- unbounded source code;
- arbitrary external responses.

## 18.3 Metrics

Define counters and histograms such as:

- calls by operation/status;
- preflight failures;
- duration;
- timeout count;
- cancellation count;
- output truncation count;
- sandbox failures;
- domain-validation failures;
- repair attempts;
- artifact bytes;
- provider rate-limit responses.

## 18.4 Correlation

Use the same run ID across:

- native worker;
- HTTP request;
- route log;
- executor;
- artifact directory;
- result;
- agent observation.

---

# 19. Phase M — Testing doctrine

## 19.1 Every modification requires a test contract

For every file or symbol modification, specify:

```text
Test ID:
Purpose:
Production symbol exercised:
Fixture/input:
Command:
Expected exit/status:
Expected assertions:
Failure meaning:
Cleanup:
Maximum runtime:
```

A modification without a test contract is incomplete.

## 19.2 Test pyramid

### Layer 1 — Pure unit tests

Test:

- configuration parsing;
- request validation;
- result validation;
- path sanitization;
- diagnostic parsing;
- state transitions;
- counter rules;
- error mapping;
- output buffer behavior.

### Layer 2 — Production-module tests

Import and invoke actual production modules:

- route factory;
- executor;
- sandbox builder;
- catalog/schema/capability modules;
- native request/response helpers where testable.

Never recreate the route handler inside the test and then claim the production route is tested.

### Layer 3 — Real tool tests

Using a pinned tool version, test:

- minimal success;
- syntax/input error;
- domain/type/semantic error;
- optional dependency profile;
- version mismatch;
- timeout;
- cancellation;
- output truncation;
- missing executable/service.

### Layer 4 — Security tests

Use the actual sandbox/guard behavior, not mocks alone.

### Layer 5 — Native-to-server integration

Verify:

```text
model/native call -> encoded request -> server route -> executor -> result parser -> observation
```

### Layer 6 — Agent end-to-end

Verify the model-visible workflow:

- tool appears only when available/enabled;
- model uses the dedicated tool;
- diagnostics are returned;
- repair budget works;
- final answer does not claim success before publishability;
- sibling tools remain available.

## 19.3 Negative tests are mandatory

For each positive path, add relevant negative paths.

Examples:

- missing required field;
- wrong type;
- oversized payload;
- invalid operation;
- unknown contract version;
- stale policy revision;
- invalid run ID;
- duplicate run;
- unavailable sandbox;
- malformed external-tool output;
- partial artifact failure;
- cancellation race;
- server disconnect.

## 19.4 Production-coupling check

For every test ask:

```text
Would this test still pass if the production implementation were deleted or disconnected?
```

If yes, the test is probably fake or insufficient.

## 19.5 Mock rule

Mocks MAY test caller behavior, but they MUST NOT be the only evidence that:

- the real command is correct;
- the real route is registered;
- the real sandbox blocks access;
- the real parser handles actual output;
- the real process is cancelled;
- the real tool version is compatible.

## 19.6 Regression matrix

At minimum verify:

| Area | Before | After expected | Test |
|---|---|---|---|
| build | passes/known failure | unchanged or fixed intentionally | build gate |
| generic chat | works | works | smoke |
| sibling tool A | works | works | regression |
| session new/switch | works | works | lifecycle test |
| missing new dependency | server works | server works | optional-dependency test |
| prompt construction | valid | new policy only when enabled | prompt test |
| tool catalog | stable | one intentional addition | catalog snapshot/semantic test |

---

# 20. Phase N — Critical evaluation method

## 20.1 Weighted score

Use this default rubric, adapting weights only with justification:

| Area | Weight |
|---|---:|
| Architectural fit | 10% |
| Repository grounding | 12% |
| External-tool semantic correctness | 12% |
| Integration completeness | 12% |
| Security | 12% |
| Contracts and state | 8% |
| Testing | 10% |
| Anti-regression | 7% |
| Reproducibility | 6% |
| Operability/observability | 6% |
| Executability by modest LLM | 5% |

Score each from 0 to 10.

Weighted score formula:

```text
TOTAL = sum(area_score * area_weight)
```

## 20.2 Approval states

```text
APPROVED
APPROVED_WITH_CONDITIONS
NOT_APPROVED_FOR_DIRECT_EXECUTION
REJECTED_ARCHITECTURALLY
INSUFFICIENT_EVIDENCE
```

Default thresholds:

- `>= 8.5`: APPROVED, if no blocker exists;
- `7.0–8.4`: APPROVED_WITH_CONDITIONS, if blockers are absent;
- `4.0–6.9`: NOT_APPROVED_FOR_DIRECT_EXECUTION;
- `< 4.0`: NOT_APPROVED; substantial rewrite required;
- any unresolved critical security or semantic defect blocks approval regardless of score.

## 20.3 Severity model

### Critical

Could enable arbitrary unintended effects, data loss, privilege breach, false certification, or unusable core semantics.

### Blocker

Prevents build, startup, tool availability, correct routing, policy loading, or result interpretation.

### Major

Causes incomplete lifecycle, weak tests, unreliable errors, poor reproducibility, or significant regression risk.

### Minor

Documentation, naming, maintainability, or non-critical observability issue.

## 20.4 Defect record template

```text
ID: D-001
Title:
Severity:
Claim in proposed plan:
Verified reality:
Evidence:
Why it matters:
Failure scenario:
Required correction:
Acceptance test:
```

## 20.5 Mandatory defect searches

Explicitly look for:

- wrong command or API semantics;
- copied variable names from sibling tool;
- unused state fields;
- counters never incremented;
- state never transitioned;
- policy loaded but not injected;
- policy injected but revision not computed;
- startup documented variable differing from code variable;
- helper invoked but undefined;
- route test using a local copy;
- success based only on exit code;
- missing sandbox;
- arbitrary timeout range;
- no output bound;
- no cancellation;
- no process-group kill;
- no cleanup;
- no idempotency;
- missing capability/catalog/schema/session registration;
- hard dependency accidentally introduced;
- hidden shell invocation;
- path concatenation without canonical containment;
- logs leaking secrets;
- tests requiring unavailable external infrastructure without gating;
- mutable external action retried automatically;
- “future extension” claimed as present certification.

---

# 21. Phase O — Executable-plan construction

## 21.1 Plan structure

The executable plan MUST use this order:

1. measurable objective;
2. rules for the implementing LLM;
3. scope and non-scope;
4. baseline;
5. architectural decisions;
6. contracts;
7. files to create;
8. files to modify;
9. phased implementation;
10. per-phase tests and gates;
11. security certification;
12. integration certification;
13. rollout;
14. observability;
15. performance bounds;
16. error taxonomy;
17. threat model;
18. anti-regression matrix;
19. file-by-file checklist;
20. exact execution order;
21. final acceptance gate;
22. rollback;
23. Definition of Done;
24. compact instructions for the implementing LLM.

## 21.2 Work-package template

Every work package MUST contain:

```text
Work package ID:
Phase:
Goal:
Dependency:
Files:
Verified anchor symbols:
Current behavior:
Required behavior:
Inputs:
Outputs:
Exact implementation steps:
Invariants:
Error handling:
Security requirements:
Observability requirements:
Tests:
Commands:
Expected results:
Rollback:
Gate:
```

## 21.3 File-change template

```text
File: <path>
Action: CREATE | MODIFY | DELETE
Anchor: <symbol/unique marker>
Reason:
Change:
Do not change:
New symbols:
Modified symbols:
Configuration impact:
Lifecycle impact:
Security impact:
Test IDs:
```

## 21.4 Exactness rule

A modest LLM MUST NOT be forced to infer:

- which file owns a responsibility;
- whether a symbol is new or existing;
- the order of operations;
- success criteria;
- cleanup behavior;
- test command;
- expected result;
- rollback.

If any of these is omitted, the work package is not executable.

## 21.5 Dependency graph

State phase dependencies explicitly:

```text
P0 Baseline
 -> P1 Contracts/config
 -> P2 Paths/workspace
 -> P3 Process/sandbox
 -> P4 Executor
 -> P5 Route
 -> P6 Registry/capabilities
 -> P7 Skill/policy
 -> P8 Native integration
 -> P9 Startup/autoload
 -> P10 Tests/certification
 -> P11 Rollout
```

Adapt the graph to the chosen architecture. Do not implement native callers before the receiving contract exists.

## 21.6 Gate rule

Each phase ends with:

```text
GATE <ID>
Command(s):
Required assertions:
Artifacts produced:
Failure action:
Permission to continue: YES only if all pass
```

No later phase may compensate silently for a failed earlier gate.

---

# 22. Phase P — Modest-LLM execution controls

## 22.1 One work package at a time

The implementing LLM SHALL:

1. read the current work package;
2. inspect all anchor symbols;
3. verify they still match the plan;
4. make only the listed changes;
5. run the listed tests;
6. record results;
7. stop on gate failure;
8. update the execution ledger;
9. proceed only after the gate passes.

## 22.2 Drift detector

Before editing, compare:

```text
Expected symbol exists?
Expected current behavior matches?
Expected test file exists?
Expected build command still valid?
Working tree contains unrelated changes?
```

If material drift exists:

- do not guess;
- document the drift;
- re-anchor the work package using current code;
- preserve the original architectural invariant;
- rerun the relevant baseline subset.

## 22.3 Change budget

Each work package SHOULD modify the minimum coherent set of files.

Do not combine:

- process controller creation;
- UI redesign;
- unrelated refactor;
- sibling tool cleanup;
- performance optimization;

unless they are direct dependencies of the gate.

## 22.4 No opportunistic refactor

The implementing LLM MUST NOT refactor unrelated code “for cleanliness.”

Any necessary shared refactor must be:

- identified in the plan;
- justified;
- tested against all consumers;
- separated into its own work package.

## 22.5 Execution ledger

Maintain:

| WP | Files changed | Tests run | Result | Commit | Deviations |
|---|---|---|---|---|---|

## 22.6 Stop conditions

Stop implementation and report when:

- an anchor symbol is absent and no verified replacement exists;
- baseline changed unexpectedly;
- security dependency is unavailable and no approved alternative exists;
- a gate fails twice after one targeted correction;
- external tool semantics contradict the architecture;
- requested operation would be destructive without authorization;
- tests reveal a regression outside the planned scope.

Stopping is not failure. Continuing by invention is failure.

---

# 23. Phase Q — Certification script

Create one repository script, adapted to project conventions, such as:

```text
scripts/certify-<tool>-integration.sh
```

It MUST:

1. use strict shell settings;
2. report repository revision;
3. verify required dependencies;
4. run fast static/unit checks;
5. run production-module tests;
6. run real tool smoke tests when available;
7. run security tests;
8. run native/server integration tests;
9. run sibling regression tests;
10. print a machine-readable final status;
11. exit non-zero on any mandatory failure.

Example final line:

```text
DS4_TOOL_INTEGRATION_CERTIFICATION=PASS
```

or:

```text
DS4_TOOL_INTEGRATION_CERTIFICATION=FAIL stage=<stage> test=<id>
```

The script MUST NOT hide failures with unconditional `|| true` except for explicitly optional diagnostics that are reported as optional.

---

# 24. Phase R — Rollout and rollback

## 24.1 Rollout stages

Default progression:

### Stage 0 — Code present, disabled

- modules and tests land;
- tool not model-visible;
- preflight callable by developers;
- no user traffic.

### Stage 1 — Local opt-in

- enable by environment/config;
- developer smoke tests;
- collect logs and failures.

### Stage 2 — UI/config opt-in

- explicit user setting;
- capability reflects availability;
- documentation published.

### Stage 3 — Default-on only if justified

Requires:

- dependency availability strategy;
- security certification;
- acceptable performance;
- stable error rate;
- no regression in generic agent behavior.

## 24.2 Feature flag

Define one canonical enable flag and one policy auto-load flag if needed. Avoid multiple contradictory flags.

## 24.3 Rollback

Specify exact rollback actions:

- disable flag;
- remove model-visible capability;
- preserve or migrate artifacts;
- stop active processes;
- revert code commits in dependency order;
- restore previous prompt behavior;
- run regression certification.

Rollback MUST NOT require uninstalling the entire application.

---

# 25. Phase S — Performance and resource bounds

## 25.1 Performance budget

Define measurable budgets for:

- preflight latency;
- cold start;
- warm execution;
- maximum process duration;
- maximum stdout/stderr;
- maximum request size;
- maximum artifact size;
- maximum concurrent runs;
- memory/CPU limits;
- cache size and retention.

## 25.2 Concurrency

Determine whether ds4-studio permits:

- one active tool call per agent turn;
- one run per session;
- global serialization;
- bounded parallelism.

Specify locking and cancellation behavior. Do not assume concurrency safety.

## 25.3 Cache

Cache only when semantics permit.

Cache key SHOULD include relevant items:

```text
tool version
operation
normalized input hash
configuration/profile hash
policy revision
dependency lock hash
```

Do not cache external mutations as if they were pure results.

---

# 26. Mandatory anti-regression matrix for ds4-studio

The final plan MUST address at least:

| Subsystem | Risk | Required check |
|---|---|---|
| native build | new C symbols/objects break platform builds | all relevant build targets |
| server startup | optional dependency causes crash | startup without tool installed |
| generic chat | prompt or tool schema regression | chat smoke |
| tool parsing | new name conflicts with DSML/parser | parser test |
| tool catalog | missing or duplicated entry | catalog test |
| schema | model gets invalid/unsupported fields | schema test |
| capabilities | unavailable tool advertised | capability test |
| session | tool lost or leaked across sessions | session lifecycle test |
| prompt | skill absent/duplicated/stale | prompt construction test |
| policy | wrong environment flag/revision | policy tests |
| transport | malformed JSON/HTML mishandled | response parser test |
| cancellation | orphan process remains | process-tree test |
| sibling tools | copied logic breaks existing integrations | sibling smoke tests |
| compression | large output destabilizes context | truncation/compression test |
| logging | secrets or huge payloads logged | log redaction test |
| artifacts | cross-session/path escape | path and retention tests |
| UI/config | state differs from backend | config integration test |

---

# 27. Common failure patterns and mandatory corrections

## 27.1 “Replicate tool X” without semantic comparison

Correction:

- create reuse/adapt/do-not-reuse table;
- identify semantic differences;
- redesign success and security gates.

## 27.2 Wrong execution command

Correction:

- verify official command for each operation;
- test it against a minimal real fixture;
- separate validate/build/run/mutate.

## 27.3 Temporary directory presented as sandbox

Correction:

- define actual isolation controls;
- fail closed when unavailable;
- add real escape tests.

## 27.4 Test-only route copy

Correction:

- extract production route factory/handler;
- import it in tests;
- assert actual registration separately.

## 27.5 Undefined convenience helper

Correction:

- locate existing helper;
- or fully specify and test a new helper;
- never leave hidden implementation scope.

## 27.6 Policy loaded but unusable

Correction:

Test the full chain:

```text
read -> hash -> store -> inject -> rebuild -> advertise -> invoke -> compare revision -> cleanup
```

## 27.7 Success equals no error string

Correction:

- explicit state;
- explicit contract validity;
- explicit domain gate;
- explicit publishable predicate.

## 27.8 Unlimited timeout/output

Correction:

- operation-specific min/default/max;
- bounded buffers;
- process-group kill;
- tests.

## 27.9 Dependency “latest”

Correction:

- pin version;
- lock dependencies;
- expose preflight version mismatch;
- define update procedure.

## 27.10 Hard dependency by accident

Correction:

- optional capability state;
- startup without dependency;
- fail only the requested tool;
- regression test generic agent.

## 27.11 Future capability claimed as current

Correction:

Use precise statuses:

```text
implemented
validated
policy-validated
certified
planned
out of scope
```

Never call a result formally certified when only parsing or process success was checked.

---

# 28. Critical-evaluation document template

Use this exact skeleton and fill every section.

```markdown
# Critical evaluation of <TOOL> integration in ds4-studio

> Date:
> Repository revision:
> Inputs evaluated:
> Verdict:
> Score:

## 1. Executive verdict

## 2. Weighted score by area

## 3. Valid decisions to retain

## 4. Critical blockers

### D-001 — <title>
- Severity:
- Proposed claim:
- Verified reality:
- Evidence:
- Impact:
- Required correction:
- Acceptance test:

## 5. Major defects

## 6. Minor defects

## 7. External-tool semantic corrections

## 8. Repository integration-surface gaps

## 9. Security assessment

## 10. Contract and state assessment

## 11. Test-quality assessment

## 12. Reproducibility assessment

## 13. Invented, stale, or missing symbols

| Symbol | Claimed location | Verified status | Required action |

## 14. Evidence matrix

| Claim | Repository/tool evidence | Status | Consequence |

## 15. Conditions required before implementation

## 16. Final decision
```

---

# 29. Executable-plan document template

Use this exact skeleton and expand it to the required detail.

```markdown
# Executable plan for integrating <TOOL> into ds4-studio

> Date:
> Repository revision:
> Target tool version:
> Architecture decision:
> Risk tier:

# 0. Verifiable objective

# 1. Mandatory rules for the implementing LLM
## 1.1 Anti-hallucination rules
## 1.2 Repository drift rules
## 1.3 Commit and scope rules

# 2. Scope
## 2.1 MVP
## 2.2 Non-goals
## 2.3 Deferred work

# 3. Baseline
## 3.1 Commands
## 3.2 Recorded results
## 3.3 G0 baseline gate

# 4. Architectural decisions
## 4.1 Candidate comparison
## 4.2 ADR
## 4.3 Responsibility boundaries
## 4.4 End-to-end flow

# 5. Contracts
## 5.1 Request v1
## 5.2 Result v1
## 5.3 Diagnostics
## 5.4 Invariants
## 5.5 Compatibility

# 6. Files to create

# 7. Files to modify

# 8. Phased implementation
## Phase 1 — dependency/runtime pinning
## Phase 2 — constants/config/preflight
## Phase 3 — path/workspace
## Phase 4 — contract/diagnostics
## Phase 5 — process or provider client
## Phase 6 — sandbox/security guards
## Phase 7 — executor
## Phase 8 — production route/service
## Phase 9 — catalog/schema/capability/session
## Phase 10 — skill/policy
## Phase 11 — native integration
## Phase 12 — slash/runtime lifecycle
## Phase 13 — startup/autoload/build
## Phase 14 — mandatory native tests
## Phase 15 — mandatory server tests
## Phase 16 — real tool and security tests
## Phase 17 — certification script
## Phase 18 — rollout

# 9. Observability

# 10. Performance and resource limits

# 11. Error taxonomy

# 12. Threat model

# 13. Anti-regression matrix

# 14. File-by-file checklist

# 15. Binding execution order

# 16. Completion criteria for every task

# 17. Final acceptance gate

# 18. Rollback

# 19. Global Definition of Done

# 20. Compact execution protocol for a modest LLM
```

---

# 30. Definition of Done for the analysis task

The audit-and-plan task is complete only when all statements below are true.

## 30.1 Evidence completeness

- [ ] Proposed documents were read fully enough to assess all implementation claims.
- [ ] Relevant repository symbols were located in production code.
- [ ] Sibling integration was traced end-to-end.
- [ ] Build/config/test surfaces were inspected.
- [ ] External-tool semantics were verified from authoritative sources or reproducible versioned behavior.
- [ ] Unresolved claims are explicitly listed.

## 30.2 Evaluation completeness

- [ ] Weighted score is justified.
- [ ] Verdict reflects blockers, not only average score.
- [ ] Valid ideas are separated from unsafe implementation details.
- [ ] Each blocker has evidence, consequence, correction, and acceptance test.
- [ ] Invented helpers and stale names are listed.
- [ ] Security, reproducibility, contracts, lifecycle, and tests are evaluated independently.

## 30.3 Plan completeness

- [ ] Architecture is chosen through explicit comparison.
- [ ] MVP and future scope are separated.
- [ ] Contracts precede implementation.
- [ ] Every required integration surface is covered or explicitly excluded with reason.
- [ ] Every modification has a test contract.
- [ ] Security posture matches the risk tier.
- [ ] Optional dependency behavior is specified.
- [ ] Lifecycle, reset, cleanup, and cancellation are specified.
- [ ] Rollout and rollback are actionable.
- [ ] Final certification is executable.

## 30.4 Modest-LLM usability

- [ ] No task depends on guessed line numbers alone.
- [ ] No existing/new symbol ambiguity remains.
- [ ] No `...`, “similar to,” or unspecified error handling remains in mandatory steps.
- [ ] Phase order and dependencies are explicit.
- [ ] Commands and expected results are provided.
- [ ] Stop conditions prevent invention.
- [ ] Gates prevent cascading implementation on a broken foundation.

---

# 31. Compact execution algorithm

A modest-capability LLM SHALL follow this algorithm exactly.

```text
INPUT:
  proposed integration documents
  current repository
  external tool identity
  user constraints

STEP 1 — INVENTORY
  List all input artifacts.
  Record repository revision and exclusions.
  Create evidence ledger.

STEP 2 — BASELINE
  Identify build and test commands.
  Record current results.
  Identify external tool version and availability.
  Do not design before G0 passes or is explicitly excepted.

STEP 3 — EXTERNAL SEMANTICS
  From official/versioned evidence, list operations.
  Separate validate/build/run/query/mutate.
  Define real success and failure levels.
  Classify risk tier.

STEP 4 — TRACE SIBLING INTEGRATION
  Follow model schema to dispatcher to transport to route to executor to result.
  Trace policy, startup, session, cleanup, logs, and tests.
  Build REUSE/ADAPT/DO-NOT-REUSE table.

STEP 5 — VERIFY PROPOSED CLAIMS
  For every named symbol, command, variable, route, and test:
    locate it;
    classify status;
    compare proposed behavior with real behavior.
  Record defects.

STEP 6 — SURFACE MATRIX
  Evaluate every ds4-studio integration surface.
  Mark required/not required/deferred.
  Require one test per required modification.

STEP 7 — SECURITY
  Build threat model from real tool capabilities.
  Choose fail-closed controls.
  Define real negative tests.

STEP 8 — CONTRACTS AND STATE
  Define request v1, result v1, diagnostics, invariants, states, transitions,
  counters, finalization, cancellation, reset, and cleanup.

STEP 9 — CRITICAL EVALUATION
  Score weighted areas.
  Issue blocker-aware verdict.
  Preserve valid decisions.
  Provide corrections and acceptance tests.

STEP 10 — EXECUTABLE PLAN
  Choose architecture.
  Define files and anchor symbols.
  Order phases by dependency.
  For every task specify implementation, tests, expected result, rollback, gate.

STEP 11 — CROSS-CHECK
  Confirm every critical defect is addressed by at least one plan task and test.
  Confirm every plan task is justified by evidence or an explicit design decision.
  Confirm no undefined helper or guessed path remains.

STEP 12 — FINAL CERTIFICATION OF DOCUMENTS
  Run the document Definition of Done.
  Produce the two downloadable Markdown artifacts.
```

---

# 32. Self-review protocol before delivery

Before returning the artifacts, answer these questions internally with `YES`, `NO`, or `NOT APPLICABLE`.

## Repository grounding

1. Did I verify every existing symbol I named?
2. Did I distinguish production from test-only code?
3. Did I trace all callers/registrations needed for the integration?
4. Did I inspect build and startup configuration?
5. Did I avoid treating prior documentation as source-code truth?

## Tool correctness

6. Did I distinguish validation from execution and mutation?
7. Did I verify commands against the relevant version?
8. Did I define domain-level success rather than exit-code-only success?
9. Did I pin or explicitly manage version drift?
10. Did I identify optional dependencies and profiles?

## Security

11. Did I classify the risk tier?
12. Did I model untrusted model-generated arguments?
13. Did I require fail-closed isolation where code can execute?
14. Did I bound timeout, output, artifacts, and processes?
15. Did I include real negative security tests?

## Completeness

16. Did I cover catalog, schema, capability, session, policy, prompt, runtime, startup, cleanup, and tests where applicable?
17. Did I define request/result contracts first?
18. Did I define lifecycle transitions and counter increments?
19. Did I prevent duplicate generic execution paths?
20. Did I include observability and correlation?

## Test quality

21. Do route tests import production code?
22. Are real-tool tests included?
23. Are sibling regressions included?
24. Would any test pass if production code were disconnected?
25. Is there one certification command/script?

## Modest-LLM executability

26. Does every work package have verified anchors?
27. Does every modification have exact tests and expected results?
28. Are stop conditions explicit?
29. Are rollback steps explicit?
30. Is there any placeholder that asks the implementer to invent behavior?

If any mandatory answer is `NO`, correct the artifacts before delivery or clearly mark the unresolved limitation.

---

# 33. Minimal invocation prompt

Use this skill with a request such as:

```text
Apply the DS4 Universal Tool Integration Engineering Skill.

Evaluate the proposed integration of <TOOL> into ds4-studio against the attached
repository snapshot and the official semantics of the tool. Produce:

1. a critical evaluation with evidence, blocker-aware score, and corrections;
2. a super-detailed executable implementation plan for a modest-capability LLM.

Do not modify the repository. Verify every symbol. Treat the external tool as
untrusted according to its real capabilities. Every planned modification must
have a production-coupled test contract, gate, and rollback.
```

---

# 34. Final invariant

The central invariant of this skill is:

```text
NO INTEGRATION CLAIM WITHOUT EVIDENCE.
NO IMPLEMENTATION TASK WITHOUT AN ANCHOR.
NO ANCHOR WITHOUT REPOSITORY VERIFICATION.
NO OPERATION WITHOUT A VERSIONED CONTRACT.
NO SUCCESS WITHOUT A DOMAIN-SPECIFIC POSITIVE GATE.
NO UNTRUSTED EXECUTION WITHOUT FAIL-CLOSED CONTAINMENT.
NO MODIFICATION WITHOUT A PRODUCTION-COUPLED TEST.
NO PHASE ADVANCE WITHOUT A PASSING GATE.
NO DELIVERY WITHOUT ROLLBACK AND CERTIFICATION.
```
