## Benchmarking

Run `ds4-bench` as in the main example:

```
./ds4-bench \
  -m ds4flash.gguf \
  --prompt-file bench/promessi_sposi.txt \
  --ctx-start 2048 \
  --ctx-max 65536 \
  --step-incr 2048 \
  --gen-tokens 128
```
```
ds4-bench: context buffers 1933.10 MiB (ctx=65665, backend=metal, prefill_chunk=2048, raw_kv_rows=2304, compressed_kv_rows=16418)
ds4: Metal device Apple M4 Max, 128.00 GiB RAM
ds4: requesting Metal residency (may take tens of seconds)... done
ds4: warming Metal model views... done
ds4: Metal model views created in 2.262 ms, residency requested in 27390.486 ms, warmup 3.940 ms (mapped 82697.67 MiB from offset 5.08 MiB)
ds4: Metal mapped mmaped model as 2 overlapping shared buffers
ds4: metal backend initialized for graph diagnostics
```

See the output CSV file `benchmarks_results` folder.
