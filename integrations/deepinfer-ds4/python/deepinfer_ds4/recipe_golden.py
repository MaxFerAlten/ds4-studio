# Part of DS4-Studio DeepInfer integration (plan §5, PR-05: recipe adapter golden gate).
"""Golden comparison between deepseek-recipe and DS4's legacy prompt renderer.

Routing rule (plan §5.2): a family uses the recipe adapter only when the overlay
flag is on, the family is allowed, and every golden case of that family renders
byte-identical to DS4 under the current template fingerprint. Any mismatch,
missing binary, or stale report falls back to the legacy adapter.

The template fingerprint is the SHA-256 of the DS4 oracle outputs over the whole
corpus, so it changes exactly when DS4's rendering of the corpus changes.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
from dataclasses import dataclass

REPORT_SCHEMA_VERSION = 1
RECIPE_COMMIT = "935817c66f5d6e64838f419692545f06787e485f"
DS4_FAMILIES = {"deepseek-v4": "deepseek", "deepseek-v4.1": "deepseek41"}
THINK_MODES = ("none", "high", "max")
TIMEOUT_S = 60

PKG_ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_ADAPTER = PKG_ROOT / "recipe-adapter/target/debug/ds4di-recipe-adapter"
DEFAULT_ORACLE = PKG_ROOT / "recipe-adapter/oracle/build/ds4_render_oracle"
DEFAULT_CASES = PKG_ROOT / "recipe-adapter/golden/render_cases.json"


@dataclass(frozen=True)
class CaseResult:
    name: str
    model_family: str
    equal: bool
    first_diff: int | None    # byte offset of the first difference (UTF-8)
    error: str | None


def load_cases(path: pathlib.Path) -> list[dict]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("schema_version") != 1 or not isinstance(doc.get("cases"), list):
        raise ValueError("unsupported golden case file")
    names = set()
    for c in doc["cases"]:
        fam = c.get("model_family")
        if fam not in DS4_FAMILIES or c.get("ds4_syntax") != DS4_FAMILIES[fam]:
            raise ValueError(f"case {c.get('name')!r}: unknown family/syntax pair")
        if c.get("think") not in THINK_MODES or not isinstance(c.get("request"), dict):
            raise ValueError(f"case {c.get('name')!r}: bad think mode or request")
        if c["name"] in names:
            raise ValueError(f"duplicate case {c['name']!r}")
        names.add(c["name"])
    return doc["cases"]


def run_adapter(adapter: pathlib.Path, messages: list[dict]) -> list[dict]:
    """One adapter process for the whole batch; responses are matched by id."""
    payload = "".join(json.dumps(m, ensure_ascii=False) + "\n" for m in messages)
    proc = subprocess.run([str(adapter)], input=payload.encode(), capture_output=True,
                          timeout=TIMEOUT_S, check=True)
    out = [json.loads(line) for line in proc.stdout.decode().splitlines() if line.strip()]
    if [r.get("id") for r in out] != [m["id"] for m in messages]:
        raise RuntimeError("adapter responses do not match requests")
    return out


def run_oracle(oracle: pathlib.Path, syntax: str, think: str, request: dict) -> bytes:
    proc = subprocess.run([str(oracle), syntax, think],
                          input=json.dumps(request, ensure_ascii=False).encode(),
                          capture_output=True, timeout=TIMEOUT_S)
    if proc.returncode != 0:
        raise RuntimeError(f"oracle failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout


def _first_diff(a: bytes, b: bytes) -> int | None:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return None if len(a) == len(b) else min(len(a), len(b))


def compare(cases: list[dict], adapter: pathlib.Path = DEFAULT_ADAPTER,
            oracle: pathlib.Path = DEFAULT_ORACLE) -> tuple[list[CaseResult], str]:
    msgs = [{"v": 1, "id": str(i), "op": "encode", "model_family": c["model_family"],
             "request": c["request"]} for i, c in enumerate(cases)]
    responses = run_adapter(adapter, msgs)
    fp = hashlib.sha256()
    results = []
    for c, r in zip(cases, responses):
        ds4 = run_oracle(oracle, c["ds4_syntax"], c["think"], c["request"])
        fp.update(c["name"].encode() + b"\0" + hashlib.sha256(ds4).digest())
        if not r.get("ok"):
            results.append(CaseResult(c["name"], c["model_family"], False, None, r.get("error")))
            continue
        recipe = r["prompt"].encode()
        diff = _first_diff(recipe, ds4)
        results.append(CaseResult(c["name"], c["model_family"], diff is None, diff, None))
    return results, fp.hexdigest()


def build_report(results: list[CaseResult], template_fingerprint: str) -> dict:
    families = {}
    for fam in DS4_FAMILIES:
        rs = [r for r in results if r.model_family == fam]
        families[fam] = {"cases": len(rs), "equal": sum(r.equal for r in rs),
                         "golden_pass": bool(rs) and all(r.equal for r in rs)}
    return {"schema_version": REPORT_SCHEMA_VERSION, "recipe_commit": RECIPE_COMMIT,
            "template_fingerprint": template_fingerprint, "families": families,
            "cases": [r.__dict__ for r in results]}


def route(model_family: str, overlay: dict, report: dict | None,
          current_fingerprint: str | None) -> str:
    """Return "recipe" or "legacy". Fail closed on anything unverified.

    `overlay` is the `deepinfer_overlay` object of the overlay config.
    """
    cfg = overlay.get("recipe_adapter", {})
    if not cfg.get("enabled") or model_family not in cfg.get("allowed_families", []):
        return "legacy"
    if (not report or report.get("schema_version") != REPORT_SCHEMA_VERSION
            or report.get("recipe_commit") != RECIPE_COMMIT
            or current_fingerprint is None
            or report.get("template_fingerprint") != current_fingerprint):
        return "legacy"
    fam = report.get("families", {}).get(model_family, {})
    return "recipe" if fam.get("golden_pass") is True else "legacy"
