from __future__ import annotations

from pathlib import Path

from ds4_cmf.api.errors import CmfError
from ds4_cmf.search.fts import build_match, search

from support import StoreCase


class TestFts(StoreCase):
    def test_unicode_exact_paths_and_error_ids(self):
        self.observe("unicode", "Caffè errore DS4ABC42 nel percorso backend")
        self.project()
        self.assertEqual(len(search(self.ctx, self.a, project_id="project-a",
                                    query="caffè").items), 1)
        self.assertEqual(len(search(self.ctx, self.a, project_id="project-a",
                                    query="DS4ABC42").items), 1)

    def test_quotes_operators_empty_and_term_caps(self):
        self.observe("operator", "alpha beta query")
        self.project()
        for query in ('" OR project-b:*', 'alpha" OR beta', '()', '"'):
            result = search(self.ctx, self.a, project_id="project-a", query=query)
            self.assertTrue(all(h.text == "alpha beta query" for h in result.items))
        self.assertIsNone(build_match('"()'))
        self.assertLessEqual(build_match(" ".join(f"word{i}" for i in range(50)), mode="or").count(" OR "), 11)

    def test_scope_precedes_limit_and_ranking(self):
        self.observe("foreign", "needle needle needle needle", project="project-b")
        own = self.observe("own", "needle")
        self.project()
        hits = search(self.ctx, self.a, project_id="project-a", query="needle", limit=1).items
        self.assertEqual([h.event_id for h in hits], [own.event_id])

    def test_recall_has_no_trust_or_write_effect(self):
        self.observe("readonly", "memory clue")
        self.project()
        before = self.ctx.db.execute("SELECT seq_committed FROM projection_checkpoints").fetchone()[0]
        for _ in range(20):
            search(self.ctx, self.a, project_id="project-a", query="memory")
        self.assertEqual(self.ctx.db.execute("SELECT seq_committed FROM projection_checkpoints").fetchone()[0], before)
        self.assertEqual(self.ctx.db.execute("SELECT verification FROM memory_units").fetchone()[0], "UNVERIFIED")

    def test_lag_and_source_integrity(self):
        self.observe("pending", "pending item")
        self.assertEqual(search(self.ctx, self.a, project_id="project-a", query="pending").lag, 1)
        self.project()
        hit = search(self.ctx, self.a, project_id="project-a", query="pending").items[0]
        path = self.ctx.blob_root / "sha256" / f"{hit.source_sha256}.txt"
        path.write_bytes(b"X" * path.stat().st_size)
        # Equal-size tampering must not produce a source-backed search hit.
        self.assertEqual(search(self.ctx, self.a, project_id="project-a", query="pending").items, ())

    def test_query_rejects_lone_surrogate(self):
        with self.assertRaises(CmfError) as caught:
            search(self.ctx, self.a, project_id="project-a", query="\ud800")
        self.assertEqual(caught.exception.code, "SCHEMA")
