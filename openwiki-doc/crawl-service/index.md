# Crawl Service: Python Crawl4AI Integration

The crawl service is a **persistent Python FastAPI process** that wraps `crawl4ai==0.9.0` for production-grade web crawling. It is the only component that imports the upstream Crawl4AI package.

---

## Architecture

```
ds4-wrapper / Node Server / CLI
        │
        ▼ HTTP (loopback)
┌───────────────────────────────┐
│  FastAPI + Uvicorn (Python)   │
│  ┌──────────────┐ ┌─────────┐ │
│  │ CrawlRunner  │ │ SQLite  │ │
│  │ ArtifactStore│ │ Jobs DB │ │
│  └──────────────┘ └─────────┘ │
└───────────────────────────────┘
```

---

## FastAPI Endpoints (`app.py`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/jobs` | POST | Create a new crawl job |
| `/jobs/{job_id}` | GET | Get job status and result |
| `/jobs/{job_id}/events` | GET | Stream job events (SSE) |
| `/sessions` | GET | List active sessions |
| `/sessions/{session_id}` | GET | Get session details |
| `/sessions/{session_id}/close` | POST | Close a session |
| `/results/{job_id}` | GET | Get crawl results |
| `/artifacts/{job_id}/{name}` | GET | Get artifact by name |
| `/cache` | GET | Cache statistics |
| `/cache/clear` | POST | Clear cache |
| `/maintenance/compact` | POST | Compact SQLite database |

All endpoints except `/health` require bearer token authentication (`verify_bearer`).

---

## Core Components

### Runner (`runner.py`)
Manages the Crawl4AI lifecycle. Submits jobs to a background thread pool, handles browser pool sharing, and tracks job state transitions: `queued → running → completed/failed`.

### Repository (`repository.py`)
SQLite-backed persistence layer for jobs, events, sessions, and cache metadata. Uses migrations (`migrations/001_initial.sql`) for schema management.

### Artifact Store (`artifacts.py`)
Content-addressed storage for crawl artifacts (HTML snapshots, screenshots, PDFs). Files stored by content hash with configurable retention.

### Plugins (`plugins.py`)
Trusted local Python extension points for non-serializable Crawl4AI features (custom strategies, hooks, callbacks). Plugins are loaded from a configured directory.

### Serialization (`serialize.py`)
Serializes crawl results into a JSON format compatible with the agent's tool result protocol.

### Sessions (`sessions.py`)
Session manager for browser instances. Tracks active browser sessions and maps them to crawl jobs.

### Auth (`auth.py`)
Bearer token authentication. The token is auto-generated on first startup and stored in the settings file.

### Settings (`settings.py`)
Configuration loading from environment variables and a JSON settings file. Includes database path, artifact directory, plugin directory, and token.

### Models (`models.py`)
Pydantic models for request/response validation (`CrawlRequest`, `CrawlResult`, etc.).

### Adapter (`adapter.py`)
Configuration adapter that maps declarative JSON configs to Crawl4AI `BrowserConfig` and `CrawlerRunConfig` objects.

### Parity (`parity.py`)
Ensures that all public fields in the pinned Crawl4AI release are representable through ds4-studio's configuration system.

---

## Client Integration

The crawl service is consumed by:

- **Node.js CrawlClient** (`crawlClient.mjs`) — HTTP client with retry logic
- **CrawlSummarizer** (`crawlSummarizer.mjs`) — summarizes crawl manifests for the agent
- **C CLI** — direct HTTP calls from `ds4_agent.c` and `ds4_crawl_grounding.c`
- **Frontend** — proxy endpoints in `index.mjs` for browser-based access

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `app.py` | 5,418 | FastAPI application and routes |
| `runner.py` | 10,559 | Crawl job runner and lifecycle management |
| `repository.py` | 5,961 | SQLite persistence layer |
| `artifacts.py` | 3,029 | Content-addressed artifact storage |
| `plugins.py` | 2,640 | Local Python plugin extensions |
| `serialize.py` | 2,373 | Result serialization |
| `sessions.py` | 726 | Browser session management |
| `auth.py` | 691 | Bearer token authentication |
| `settings.py` | 1,977 | Configuration loading |
| `models.py` | 723 | Pydantic request/response models |
| `adapter.py` | 4,790 | Config adapter for Crawl4AI objects |
| `parity.py` | 831 | Parity validation for Crawl4AI fields |
| `previews.py` | 671 | Preview generation from artifacts |
| `cli.py` | 1,453 | CLI entrypoint for the service |
