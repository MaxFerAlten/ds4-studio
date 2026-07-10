# Agent Infrastructure: Safety, Controls & Compression

This page documents the safety mechanisms, guardrails, and compression systems that make the agentic loop robust, safe, and efficient.

---

## Loop Guard (`agentLoopGuard.mjs`)

The loop guard detects and interrupts **sterile tool command loops** — situations where the agent repeatedly calls the same tool with functionally identical arguments without making progress.

Key behaviors:
- Tracks consecutive tool calls of the same type
- If results are functionally similar across 5+ consecutive calls, triggers an interrupt
- After interrupt, the agent is forced to change strategy or yield to the user
- Integrates with the agent session to inject "loop detected" notices

Source: `frontend/server/agentLoopGuard.mjs` (10,248 bytes)

---

## Claim Guard (`claimGuard.mjs`)

Verifies model claims against actual tool output. When the model makes a factual claim that should be supported by tool results, the claim guard checks whether the claim is actually present in the returned data. If not, the claim is marked as "unverified" and surfaced to the user.

Source: `frontend/server/claimGuard.mjs` (1,082 bytes)

---

## Runtime Rules (`agentRuntimeRules.mjs`)

Core behavioral rules injected into the agent's system prompt. These rules define:
- File exploration strategy (search-first, read-targeted)
- Tool usage guidelines
- Output formatting expectations
- Error handling patterns

Source: `frontend/server/agentRuntimeRules.mjs` (1,399 bytes)

---

## Autonomy & Capabilities

- **AgentAutonomy** (`agentAutonomy.mjs`) — Controls the agent's autonomy level: how much it can do without user confirmation, whether it can execute bash commands, whether it can browse the web.
- **AgentCapabilities** (`agentCapabilities.mjs`) — Declares available capabilities to the model so it knows what tools and actions are available.

---

## GitNexus Policy (`agentGitnexusPolicy.mjs`)

Integrates GitNexus code intelligence into the agent workflow. When the agent needs to understand or modify code, this policy ensures:
- Impact analysis before editing symbols
- Change detection before committing
- Context queries for codebase navigation

The agent is instructed to use GitNexus tools instead of manual grep/search on project code.

---

## Pony Policy (`agentPonyPolicy.mjs`)

A "Pony" mode that restricts the assistant to a limited, safe behavior profile. When enabled, the assistant:
- Cannot execute arbitrary code
- Cannot browse the web
- Responds in a constrained, polite manner

---

## Cost Limits (`costLimits.mjs`)

Budget tracking and enforcement for agent sessions. Tracks token usage across turns and enforces maximum budget limits. Includes:
- `maxAgentTotalTokens` — hard cap on total tokens per session
- `maxAnalyzeChunks` — limit on file analysis chunks
- `agentBudgetStatus` — current budget state

---

## Tool Output Compression (`toolOutputCompressor.mjs`)

Large tool results are compressed to save context window space and reduce bandwidth. Strategies include:

- **Token-level compression**: Replace common patterns with shorter representations
- **Content-aware truncation**: Keep important parts, drop verbose boilerplate
- **Blob storage**: Move large artifacts to content-addressed blob storage
- **Delta compression**: Only send changes since last result

Metrics tracked: events count, original bytes, compressed bytes, blob count, strategy used.

---

## Tool Blob Store (`toolBlobStore.mjs`)

Content-addressed storage for large tool artifacts. When tool output exceeds size thresholds, the compressor stores the full content in the blob store and returns a reference. The model can retrieve blobs by ID when needed.

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `agentLoopGuard.mjs` | 10,248 | Sterile loop detection and interrupt |
| `claimGuard.mjs` | 1,082 | Claim verification against tool output |
| `agentRuntimeRules.mjs` | 1,399 | Core behavioral rules |
| `agentAutonomy.mjs` | 1,488 | Autonomy level controls |
| `agentCapabilities.mjs` | 1,968 | Capability declarations |
| `agentGitnexusPolicy.mjs` | 2,168 | GitNexus code intelligence policy |
| `agentPonyPolicy.mjs` | 2,377 | Pony mode restrictions |
| `costLimits.mjs` | 2,851 | Budget tracking and enforcement |
| `toolOutputCompressor.mjs` | 17,548 | Tool output compression strategies |
| `toolBlobStore.mjs` | 3,098 | Content-addressed blob storage |
