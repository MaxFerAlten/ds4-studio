from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TextPreview:
    text: str
    truncated: bool
    preview_bytes: int
    original_bytes: int


def utf8_preview(text: str, max_bytes: int) -> TextPreview:
    if max_bytes < 0:
        raise ValueError("max_bytes must be non-negative")
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return TextPreview(text, False, len(encoded), len(encoded))
    preview = encoded[:max_bytes].decode("utf-8", errors="ignore")
    preview_bytes = len(preview.encode("utf-8"))
    return TextPreview(preview, True, preview_bytes, len(encoded))
