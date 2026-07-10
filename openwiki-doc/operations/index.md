# Operations: Configuration & Profiles

This page documents the configuration system, profile management, and environment variables used by DS4 Studio.

---

## Configuration File

The primary configuration file is `frontend/ds4-ui.config.json`. It is loaded by the Node.js backend on startup and can be modified at runtime through the UI settings panel.

### Configuration Sections

| Section | Description |
|---------|-------------|
| `control` | UI host and port |
| `history` | Conversation history directory and enabled flag |
| `server` | Inference engine settings (binary, model, context, GPU env) |
| `wrapper` | Session wrapper settings (mode, freeze, timeout) |
| `requestDefaults` | Default request parameters (max_tokens, temperature, etc.) |
| `research` | Research provider configuration (API keys, engines) |
| `toolBlobs` | Tool blob storage settings |
| `crawl` | Crawl service host and port |
| `callDebug` | Call debug recording settings |
| `selectedProfile` | Active profile name |

### Server Configuration (`config.server`)

Key server fields:

| Field | Default | Description |
|-------|---------|-------------|
| `binary` | `./ds4-server` | Path to inference engine binary |
| `model` | `ds4flash.gguf` | Path to GGUF model file |
| `ctx` | `32768` | Context size in tokens |
| `tokens` | `8192` | Max output tokens |
| `backend` | `auto` | GPU backend selection |
| `quality` | `false` | Quality decode mode |
| `kvDiskDir` | — | Directory for disk-based KV cache |
| `kvDiskSpaceMb` | `4096` | Disk KV cache size limit |
| `env` | — | GPU environment variables (DS4_CUDA_*, DS4_METAL_*) |

### Wrapper Configuration (`config.wrapper`)

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable session wrapper |
| `startupMode` | `server` | Initial mode (server or agent) |
| `freezeOnSwitch` | `true` | Freeze session on mode switch |
| `ramFreezeMaxMb` | `4096` | Max RAM for frozen sessions |
| `modeSwitchTimeoutMs` | `120000` | Mode switch timeout |

---

## Profile System (`profileLoader.mjs`)

Profiles allow switching between named configurations. Each profile is a JSON file in a profiles directory that can override any config field.

### API

| Endpoint | Description |
|----------|-------------|
| `GET /api/profiles` | List available profiles |
| `GET /api/profiles/:name` | Load a specific profile |
| `POST /api/profiles/select` | Select and apply a profile |
| `GET /api/profiles/default` | Get the default profile |

The profile system supports:
- `buildProfileCandidate` — merge profile overrides with base config
- `loadProfileOrDefault` — load named profile or return default
- Profile fields can override `server`, `requestDefaults`, `research`, and `toolBlobs` sections

---

## Environment Variables

Key environment variables that can be set in `frontend/.env` or the shell:

| Variable | Purpose |
|----------|---------|
| `TAVILY_API_KEY` | Tavily search API key |
| `SERPAPI_KEY` | SerpAPI search key |
| `GOOGLE_API_KEY` | Google Custom Search / Gemini API key |
| `DS4_UI_HOST` | Override UI host |
| `DS4_UI_PORT` | Override UI port |
| `DS4_AGENT_SANDBOX` | Set to `0` to disable workspace sandbox |
| `DS4_SERVER_FAST_FULL` | ROCm performance preset |
| `DS4_SERVER_PERFLEVEL` | ROCm performance level |
| `ROCM_ARCH` | ROCm GPU architecture target |

---

## Request Defaults

Default request parameters that can be set in config or overridden per request:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_tokens` | `auto` | Output token budget (`auto` = until EOS/context limit) |
| `max_tokens_safety_cap` | `32768` | Hard cap when using `auto` |
| `context_margin` | `1024` | Context window margin |
| `temperature` | `0` | Sampling temperature |
| `top_p` | `1` | Nucleus sampling threshold |
| `min_p` | `0.05` | Minimum probability threshold |
| `seed` | `42` | Random seed for reproducibility |

---

## Source Files

| File | Lines | Description |
|------|-------|-------------|
| `frontend/ds4-ui.config.json` | 8,358 | Primary configuration file |
| `frontend/server/config.mjs` | 17,083 | Config loading, validation, saving |
| `frontend/server/defaultConfig.mjs` | 4,125 | Default configuration values |
| `frontend/server/profileLoader.mjs` | 5,327 | Named profile management |
| `frontend/.env.example` | 1,089 | Example environment file |
| `frontend/server/requestPayload.mjs` | 4,167 | Request payload building and defaults |
| `frontend/server/costLimits.mjs` | 2,851 | Budget tracking and enforcement |
