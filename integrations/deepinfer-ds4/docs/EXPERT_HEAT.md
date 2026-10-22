# MoE expert hotness — sola telemetria (piano §9, PR-10)

DeepInfer EPLB ridistribuisce esperti fra GPU: inutile su una singola APU. Qui resta
solo la misura della distribuzione del routing. Nessun cambio runtime, nessuna
duplicazione di pesi.

## Cosa produce DS4

| Uscita | Attivazione | Writer | Contenuto |
|---|---|---|---|
| hotlist v1 (testo) | `DS4_EXPERT_HOTLIST=FILE` | `ds4.c:1841-1903` | istogramma completo `layer expert hits weight` |
| locality profile (JSON) | `--expert-profile FILE` (`ds4_bench.c:306`) o `DS4_EXPERT_PROFILE` | `ds4.c:1906-1960`, layer `ds4.c:1765-1839` | top-16 per layer, overlap fra token adiacenti, hit rate di cache LRU simulate (n = 1..384, `ds4.c:1524`) |

**Limite bloccante su Strix Halo:** il profiler si attiva solo con backend Metal
(`ds4.c:72002`); su ROCm stampa `expert profile/hotlist is Metal-only for now` e
non registra nulla. La cattura su questo device richiede un hook upstream
(patch a `ds4.c`, fuori dal perimetro di questa integrazione).

Le hotlist di streaming incluse (`ds4_streaming_hotlist*.inc`) sono "generated from
ds4 expert hotlist profiles" (header del file): stesso formato, già usate da DS4
per il preload in SSD streaming.

## Analisi offline

```bash
PYTHONPATH=integrations/deepinfer-ds4/python python3 -m deepinfer_ds4 expert-heat \
  --hotlist hot-prompt-a.txt [--compare hot-prompt-b.txt] [--top 16]
```

Per layer: selezioni, esperti attivi, quota top-N, Gini, entropia (bit), numero di
esperti che coprono 50/90/99% delle selezioni. Con `--compare`: Jaccard dei top-N e
Spearman fra due carichi. Il parser è fail-closed (header, conteggi, righe duplicate
o mancanti, somma delle hit). `parse_profile_json` riassume il profilo JSON (solo top-16).

## Conclusioni ammesse

- Modello residente (caso Strix Halo 128 GB): tutti gli esperti sono già in memoria,
  quindi la hotness **non** giustifica prefetch o duplicazione.
- Solo con `--ssd-streaming` misurato (miss rate della cache esperti, latenza) una
  hotlist specifica del carico può valere un esperimento, confrontando
  `--ssd-streaming-cache-experts` con la hotlist di default. Prima serve la cattura su ROCm.
