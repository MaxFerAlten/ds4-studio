# DS4 Evolution — Behavioral Specification

**Document ID:** `DS4-EVO-BEH-001`
**Version:** `1.0.1`
**Status:** Normative
**Dependency:** `clean-room-provenance.md`
**Purpose:** Define the externally observable behavior of a DS4-native iterative improvement engine without prescribing copied implementation details.

---

## 1. System objective

DS4 Evolution SHALL improve a bounded DS4 artifact through a sequence of isolated candidate revisions while preserving correctness, security, reproducibility, and rollback.

The system SHALL transform a task contract and repository baseline into one of the following terminal outcomes:

- `COMPLETED`
- `STOPPED`
- `FAILED`

No candidate SHALL affect the canonical repository unless it is explicitly promoted.

---

## 2. Core behavioral model

The required high-level loop is:

```text
CREATE RUN
  -> CAPTURE BASELINE
  -> EVALUATE BASELINE
  -> PROPOSE CANDIDATE
  -> MATERIALIZE ISOLATED WORKSPACE
  -> EXECUTE CANDIDATE
  -> EVALUATE CANDIDATE
  -> DIAGNOSE
  -> APPLY PROMOTION GATE
  -> PROMOTE | REJECT | MANUAL REVIEW
  -> REPEAT OR TERMINATE
```

The loop SHALL be controlled by structured state, not by prose emitted by a model.

---

## 3. Actors

### 3.1 Run Controller

The Run Controller SHALL:

- validate the task contract;
- create the run;
- enforce state transitions;
- dispatch work;
- persist events;
- enforce budgets;
- stop on terminal conditions.

The Run Controller SHALL NOT decide metric semantics dynamically.

### 3.2 Proposer

The Proposer MAY be an LLM or a deterministic component.

It SHALL receive only approved inputs and SHALL output a structured proposal.

It SHALL NOT:

- modify the canonical repository;
- modify evaluators;
- modify immutable paths;
- promote a candidate;
- claim that tests passed unless evaluator evidence exists.

### 3.3 Candidate Builder

The Candidate Builder SHALL convert an approved proposal into a candidate patch inside an isolated workspace.

It SHALL prefer:

1. no change when no change is necessary;
2. reuse of existing DS4 code;
3. standard-library or native-platform behavior;
4. the smallest safe patch;
5. the fewest touched files.

### 3.4 Executor

The Executor SHALL run candidate commands in the isolated workspace and SHALL collect bounded execution data.

### 3.5 Evaluator

The Evaluator SHALL produce structured, reproducible measurements.

The Evaluator SHALL be authoritative for:

- pass/fail;
- metric values;
- constraint violations;
- reproducibility metadata.

### 3.6 Critic

The Critic SHALL produce an evidence-linked diagnosis.

The Critic SHALL NOT override evaluator output or promotion rules.

### 3.7 Promotion Gate

The Promotion Gate SHALL deterministically select one of:

- `PROMOTE`
- `REJECT`
- `MANUAL_REVIEW`

The gate SHALL be a pure function of:

- task contract;
- baseline evaluation;
- candidate evaluation;
- candidate diff metadata;
- security-policy output;
- budget state.

---

## 4. State machine

### 4.1 States

```text
CREATED
BASELINE_CAPTURING
BASELINE_EVALUATING
BASELINE_READY
PROPOSING
CANDIDATE_BUILDING
CANDIDATE_READY
EXECUTING
EVALUATING
DIAGNOSING
GATING
PROMOTED
REJECTED
MANUAL_REVIEW
COMPLETED
STOPPED
FAILED
```

### 4.2 Valid transitions

| From | To | Condition |
|---|---|---|
| `CREATED` | `BASELINE_CAPTURING` | task contract valid |
| `BASELINE_CAPTURING` | `BASELINE_EVALUATING` | snapshot completed |
| `BASELINE_EVALUATING` | `BASELINE_READY` | all required baseline evaluators completed |
| `BASELINE_EVALUATING` | `FAILED` | mandatory baseline evaluation cannot complete |
| `BASELINE_READY` | `PROPOSING` | revision budget remains |
| `PROPOSING` | `CANDIDATE_BUILDING` | proposal schema valid |
| `PROPOSING` | `STOPPED` | proposer recommends stop and stop policy accepts |
| `CANDIDATE_BUILDING` | `CANDIDATE_READY` | patch created and static preflight passes |
| `CANDIDATE_BUILDING` | `REJECTED` | patch invalid or violates immutable scope |
| `CANDIDATE_READY` | `EXECUTING` | executor resources available |
| `EXECUTING` | `EVALUATING` | process completed or failed with captured result |
| `EXECUTING` | `FAILED` | infrastructure failure prevents evidence capture |
| `EVALUATING` | `DIAGNOSING` | evaluator results persisted |
| `DIAGNOSING` | `GATING` | diagnosis persisted or critic skipped |
| `GATING` | `PROMOTED` | deterministic gate passes |
| `GATING` | `REJECTED` | deterministic gate fails |
| `GATING` | `MANUAL_REVIEW` | contract requires human decision |
| `MANUAL_REVIEW` | `PROMOTED` | authorized reviewer approves |
| `MANUAL_REVIEW` | `REJECTED` | reviewer rejects or timeout expires |
| `PROMOTED` | `PROPOSING` | target not reached and budget remains |
| `PROMOTED` | `COMPLETED` | success target reached |
| `REJECTED` | `PROPOSING` | budget remains and retry policy allows |
| `REJECTED` | `STOPPED` | budget exhausted or repeated-failure rule fires |

### 4.3 Exceptional terminal transitions

The following security-first transitions are valid in addition to the ordinary
workflow table:

- any non-terminal state MAY transition to `FAILED` when a verified hard
  failure makes continued execution unsafe or makes the run evidence invalid;
- any non-terminal state MAY transition to `STOPPED` after an explicit user
  stop or a deterministic stop-policy decision, once active candidate
  processes have been terminated and cancellation evidence has been captured.

A hard failure is limited to baseline mutation, ledger-integrity failure,
critical security-policy violation, unrecoverable infrastructure failure, or
another unwaivable condition named by the acceptance contract. The transition
event SHALL record the applicable reason code. Callers MUST identify these
transitions explicitly as `hard_failure` or `stop`; they are not ordinary
workflow edges.

All other transitions SHALL be rejected.

---

## 5. Task contract

### 5.1 Required schema

```json
{
  "contractVersion": "ds4_evolution_task_v1",
  "taskId": "string",
  "title": "string",
  "objective": "string",
  "workspaceRoot": "string",
  "mutablePaths": ["string"],
  "immutablePaths": ["string"],
  "baselineRef": "git-ref-or-snapshot-id",
  "evaluators": [
    {
      "id": "string",
      "required": true,
      "configuration": {}
    }
  ],
  "metrics": [
    {
      "name": "string",
      "direction": "maximize|minimize|exact|boolean",
      "required": true,
      "baselineTolerance": 0,
      "target": null,
      "weight": 1
    }
  ],
  "budgets": {
    "maxRevisions": 4,
    "maxFilesChanged": 5,
    "maxAddedLines": 250,
    "maxDeletedLines": 500,
    "maxWallTimeMsPerRevision": 600000,
    "maxPromptTokensPerRevision": 20000,
    "maxCompletionTokensPerRevision": 10000
  },
  "approvalPolicy": {
    "mode": "manual|auto_for_low_risk|always_auto",
    "allowedRiskLevels": ["LOW"]
  }
}
```

Level C/D automation SHALL use `ds4_evolution_task_v2`. It adds:

```json
{
  "automation": {
    "level": "C|D",
    "criticEnabled": true,
    "proposerEnabled": false,
    "autoContinue": false,
    "modelProfile": "default"
  },
  "budgets": {
    "maxTotalWallTimeMs": 600000,
    "maxTotalPromptTokens": 24000,
    "maxTotalCompletionTokens": 24000,
    "maxModelCallsPerRevision": 4,
    "maxInfrastructureRetries": 1,
    "maxEvaluatorRetries": 1,
    "maxCriticRepairs": 1,
    "maxProposerRepairs": 1,
    "maxRepeatedFailureSignatures": 2,
    "maxNoImprovementRevisions": 2
  }
}
```

Level C requires Critic enabled and Proposer disabled. Level D requires both enabled. Both require manual promotion. `maxCriticRepairs` and `maxProposerRepairs` SHALL equal one. Level E is rejected unless the independent server feature gate is enabled.

### 5.2 Contract validation

A task contract SHALL be rejected when:

- `contractVersion` is unsupported;
- `taskId` is absent or unsafe;
- mutable and immutable paths overlap;
- no evaluator is declared;
- no required metric exists;
- a budget is missing or non-positive;
- approval policy is unknown;
- workspace root escapes the configured repository;
- a metric lacks direction semantics.

---

## 6. Baseline behavior

### 6.1 Baseline capture

The system SHALL:

- resolve the baseline reference;
- capture repository identity;
- capture relevant configuration;
- hash mutable and immutable files;
- capture toolchain versions;
- create a read-only baseline snapshot record.

### 6.2 Baseline evaluation

Every required evaluator SHALL run against the baseline before any candidate is proposed.

A run SHALL fail early when the baseline cannot be evaluated reproducibly.

### 6.3 Baseline immutability

The baseline SHALL never be edited.

If a baseline file hash changes during a run, the run SHALL transition to `FAILED` with reason `BASELINE_MUTATED`.

---

## 7. Proposal behavior

### 7.1 Proposal input

The Proposer MAY receive:

- task objective;
- mutable path list;
- immutable path list;
- baseline metrics;
- current promoted revision metrics;
- bounded failure evidence;
- active-file summary;
- prior rejected strategy summaries;
- remaining budgets;
- GitNexus impact summaries.

It SHALL NOT automatically receive:

- raw full repository dumps;
- unbounded logs;
- hidden evaluator data;
- secrets;
- private test fixtures;
- canonical repository write access.

### 7.2 Proposal output

```json
{
  "proposalVersion": "ds4_evolution_proposal_v1",
  "revision": 1,
  "summary": "string",
  "hypothesis": "string",
  "targetFiles": ["string"],
  "targetSymbols": ["string"],
  "plannedChanges": [
    {
      "file": "string",
      "symbol": "string|null",
      "change": "string",
      "reason": "string",
      "expectedMetricEffect": {
        "metric": "string",
        "direction": "increase|decrease|unchanged"
      }
    }
  ],
  "testsToRun": ["evaluator-id"],
  "knownRisks": ["string"],
  "stopInstead": false
}
```

The proposal SHALL be schema-validated before candidate construction.

### 7.3 Proposal anti-hallucination rules

The system SHALL reject a proposal that:

- references nonexistent files without an explicit creation rationale;
- targets immutable paths;
- claims a test result not present in evidence;
- exceeds file-count budget;
- requests disabling security controls;
- requests changing the evaluator or hidden data;
- contains no falsifiable hypothesis;
- contains no test plan.

---

## 8. Candidate workspace behavior

### 8.1 Isolation

Each revision SHALL receive a unique workspace.

The workspace SHALL:

- derive from the last promoted snapshot;
- be disposable;
- prevent writes outside its root;
- disable network by default;
- expose evaluator assets as read-only;
- use separate temporary and artifact directories;
- be destroyed or archived according to policy.

### 8.2 Scope enforcement

Before execution, the system SHALL calculate the candidate diff.

A candidate SHALL be rejected if it:

- touches an immutable path;
- exceeds file or line budgets;
- introduces a disallowed dependency;
- edits generated files instead of sources;
- modifies evaluator configuration without authorization;
- creates symlinks escaping the workspace;
- includes binary artifacts without authorization.

### 8.3 GitNexus preflight

For source-code changes, the Candidate Builder SHALL obtain impact information before editing targeted symbols.

High or critical blast radius SHALL force `MANUAL_REVIEW` unless the task contract explicitly authorizes it.

---

## 9. Execution behavior

### 9.1 Process controls

The Executor SHALL apply:

- wall-clock timeout;
- process-count limit;
- memory limit where supported;
- output-size limit;
- environment allowlist;
- secret redaction;
- cancellation support.

### 9.2 Execution result

```json
{
  "executionVersion": "ds4_evolution_execution_v1",
  "revision": 1,
  "status": "success|failure|timeout|cancelled|infrastructure_error",
  "exitCode": 0,
  "signal": null,
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601",
  "durationMs": 0,
  "stdoutArtifact": "artifact-ref|null",
  "stderrArtifact": "artifact-ref|null",
  "stdoutPreview": "string",
  "stderrPreview": "string",
  "resourceUsage": {
    "maxRssBytes": null,
    "cpuTimeMs": null
  }
}
```

Execution failure SHALL still proceed to evaluation when evaluators can produce meaningful failure evidence.

---

## 10. Evaluation behavior

### 10.1 Evaluator interface

Every evaluator SHALL implement an interface equivalent to:

```javascript
async function evaluate({
  taskContract,
  baseline,
  candidateWorkspace,
  executionResult,
  signal
}) => EvaluationResult
```

### 10.2 Evaluation result

```json
{
  "evaluationVersion": "ds4_evolution_evaluation_v1",
  "revision": 1,
  "status": "passed|failed|error|partial",
  "evaluators": [
    {
      "id": "node-test",
      "status": "passed",
      "required": true,
      "metrics": {},
      "violations": [],
      "artifacts": [],
      "reproducibility": {
        "commandHash": "string",
        "environmentHash": "string",
        "seed": 42
      }
    }
  ],
  "aggregateMetrics": {},
  "hardFailures": []
}
```

### 10.3 Evaluator authority

Free-form model output SHALL NOT change:

- evaluator status;
- measured metrics;
- hard failures;
- reproducibility metadata.

### 10.4 Required evaluator classes

Version 1 SHOULD support:

- unit-test evaluator;
- shell-command evaluator;
- static-analysis evaluator;
- diff-complexity evaluator;
- security-policy evaluator;
- benchmark evaluator;
- JSON scorer evaluator.

---

## 11. Diagnosis behavior

### 11.1 Critic input

The Critic SHALL receive a compact evidence packet, not raw unrestricted logs.

### 11.2 Diagnosis output

```json
{
  "diagnosisVersion": "ds4_evolution_diagnosis_v1",
  "revision": 1,
  "summary": "string",
  "rootCauses": [
    {
      "claim": "string",
      "evidenceRefs": ["string"],
      "confidence": 0.0
    }
  ],
  "retainedStrengths": [],
  "rejectedApproaches": [],
  "nextRevisionRecommendations": [],
  "stopRecommendation": false,
  "uncertainties": []
}
```

Every root-cause claim SHALL include evidence references.

Unsupported claims SHALL be marked as uncertainty.

---

## 12. Promotion behavior

### 12.1 Hard-gate conditions

A candidate SHALL NOT be promoted if any of the following is true:

- required evaluator failed or errored;
- correctness is below baseline tolerance;
- security posture regressed;
- immutable path changed;
- budget exceeded;
- reproducibility metadata missing;
- baseline integrity check failed;
- required rollback artifact missing;
- candidate depends on hidden information;
- candidate modifies its own evaluator;
- candidate introduces an unapproved network dependency.

### 12.2 Metric comparison

For metric \(m\):

- `maximize`: candidate must be at least `baseline - tolerance`;
- `minimize`: candidate must be at most `baseline + tolerance`;
- `exact`: candidate must equal target;
- `boolean`: candidate must equal required boolean.

A candidate MAY be non-regressive without being materially better. Promotion policy SHALL define whether neutral candidates are acceptable.

### 12.3 Promotion result

```json
{
  "promotionVersion": "ds4_evolution_promotion_v1",
  "revision": 1,
  "decision": "PROMOTE|REJECT|MANUAL_REVIEW",
  "hardFailures": [],
  "regressions": [],
  "improvements": [],
  "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
  "requiresHuman": false,
  "rollbackArtifact": "artifact-ref|null",
  "decidedAt": "ISO-8601"
}
```

---

## 13. Promotion application

A promoted candidate SHALL be applied atomically.

The system SHALL:

1. verify the canonical repository still matches the expected parent snapshot;
2. verify candidate hashes;
3. save rollback material;
4. apply the patch;
5. rerun a post-apply smoke gate;
6. revert automatically if the post-apply smoke gate fails;
7. record the final repository identity.

---

## 14. Rollback behavior

Rollback SHALL be available for every promoted revision.

Rollback SHALL:

- verify target revision;
- apply the inverse patch or restore the snapshot;
- rerun mandatory smoke checks;
- record a rollback event;
- never delete the historical evaluation record.

---

## 15. Ledger behavior

### 15.1 Event schema

```json
{
  "eventVersion": "ds4_evolution_event_v1",
  "eventId": "uuid",
  "runId": "string",
  "revision": 1,
  "sequence": 1,
  "type": "string",
  "timestamp": "ISO-8601",
  "payload": {},
  "payloadHash": "sha256"
}
```

### 15.2 Ledger requirements

The ledger SHALL be:

- append-only;
- ordered;
- capped by policy without deleting canonical decision records;
- recoverable after restart;
- resistant to partial writes;
- hash-verifiable.

Raw large output SHALL be stored separately and referenced by artifact ID.

---

## 16. Context behavior

### 16.1 Canonical versus operational context

The run ledger and revision artifacts SHALL be canonical.

ContextWiki MAY provide an operational capsule containing:

- objective;
- current promoted revision;
- active files;
- prior decisions;
- open questions;
- recent evidence;
- rejected approaches.

The capsule SHALL NOT replace the ledger.

### 16.2 Delta-safety

Context injection SHALL preserve DS4 delta/session reuse.

If preflight indicates reset risk, the capsule SHALL not be injected.

---

## 17. Budget behavior

The controller SHALL maintain remaining budgets.

A revision SHALL be rejected or stopped when it exceeds:

- revision count;
- total wall time;
- per-revision wall time;
- model token budget;
- changed file count;
- added/deleted lines;
- evaluator retry count;
- critic retry count.

Budget exhaustion SHALL be a structured event, not an unhandled exception.

---

## 18. Retry behavior

Retries SHALL be bounded.

| Operation | Default maximum |
|---|---:|
| Infrastructure retry | 1 |
| Evaluator retry after transient error | 1 |
| Critic schema-repair retry | 1 |
| Proposer schema-repair retry | 1 |
| Same candidate execution | 0 unless explicitly requested |

The system SHALL NOT retry a deterministic failure without changing the relevant input.

---

## 19. Stop behavior

The run SHALL stop when any configured condition is met:

- target metric reached;
- maximum revisions reached;
- repeated failure signature threshold reached;
- no material improvement across configured window;
- manual stop;
- critical security violation;
- baseline integrity failure;
- unrecoverable ledger corruption.

---

## 20. API behavior

Version 1 SHOULD expose:

```text
POST   /api/evolution/runs
GET    /api/evolution/runs
GET    /api/evolution/runs/:runId
POST   /api/evolution/runs/:runId/start
POST   /api/evolution/runs/:runId/cancel
GET    /api/evolution/runs/:runId/events
GET    /api/evolution/runs/:runId/stream
GET    /api/evolution/runs/:runId/revisions/:revision
POST   /api/evolution/runs/:runId/revisions/:revision/approve
POST   /api/evolution/runs/:runId/revisions/:revision/reject
POST   /api/evolution/runs/:runId/revisions/:revision/rollback
```

Write endpoints SHALL require explicit authorization.

The server SHALL reject task levels above `evolution.maxLevel` before creating a run. SSE subscription SHALL be installed before replay, buffer concurrent durable events, deliver monotonic sequence IDs, cap replay, and isolate subscriber failures. API DTOs SHALL bound artifacts and omit workspace paths, secrets, model reasoning, and unbounded prompts.

---

## 21. Observability behavior

Telemetry SHOULD include:

- state-transition counts;
- revision duration;
- evaluator duration;
- token usage;
- candidate diff size;
- promotion/rejection count;
- rejection reasons;
- reset rate;
- duplicate-read count;
- duplicate-action count;
- capsule size;
- rollback count;
- infrastructure failures.

Telemetry MUST NOT contain secrets or unbounded raw model output.

---

## 22. Failure behavior

### 22.1 Fail closed

The system SHALL fail closed for:

- path-policy ambiguity;
- evaluator ambiguity;
- baseline mismatch;
- security-policy failure;
- missing required metric;
- malformed promotion data.

### 22.2 Fail open only for optional observability

The system MAY continue when:

- optional dashboard rendering fails;
- optional Critic generation fails;
- optional telemetry export fails.

Such failures SHALL be recorded.

---

## 23. Version 1 safety boundary

Automatic candidate promotion SHALL initially be limited to low-risk paths explicitly allowed by the task contract.

The following SHOULD default to immutable:

```text
ds4.c
ds4.h
ds4_rocm.cu
ds4_cuda.cu
ds4_metal.m
rocm/
metal/
Makefile
ds4_agent_runtime.c
ds4_server_runtime.c
security and sandbox modules
evaluator code
hidden fixtures
```

Changing these areas SHALL require manual review and dedicated hardware/backend certification.

### 23.1 Shared structured-model boundary

Critic, Proposer, and Patcher SHALL use the DS4 shared structured transport. The boundary SHALL:

- run at deterministic temperature;
- disable model tools and private reasoning persistence;
- validate JSON and role schema before canonical use;
- allow at most one syntax repair and one bounded semantic repair;
- count every underlying transport attempt;
- aggregate prompt, completion, and total-token usage across attempts;
- persist only role/model identifiers, prompt and response hashes, usage, call count, and repair count.

Missing complete usage or invalid output after the repair budget SHALL fail closed.

### 23.2 Critic Level C behavior

After deterministic evaluation, the orchestrator SHALL build a bounded evidence packet owned by the current run and revision. The packet may contain compact proposal, candidate, execution, evaluation, gate, and prior-rejection evidence. Cross-run references are invalid.

The Critic diagnosis is consultive. It SHALL be persisted with explicit evidence references, but changing or removing diagnosis prose MUST NOT change the deterministic gate decision. Critic failure is recorded and does not turn a deterministic failure into a pass.

### 23.3 Proposer/Patcher Level D behavior

The Proposer SHALL emit a structured plan only. Model-provided impact claims SHALL be removed and replaced with trusted GitNexus evidence or a conservative file-risk fallback. The Patcher is a separate call that sees only approved, regular, in-scope source files and emits a schema-bound unified patch tied to the proposal hash.

Neither role receives promotion, approval, shell, filesystem-write, or arbitrary tool authority. Candidate writes occur only through the existing isolated Candidate Builder.

### 23.4 Automatic controller and exact recovery

The controller SHALL execute this order:

```text
ledger budget check -> proposer -> persist generated proposal/evidence/event
-> budget check -> patcher -> persist generated patch/evidence/event
-> candidate build -> isolated evaluation -> critic -> deterministic gate
-> manual review, rejection/next revision, completion, or structured stop
```

Generated proposal and patch artifacts are immutable and revision-owned. If the process stops after a model response is durably stored but before candidate construction, restart SHALL validate and reuse that output instead of repeating the role call. Budget state is derived only from the ledger, including actual transport retry counts.

Only one runtime job may be active for a run. Cancellation is idempotent. Durable ledger append precedes live notification; observer failure cannot affect the run.

### 23.5 Post-apply and rollback smoke

Promotion and rollback SHALL run a fail-closed post-apply smoke consisting of server syntax validation and the production frontend build. A smoke failure reverts or rejects the operation. Human-triggered rollback records the validated reviewer and restored content hash in the durable ledger.

---

## 24. Behavioral conformance

A system conforms to this specification only when all mandatory behaviors have executable tests mapped in `acceptance-contract.md`.
