from __future__ import annotations

import importlib
import re
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any


_ALIAS_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]*$")
_MODULE_PATTERN = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
_EXPORT_PATTERN = re.compile(r"^[A-Za-z_]\w*$")


class PluginReferenceError(ValueError):
    pass


class PluginResolver:
    def __init__(
        self,
        modules: Mapping[str, str],
        roots: Iterable[Path | str],
    ) -> None:
        if not modules:
            raise ValueError("at least one configured plugin module is required")
        self._modules = dict(modules)
        self._roots = tuple(Path(root).expanduser().resolve() for root in roots)
        if not self._roots:
            raise ValueError("at least one configured plugin root is required")
        for alias, module_name in self._modules.items():
            if not _ALIAS_PATTERN.fullmatch(alias):
                raise ValueError(f"invalid plugin alias {alias!r}")
            if not _MODULE_PATTERN.fullmatch(module_name):
                raise ValueError(f"invalid plugin module {module_name!r}")

    def resolve(self, reference: str) -> Any:
        if reference.count(":") != 1:
            raise PluginReferenceError("plugin reference must be alias:export")
        alias, export = reference.split(":", 1)
        if not _ALIAS_PATTERN.fullmatch(alias) or not _EXPORT_PATTERN.fullmatch(export):
            raise PluginReferenceError("plugin reference must be alias:export")
        module_name = self._modules.get(alias)
        if module_name is None:
            raise PluginReferenceError(f"plugin alias {alias!r} is not configured")

        importlib.invalidate_caches()
        try:
            module = importlib.import_module(module_name)
        except ImportError as error:
            raise PluginReferenceError(f"configured plugin {alias!r} could not load") from error

        module_file = getattr(module, "__file__", None)
        if module_file is None:
            raise PluginReferenceError(f"configured plugin {alias!r} has no local file")
        resolved_file = Path(module_file).resolve()
        if not any(resolved_file.is_relative_to(root) for root in self._roots):
            raise PluginReferenceError(
                f"configured plugin {alias!r} is outside the allowed plugin roots"
            )
        try:
            return getattr(module, export)
        except AttributeError as error:
            raise PluginReferenceError(
                f"configured plugin {alias!r} has no export {export!r}"
            ) from error
