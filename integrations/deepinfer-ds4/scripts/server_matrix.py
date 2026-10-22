#!/usr/bin/env python3
# Part of DS4-Studio DeepInfer integration (Gate 0 server leg).
"""Run a workload against ds4-server under several configurations.

Each (configuration, round) gets a fresh ds4-server process, in a seeded random
order, so load order and thermal drift spread across configurations. Config
file: same format as bench_matrix.sh (NAME, then KEY=VALUE env words, then
server arguments). Every run writes runs/<config>/<round>.jsonl (one record per
request) and <round>.err (server stderr, read by dspark_log).

Client-side timing on the streamed Chat Completions response:
- ttft_ms: request sent -> first content or reasoning delta;
- decode_tps: (completion_tokens - 1) / (last delta - first delta).
Prompt text never goes to the records; only scenario names and numbers.

usage: server_matrix.py --configs F --workload W --out DIR --server ./ds4-server
                         [--rounds 7] [--seed 1] [--port 8010] -- SERVER_ARGS...
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import pathlib
import random
import re
import signal
import subprocess
import sys
import time

ENV_WORD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def parse_configs(path):
    configs = []
    for line in pathlib.Path(path).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, *words = line.split()
        env, args = {}, []
        for w in words:
            if not args and ENV_WORD.match(w):
                k, v = w.split("=", 1)
                env[k] = v
            else:
                args.append(w)
        configs.append((name, env, args))
    if len({c[0] for c in configs}) != len(configs):
        raise SystemExit("server_matrix: duplicate configuration names")
    return configs


def wait_ready(port, proc, timeout_s=900):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout_s:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited with {proc.returncode} during load")
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
            c.request("GET", "/v1/models")
            if c.getresponse().status == 200:
                return time.monotonic() - t0
        except OSError:
            pass
        time.sleep(2)
    raise RuntimeError("server did not become ready")


def stream_chat(port, body, timeout_s=1800):
    body = {**body, "model": "deepseek-v4-flash", "stream": True,
            "stream_options": {"include_usage": True}}
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout_s)
    t_send = time.monotonic()
    c.request("POST", "/v1/chat/completions", json.dumps(body, ensure_ascii=False).encode(),
              {"content-type": "application/json"})
    resp = c.getresponse()
    if resp.status != 200:
        raise RuntimeError(f"HTTP {resp.status}: {resp.read()[:300]!r}")
    first = last = None
    usage, finish, content, reasoning, tool_calls = None, None, [], [], 0
    for raw in resp:
        line = raw.decode().strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        ev = json.loads(data)
        if ev.get("usage"):
            usage = ev["usage"]
        for ch in ev.get("choices", []):
            d = ch.get("delta", {})
            piece = (d.get("content") or "") + (d.get("reasoning_content") or "")
            if piece or d.get("tool_calls"):
                now = time.monotonic()
                first = first or now
                last = now
            content.append(d.get("content") or "")
            reasoning.append(d.get("reasoning_content") or "")
            tool_calls += len(d.get("tool_calls") or [])
            finish = ch.get("finish_reason") or finish
    if first is None or not usage:
        raise RuntimeError("stream produced no output or no usage")
    n = usage["completion_tokens"]
    return {
        "ttft_ms": (first - t_send) * 1000.0,
        "decode_tps": (n - 1) / (last - first) if n > 1 and last > first else None,
        "prompt_tokens": usage["prompt_tokens"], "completion_tokens": n,
        "finish_reason": finish, "tool_call_deltas": tool_calls,
        "content": "".join(content), "reasoning_chars": len("".join(reasoning)),
    }


def run_workload(port, workload, rnd, keep_content):
    for sc in workload["scenarios"]:
        n = sc.get("samples", 1)
        for i in range(n):
            body = json.loads(json.dumps(sc["request"]))
            if sc.get("nonce"):
                # Unique leading text defeats in-memory prefix reuse between runs.
                msgs = body["messages"]
                tag = f"[run {rnd}] "
                if msgs[0]["role"] == "system":
                    msgs[0]["content"] = tag + msgs[0]["content"]
                else:
                    msgs.insert(0, {"role": "system", "content": tag.strip()})
            if n > 1:
                body["seed"] = 1000 * rnd + i + 1
            rec = stream_chat(port, body)
            rec.update(scenario=sc["name"], sample=i)
            if not (keep_content or sc["name"] == "sample"):
                rec.pop("content")
            yield rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--configs", required=True)
    ap.add_argument("--workload", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--server", default="./ds4-server")
    ap.add_argument("--rounds", type=int, default=7)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--port", type=int, default=8010)
    ap.add_argument("--keep-content", action="store_true",
                    help="store generated text for every scenario (default: sample only)")
    ap.add_argument("server_args", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    server_args = a.server_args[1:] if a.server_args[:1] == ["--"] else a.server_args

    out = pathlib.Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"server_matrix: {out} is not empty")
    out.mkdir(parents=True, exist_ok=True)
    configs = parse_configs(a.configs)
    workload = json.loads(pathlib.Path(a.workload).read_text())
    order = [(c, r) for c in range(len(configs)) for r in range(1, a.rounds + 1)]
    random.Random(a.seed).shuffle(order)
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    model = next((server_args[i + 1] for i, w in enumerate(server_args[:-1]) if w in ("-m", "--model")), "")
    (out / "metadata.json").write_text(json.dumps({
        "schema_version": 1, "utc_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "git_sha_ds4": sha, "model_basename": os.path.basename(model), "rounds": a.rounds,
        "seed": a.seed, "configs": [c[0] for c in configs],
        "scenarios": [s["name"] for s in workload["scenarios"]]}, indent=1))

    failed = 0
    for idx, (ci, rnd) in enumerate(order, 1):
        name, env, args = configs[ci]
        d = out / "runs" / name
        d.mkdir(parents=True, exist_ok=True)
        print(f"server_matrix: [{idx}/{len(order)}] {name} round {rnd}", file=sys.stderr, flush=True)
        with open(d / f"{rnd}.err", "w") as err:
            proc = subprocess.Popen([a.server, *server_args, *args, "--port", str(a.port)],
                                    env={**os.environ, **env}, stdout=subprocess.DEVNULL, stderr=err)
            try:
                load_s = wait_ready(a.port, proc)
                with open(d / f"{rnd}.jsonl", "w") as f:
                    for rec in run_workload(a.port, workload, rnd, a.keep_content):
                        rec.update(config=name, round=rnd, load_s=load_s)
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                        f.flush()
            except Exception as e:  # recorded and counted; next run starts clean
                failed += 1
                print(f"server_matrix: {name} round {rnd} failed: {e}", file=sys.stderr, flush=True)
                (d / f"{rnd}.jsonl").unlink(missing_ok=True)
            finally:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=120)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
    print(f"server_matrix: done, {failed} failed run(s), results in {out}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
