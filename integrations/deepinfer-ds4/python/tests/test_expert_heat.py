"""expert_heat against the exact writer formats in ds4.c (hotlist v1: ds4.c:1874-1888;
profile JSON: ds4.c:1918-1937 and per layer ds4.c:1789-1838)."""
import json
import math
import subprocess
import sys
import pathlib

import pytest

from deepinfer_ds4 import expert_heat as eh

PKG = pathlib.Path(__file__).resolve().parents[1]


def hotlist_text(hist, model="deepseek4", records=10):
    layers, experts = len(hist), len(hist[0])
    rows = sorted(((c, il, e) for il, row in enumerate(hist) for e, c in enumerate(row)),
                  key=lambda t: (-t[0], t[1], t[2]))
    sel = sum(map(sum, hist))
    # Same header lines and "%u %u %llu %.17g" rows as ds4_expert_profile_write_hotlist_file.
    head = (f"# ds4 expert hotlist v1\n# model {model}\n# layers {layers}\n# experts {experts}\n"
            f"# layer_records {records}\n# selections {sel}\n# columns: layer expert hits weight\n")
    return head + "".join(f"{il} {e} {c} {c * 0.25:.17g}\n" for c, il, e in rows)


HIST = [[8, 0, 0, 0], [2, 2, 2, 2]]


def test_parse_and_layer_stats():
    h = eh.parse_hotlist(hotlist_text(HIST))
    assert (h.layers, h.experts, h.selections) == (2, 4, 16)
    hot, flat = (eh.layer_heat(h.hits[il], il, top_n=1) for il in range(2))
    assert hot.active_experts == 1 and hot.top_share == 1.0 and hot.entropy_bits == 0.0
    assert hot.gini == pytest.approx(0.75) and hot.experts_for_99 == 1
    assert flat.gini == 0.0 and flat.entropy_bits == pytest.approx(2.0)
    assert (flat.experts_for_50, flat.experts_for_90, flat.experts_for_99) == (2, 4, 4)


@pytest.mark.parametrize("mutate", [
    lambda t: t.replace("v1", "v2"),
    lambda t: t.replace("# selections 16", "# selections 17"),
    lambda t: t.replace("# layers 2", "# layers x"),
    lambda t: t + "0 0 1 0.25\n",
    lambda t: "\n".join(t.splitlines()[:-1]) + "\n",
    lambda t: t.replace("# model deepseek4\n", ""),
    lambda t: t.rstrip("\n") + " extra\n",
    lambda t: t.replace(" 0.5\n", " nan\n", 1),
])
def test_malformed_hotlists_fail_closed(mutate):
    with pytest.raises(ValueError):
        eh.parse_hotlist(mutate(hotlist_text(HIST)))


def test_compare_identical_and_disjoint():
    a = eh.parse_hotlist(hotlist_text([[5, 4, 0, 0]]))
    b = eh.parse_hotlist(hotlist_text([[0, 0, 4, 5]]))
    same = eh.compare(a, a, top_n=2)[0]
    assert same["top_jaccard"] == 1.0 and same["spearman"] == pytest.approx(1.0)
    diff = eh.compare(a, b, top_n=2)[0]
    assert diff["top_jaccard"] == 0.0 and diff["spearman"] < 0
    with pytest.raises(ValueError):
        eh.compare(a, eh.parse_hotlist(hotlist_text(HIST)))


def test_spearman_constant_is_none():
    assert eh.spearman([1, 1, 1], [1, 2, 3]) is None


def test_profile_json_summary():
    layer = {"layer": 0, "hash_router": False, "records": 4, "selections": 8, "unique_experts": 2,
             "avg_adjacent_overlap": 1.5, "avg_adjacent_jaccard": 0.6,
             "top_experts": [{"id": 1, "count": 6, "pct": 75.0, "weight": 1.5, "weight_pct": 70.0},
                             {"id": 3, "count": 2, "pct": 25.0, "weight": 0.5, "weight_pct": 30.0}],
             "cache": [{"n": 1, "hits": 3, "hit_rate": 0.375, "weighted_hit_rate": 0.4}]}
    doc = {"source": "ds4 Metal expert locality profile", "model": "deepseek4", "layers": 1,
           "experts": 4, "expert_used": 2, "layer_records": 4, "selections": 8, "cache_ns": [1],
           "cache_summary": [{"n": 1, "hits": 3, "selections": 8, "hit_rate": 0.375,
                              "weighted_hit_rate": 0.4}], "layers_detail": [layer]}
    s = eh.parse_profile_json(json.dumps(doc))
    assert s["per_layer"][0]["top16_pct"] == 100.0 and s["cache_summary"][0]["n"] == 1
    with pytest.raises(ValueError):
        eh.parse_profile_json(json.dumps({**doc, "source": "other"}))
    with pytest.raises(ValueError):
        eh.parse_profile_json(json.dumps({**doc, "layers": 2}))


def test_cli_expert_heat(tmp_path):
    a = tmp_path / "a.txt"
    a.write_text(hotlist_text(HIST))
    r = subprocess.run([sys.executable, "-m", "deepinfer_ds4", "expert-heat", "--hotlist", str(a),
                        "--compare", str(a), "--top", "2"], cwd=PKG, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["selections"] == 16 and len(out["per_layer"]) == 2
    assert all(c["top_jaccard"] == 1.0 for c in out["compare"])
    assert all(math.isfinite(l["gini"]) for l in out["per_layer"])
