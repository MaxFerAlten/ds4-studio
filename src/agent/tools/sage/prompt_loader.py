"""Silent loading of the Sage startup correction prompt."""
import hashlib
from pathlib import Path

from .models import PromptMetadata


class SagePromptLoader:
    """Loads and caches the Sage startup prompt.

    The prompt is loaded only when Sage V2 orchestration is active.
    It is never injected globally into all conversations.
    """

    def __init__(self, prompt_path: Path):
        self.prompt_path = prompt_path
        self._cached_prompt: str | None = None
        self._metadata: PromptMetadata | None = None

    def load(self) -> str:
        """Return cached or freshly loaded prompt text."""
        if self._cached_prompt is not None:
            return self._cached_prompt

        if not self.prompt_path.exists():
            raise RuntimeError(
                f"Sage startup prompt not found at {self.prompt_path}"
            )

        raw = self.prompt_path.read_text(encoding="utf-8").strip()

        if not raw:
            raise RuntimeError("Sage startup prompt is empty")

        self._cached_prompt = raw
        self._metadata = self._parse_metadata(raw)
        return self._cached_prompt

    @property
    def metadata(self) -> PromptMetadata:
        if self._metadata is None:
            # trigger lazy load
            self.load()
        return self._metadata  # type: ignore[return-value]

    def _parse_metadata(self, raw: str) -> PromptMetadata:
        sha256 = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        name = "sage-startup-correction"
        version = "1.0.0"

        # Try to extract YAML frontmatter
        if raw.startswith("---"):
            lines = raw.splitlines()
            for line in lines[1:]:
                if line == "---":
                    break
                if line.startswith("name:"):
                    name = line.split(":", 1)[1].strip()
                elif line.startswith("version:"):
                    version = line.split(":", 1)[1].strip()

        return PromptMetadata(name=name, version=version, sha256=sha256)

    def reload(self) -> None:
        """Force cache invalidation and re-read."""
        self._cached_prompt = None
        self._metadata = None
        self.load()
