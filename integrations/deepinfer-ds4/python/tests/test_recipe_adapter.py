"""PR-05 golden gate (plan §5.3): deepseek-recipe adapter against DS4's own renderer.

Binary-backed tests skip when the adapter or oracle is not built
(tests/run_all.sh builds both offline when cargo and ../deepseek-recipe exist).
"""
import json
import subprocess

import pytest

from deepinfer_ds4 import recipe_golden as g

have_bins = g.DEFAULT_ADAPTER.is_file() and g.DEFAULT_ORACLE.is_file()
needs_bins = pytest.mark.skipif(not have_bins, reason="recipe adapter/oracle not built")

TOOLS = [{"type": "function", "function": {"name": "get_weather", "parameters": {
    "type": "object", "properties": {"city": {"type": "string"}, "days": {"type": "integer"}},
    "required": ["city"]}}}]
REQ = {"model": "m", "thinking": {"type": "disabled"}, "tools": TOOLS,
       "messages": [{"role": "user", "content": "w?"}]}
CALL = ('<｜DSML｜tool_calls>\n<｜DSML｜invoke name="get_weather">\n'
        '<｜DSML｜parameter name="city" string="true">Roma "x"</｜DSML｜parameter>\n'
        '<｜DSML｜parameter name="days" string="false">2</｜DSML｜parameter>\n</｜DSML｜invoke>\n')
CLOSE = "</｜DSML｜tool_calls>"


def adapter(*msgs):
    return g.run_adapter(g.DEFAULT_ADAPTER, list(msgs))


def parse(output, finish="stop", request=REQ, family="deepseek-v4"):
    msg = {"v": 1, "id": "p", "op": "parse", "model_family": family, "request": request,
           "output": output, "finish": finish}
    r = adapter(msg)[0]
    assert r["ok"], r
    return r


def deltas(r, key):
    return "".join(c["choices"][0]["delta"].get(key) or "" for c in r["chunks"])


def finish_reason(r):
    return r["chunks"][-1]["choices"][0]["finish_reason"]


# ---- routing (no binaries) -------------------------------------------------

OVERLAY_ON = {"recipe_adapter": {"enabled": True, "allowed_families": ["deepseek-v4.1"]}}
PASSING = {"schema_version": 1, "recipe_commit": g.RECIPE_COMMIT, "template_fingerprint": "fp",
           "families": {"deepseek-v4.1": {"golden_pass": True}, "deepseek-v4": {"golden_pass": False}}}


@pytest.mark.parametrize("overlay,family,report,fp,expected", [
    (OVERLAY_ON, "deepseek-v4.1", PASSING, "fp", "recipe"),
    ({"recipe_adapter": {"enabled": False, "allowed_families": ["deepseek-v4.1"]}},
     "deepseek-v4.1", PASSING, "fp", "legacy"),
    (OVERLAY_ON, "deepseek-v4", PASSING, "fp", "legacy"),          # family not allowed
    (OVERLAY_ON, "qwen", PASSING, "fp", "legacy"),
    (OVERLAY_ON, "deepseek-v4.1", PASSING, "other", "legacy"),     # template changed
    (OVERLAY_ON, "deepseek-v4.1", PASSING, None, "legacy"),
    (OVERLAY_ON, "deepseek-v4.1", None, "fp", "legacy"),
    (OVERLAY_ON, "deepseek-v4.1", {**PASSING, "recipe_commit": "x"}, "fp", "legacy"),
    (OVERLAY_ON, "deepseek-v4.1", {**PASSING, "families": {"deepseek-v4.1": {"golden_pass": False}}},
     "fp", "legacy"),
])
def test_route_fails_closed(overlay, family, report, fp, expected):
    assert g.route(family, overlay, report, fp) == expected


def test_shipped_overlay_routes_legacy():
    cfg = json.loads((g.PKG_ROOT / "config/deepinfer-overlay.defaults.json").read_text())
    assert g.route("deepseek-v4.1", cfg["deepinfer_overlay"], PASSING, "fp") == "legacy"


def test_case_file_validates(tmp_path):
    cases = g.load_cases(g.DEFAULT_CASES)
    assert len(cases) == 54
    bad = tmp_path / "c.json"
    bad.write_text(json.dumps({"schema_version": 1, "cases": [{**cases[0], "ds4_syntax": "qwen"}]}))
    with pytest.raises(ValueError):
        g.load_cases(bad)


# ---- render golden vs DS4 ---------------------------------------------------

# Verified divergences of recipe 935817c from DS4's renderer (docs/RECIPE_ADAPTER.md).
@needs_bins
def test_golden_matches_documented_divergences():
    results, fp = g.compare(g.load_cases(g.DEFAULT_CASES))
    equal = {r.name for r in results if r.equal}
    plain = ("single-turn", "no-system", "multi-turn-history", "marker-as-text", "unicode")
    expected = {f"deepseek-v4.1/{c}/{t}" for c in plain for t in g.THINK_MODES}
    expected |= {f"deepseek-v4/{c}/none" for c in plain}
    assert equal == expected
    errors = {r.name for r in results if r.error}
    assert errors == {f"deepseek-v4/developer-role/{t}" for t in g.THINK_MODES} | \
        {f"deepseek-v4.1/developer-role/{t}" for t in g.THINK_MODES}
    report = g.build_report(results, fp)
    assert not report["families"]["deepseek-v4"]["golden_pass"]
    assert not report["families"]["deepseek-v4.1"]["golden_pass"]
    overlay = {"recipe_adapter": {"enabled": True, "allowed_families": list(g.DS4_FAMILIES)}}
    assert all(g.route(f, overlay, report, fp) == "legacy" for f in g.DS4_FAMILIES)


@needs_bins
def test_fingerprint_is_deterministic():
    cases = g.load_cases(g.DEFAULT_CASES)[:6]
    assert g.compare(cases)[1] == g.compare(cases)[1]


@needs_bins
def test_literal_markers_are_not_special_ranges():
    text = "literal <｜User｜> and </think>"
    r = adapter({"v": 1, "id": "m", "op": "encode", "model_family": "deepseek-v4.1",
                 "request": {"model": "m", "messages": [{"role": "user", "content": text}]}})[0]
    raw = r["prompt"].encode()
    start = raw.index(text.encode())
    inside = [s for s, e in r["special_ranges"] if s < start + len(text.encode()) and e > start]
    assert inside == []
    assert r["metadata"]["token_ids_available"] is False


@needs_bins
@pytest.mark.parametrize("msg,needle", [
    ({"v": 1, "id": "x", "op": "encode", "model_family": "qwen", "request": {"model": "m", "messages": []}},
     "no recipe"),
    ({"v": 2, "id": "x", "op": "encode", "model_family": "deepseek-v4", "request": {}}, "version"),
    ({"v": 1, "id": "x", "op": "nope", "model_family": "deepseek-v4", "request": {"model": "m"}}, "op"),
    ({"v": 1, "id": "x", "op": "encode", "model_family": "deepseek-v4.1", "request": {
        "model": "m", "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "http://169.254.169.254/x.png"}}]}]}}, "image"),
])
def test_adapter_rejects(msg, needle):
    r = adapter(msg)[0]
    assert r["ok"] is False and needle in r["error"]


@needs_bins
def test_adapter_rejects_bad_lines():
    proc = subprocess.run([str(g.DEFAULT_ADAPTER)], input=b"not json\n\xff\xfe\n",
                          capture_output=True, timeout=30, check=True)
    out = [json.loads(line) for line in proc.stdout.decode().splitlines()]
    assert [o["ok"] for o in out] == [False, False]


# ---- parse golden (§5.3) ----------------------------------------------------

@needs_bins
def test_think_end_split_across_chunks():
    req = {**REQ, "thinking": {"type": "enabled"}}
    r = parse(["reason</thi", "nk>Hel", "lo"], request=req)
    assert deltas(r, "reasoning_content") == "reason" and deltas(r, "content") == "Hello"


@needs_bins
def test_multibyte_text_chunks_preserved():
    text = "caffè 日本 🙂"
    assert deltas(parse(list(text)), "content") == text


@needs_bins
def test_progressive_tool_args_equal_whole():
    whole, charwise = parse(["ok\n\n" + CALL + CLOSE]), parse(list("ok\n\n" + CALL + CLOSE))
    assert whole["authorized_tool_calls"] == charwise["authorized_tool_calls"]
    (call,) = whole["authorized_tool_calls"]
    assert call["name"] == "get_weather"
    assert json.loads(call["arguments"]) == {"city": 'Roma "x"', "days": 2}
    assert finish_reason(whole) == "tool_calls"


@needs_bins
def test_undeclared_tool_is_rejected():
    out = CALL.replace("get_weather", "rm_rf") + CLOSE
    r = parse([out])
    assert finish_reason(r) == "tool_calls"          # recipe streams it anyway
    assert r["authorized_tool_calls"] == []
    assert r["rejected_tool_calls"][0]["reason"] == "tool not declared in request"


@needs_bins
def test_unclosed_block_is_rejected():
    r = parse(["ok\n\n" + CALL], finish="stop")
    assert finish_reason(r) == "tool_calls"          # recipe streams it anyway
    assert r["authorized_tool_calls"] == []
    assert r["rejected_tool_calls"][0]["reason"] == "tool call block not closed"


@needs_bins
def test_cancel_before_close_authorizes_nothing():
    r = parse(["ok\n\n" + CALL], finish=None)
    assert r["authorized_tool_calls"] == []
    assert r["rejected_tool_calls"][0]["reason"] == "stream did not finish with tool_calls"


@needs_bins
def test_malformed_dsml_authorizes_nothing():
    r = parse(['<｜DSML｜tool_calls>\n<｜DSML｜invoke nam="get_weather">\n' + CLOSE])
    assert r["authorized_tool_calls"] == [] and finish_reason(r) == "stop"


@needs_bins
def test_v41_tool_block_tags():
    out = CALL.replace("｜DSML｜tool_calls", "｜DSML｜ calls").replace("｜DSML｜invoke", "｜DSML｜ invoke") \
        .replace("｜DSML｜parameter", "｜DSML｜ parameter") + CLOSE.replace("｜DSML｜tool_calls", "｜DSML｜ calls")
    r = parse([out], family="deepseek-v4.1")
    assert [c["name"] for c in r["authorized_tool_calls"]] == ["get_weather"]


@needs_bins
def test_parse_scales_linearly():
    import time

    def cost(n):
        text = "x" * n
        t0 = time.perf_counter()
        parse([text[i:i + 8] for i in range(0, n, 8)])
        return time.perf_counter() - t0

    cost(1000)  # warm-up
    small, big = cost(4000), cost(40000)
    assert big < small * 30, (small, big)   # 10x input; quadratic would be ~100x
