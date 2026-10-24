from __future__ import annotations

import hashlib
import os

from ds4_cmf.api.errors import CmfError
from ds4_cmf.domain.events import BlobRef
from ds4_cmf.storage import blobs

from support import StoreCase


class TestBlobs(StoreCase):
    def test_text_digest_roundtrip_and_dedup(self):
        for text in ("", "Caffè ☕", "same text"):
            first = blobs.put_text(self.ctx.blob_root, text)
            second = blobs.put_text(self.ctx.blob_root, text)
            self.assertEqual(first, second)
            self.assertEqual(first.sha256, hashlib.sha256(text.encode()).hexdigest())
            self.assertEqual(blobs.read_text(self.ctx.blob_root, first, max_bytes=100), text)

    def test_blob_limit_and_utf8_prefix(self):
        from ds4_cmf.storage.projection import utf8_prefix
        self.assertEqual(utf8_prefix("a☕b", 3), ("a", 1))
        self.assertEqual(utf8_prefix("a☕b", 4), ("a☕", 4))
        ref = blobs.put_text(self.ctx.blob_root, "12345")
        with self.assertRaises(CmfError):
            blobs.read_text(self.ctx.blob_root, ref, max_bytes=4)

    def test_ds4_id_format_hash_and_readonly(self):
        root = self.tmp / "ds4-source"
        root.mkdir()
        sha_dir = root / "sha256"
        sha_dir.mkdir()
        data = "raw but local".encode()
        sha = hashlib.sha256(data).hexdigest()
        source = sha_dir / f"{sha}.txt"
        source.write_bytes(data)
        before = (source.read_bytes(), source.stat().st_mtime_ns)
        ref, text = blobs.resolve_ds4_blob(root, f"sha256:{sha}", max_bytes=1024)
        self.assertEqual((ref.sha256, text), (sha, data.decode()))
        self.assertEqual((source.read_bytes(), source.stat().st_mtime_ns), before)
        with self.assertRaises(CmfError):
            blobs.resolve_ds4_blob(root, f"sha256:{sha.upper()}", max_bytes=1024)

    def test_symlink_hardlink_and_traversal(self):
        ref = blobs.put_text(self.ctx.blob_root, "protected")
        source = self.ctx.blob_root / "sha256" / f"{ref.sha256}.txt"
        hard = self.tmp / "hardlink"
        os.link(source, hard)
        with self.assertRaises(CmfError):
            blobs.read_text(self.ctx.blob_root, ref, max_bytes=100)
        hard.unlink()
        source.unlink()
        source.symlink_to("/etc/passwd")
        with self.assertRaises(CmfError):
            blobs.read_text(self.ctx.blob_root, ref, max_bytes=100)
        with self.assertRaises(CmfError):
            blobs.read_text(self.ctx.blob_root, BlobRef("../" + ref.sha256, 0, "REDACTED_TEXT"),
                            max_bytes=100)
