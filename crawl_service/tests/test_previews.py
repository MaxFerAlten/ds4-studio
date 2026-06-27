from __future__ import annotations

from ds4_crawl.previews import utf8_preview


def test_utf8_preview_never_splits_a_codepoint() -> None:
    preview = utf8_preview("abc😀def", 6)

    assert preview.text == "abc"
    assert preview.truncated is True
    assert preview.preview_bytes == 3
    assert preview.original_bytes == 10
