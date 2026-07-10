# PageAgent: Browser Automation Subsystem

PageAgent allows the AI agent to **inspect and control the browser UI** from the server side, enabling autonomous web browsing, form filling, and UI interaction without a remote browser driver.

---

## Architecture

PageAgent has two sides that communicate via HTTP:

1. **Server-side** (Node.js): Defines tools, plans tasks, enforces safety rules
2. **Client-side** (Browser): Polls for pending tool requests, executes them locally, returns results

The browser proxy polls `/api/pageagent/pending` every 300ms. When a tool arrives, it executes the DOM operation and posts the result to `/api/pageagent/resolve`.

---

## Server-Side Components

### PageAgent Tool Definitions (`pageAgentTool.mjs`)

Three core tools:

| Tool | Description |
|------|-------------|
| `page_snapshot` | Read a guarded snapshot of the current DS4 Studio UI or an allowed browser page. Returns URL, title, visible controls (buttons, inputs, selects, links), and visible text. |
| `page_action` | Perform one guarded UI action: click, input, select, scroll, wait. Requires a target (data-agent-id, visible label, or stable selector). |
| `page_task` | High-level UI task described in natural language. Automatically inspects the page, plans actions, executes them, and confirms the result. |

### Task Planner (`pageAgentTask.mjs`)

For `page_task`, the task planner:
1. Parses the natural language task description
2. Plans a sequence of actions
3. Executes each action via `page_action`
4. Verifies the result with `page_snapshot`
5. Returns confirmation or error

### Safety & Audit (`pageAgentSafety.mjs` / `pageAgentAudit.mjs`)

- **Safety layer**: Validates targets, actions, and URLs against an allowlist. Prevents destructive actions without user confirmation.
- **Audit layer**: Logs all PageAgent operations for review. Records snapshots before and after actions.

### Bridge Protocol (`pageAgentBridge.mjs`)

Manages the client-server connection:
- `enqueuePageAgentTool` — queue a tool for the browser to execute
- `resolvePageAgentTool` — receive result from browser
- `getPendingTools` — return pending tools for browser polling
- `markClientConnected` / `resetClientConnection` — track browser state
- `isServerEnabled` / `setServerEnabled` — toggle PageAgent server-side

### MCP Server (`pageagentMcp.mjs`)

An MCP (Model Context Protocol) server that exposes PageAgent tools to external AI clients. Registered tools:
- `page_snapshot` — read UI snapshot
- `page_action` — perform UI action
- `page_task` — high-level UI task

Uses `@modelcontextprotocol/sdk` with stdio transport. The MCP server connects to the frontend port to call the PageAgent bridge.

---

## Client-Side Components

### Browser Proxy (`pageagent/pageAgentProxy.mjs`)

Runs in the browser and polls the server. Executes tools locally:

- **`localPageSnapshot`** — reads `document.title`, `document.body.innerText`, and visible controls using `querySelectorAll`
- **`localPageAction`** — dispatches clicks, fills inputs, selects options, scrolls, waits
- **`localPageTask`** — breaks down a natural language task into local actions

Controls are detected via CSS selectors: `button, input, select, textarea, a, [role=button], [role=tab], [data-agent-id]`. Only visible elements (non-zero bounding rect) are included.

### Client Protocol (`pageagent/pageAgentClient.mjs`)

Client-side API for PageAgent operations. Provides `pageSnapshot()`, `pageAction()`, `pageTask()` functions that communicate with the server.

### Event System (`pageagent/pageAgentEvents.mjs`)

Event-based API for reactive PageAgent operations. Fires events when tools are pending, resolved, or errored.

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `frontend/server/pageAgentTool.mjs` | 4,930 | Tool definitions (snapshot, action, task) |
| `frontend/server/pageAgentTask.mjs` | 3,844 | High-level task planner |
| `frontend/server/pageAgentSafety.mjs` | 6,033 | Safety validation layer |
| `frontend/server/pageAgentAudit.mjs` | 2,790 | Audit logging |
| `frontend/server/pageAgentBridge.mjs` | 1,210 | Client-server bridge protocol |
| `frontend/server/pageagentMcp.mjs` | 3,358 | MCP server integration |
| `frontend/server/pageAgentFixture.mjs` | 4,928 | Test fixtures |
| `frontend/server/pageAgentBench.mjs` | 3,365 | Benchmark utilities |
| `frontend/src/pageagent/pageAgentProxy.mjs` | — | Browser-side tool executor |
| `frontend/src/pageagent/pageAgentClient.mjs` | — | Client API |
| `frontend/src/pageagent/pageAgentEvents.mjs` | — | Event system |
| `frontend/src/pageagent/PageAgentPanel.jsx` | — | UI panel for PageAgent controls |
