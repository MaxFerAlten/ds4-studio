# DS4 Evolution — Threat Model

**Document ID:** `DS4-EVO-THR-001`
**Version:** `1.0.0`
**Status:** Normative security analysis
**Method:** STRIDE-inspired analysis augmented with agentic, LLM, benchmark, and supply-chain threats
**Protected system:** DS4 Evolution and the DS4-Studio repository it operates on

---

## 1. Security objective

DS4 Evolution SHALL permit bounded experimentation without allowing a model, candidate process, tool result, evaluator, or user-interface action to silently compromise:

- the canonical DS4 repository;
- evaluator integrity;
- baseline integrity;
- secrets;
- host stability;
- run history;
- promotion correctness;
- rollback capability;
- session/delta behavior;
- security controls.

---

## 2. Assets

| Asset ID | Asset | Security property |
|---|---|---|
| `A-001` | Canonical DS4 repository | integrity, availability |
| `A-002` | Baseline snapshot | integrity, immutability |
| `A-003` | Evaluator code | integrity, independence |
| `A-004` | Hidden fixtures and oracle data | confidentiality, integrity |
| `A-005` | Evolution run ledger | integrity, durability, ordering |
| `A-006` | Candidate workspaces | containment |
| `A-007` | API keys and local secrets | confidentiality |
| `A-008` | Tool and model outputs | integrity, boundedness |
| `A-009` | Promotion decisions | authenticity, non-repudiation |
| `A-010` | Rollback artifacts | integrity, availability |
| `A-011` | DS4 session state | integrity, delta-safety |
| `A-012` | Host resources | availability |
| `A-013` | Provenance records | integrity, auditability |

---

## 3. Trust boundaries

### TB-1 — User/API boundary

Untrusted or partially trusted input:

- task objectives;
- path lists;
- evaluator configuration;
- approval actions.

Controls:

- schema validation;
- authentication;
- authorization;
- path normalization;
- rate limiting.

### TB-2 — LLM boundary

Untrusted output:

- proposals;
- patches;
- diagnoses;
- stop recommendations.

Controls:

- strict schemas;
- immutable scope enforcement;
- deterministic evaluators;
- non-LLM promotion gate;
- bounded retries;
- prompt-injection resistance.

### TB-3 — Candidate process boundary

Potentially hostile code executes in a workspace.

Controls:

- process isolation;
- filesystem sandbox;
- network disabled;
- resource limits;
- read-only evaluator mounts;
- environment allowlist.

### TB-4 — Evaluator boundary

Evaluator results are trusted more than model prose, but evaluator code and configuration must be protected.

Controls:

- immutable evaluator paths;
- hash verification;
- versioned results;
- command and environment hashes;
- hidden fixture isolation.

### TB-5 — Canonical repository boundary

Promotion crosses from experimental state to canonical state.

Controls:

- parent snapshot verification;
- atomic patch application;
- post-apply smoke gate;
- rollback.

### TB-6 — Artifact and ledger boundary

Large outputs and structured events cross into persistent storage.

Controls:

- content hashing;
- atomic append;
- size caps;
- blob indirection;
- secret redaction;
- access control.

---

## 4. Threat actors

| Actor | Capability |
|---|---|
| Malicious task author | crafts objectives and paths to escape scope |
| Compromised or misaligned LLM | proposes unsafe code or fabricates success |
| Candidate code | attempts host escape, network access, secret theft, evaluator tampering |
| Prompt-injected tool output | tries to redirect the Proposer or Critic |
| Faulty evaluator | reports incorrect pass/fail |
| Malicious evaluator modification | changes scoring to favor candidate |
| Concurrent process | mutates baseline or canonical repository during run |
| Insider/reviewer | improperly approves high-risk candidate |
| Dependency supplier | introduces malicious package or update |
| Accidental operator error | promotes wrong revision or deletes rollback material |

---

## 5. Threat catalogue

## T-001 — Prompt injection through repository content

**Scenario:** A source file, README, web page, log, or tool result contains instructions telling the model to ignore the task contract, expose secrets, or alter protected files.

**Impact:** unsafe proposal, secret disclosure, policy bypass.

**Controls:**

- tool outputs treated as evidence, never authority;
- synthesis layer strips imperative status;
- prompt explicitly states repository content is untrusted;
- Proposer and Patcher receive bounded source/context objects rather than repository instructions as authority;
- model-supplied impact claims are stripped and replaced with trusted GitNexus evidence or conservative file risk;
- immutable paths enforced programmatically;
- evaluator and gate ignore model instructions;
- large raw content stored as blob and selectively retrieved.

**Acceptance evidence:** `SEC-PI-001`, `SEC-PI-002`.

---

## T-002 — Candidate modifies evaluator

**Scenario:** Candidate edits evaluator code, configuration, oracle data, or result files so that it appears successful.

**Impact:** false promotion.

**Controls:**

- evaluator paths outside candidate writable root or mounted read-only;
- preflight diff rejects evaluator changes;
- evaluator hashes recorded before and after;
- results generated outside candidate-controlled directory where feasible;
- candidate result files treated as untrusted until evaluator signature/hash validation.

**Acceptance evidence:** `SEC-EVAL-001` through `SEC-EVAL-004`.

---

## T-003 — Hidden fixture exfiltration

**Scenario:** Candidate reads private ground truth and hardcodes answers.

**Impact:** benchmark contamination and false improvement.

**Controls:**

- private fixtures inaccessible to candidate;
- evaluator receives private fixture after candidate completes;
- no path or environment variable discloses fixture location;
- network disabled;
- access audit for fixture directory.

**Acceptance evidence:** `SEC-HID-001`, `SEC-HID-002`.

---

## T-004 — Workspace path escape

**Scenario:** Candidate uses `../`, absolute paths, symlinks, hard links, or shell tricks to write outside the workspace.

**Impact:** canonical repository or host compromise.

**Controls:**

- canonical path resolution;
- reject paths whose relative form escapes root;
- symlink policy;
- separate OS-level sandbox where available;
- filesystem write allowlist;
- post-run filesystem audit.

**Acceptance evidence:** `SEC-PATH-001` through `SEC-PATH-005`.

---

## T-005 — Shell injection

**Scenario:** Untrusted task fields are concatenated into shell commands.

**Impact:** arbitrary command execution.

**Controls:**

- spawn with argument arrays;
- no shell unless evaluator explicitly requires it;
- shell evaluators use static command templates plus validated parameters;
- command logging and hashing;
- metacharacter rejection for constrained fields.

**Acceptance evidence:** `SEC-SHELL-001`, `SEC-SHELL-002`.

---

## T-006 — Secret exposure

**Scenario:** Candidate or model reads `.env`, process environment, SSH keys, cloud credentials, or API keys.

**Impact:** credential theft.

**Controls:**

- environment allowlist;
- no inherited full environment;
- secret-path denylist;
- output redaction;
- network disabled;
- artifact scanning before persistence.

**Acceptance evidence:** `SEC-SECRET-001` through `SEC-SECRET-004`.

---

## T-007 — Network exfiltration

**Scenario:** Candidate sends source, secrets, fixtures, or logs to an external endpoint.

**Impact:** confidentiality breach.

**Controls:**

- no network namespace by default;
- DNS disabled;
- explicit per-task network capability;
- destination allowlist;
- network events logged;
- automatic promotion forbidden when network capability is enabled.

**Acceptance evidence:** `SEC-NET-001`, `SEC-NET-002`.

---

## T-008 — Resource exhaustion

**Scenario:** Candidate forks processes, allocates excessive RAM, fills disk, generates enormous logs, or hangs.

**Impact:** host denial of service; model/runtime crash.

**Controls:**

- process count limit;
- memory and CPU limit;
- wall timeout;
- disk quota;
- stdout/stderr caps;
- cancellation;
- cleanup watchdog.

**Acceptance evidence:** `SEC-DOS-001` through `SEC-DOS-006`.

---

## T-009 — Large-output context poisoning

**Scenario:** Candidate creates huge repetitive output that consumes context and causes the agent to lose constraints.

**Impact:** context loss, loop, hallucinated decisions.

**Controls:**

- output compression;
- blob store;
- preview limits;
- structured observation requirement;
- loop guard;
- capsule token budget;
- no raw echo to model or UI by default.

**Acceptance evidence:** `SEC-CTX-001` through `SEC-CTX-004`.

---

## T-010 — Self-evaluation bias

**Scenario:** The same LLM proposes, critiques, and promotes its own patch.

**Impact:** false confidence and unsafe promotion.

**Controls:**

- deterministic evaluator;
- pure promotion gate;
- Critic recommendation non-authoritative;
- optional role/model separation;
- human approval for non-low-risk changes.

**Acceptance evidence:** `SEC-AUTH-001`, `SEC-AUTH-002`.

---

## T-011 — Metric gaming

**Scenario:** Candidate optimizes the visible metric while degrading unmeasured behavior.

**Impact:** overfitting and regressions.

**Controls:**

- multiple required metrics;
- hidden tests;
- safety and complexity gates;
- baseline non-regression;
- repeated runs/seeds for unstable metrics;
- out-of-distribution smoke cases.

**Acceptance evidence:** `SEC-GAME-001` through `SEC-GAME-004`.

---

## T-012 — Baseline mutation

**Scenario:** A concurrent process or candidate changes baseline files during the run.

**Impact:** invalid comparisons and irreproducibility.

**Controls:**

- immutable snapshot;
- hash checks before every gate;
- worktree isolation;
- fail with `BASELINE_MUTATED`.

**Acceptance evidence:** `SEC-BASE-001`, `SEC-BASE-002`.

---

## T-013 — Ledger tampering or truncation

**Scenario:** Events are reordered, removed, duplicated, or partially written.

**Impact:** untrustworthy audit trail and wrong recovery.

**Controls:**

- monotonic sequence;
- event hash;
- atomic append;
- fsync policy for critical decisions;
- recovery validation;
- duplicate event rejection.

**Acceptance evidence:** `SEC-LEDGER-001` through `SEC-LEDGER-005`.

---

## T-014 — Replay of stale approval

**Scenario:** An approval intended for one candidate is reused for another.

**Impact:** unauthorized promotion.

**Controls:**

- approval binds run ID, revision, candidate hash, parent snapshot hash;
- short-lived approval nonce;
- single-use approval event;
- repository identity rechecked at apply time.

**Acceptance evidence:** `SEC-APPROVAL-001`, `SEC-APPROVAL-002`.

---

## T-015 — Time-of-check/time-of-use race

**Scenario:** Candidate or repository changes after evaluation but before promotion.

**Impact:** unevaluated code promoted.

**Controls:**

- candidate content hash;
- immutable candidate workspace after evaluation;
- hash revalidation immediately before apply;
- post-apply smoke evaluation.

**Acceptance evidence:** `SEC-TOCTOU-001`, `SEC-TOCTOU-002`.

---

## T-016 — Dependency confusion or supply-chain attack

**Scenario:** Candidate adds an external package with a malicious or confused name.

**Impact:** arbitrary code execution and exfiltration.

**Controls:**

- dependencies disabled by default;
- allowlist and lockfile;
- exact versions and hashes;
- offline install cache;
- license and vulnerability scan;
- manual review for every new dependency.

**Acceptance evidence:** `SEC-SUPPLY-001` through `SEC-SUPPLY-004`.

---

## T-017 — Unsafe simplification

**Scenario:** Candidate improves LOC or speed by removing validation, sandboxing, accessibility, data-loss protection, or GitNexus checks.

**Impact:** hidden security regression.

**Controls:**

- protected invariants;
- security-policy evaluator;
- mandatory tests for removed checks;
- Pony policy cannot override security;
- security regression is a hard failure.

**Acceptance evidence:** `SEC-SIMPLIFY-001`, `SEC-SIMPLIFY-002`.

---

## T-018 — Critic hallucination

**Scenario:** Critic invents a root cause or claims a test passed.

**Impact:** wasted revisions or false confidence.

**Controls:**

- every diagnosis claim requires evidence references;
- unsupported claims marked uncertain;
- evaluator output inserted as structured data;
- claim guard;
- diagnosis never directly promotes.

**Acceptance evidence:** `SEC-CRITIC-001` through `SEC-CRITIC-003`.

---

## T-019 — Context capsule changes session semantics

**Scenario:** Context injection forces full resets or duplicates history.

**Impact:** token explosion, lost reuse, changed agent behavior.

**Controls:**

- preview-only default;
- delta-safe preflight;
- hard token cap;
- baseline fallback;
- A/B gate on reset rate and task success.

**Acceptance evidence:** `SEC-DELTA-001` through `SEC-DELTA-004`.

---

## T-020 — Rollback failure

**Scenario:** A promoted change cannot be safely undone.

**Impact:** persistent repository breakage.

**Controls:**

- rollback artifact required before promotion;
- inverse patch or snapshot;
- rollback smoke test;
- immutable promotion record;
- manual recovery instructions.

**Acceptance evidence:** `SEC-ROLLBACK-001` through `SEC-ROLLBACK-003`.

---

## T-021 — Unauthorized high-risk automation

**Scenario:** Evolution automatically edits kernels, memory management, build scripts, or security modules.

**Impact:** backend instability, data loss, system crash.

**Controls:**

- default immutable path set;
- risk classification;
- mandatory human review for HIGH/CRITICAL;
- dedicated hardware certification;
- task contract cannot silently lower global policy.

**Acceptance evidence:** `SEC-RISK-001` through `SEC-RISK-003`.

---

## T-022 — Approval UI deception

**Scenario:** UI displays stale metrics or a different diff than the one being approved.

**Impact:** reviewer approves wrong content.

**Controls:**

- UI displays candidate hash and parent hash;
- approval request includes exact diff;
- backend rejects mismatch;
- no hidden truncation of security-relevant diff;
- stale page requires refresh.

**Acceptance evidence:** `SEC-UI-001`, `SEC-UI-002`.

---

## T-023 — Cross-run state contamination

**Scenario:** evidence, session state, artifacts, or approvals from one run affect another.

**Impact:** incorrect diagnosis or promotion.

**Controls:**

- unique run and revision namespaces;
- isolated session keys;
- artifact ownership checks;
- no global mutable evaluator state;
- concurrency tests.

**Acceptance evidence:** `SEC-ISOLATION-001` through `SEC-ISOLATION-003`.

---

## T-024 — Malformed structured output

**Scenario:** LLM emits invalid or adversarial JSON.

**Impact:** parser confusion and policy bypass.

**Controls:**

- strict schema validation;
- unknown fields policy;
- maximum nesting and string lengths;
- one bounded repair attempt;
- failure closed after repair failure.

**Acceptance evidence:** `SEC-SCHEMA-001` through `SEC-SCHEMA-003`.

---

## T-025 — Patch smuggling or proposal substitution

**Scenario:** A model returns a patch for files or a revision different from the validated proposal, embeds a second patch in prose, or substitutes a new proposal after impact review.

**Impact:** immutable-path write, unreviewed change, or approval bypass.

**Controls:**

- separate structured Proposer and Patcher calls;
- exact proposal hash embedded in the generated-patch contract;
- target-file, revision, mutable-scope, and diff validation outside the model;
- only the validated patch field reaches Candidate Builder;
- immutable generated outputs reused on restart rather than regenerated silently.

**Acceptance evidence:** `SEC-PROPOSER-001` through `SEC-PROPOSER-003`, `BEH-LOOP-002`.

---

## T-026 — Model retry and token-budget exhaustion

**Scenario:** Invalid structured replies trigger hidden transport retries or repeated semantic repair, so actual calls/tokens exceed ledger budgets.

**Impact:** denial of service, unexpected cost, or unbounded automatic loop.

**Controls:**

- exactly one schema repair configured and enforced independently of caller input;
- every underlying transport attempt counted;
- token usage aggregated across syntax and semantic repairs;
- complete usage required before canonical output;
- ledger-derived budget check before the next role call;
- stable `BUDGET_EXHAUSTED` stop reason.

**Acceptance evidence:** `BEH-MODEL-002`, `SEC-MODEL-002`, `SEC-MODEL-003`, `SEC-LOOP-002`, `SEC-LOOP-003`.

---

## T-027 — Write-token bypass or level escalation

**Scenario:** An unauthenticated browser invokes mutation routes, a disabled token is treated as permissive, or a caller requests Level D/E above server policy.

**Impact:** unauthorized model use, candidate execution, promotion, or rollback.

**Controls:**

- write token is read only from a named server environment variable;
- absent token disables all mutations;
- timing-safe Bearer comparison and bounded reviewer identity;
- `maxLevel` checked before run creation;
- Level E also requires the independent environment feature gate;
- browser retains the write token in memory only.

**Acceptance evidence:** `SEC-API-001`, `SEC-AUTH-001`, `SEC-AUTH-002`.

---

## T-028 — SSE replay gap, duplication, or observer backpressure

**Scenario:** An event is appended between replay and subscription, reconnection duplicates events, or a broken client blocks/fails the controller.

**Impact:** deceptive dashboard state or runtime availability loss.

**Controls:**

- subscription installed before replay with concurrent-event buffering;
- monotonic sequence IDs and client gap detection;
- bounded replay and artifact retrieval;
- notification occurs only after durable append;
- subscriber exceptions and backpressure close only that stream.

**Acceptance evidence:** `BEH-API-003`, `SEC-API-002`.

---

## T-029 — Stored XSS or deceptive evidence rendering

**Scenario:** Model, patch, evaluator, or repository text contains HTML/script intended to execute in the Evolution dashboard or conceal the reviewed diff.

**Impact:** token theft, forged approval, or operator deception.

**Controls:**

- evidence, diagnosis, candidate, and diff rendered as React text/`pre`, never injected HTML;
- no `dangerouslySetInnerHTML` in Evolution views;
- exact candidate, parent, gate, and review hashes bound server-side;
- stale review submissions rejected;
- artifact sizes bounded before rendering.

**Acceptance evidence:** `SEC-UI-001`, `SEC-UI-002`.

---

## 6. Risk matrix

| Threat | Likelihood | Impact | Initial risk | Required residual risk |
|---|---|---|---|---|
| Evaluator tampering | Medium | Critical | Critical | Low |
| Path escape | Medium | Critical | Critical | Low |
| Secret exposure | Medium | Critical | Critical | Low |
| Resource exhaustion | High | High | Critical | Medium |
| Metric gaming | High | High | Critical | Medium |
| Self-evaluation bias | High | High | Critical | Low |
| Ledger corruption | Low | High | High | Low |
| TOCTOU promotion | Medium | High | High | Low |
| Dependency attack | Medium | High | High | Low |
| Context poisoning | High | Medium | High | Medium |
| Rollback failure | Low | Critical | High | Low |
| Cross-run contamination | Medium | High | High | Low |
| Patch smuggling | Medium | Critical | Critical | Low |
| Model budget exhaustion | High | Medium | High | Low |
| Write-token/level bypass | Medium | Critical | Critical | Low |
| SSE replay/backpressure | Medium | Medium | Medium | Low |
| Stored XSS/UI deception | Medium | High | High | Low |

Automatic promotion SHALL remain disabled if any critical threat lacks an implemented mitigation and passing acceptance test.

---

## 7. Security invariants

The following invariants are absolute:

1. Candidate code cannot write outside its workspace.
2. Candidate code cannot modify evaluator or hidden-fixture files.
3. Candidate code has no network access by default.
4. The full parent environment is never inherited.
5. A failed required evaluator always blocks promotion.
6. A Critic cannot override evaluator output.
7. Promotion binds to exact candidate and parent hashes.
8. The baseline remains immutable.
9. Every promotion has rollback material.
10. High-risk path changes require human approval.
11. Canonical repository application is atomic or reverted.
12. A run can be recovered without trusting model prose.
13. Secrets are redacted before logs or artifacts are persisted.
14. Context injection cannot silently force reset without telemetry and gate failure.

---

## 8. Security event taxonomy

The ledger SHALL support at least:

```text
SECURITY_POLICY_VIOLATION
PATH_ESCAPE_ATTEMPT
IMMUTABLE_PATH_WRITE
EVALUATOR_TAMPER_ATTEMPT
SECRET_ACCESS_ATTEMPT
NETWORK_ACCESS_ATTEMPT
RESOURCE_LIMIT_EXCEEDED
BASELINE_MUTATED
CANDIDATE_HASH_MISMATCH
APPROVAL_HASH_MISMATCH
LEDGER_INTEGRITY_FAILURE
ROLLBACK_FAILURE
CROSS_RUN_ACCESS_ATTEMPT
SCHEMA_VALIDATION_FAILURE
```

Critical events SHALL terminate the revision. Some SHALL terminate the entire run.

---

## 9. Logging and privacy

Logs SHALL:

- redact values matching secret patterns;
- avoid recording full environment variables;
- cap stdout and stderr previews;
- store large content in protected artifacts;
- record hashes rather than secret values;
- include actor, run, revision, and timestamp;
- preserve enough evidence for audit.

Logs SHALL NOT contain:

- API keys;
- access tokens;
- private keys;
- hidden fixture contents;
- full user home directory listings;
- unrestricted model prompts containing secrets.

---

## 10. Manual review requirements

Human review is mandatory when:

- risk is HIGH or CRITICAL;
- a new dependency is added;
- network access is requested;
- build system changes;
- security or sandbox code changes;
- native C/CUDA/ROCm/Metal code changes;
- model format, KV cache, or memory allocation changes;
- evaluator code changes;
- candidate cannot be evaluated deterministically;
- results are unstable across required runs;
- rollback cannot be proven.

---

## 11. Incident response

On a critical violation:

1. cancel candidate processes;
2. prevent promotion;
3. seal current artifacts;
4. record critical event;
5. verify canonical repository integrity;
6. rotate exposed credentials when applicable;
7. quarantine candidate workspace;
8. disable automatic runs;
9. require manual security review;
10. preserve evidence for root-cause analysis.

---

## 12. Residual risk statement

Even with all controls, an LLM-generated patch may contain subtle logical faults not covered by tests. Therefore:

- automatic promotion is limited to low-risk, explicitly scoped changes;
- deterministic tests are necessary but not sufficient;
- high-risk code remains human-gated;
- continuous post-promotion monitoring and rollback remain mandatory.
