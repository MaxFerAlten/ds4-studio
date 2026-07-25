# DS4-Agno Service

Agno AgentOS sidecar supervised by DS4-Studio.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pip freeze > requirements.lock
```

## Test

```bash
.venv/bin/pytest tests/
```

## Run

```bash
.venv/bin/ds4-agno-service
```

## Upstream

See [UPSTREAM_PROVENANCE.md](UPSTREAM_PROVENANCE.md) for full provenance details.

- Agno version: 2.8.0
- License: Apache-2.0
- Integration: external sidecar using public Python API only
