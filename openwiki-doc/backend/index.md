# Backend: Node.js Server

The backend is an Express + Vite server (`frontend/server/index.mjs`) that serves the React frontend, proxies inference requests to `ds4-wrapper`, and runs the agentic tooling loop.

---

## Architecture

The backend is a single Node.js process with these responsibilities:

1. **Static file serving** — Vite dev/production middleware for the React UI
2. **API endpoints** — REST routes for chat, agent sessions, settings, research, PageAgent
3. **Agent Session Manager** — stateful delta protocol for tool-calling conversations
4. **Tool Executor** — sandboxed file system and shell tools
5. **Research Orchestrator** — deep research with multiple engine backends
6. **PageAgent Bridge** — browser automation protocol between server and client

---

## Key Endpoints

| Route | Purpose |
|-------|---------|
| `/v1/chat/completions` | OpenAI-compatible chat completions (proxied to ds4-server) |
| `/api/chat` | Agent chat endpoint (stateful session + tool loop) |
| `/api/config` | Read/write config.json |
| `/api/profiles/*` | Profile management (list, select, load) |
| `/api/history/*` | Conversation history CRUD |
| `/api/export/*` | Conversation export (Markdown, raw) |
| `/api/research/*` | Deep research session management |
| `/api/pageagent/*` | PageAgent tool bridge (pending, resolve, enable) |
| `/api/crawl/*` | Crawl service proxy (jobs, events, results) |
| `/api/sage` | Sage execution endpoint |
| `/api/amd-smi` | AMD GPU telemetry |

---

## Agent Session Manager (`agentSession.mjs`)

The session manager implements a **stateful delta protocol** inspired by pi-ds4-stateful. Instead of replaying the entire transcript on every turn, it tracks message hashes and sends lightweight delta payloads.

Key concepts:

- **Stable hashing**: Messages are hashed with sorted JSON keys (SHA-1). Hash cache survives across `choosePayload` calls.
- **Incremental**: O(N) total hashing work as sessions grow to N turns (not O(N²)).
- **System prompt**: The agent system prompt includes tool schemas in OpenAI function-calling format.
- **Tools**: The agent can call bash, read, write, edit, search, list, web_search, web_read, crawl_url, page_snapshot, page_action, page_task, and history tools.

### Session Flow

1. User sends message → session creates delta payload
2. Model generates assistant response with tool calls
3. Tool executor runs each tool and returns results
4. Results are appended as tool messages
5. Model continues or returns final answer
6. Loop guard detects sterile loops and interrupts

---

## Tool Executor (`agentTools.mjs`)

All tool execution is **server-side (Node.js)**. Tools are sandboxed to the workspace root by default (set `DS4_AGENT_SANDBOX=0` to disable).

### Tool Set

| Tool | Description | Security |
|------|-------------|----------|
| `bash` | Execute shell commands | Sandboxed to workspace, timeout 30s, 64KB output cap |
| `read` | Read file content | 20KB cap per result |
| `write` | Write file content | Workspace-restricted |
| `edit` | Exact string replacement | Workspace-restricted |
| `search` | Grep filesystem | Uses `searchQueryGuard` for validation |
| `list` | Directory listing | Workspace-restricted |
| `web_search` | Web search via Tavily/SerpAPI/Google | API key from config or .env |
| `web_read` | Fetch and strip HTML page | 16KB cap after HTML stripping |
| `crawl_url` | Crawl via ds4-crawl-service | Python service client |
| `page_snapshot` | Snapshot browser page | PageAgent bridge |
| `page_action` | Perform browser action | PageAgent bridge |
| `page_task` | High-level UI task | PageAgent bridge |
| `history` | Search chat history | Local history store |

---

## Research System

The backend integrates a **deep research subsystem** with multiple engine backends:

- **LocalGraphEngine** — local analysis/graph-based research
- **GeminiResearchEngine** — Google Gemini API research
- **PrismResearchEngine** — Printing Press Prism research

Components: `researchRuntime.mjs`, `researchSearchService.mjs`, `researchFormatter.mjs`, `evidenceStore.mjs`, `synthesisEngine.mjs`, `sourceCritic.mjs`, `crawlClient.mjs`, `crawlSummarizer.mjs`.

---

## Safety & Controls

- **AgentLoopGuard** (`agentLoopGuard.mjs`) — detects sterile tool command loops and interrupts
- **ClaimGuard** (`claimGuard.mjs`) — verifies model claims against tool output
- **AgentRuntimeRules** (`agentRuntimeRules.mjs`) — core behavioral rules injected into system prompt
- **AgentAutonomy** (`agentAutonomy.mjs`) — autonomy level controls
- **AgentCapabilities** (`agentCapabilities.mjs`) — capability declarations for the model
- **GitNexusPolicy** (`agentGitnexusPolicy.mjs`) — GitNexus code intelligence integration
- **PonyPolicy** (`agentPonyPolicy.mjs`) — "Pony" mode (restricted assistant behavior)
- **CostLimits** (`costLimits.mjs`) — budget tracking and enforcement
- **ToolOutputCompressor** (`toolOutputCompressor.mjs`) — compress large tool results
- **ToolBlobStore** (`toolBlobStore.mjs`) — content-addressed blob storage for tool artifacts

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `index.mjs` | 96,654 | Main server entrypoint, Express routes, middleware |
| `agentSession.mjs` | 29,516 | Stateful session manager with delta protocol |
| `agentTools.mjs` | 49,850 | Tool executor and tool definitions |
| `agentLoopGuard.mjs` | 10,248 | Sterile loop detection and interruption |
| `toolOutputCompressor.mjs` | 17,548 | Tool output compression strategies |
| `config.mjs` | 17,083 | Config loading, validation, saving |
| `webSearchTool.mjs` | 19,182 | Web search and page reading tools |
| `research/researchRuntime.mjs` | — | Research orchestrator |
| `crawlClient.mjs` | 3,134 | Crawl service HTTP client |
| `pageAgentTool.mjs` | 4,930 | PageAgent tool definitions |
| `pageAgentTask.mjs` | 3,844 | High-level task planner for PageAgent |
| `pageAgentBridge.mjs` | 1,210 | Client-server bridge protocol |
| `pageagentMcp.mjs` | 3,358 | MCP server for external AI tool calling |
| `processManager.mjs` | 4,244 | Child process management for ds4-wrapper |
| `profileLoader.mjs` | 5,327 | Named profile loading |
