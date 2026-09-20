#!/usr/bin/env python3
"""test_vision_models.py - every vision-capable model must actually see an image.

The models are not listed here: srun's own recommender (scripts/srun_model_scan)
pairs each model in the models directory with its vision encoder, exactly as a
launch would, so a model added later is covered without touching this file.
Each one is started through ds4-wrapper with srun's settings (context reduced
to keep the run short), shown upstream's "photo" fixture (NASA's Apollo 17
Earth, tests/vision-fixtures/glm53) and must name every fact cases.json
requires for it: a generic description cannot pass.

A reply that merely comes back is not enough: V4.1 on ROCm once encoded the
image, filled the prompt and answered that no image had been sent. Needs the
GPU and the models; one model at a time, a few minutes each.

    tests/test_vision_models.py                 # every vision model
    tests/test_vision_models.py --only V4.1     # names containing V4.1
    tests/test_vision_models.py --list          # what would run
"""
import argparse
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import srun_model_scan as scan  # noqa: E402

# DS4_MODELS_DIR, else server.modelsDir of the UI config: the directory srun scans.
MODELS_DIR = scan.configured_models_dir()
FIXTURES = ROOT / "tests" / "vision-fixtures" / "glm53"
PORT = int(os.environ.get("DS4_TEST_PORT", "8012"))
ENDPOINT = os.environ.get("DS4_TEST_ENDPOINT", "http://127.0.0.1:8731/v1")
TEST_CTX = 32768


def vision_models():
    """(name, settings) for every model srun would launch with a vision encoder."""
    models = scan.scan(MODELS_DIR)
    obs = scan.load_observations()
    out = []
    for m in models:
        if m.kind != "target" or scan.unsupported_reason(m):
            continue
        rec = scan.recommend(m, models, obs, want_vision=True)
        s = rec.get("settings", {})
        if rec.get("blocked") or not s.get("server.vision"):
            continue
        out.append((m.path.name, s))
    return out


def wrapper_args(s, kv_dir):
    """The subset of frontend/server/commandBuilder.mjs a recommendation sets."""
    args = ["--model", s["server.model"], "--vision", s["server.vision"]]
    if s.get("server.mtp"):
        args += ["--mtp", s["server.mtp"]]
    if s.get("server.dspark"):
        args.append("--dspark")
    args += ["--ctx", str(TEST_CTX), "--tokens", "256"]
    if s.get("server.ssdStreaming"):
        args.append("--ssd-streaming")
    if s.get("server.ssdStreamingCacheExperts"):
        args += ["--ssd-streaming-cache-experts", str(s["server.ssdStreamingCacheExperts"])]
    if s.get("server.power"):
        args += ["--power", str(s["server.power"])]
    return args + ["--host", "127.0.0.1", "--port", str(PORT), "--kv-disk-dir", kv_dir]


def http_json(url, body=None, timeout=1200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fixture(name):
    """One case from upstream's cases.json: image, prompt and required facts."""
    cases = json.loads((FIXTURES / "cases.json").read_text())
    return next(c for c in cases if c["name"] == name)


CASE = fixture(os.environ.get("DS4_TEST_CASE", "photo"))


def ask(base, model=None, endpoint=False):
    path = FIXTURES / CASE["image"]
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    img = base64.b64encode(path.read_bytes()).decode()
    body = {
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": CASE["prompt"]},
            {"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (mime, img)}}]}],
        "max_tokens": 200, "temperature": 0, "seed": 42,
    }
    if model:
        body["model"] = model
    # ds4 takes `think`; the OpenAI-style endpoint takes `enable_thinking`.
    body["enable_thinking" if endpoint else "think"] = False
    try:
        d = http_json(base + "/chat/completions", body)
    except urllib.error.HTTPError as e:
        return "HTTP %d: %s" % (e.code, e.read().decode(errors="replace")[:300])
    if "error" in d:
        return "error: %s" % d["error"]
    return d["choices"][0]["message"].get("content") or ""


def verdict(name, reply):
    """Every required fact present; a list entry means any one of its spellings."""
    text = reply.lower()
    missing = [r for r in CASE["required"]
               if not any(alt in text for alt in (r if isinstance(r, list) else [r]))]
    print("%s %s%s\n     %s" % ("FAIL" if missing else "ok  ", name,
          "  (missing: %s)" % ", ".join(map(str, missing)) if missing else "",
          " ".join(reply.split())[:300]))
    return not missing


def run_model(name, s, binary):
    tmp = tempfile.mkdtemp(prefix="ds4-vision-test-")
    log = Path(tmp) / "wrapper.log"
    proc = subprocess.Popen([binary, *wrapper_args(s, str(Path(tmp) / "kv"))],
                            cwd=ROOT, stdout=log.open("w"), stderr=subprocess.STDOUT)
    try:
        base = "http://127.0.0.1:%d" % PORT
        deadline = time.time() + 900
        while True:
            if proc.poll() is not None:
                print("FAIL %s\n     wrapper exited %s:\n%s" % (
                    name, proc.returncode, "".join(log.read_text(errors="replace").splitlines(True)[-8:])))
                return False
            try:
                http_json(base + "/v1/models", timeout=5)
                break
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                if time.time() > deadline:
                    print("FAIL %s\n     not ready after 15 minutes" % name)
                    return False
                time.sleep(2)
        return verdict(name, ask(base + "/v1"))
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=120)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        shutil.rmtree(tmp, ignore_errors=True)


def run_endpoint():
    """An attached OpenAI-compatible endpoint (Halogen); skipped when down."""
    try:
        ids = [m["id"] for m in http_json(ENDPOINT + "/models", timeout=5).get("data", [])]
    except (urllib.error.URLError, ConnectionError, TimeoutError, ValueError):
        print("skip endpoint %s (not reachable)" % ENDPOINT)
        return None
    if not ids:
        print("FAIL endpoint %s advertises no model" % ENDPOINT)
        return False
    return verdict("endpoint %s (%s)" % (ENDPOINT, ids[0]), ask(ENDPOINT, ids[0], endpoint=True))


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--only", help="run models whose file name contains this")
    p.add_argument("--list", action="store_true", help="print the models and exit")
    p.add_argument("--no-endpoint", action="store_true", help="skip the attached endpoint")
    p.add_argument("--binary", default=os.environ.get("DS4_TEST_BIN", str(ROOT / "ds4-wrapper")))
    a = p.parse_args()

    if MODELS_DIR is None or not MODELS_DIR.is_dir():
        print("FAIL no models directory%s: set server.modelsDir (srun --models-dir) "
              "or DS4_MODELS_DIR" % (" at %s" % MODELS_DIR if MODELS_DIR else ""))
        return 1
    todo = [(n, s) for n, s in vision_models() if not a.only or a.only in n]
    if a.list:
        for n, s in todo:
            print("%s\n    vision=%s ssd=%s cache=%s" % (n, Path(s["server.vision"]).name,
                  s.get("server.ssdStreaming"), s.get("server.ssdStreamingCacheExperts")))
        return 0
    if not todo:
        print("FAIL no vision model%s in %s" % (
            " matching %r" % a.only if a.only else "", MODELS_DIR))
        return 1

    results = [run_model(n, s, a.binary) for n, s in todo]
    if not a.no_endpoint and not a.only:
        r = run_endpoint()
        if r is not None:
            results.append(r)
    print("\ntest_vision_models: %d/%d %s" % (sum(results), len(results),
          "PASS" if all(results) else "FAIL"))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
