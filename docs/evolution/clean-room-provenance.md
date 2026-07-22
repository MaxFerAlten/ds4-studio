# DS4 Evolution — Clean-Room Provenance Protocol

**Document ID:** `DS4-EVO-CRP-001`
**Version:** `1.0.0`
**Status:** Normative
**Applies to:** DS4-Studio clean-room implementation of an iterative, evaluation-driven agent improvement loop
**Target repository:** DS4-Studio
**Implementation language:** DS4-native Node.js/JavaScript and existing DS4 C runtime interfaces
**External system studied:** SIA — Self-Improving AI
**Primary rule:** transfer behaviorally useful ideas, never source code, prompts, test text, class names, function names, directory layouts, or implementation-specific control flow.

---

## 1. Purpose

This document defines the provenance, separation, audit, and evidence requirements for implementing a DS4-native evolution engine inspired by publicly observable ideas in SIA while preserving a defensible clean-room process.

The intended DS4 capability is an independently designed protocol that:

1. creates an immutable baseline;
2. generates or receives a candidate patch in an isolated workspace;
3. executes the candidate;
4. evaluates it with deterministic scorers;
5. produces a diagnosis from bounded evidence;
6. applies a non-LLM promotion gate;
7. records the complete decision trail;
8. supports rejection, manual review, promotion, and rollback.

The clean-room target is **functional independence**, not textual or structural similarity.

---

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

- **MUST / MUST NOT**: mandatory for conformance.
- **SHOULD / SHOULD NOT**: strong recommendation; deviations require written rationale.
- **MAY**: optional behavior.

---

## 3. Scope

### 3.1 In scope

The clean-room process covers:

- behavioral analysis of iterative agent improvement;
- DS4-native orchestration;
- task contracts;
- isolated candidate workspaces;
- execution and evaluation adapters;
- structured diagnosis;
- run and revision ledgers;
- promotion and rollback;
- dashboard-ready telemetry;
- deterministic acceptance gates;
- integration with existing DS4 session, context, evidence, compression, loop-guard, and benchmark systems.

### 3.2 Out of scope for version 1

The following are explicitly excluded:

- copying SIA source code;
- copying or adapting SIA prompt text;
- importing SIA as a runtime dependency;
- preserving SIA filenames or class names;
- reproducing SIA tests line by line;
- weight training or RL-based weight updates;
- autonomous modification of DS4 inference kernels;
- autonomous modification of model serialization, KV-cache, memory-allocation, build-system, or security-critical code;
- direct promotion into the canonical repository without deterministic gates.

---

## 4. Source materials and evidence boundary

### 4.1 Studied materials

The clean-room analysis is based on the following user-supplied repository representations:

| Source | Role |
|---|---|
| `sia.1.md` | Behavioral and architectural observation of SIA |
| `ds4studio.1(8).md` | Existing DS4-Studio architecture and reusable native mechanisms |

### 4.2 Evidence register

The following observations are allowed as **behavioral facts**:

| Evidence ID | Observation | Source anchor |
|---|---|---|
| `SIA-BEH-001` | SIA distinguishes Meta, Target, and Feedback roles | `sia.1.md`, README architecture section around lines 2033–2045 |
| `SIA-BEH-002` | SIA stores artifacts per run and generation | `sia.1.md`, README run section around lines 21–39 |
| `SIA-BEH-003` | One generation executes a target, evaluates it, records context, and optionally produces the next generation | `sia.1.md`, orchestrator section around lines 1551–1669 |
| `SIA-BEH-004` | Evaluation is externalized through an evaluator script producing structured results | `sia.1.md`, evaluation section around lines 1101–1186 |
| `SIA-BEH-005` | Evolution history includes metrics and summaries across generations | `sia.1.md`, context manager around lines 384–710 |
| `SIA-BEH-006` | Agent implementations are abstracted behind a uniform runner interface | `sia.1.md`, agent registry around lines 13–82 |
| `DS4-NAT-001` | DS4 has stateful sessions and delta payload selection | `ds4studio.1(8).md`, `agentSession.mjs` around lines 155301–156300 |
| `DS4-NAT-002` | DS4 has loop guards for repeated intent, action, no-progress, and output echo | `ds4studio.1(8).md`, `agentLoopGuard.mjs` around lines 154177–155176 |
| `DS4-NAT-003` | DS4 has structured evidence storage | `ds4studio.1(8).md`, `evidenceStore.mjs` around lines 164396–164406 |
| `DS4-NAT-004` | DS4 has a synthesis engine that treats tool output as internal evidence | `ds4studio.1(8).md`, `synthesisEngine.mjs` around lines 177675–177685 |
| `DS4-NAT-005` | DS4 has ContextWiki with token-bounded capsules and delta-safety preflight | `ds4studio.1(8).md`, `contextCapsule.mjs` and `agentContextIntegration.mjs` |
| `DS4-NAT-006` | DS4 already contains clean-room A/B benchmark patterns | `ds4studio.1(8).md`, Pony and ContextWiki benchmark sections |
| `DS4-NAT-007` | DS4 filesystem tools are workspace-sandboxed by default | `ds4studio.1(8).md`, `agentTools.mjs` around lines 1182–1194 |

These facts MAY influence requirements and independently designed behavior. They MUST NOT be used to reproduce SIA implementation details.

### 4.3 Forbidden implementation inputs

The implementation team MUST NOT consult or reuse:

- exact SIA prompts;
- source fragments copied from `sia.1.md`;
- SIA test assertions as templates;
- SIA module, class, function, or variable names;
- SIA directory names as the DS4 layout;
- SIA serialization formats unless independently specified from DS4 requirements;
- comments or explanatory prose copied from SIA.

---

## 5. Clean-room role separation

A conforming implementation SHOULD use three logical roles. One person or model MAY perform multiple roles only when each phase is recorded and the forbidden-input boundary is preserved.

### 5.1 Observation role

The observer MAY inspect SIA materials and MUST produce only:

- behavioral descriptions;
- input/output observations;
- invariants;
- failure modes;
- measurable acceptance criteria;
- non-code diagrams.

The observer MUST NOT produce implementation pseudocode that mirrors SIA control flow.

### 5.2 Specification role

The specifier receives:

- approved behavioral observations;
- DS4 architecture;
- DS4 constraints;
- user requirements.

The specifier MUST produce a DS4-native specification without consulting SIA source text during implementation design.

### 5.3 Implementation role

The implementer receives only:

- this provenance protocol;
- the DS4 behavioral specification;
- the DS4 threat model;
- the DS4 acceptance contract;
- the DS4 repository.

The implementer MUST NOT use SIA source code or prompts.

---

## 6. Independent terminology

The DS4 implementation MUST use independent names.

### 6.1 Approved DS4 terminology

| Concept | DS4 term |
|---|---|
| Whole experiment | Evolution Run |
| Iteration | Revision |
| Initial measurement | Baseline |
| Proposed modification | Candidate |
| Candidate author | Proposer |
| Candidate runtime | Executor |
| Deterministic measurement | Evaluator |
| Evidence-based diagnosis | Critic |
| Promotion decision | Promotion Gate |
| Immutable event stream | Run Ledger |
| Temporary candidate checkout | Candidate Workspace |

### 6.2 Forbidden naming inheritance

The following MUST NOT be used as primary DS4 component names:

- `MetaAgent`
- `TargetAgent`
- `FeedbackAgent`
- `ContextManager` when referring to the evolution ledger
- `run_generation`
- `target_agent.py`
- `improvement.md`
- `gen_1`, `gen_2`, or equivalent SIA-specific directory semantics

Equivalent functionality MAY exist under independently designed names.

---

## 7. Independent architecture requirement

The DS4 implementation MUST be based on the existing DS4 architecture and SHOULD use a layout similar to:

```text
frontend/server/evolution/
  evolutionContracts.mjs
  evolutionRunStore.mjs
  evolutionWorkspace.mjs
  evolutionExecutor.mjs
  evolutionEvaluator.mjs
  evolutionCritic.mjs
  evolutionCandidateBuilder.mjs
  evolutionPromotionGate.mjs
  evolutionTelemetry.mjs
  evolutionOrchestrator.mjs
  evolutionApi.mjs
```

This layout is a DS4 design decision. It is not intended to reproduce an external repository layout.

Every production module MUST have a directly corresponding test module.

---

## 8. Provenance header requirement

Every new source file in the evolution subsystem MUST contain a compact header:

```javascript
/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: <explicit list>.
 */
```

Every non-trivial commit MUST update a provenance manifest.

---

## 9. Provenance manifest

Each revision of the evolution subsystem MUST include a machine-readable record:

```json
{
  "schema": "ds4_clean_room_provenance_v1",
  "change_id": "CR-0001",
  "requirements": [
    "BEH-RUN-001",
    "BEH-GATE-004"
  ],
  "ds4_components_reused": [
    "AgentSessionManager",
    "AgentLoopGuard",
    "ToolBlobStore"
  ],
  "external_code_copied": false,
  "external_prompts_copied": false,
  "external_tests_copied": false,
  "new_files": [],
  "modified_files": [],
  "author_attestation": "independently implemented from DS4 specifications",
  "review_status": "pending"
}
```

The schema MUST reject missing attestation fields.

---

## 10. Prompt independence

All prompts used by the DS4 Proposer or Critic MUST:

1. be written from DS4 requirements;
2. use DS4 terminology;
3. reference DS4 contracts and evidence;
4. avoid wording copied from SIA;
5. be snapshot-tested against unintended drift;
6. be versioned;
7. be bounded in size;
8. avoid instructing the model to claim success;
9. explicitly state that evaluator results are authoritative;
10. prohibit modification of evaluator code, hidden fixtures, and immutable paths.

A prompt review MUST record:

- prompt version;
- author;
- purpose;
- source requirements;
- copied-text attestation;
- security review outcome.

### 10.1 Implemented DS4 prompt register

The Level C/D implementation uses three DS4-authored role prompts. They were written from this specification, the acceptance contract, and the threat model; no SIA prompt text was available to or copied by the implementation role.

| Role | DS4 path | SHA-256 | Purpose | Source requirements | Review status |
|---|---|---|---|---|---|
| Critic | `frontend/server/evolution/prompts/critic.md` | `254a6a6b8bacc51e7f3ef6c440d9a45da2c0ea1d032c11ad84481fe360231fc8` | evidence-linked consultive diagnosis | `BEH-CRITIC-*`, `SEC-CRITIC-*` | automated schema/security tests PASS; human provenance/security review PENDING |
| Proposer | `frontend/server/evolution/prompts/proposer.md` | `7b75cc7b2d7f59e6fd98b1b5bb8af37a1535a51134c31886a1818fdebe78067a` | bounded revision proposal | `BEH-PROPOSER-001/002`, `SEC-PROPOSER-001/003` | automated schema/security tests PASS; human provenance/security review PENDING |
| Patcher | `frontend/server/evolution/prompts/patcher.md` | `ca532003b6d65dc4fc06df94bd6e902d661bd1a5d2b65b0614435ab3dc62f5fe` | proposal-hash-bound patch generation | `BEH-PROPOSER-003`, `SEC-PROPOSER-002` | automated schema/security tests PASS; human provenance/security review PENDING |

Prompt author identity for the implementation record is `DS4 implementation agent`; this is not a substitute for any of the four human release sign-offs. Prompt hashes are included in model evidence at runtime, while this table binds the reviewed source files. Any prompt edit changes the source-revision tree hash and requires a new certification bundle and renewed human review.

---

## 11. Test independence

Tests MUST be derived from DS4 acceptance requirements.

A test is non-conforming when it:

- copies assertion wording from SIA;
- reproduces SIA fixture names;
- uses SIA paths or artifact names without necessity;
- checks an implementation detail instead of a DS4 behavior;
- depends on the external repository.

Compliant test examples:

- a failed mandatory evaluator prevents promotion;
- a candidate cannot edit immutable paths;
- a crash does not corrupt the run ledger;
- a candidate that improves speed but fails correctness is rejected;
- a Critic output cannot override a deterministic failure;
- a promoted patch can be rolled back.

---

## 12. Artifact independence

### 12.1 Required DS4 artifacts

An Evolution Run SHOULD produce:

```text
data/evolution-runs/<run-id>/
  manifest.json
  events.jsonl
  baseline/
    snapshot.json
    evaluation.json
  revisions/
    r0001/
      proposal.json
      candidate.patch
      execution.json
      evaluation.json
      diagnosis.json
      promotion.json
```

### 12.2 Prohibited direct equivalence

The DS4 implementation MUST NOT depend on:

- `context.md` as the canonical run database;
- `target_agent.py` as the universal candidate;
- `improvement.md` as the only explanation artifact;
- `results.json` without a versioned DS4 schema.

Human-readable Markdown MAY be exported, but the canonical state MUST be structured and machine-verifiable.

---

## 13. DS4-native reuse policy

Existing DS4 components SHOULD be reused when they satisfy the requirement.

| Requirement | Preferred DS4 component |
|---|---|
| Session reuse | `AgentSessionManager` |
| Duplicate-action protection | `AgentLoopGuard` |
| Duplicate-read protection | `ReadGuard` |
| Large-output retention | `ToolBlobStore` |
| Structured evidence | `EvidenceStore` / context evidence |
| Compact cross-turn memory | ContextWiki capsule |
| Read-only autonomy | `agentAutonomy.mjs` |
| Workspace path protection | `agentTools.mjs` path sandbox |
| Benchmark gates | existing agentic benchmark patterns |
| Source-grounded synthesis | `synthesisEngine.mjs` |
| Code impact analysis | GitNexus integration |

New code MUST NOT duplicate these mechanisms without an explicit gap analysis.

---

## 14. Anti-contamination controls

### 14.1 Text similarity review

Before merge, prompts and comments SHOULD be checked for suspicious similarity to external materials.

Minimum review:

- exact-phrase scan;
- uncommon-token scan;
- manual inspection of high-similarity blocks.

The purpose is provenance assurance, not copyright adjudication.

### 14.2 Repository isolation

The clean-room implementation SHOULD be developed on a branch containing:

- DS4 repository;
- the four normative documents;
- no SIA source checkout;
- no SIA package dependency.

### 14.3 Dependency audit

The build MUST fail if:

- a package named `sia-agent` is added;
- a direct dependency on the external project appears;
- source files import external SIA modules;
- generated artifacts contain SIA prompt fragments.

---

## 15. Decision authority

The following hierarchy is mandatory:

1. immutable task contract;
2. deterministic evaluator output;
3. promotion gate;
4. human approval when required;
5. Critic recommendation;
6. Proposer recommendation.

The LLM MUST NOT have final authority over promotion.

---

## 16. Clean-room review checklist

A change is reviewable only when all answers are explicit.

### Provenance

- [ ] Is every requirement linked to a DS4 specification ID?
- [ ] Is copied external source code explicitly declared as none?
- [ ] Is copied external prompt text explicitly declared as none?
- [ ] Is copied external test text explicitly declared as none?
- [ ] Are all new names DS4-native?

### Architecture

- [ ] Does the change reuse existing DS4 components where appropriate?
- [ ] Is canonical state structured rather than chat-only?
- [ ] Is the baseline immutable?
- [ ] Is candidate execution isolated?
- [ ] Is promotion controlled by deterministic logic?

### Security

- [ ] Are immutable paths enforced outside the prompt?
- [ ] Are evaluator files protected?
- [ ] Is network access disabled by default?
- [ ] Are logs bounded and secrets redacted?
- [ ] Is rollback available?

### Testing

- [ ] Does every new production module have tests?
- [ ] Are tests derived from the acceptance contract?
- [ ] Are negative cases included?
- [ ] Is a crash/recovery case included?
- [ ] Is a no-regression case included?

---

## 17. Non-conformance conditions

The implementation is non-conforming if any of the following occurs:

1. SIA source or prompt text is copied.
2. SIA is added as a dependency.
3. A candidate can edit evaluator or hidden-fixture code.
4. An LLM can promote its own candidate without deterministic gates.
5. The canonical state exists only in chat messages.
6. A failed evaluator can be overridden by free-form model text.
7. The baseline is modified during candidate execution.
8. A run cannot be reconstructed after process restart.
9. A production change lacks provenance metadata.
10. The system claims clean-room status without review evidence.

---

## 18. Required attestation

Before enabling DS4 Evolution outside preview mode, the maintainer MUST sign an attestation equivalent to:

> I confirm that the DS4 Evolution implementation was produced from DS4-native specifications and behavioral observations only. No SIA source code, prompts, tests, class names, function names, or repository layout were copied. Deterministic evaluators and a promotion gate remain authoritative over LLM recommendations.

---

## 19. Final provenance verdict

The permitted transfer is limited to general ideas:

- iterative candidate improvement;
- separation of proposal, execution, evaluation, and diagnosis;
- persistent revision history;
- external measurement;
- role specialization;
- run visualization.

The DS4 implementation MUST remain independently designed in:

- source code;
- prompts;
- schemas;
- state model;
- module boundaries;
- tests;
- artifact layout;
- security controls;
- promotion policy.

**Conformance outcome:** `PASS` only when all mandatory controls in this document and the acceptance contract are satisfied.
