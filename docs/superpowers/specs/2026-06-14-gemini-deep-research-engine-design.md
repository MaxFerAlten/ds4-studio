# Gemini Deep Research Engine — Design

**Date:** 2026-06-14
**Status:** Approved (design), pending implementation plan

## Goal

Add Google's Gemini **Deep Research** (Interactions API) as a **selectable
alternative engine** for ds4-studio's Deep Research, alongside the existing
local engine (ds4-server graph + web providers + ORCID). The user picks the
engine per research session; the existing UI, history, export, plan-review gate,
and SSE streaming are reused unchanged.

## Background — the Gemini Deep Research API

- **Interactions API** (stateful, async): `POST /v1beta/interactions`,
  `GET /v1beta/interactions/{id}` on
  `https://generativelanguage.googleapis.com`.
- Models (agents): `deep-research-preview-04-2026`,
  `deep-research-max-preview-04-2026`.
- Auth: `x-goog-api-key` header (Google AI Studio key).
- Request: `agent`, `input`, `background=true` (required), `stream=true`,
  `agent_config` (`thinking_summaries`, `visualization`,
  `collaborative_planning`), `tools` (`google_search`, `url_context`,
  `code_execution`, `mcp_server`, `file_search`), `previous_interaction_id`,
  `store=true`.
- Stream events: `interaction.created` (→ `interaction_id`), `step.delta`
  (`text` | `thought` | `image`), `interaction.completed` | `error`.
- Output: `output_text` (report + inline citations), `steps[]`, `citations[]`.
- `collaborative_planning=true` → the agent returns a research plan for
  confirmation before executing.
- Cost ~$1–7/task; up to 60 min; ~80–160 searches.
- Limits: beta; no structured output; no custom function-calling (MCP only);
  requires `store=true` with `background=true`.

## Why this maps cleanly

Gemini's shapes line up with ds4-studio's existing contracts, so the frontend and
persistence stay the same:

| Gemini | ds4-studio existing |
|--------|---------------------|
| `collaborative_planning` plan-for-confirmation | plan review → `feedback_required` / accept / regenerate |
| `step.delta { text }` | `report_delta` SSE |
| `step.delta { thought }` | ThoughtChain node update |
| `output_text` + `citations[]` | `finalReport` + `sources[]` |
| async `background` + `interaction_id` | `ResearchRuntime` job + SSE reconnect by `seq` |
| `previous_interaction_id` | persisted session |

## Architecture — engine abstraction

Today `ResearchRuntime.#launch` calls `runResearchGraph(ctx)` directly. Introduce
a `ResearchEngine` interface and route to it by the session's selected engine.

```
interface ResearchEngine {
  run(ctx): Promise<state>          // drive to completion OR to the feedback gate
  submitFeedback(ctx, action): ...  // resume after plan confirm/regenerate
  cancel(ctx): ...                  // best-effort stop
}
```

- **LocalGraphEngine** — wraps the current `runResearchGraph` + feedback/cancel
  logic already in `ResearchRuntime` (behavior-preserving refactor).
- **GeminiInteractionsEngine** — drives the Interactions API and emits the same
  `ctx.emit(...)` events as the local engine, so the SSE stream, store, and UI
  are identical.

`ResearchRuntime` selects the engine from `state.engine` (set at session
creation, default `config.research.engine`).

## Components

### `server/research/geminiResearchClient.mjs`
Thin HTTP client over the Interactions API (injectable `fetchImpl`, key from env):
- `createInteraction({ input, agent, agentConfig, tools, stream })` → starts a
  background interaction, returns `{ interactionId, stream }`.
- `streamEvents(interactionId)` / consume the SSE body → async iterator of
  normalized events `{ type, deltaType?, text?, plan?, citations?, status }`.
- `getInteraction(interactionId)` → poll status/output (fallback when not
  streaming, and for reconnect).
- `cancelInteraction(interactionId)` (if supported; else abort + mark cancelled).
- `submitPlanDecision(interactionId, decision)` → confirm/regenerate plan
  (exact mechanism — follow-up interaction with `previous_interaction_id` vs a
  dedicated confirm call — to be confirmed against the live API during F1).

### `server/research/geminiResearchEngine.mjs`
Translate Gemini events → ds4-studio events on `ctx`:
- `interaction.created` → persist `state.interactionId`; `research_started`.
- plan (collaborative_planning) → `plan_generated` + set
  `status=waiting_feedback` + `feedback_required`; persist and return.
- `step.delta{thought}` → `node_started`/`node_completed` on a synthetic
  "Researching" node (drives ThoughtChain).
- `step.delta{text}` → append to `finalReport`; `report_delta`.
- `citations[]` → de-duped `source_found` (map `{title,url,snippet}` →
  normalized source).
- `interaction.completed` → set authoritative `finalReport = output_text`;
  `report_completed`; `research_completed`.
- `error` → `research_error`.
- `submitFeedback(accept|regenerate)` → resume the interaction, continue mapping.

### `ResearchRuntime` changes
- Build both engines once; pick per session via `state.engine`.
- `#launch`, `submitFeedback`, `cancel` delegate to the chosen engine.
- `ctx` gains nothing engine-specific beyond what exists; Gemini client is held
  by the Gemini engine, constructed with `config.research.gemini`.

### Persistence (`ResearchStateStore` / `initialState`)
Add to session state: `engine` (`"local"|"gemini"`) and `interactionId`
(Gemini only). Reopen/reconnect uses `interactionId` to resume streaming or poll.
`listSessions()` summaries also surface `engine` so the History tab can show the
per-session engine badge.

### Config (`researchConfig.mjs`)
```
research.engine: "local"            // "local" | "gemini"
research.gemini: {
  model: "deep-research-preview-04-2026",
  apiKeyEnv: "GEMINI_API_KEY",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  tools: ["google_search", "url_context", "code_execution"],
  collaborativePlanning: true,
  thinkingSummaries: true,
  timeoutMs: 3600000
}
```
Merged + validated like the other blocks. `.env`: `GEMINI_API_KEY` (loaded by the
existing `process.loadEnvFile`).

### Frontend
- `ResearchPanel`: engine toggle (Local / Gemini), disabled mid-run; passed at
  session start.
- History rows: small engine badge (`local` / `gemini`).
- No other UI changes — report, sources, plan review, export, reopen all reused.

## Data flow (Gemini path)

1. User picks **Gemini**, enters query, Start → `createResearchSession` with
   `engine: "gemini"`.
2. Runtime → `GeminiInteractionsEngine.run`: `createInteraction(background, stream,
   collaborative_planning)`.
3. Stream: thoughts → ThoughtChain; **plan** → `feedback_required` (UI shows plan
   review). Persist `interactionId`.
4. User accepts → `submitFeedback("accept")` → engine resumes; text deltas →
   `report_delta`; citations → `source_found`.
5. `interaction.completed` → `finalReport`/sources finalized →
   `research_completed`. Export/history/reopen work unchanged.

## Error handling

- Missing/invalid `GEMINI_API_KEY` → engine unavailable; selecting Gemini surfaces
  a clear notice; local stays the default.
- API/network errors → `research_error` with message; session marked failed;
  partial `finalReport` preserved.
- Cancel → abort stream + best-effort `cancelInteraction`; `research_cancelled`.
- Cost guard: optional confirmation before starting a Gemini task (it bills
  $1–7); surfaced in the engine toggle help text.

## Testing

- `geminiResearchClient` — fake `fetchImpl`: request shape (agent, background,
  tools, agent_config), SSE event parsing (created/delta/completed/error), poll
  fallback, error mapping.
- `geminiResearchEngine` — fed a scripted event sequence, asserts the emitted
  ds4-studio events (plan→feedback_required, text→report_delta, citations→
  source_found, completed→research_completed) and state mutations
  (`interactionId`, `finalReport`).
- `ResearchRuntime` engine selection — local vs gemini routing; default engine.
- Config merge/validation for `research.engine` + `research.gemini`.
- Frontend: engine toggle state; history badge.
- Full suites + build; one live Gemini smoke task (~$1–3) gated behind a real key.

## Phases

- **F1** Gemini client + tests; confirm live request/stream + plan-resume shape.
- **F2** Gemini engine + event mapping + tests.
- **F3** Runtime engine abstraction (LocalGraphEngine refactor, behavior-preserving)
  + selection + config + `.env`.
- **F4** Frontend engine toggle + per-session persistence + history badge.
- **F5** Full verification + one live Gemini task; export/history/reopen parity.

## Non-goals / future

- Hybrid mode (exposing arxiv/cnr/ORCID to Gemini via `mcp_server` tool) — future.
- ORCID author verification does not apply to Gemini citations (rarely carry
  structured authors); remains a local-engine feature.
- Gemini `visualization` images — not rendered in v1 (thoughts/text/citations
  only); revisit later.
- BigQuery / file_search tools — not wired in v1.

## Key risks

- Beta API: request/stream/plan-resume schemas may shift; isolate all API
  specifics in `geminiResearchClient` so changes are localized.
- Paid cloud, data leaves the host — opposite of the self-hosted default;
  Gemini is opt-in per session, never the default.
- Plan-confirmation resume mechanism is the least-documented part; F1 must verify
  it against the live API before F2 builds on it.
