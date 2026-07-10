# DS4 Studio — Quickstart

**DS4 Studio** is a self-contained DeepSeek V4 inference engine and full-stack coding agent platform. It combines a native C inference engine (optimized for Metal, CUDA, and ROCm), a C CLI agent, a Node.js backend with Express/Vite, a React frontend, and a Python crawl service — all working together to deliver local, agentic AI.

> **Philosophy**: Local inference should be three things working well together: inference engine with HTTP API + GGUF files crafted for the engine + testing/validation with real coding agents. DwarfStar only runs with its own GGUF files and is tested against official logits. It is a narrow, opinionated stack — one model at a time — not a generic GGUF runner.

---

## Quick Setup

### 1. System Requirements

- **RAM**: 128 GB minimum (96 GB possible with SSD streaming)
- **Disk**: ~85 GB for the model file (ds4flash.gguf)
- **OS**: macOS (Metal), Linux (CUDA or ROCm)
- **Strix Halo**: See [STRIXHALO.md](../STRIXHALO.md) for ROCm setup on AMD GPUs

### 2. Build & Run

```sh
# Build everything (ROCm + frontend)
./srun.sh build

# Or build only the backend binaries
./srun.sh build be

# Start the web UI
./srun.sh
```

The script starts a Node.js server on `127.0.0.1:5173` and spawns `ds4-wrapper` as the managed backend.

### 3. CLI Agent (native)

```sh
# Run the native agent directly (no frontend needed)
./ds4-agent -m ds4flash.gguf
```

### 4. Configuration

Edit `frontend/ds4-ui.config.json` or use the UI's settings panel to adjust model path, context size, KV cache settings, GPU environment variables, and request defaults.

---

## Repository Layout

| Directory | Purpose |
|-----------|---------|
| `ds4.c` / `ds4.h` | Core inference engine (DeepSeek V4 model loading, GPU backends, KV cache) |
| `ds4_agent.c` | Native CLI agent with tool-calling loop |
| `ds4_wrapper.c` / `ds4_wrapper.h` | Session multiplexing wrapper (server mode + agent mode) |
| `ds4_agent_runtime.c` / `ds4_agent_runtime.h` | Embeddable agent runtime for the wrapper |
| `frontend/server/` | Node.js backend (Express, Vite, API endpoints, agent session, tool execution) |
| `frontend/src/` | React frontend (chat UI, panels, PageAgent proxy) |
| `crawl_service/` | Python FastAPI service wrapping Crawl4AI for web crawling |
| `scripts/` | ROCm tuning, certification scripts, Python tuning GUI |
| `docs/` | Design specs and certifications |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React UI)                    │
│  ChatPanel · Settings · Metrics · PageAgent Proxy       │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (Express / Vite)
┌──────────────────────▼──────────────────────────────────┐
│              Node.js Backend (index.mjs)                 │
│  Agent Session · Tool Executor · Research · PageAgent   │
│  Web Search · Crawl Client · Compression · Safety       │
└──────┬──────────────────────────────┬───────────────────┘
       │ HTTP (API)                   │ Child Process
┌──────▼──────────────┐   ┌──────────▼───────────────────┐
│  ds4-wrapper (C)     │   │ ds4-crawl-service (Python)  │
│  Server Mode / Agent │   │ FastAPI · Crawl4AI · SQLite  │
│  Mode multiplexing   │   │ Jobs · Artifacts · Sessions  │
└──────────────────────┘   └──────────────────────────────┘
```

---

## Key Domains

- **[Architecture](architecture/index.md)** — Inference engine, wrapper, native agent runtime, GPU backends, KV cache
- **[Backend](backend/index.md)** — Node.js server, agent session manager, tool executor, web search, research engines
- **[Frontend](frontend/index.md)** — React UI, ChatPanel, settings panels, PageAgent browser proxy
- **[Agent Infrastructure](agent-infrastructure/index.md)** — Loop guard, claim guard, runtime rules, autonomy, GitNexus policy, compression
- **[PageAgent](pageagent/index.md)** — Browser automation subsystem: snapshot, action, task, MCP server, safety/audit
- **[Research](research/index.md)** — Deep research system: local/gemini/prism engines, crawl summarizer, evidence store, synthesis
- **[Crawl Service](crawl-service/index.md)** — Python Crawl4AI integration: FastAPI service, runner, artifacts, plugins
- **[Build & Deploy](build-and-deploy/index.md)** — Makefile targets, srun.sh, ROCm tuning scripts
- **[Operations](operations/index.md)** — Configuration, profiles, environment variables

---

## Next Steps

1. Read the [architecture overview](architecture/index.md) to understand the inference pipeline
2. Explore the [backend](backend/index.md) to understand the agent session protocol and tool execution
3. Check the [frontend](frontend/index.md) for the UI component structure
4. See [agent-infrastructure](agent-infrastructure/index.md) for safety mechanisms
5. Review [pageagent](pageagent/index.md) for browser automation capabilities
6. Understand the [research](research/index.md) system for deep web research
7. Configure your setup via [operations](operations/index.md)
