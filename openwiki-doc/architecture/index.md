# Architecture: Inference Engine, Wrapper & Native Agent

This page documents the core C runtime that powers DS4 Studio: the inference engine, the session multiplexing wrapper, and the native agent runtime.

---

## Inference Engine (`ds4.c` / `ds4.h`)

The engine is a **DeepSeek V4-specific inference pipeline** — not a generic GGUF runner. It loads GGUF files, parses the header and tensor directory, and runs inference on Metal, CUDA, or CPU backends.

Key characteristics:

- **Narrow model support**: Only DeepSeek V4 Flash and PRO layouts are accepted. Other models fail early.
- **mmap-based loading**: Tensor data stays in the kernel page cache until inference touches it. Metal uses slices as no-copy `MTLBuffer`s.
- **Three backends**: `DS4_BACKEND_METAL`, `DS4_BACKEND_CUDA`, `DS4_BACKEND_CPU`. CPU is for correctness checks only.
- **KV cache**: Compressed KV cache design specific to DeepSeek V4. Supports RAM and SSD streaming (first-class disk citizen).
- **Distributed inference**: `ds4_distributed.c` provides multi-device inference across GPUs.

### Engine API (ds4.h)

The public API is intentionally narrow so HTTP/CLI code doesn't depend on tensor internals:

- `ds4_engine` — loaded model handle
- `ds4_session` — mutable inference timeline (owns live KV cache and logits)
- `ds4_session_sync()` — reuse, extend, or rebuild graph state from token prefixes
- `ds4_session_penalize_logits()` — apply a llama.cpp-style repeat penalty (>1.0) to given token IDs on the session's current logits before sampling (deduplicate IDs first; compounds on duplicates)
- `ds4_session_ban_logits()` — hard-ban token IDs on the session's current logits (set to -inf) so the next sample cannot pick them
- Backend enum: `METAL`, `CUDA`, `CPU`
- Think mode: `NONE`, `HIGH`, `MAX`
- Log types: prefill, generation, KV cache, tool, timing, etc.

### Source Structure

| File | Lines | Role |
|------|-------|------|
| `ds4.c` | 1,155,620 | Core inference engine — GGUF loading, tensor layouts, CPU/Metal/CUDA graph drivers, tokenizer |
| `ds4.h` | 14,636 | Public API header |
| `ds4_gpu.h` | 39,123 | GPU kernel declarations and helpers |
| `ds4_cuda.cu` | 514,855 | CUDA kernels (also used as ROCm HIP shim) |
| `ds4_metal.m` | 1,189,243 | Metal GPU graph driver |
| `ds4_distributed.c` / `.h` | 322,920 / 3,782 | Multi-device inference |
| `ds4_rocm.cu` / `.h` | 2,827 / 6,086 | ROCm-specific setup and quality decode defaults |

---

## Session Wrapper (`ds4_wrapper.c` / `ds4_wrapper.h`)

The wrapper provides **session multiplexing** — it manages a single engine instance that can switch between server mode and agent mode.

### Wrapper State Machine

States: `STARTING → READY → BUSY → SWITCHING → ERROR → STOPPING`

Two modes:
- **Server mode** (`DS4_WRAP_MODE_SERVER`): HTTP API endpoint for chat completions
- **Agent mode** (`DS4_WRAP_MODE_AGENT`): Native agent runtime with tool calling

### Session Freezing

Sessions can be frozen to RAM or disk, allowing the wrapper to switch between server and agent modes without losing state. The `ds4_kvstore` subsystem handles KV cache persistence.

### Key Metrics

The wrapper tracks: total requests, rejected-busy counts, rejected-wrong-mode counts, switch count, freeze/thaw counts, and timing.

### Supporting Files

| File | Role |
|------|------|
| `ds4_wrapper_config.c` / `.h` | Command-line option parsing for wrapper |
| `ds4_wrapper_state.c` / `.h` | State machine logic |
| `ds4_wrapper_http.c` / `.h` | HTTP server within wrapper |
| `ds4_wrapper_metrics.c` / `.h` | Metrics collection |
| `ds4_kvstore.c` / `.h` | KV cache persistence (RAM/disk) |

---

## Native Agent Runtime (`ds4_agent_runtime.c` / `.h`)

An **embeddable agent runtime** that lives inside the wrapper. It reuses `ds4_agent.c` static helpers (worker submit/consume, agent worker init/free) via `#include "ds4_agent.c"` — the same technique `ds4_server_runtime.c` uses with `ds4_server.c`.

### Event Types

Events published to callbacks: `TEXT`, `REASONING`, `TOOL_CALL`, `TOOL_RESULT`, `STATUS`, `USAGE`, `DONE`, `ERROR`.

### Agent Runtime API

- `ds4_agent_runtime_init()` — initialize with wrapper, options (system prompt, max iterations, temperature, browser access)
- `ds4_agent_runtime_chat()` — send user text, receive events via callback
- `ds4_agent_runtime_interrupt()` — soft interrupt for stop/disconnect
- Session management: save, list, switch, strip, new, compact
- Command interface: `ds4_agent_runtime_command()` for admin commands
- Compression metrics: thread-safe snapshot of compression stats

### Agent Configuration Options

| Option | Description |
|--------|-------------|
| `system_prompt` | Agent system prompt |
| `max_iterations` | Maximum tool-calling iterations |
| `n_predict` | Tokens to generate per turn |
| `temperature` / `top_p` / `min_p` | Sampling parameters |
| `nothink` | Disable thinking/reasoning |
| `allow_browser` | Allow opening a visible Chrome browser |

---

## Native CLI Agent (`ds4_agent.c`)

The standalone CLI agent binary (`./ds4-agent`) provides a terminal-based coding agent with tool-calling. It is a single-process design: the UI thread owns terminal I/O, while a worker thread owns the live DS4 session and KV state.

### Tool Set

The native agent provides tools matching the LLM agent protocol: file read/write/edit, bash execution, search/grep, directory listing, web search, web page reading, and crawl URL. Results are returned as DSML (DS4-specific markup language) tool calls.

### Key Features

- Anti-loop guard for sterile tool command loops (`ds4_agent.c`)
- Crawl grounding (`ds4_crawl_grounding.c`) — extract source from crawl manifests and verify results
- Tool compression (`ds4_tool_compress.c`) — compress/decompress tool output for bandwidth efficiency
- Context blob support (`ds4_context_blob.c`) — structured context injection

---

## Server Runtime (`ds4_server.c` / `ds4_server_runtime.c`)

The HTTP server runtime implements the `/v1/chat/completions` API endpoint, compatible with OpenAI's API format. It shares the same engine and worker model as the agent runtime but exposes a REST API.

---

## Key Source Files

| File | Lines | Description |
|------|-------|-------------|
| `ds4.c` | 1,155,620 | Core inference engine |
| `ds4.h` | 14,636 | Public API |
| `ds4_agent.c` | 501,086 | Native CLI agent |
| `ds4_agent_runtime.c` | 45,550 | Embeddable agent runtime |
| `ds4_agent_runtime.h` | 3,064 | Agent runtime API |
| `ds4_wrapper.c` | 4,669 | Session wrapper entry point |
| `ds4_wrapper.h` | 2,202 | Wrapper state machine definition |
| `ds4_server.c` | 607,236 | HTTP server runtime |
| `ds4_server_runtime.c` | 11,778 | Server runtime init/management |
| `ds4_cuda.cu` | 514,855 | CUDA/ROCm kernels |
| `ds4_metal.m` | 1,189,243 | Metal graph driver |
| `ds4_distributed.c` | 322,920 | Distributed inference |
| `ds4_kvstore.c` | 51,223 | KV cache persistence |
| `ds4_crawl_grounding.c` | 32,409 | Crawl grounding utilities |
| `ds4_tool_compress.c` | 24,188 | Tool output compression |
| `ds4_context_blob.c` | 11,199 | Context blob management |
