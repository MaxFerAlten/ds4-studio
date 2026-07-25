# Upstream Provenance

## Agno AgentOS

| Field | Value |
|-------|-------|
| Upstream | [agno-agi/agno](https://github.com/agno-agi/agno) |
| Pinned version | 2.8.0 |
| License | Apache-2.0 |
| Integration type | External Python sidecar using public Python API |
| Source copied | No (only public API consumed via `agno` package) |

## How it is used

The `ds4-agno-service` Python sidecar depends on the `agno` package (PyPI) and uses only its public API:

- `agno.agent.Agent` — agent definition and `arun()` streaming interface
- `agno.model.openai_like.OpenAILike` — model adapter pointing to DS4's OpenAI-compatible gateway
- `agno.event RunnerEvent` — event stream types for SSE forwarding

No source code from the `agno` repository has been copied into this project. All interaction is through the installed package's public interface.

## Pinned dependencies

```
agno[os,sqlite,openai]==2.8.0
```

Full dependency lock: `agno_service/requirements.lock`
