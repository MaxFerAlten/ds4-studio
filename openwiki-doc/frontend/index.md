# Frontend: React UI

The frontend is a React application served by Vite, providing the graphical interface for chat, settings, metrics, and browser automation.

---

## Entry Point & Component Tree

The main application is in `App.jsx` (87,478 bytes). Key components:

### ChatPanel (`chat/ChatPanel.jsx`)
- Message list with memoized rendering (ReactMarkdown parsing is skipped on unchanged messages)
- Tool call rendering: call blocks with progress, result blocks with guard indicators
- Reasoning details (collapsible)
- Composer with send/stop buttons

### Right Rail Panels (`panels/RightRailPanels.jsx`)
- **RequestPanel** — output budget, temperature, sampling parameters
- **ProfilePanel** — named profile selector
- **StartupPanel** — server binary, model path, context size, GPU env vars
- **StrategyPanel** — KV cache strategy, MOE profile tuning
- **LogsPanel** — real-time streaming log viewer
- **MetricsPanel** — throughput, timing, token rates
- **CompressionPanel** — tool output compression statistics
- **CallDebugPanel** — outbound API call inspection
- **PageAgentPanel** — browser automation controls

### Left Rail (`panels/LeftRail.jsx`)
- Session list and navigation

### HistoryPanel (`panels/HistoryPanel.jsx`)
- Conversation history browser

### ResearchPanel (`research/ResearchPanel.jsx`)
- Deep research session UI

---

## PageAgent Browser Proxy (`pageagent/pageAgentProxy.mjs`)

A critical piece of frontend infrastructure: the PageAgent proxy runs **inside the browser** and polls the server for pending tool requests. When a tool arrives, it executes it locally (snapshotting the DOM, performing clicks, filling inputs) and returns the result to the server.

This allows the AI agent to control the browser UI — inspect visible elements, click buttons, read page text — without needing a remote browser driver. The proxy communicates via `/api/pageagent/pending` and `/api/pageagent/resolve` endpoints.

---

## State Management

State is managed via React hooks (`useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`) in `App.jsx`. Key state:

- `config` — server configuration object
- `request` — current request defaults
- `messages` — conversation message array
- `activeProfile` — selected profile name
- `agentSession` — agent session metadata
- `pageAgentEnabled` — PageAgent toggle state
- `rocm` / `stats` — GPU telemetry and throughput stats

### App Logic (`appLogic.mjs`)

Pure logic extracted from App.jsx for testability: constants, formatting functions, agent message handling, search result injection, session storage access.

---

## Key Utilities

| File | Description |
|------|-------------|
| `utils.mjs` | Shared utility functions (formatting, storage, event handling) |
| `appLogic.mjs` | Core application logic and constants |
| `conversationExport.mjs` | Markdown export of conversations |
| `MessageContent.mjs` | Markdown rendering component (with KaTeX and Mermaid support) |
| `MermaidFullscreen.mjs` | Fullscreen Mermaid diagram viewer |
| `throughputStats.mjs` | Token throughput and timing statistics |
| `serverMetrics.mjs` | Server-side metrics display formatting |
| `deltaBatcher.mjs` | SSE delta batching for streaming |
| `backendStatus.mjs` | Backend health polling |
| `callDebug.mjs` | Outbound API call debug recording |

---

## Styling

`styles.css` (34,508 bytes) provides the application stylesheet. The UI uses a dark theme with GPU telemetry cards, tool call blocks, and responsive layout.

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `App.jsx` | 87,478 | Main application component |
| `ChatPanel.jsx` | — | Chat message list and composer |
| `RightRailPanels.jsx` | — | Settings, metrics, and control panels |
| `LeftRail.jsx` | — | Session list sidebar |
| `HistoryPanel.jsx` | — | Conversation history browser |
| `pageAgentProxy.mjs` | — | Browser-side PageAgent tool executor |
| `pageAgentClient.mjs` | — | PageAgent client-side protocol |
| `appLogic.mjs` | 17,237 | Application logic and constants |
| `conversationExport.mjs` | 7,897 | Markdown export |
| `MessageContent.mjs` | 17,388 | Markdown renderer with KaTeX/Mermaid |
| `utils.mjs` | 14,304 | Shared utilities |
| `styles.css` | 34,508 | Application stylesheet |
