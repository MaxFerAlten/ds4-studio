from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from .adapter import build_browser_config, build_crawler_config
from .artifacts import ArtifactStore, ArtifactRecord
from .repository import Repository


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _get_value(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _first_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        s = value.strip() if isinstance(value, str) else str(value).strip()
        if s:
            return s
    return ""


def _crawl_result_to_dict(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return dict(result)
    data: dict[str, Any] = {}
    for name in (
        "url", "title", "success", "status_code", "html", "cleaned_html",
        "markdown", "links", "metadata", "extracted_content", "text",
        "error_message", "message",
    ):
        value = _get_value(result, name, None)
        if value is not None:
            data[name] = value
    return data


def _normalize_result(result: Any) -> dict[str, Any]:
    data = _crawl_result_to_dict(result)
    markdown = data.get("markdown")
    markdown_text = ""
    if markdown is not None:
        if isinstance(markdown, str):
            markdown_text = markdown.strip()
        else:
            fit = _get_value(markdown, "fit_markdown")
            raw = _get_value(markdown, "raw_markdown")
            text = _get_value(markdown, "markdown")
            content = _get_value(markdown, "content")
            markdown_text = _first_text(fit, raw, text, content)

    metadata = data.get("metadata")
    title = _first_text(
        data.get("title"),
        _get_value(metadata, "title"),
        _get_value(metadata, "pageTitle"),
        _get_value(metadata, "ogTitle"),
    )
    url = _first_text(data.get("url"), _get_value(metadata, "url"))
    html = _first_text(data.get("html"), data.get("cleaned_html"))
    links = data.get("links")

    status_code = data.get("status_code")
    ok = bool(data.get("success", True))
    if status_code is not None and status_code >= 400:
        ok = False

    payload: dict[str, Any] = {
        "ok": ok,
        "url": url,
        "title": title,
        "markdown": markdown_text,
    }
    if html:
        payload["html"] = html
    if links:
        payload["links"] = links if isinstance(links, (list, dict)) else []
    if status_code is not None:
        payload["status_code"] = status_code
    if data.get("metadata") is not None:
        payload["metadata"] = data["metadata"]
    if data.get("error_message"):
        payload["error_message"] = data["error_message"]
    return payload


class CrawlRunner:
    def __init__(self, repository: Repository, artifact_store: ArtifactStore):
        self.repository = repository
        self.artifact_store = artifact_store
        self._active_tasks: dict[str, asyncio.Task[None]] = {}
        self._cancel_requests: set[str] = set()
        self._closed = False

    async def close(self) -> None:
        self._closed = True
        for job_id, task in list(self._active_tasks.items()):
            task.cancel()
        if self._active_tasks:
            await asyncio.gather(*self._active_tasks.values(), return_exceptions=True)
        self._active_tasks.clear()

    def submit(self, job_id: str) -> asyncio.Task[None]:
        task = asyncio.create_task(self.run_job(job_id))
        self._active_tasks[job_id] = task
        task.add_done_callback(lambda _: self._active_tasks.pop(job_id, None))
        return task

    async def run_job(self, job_id: str) -> None:
        if not self.repository.transition_job(job_id, "queued", "starting"):
            return
        self.repository.transition_job(job_id, "starting", "running")

        job = self.repository.get_job(job_id)
        if job is None:
            return
        request = json.loads(job["request_json"])
        urls: list[str] = []
        if request.get("url"):
            urls = [str(request["url"])]
        elif request.get("urls"):
            urls = [str(u) for u in request["urls"]]

        all_succeeded = True

        try:
            for idx, url in enumerate(urls):
                if job_id in self._cancel_requests:
                    self._cancel_requests.discard(job_id)
                    self.repository.transition_job(job_id, "running", "cancelled")
                    return

                self._append_event(job_id, "page_start", {"page_index": idx, "url": url})
                try:
                    raw_result = await self._crawl_single(url, request)
                    normalized = _normalize_result(raw_result)
                    page_ok = normalized.get("ok", False)
                    state = "succeeded" if page_ok else "failed"
                    if not page_ok:
                        all_succeeded = False
                    self._store_page_result(job_id, idx, url, state, normalized)
                    self._append_event(job_id, "page_complete", {"page_index": idx, "url": url, "state": state})
                except Exception as exc:
                    all_succeeded = False
                    normalized = {"ok": False, "url": url, "error": str(exc)}
                    self._store_page_result(job_id, idx, url, "failed", normalized)
                    self._append_event(job_id, "page_complete", {"page_index": idx, "url": url, "state": "failed", "error": str(exc)})

            if job_id in self._cancel_requests:
                self._cancel_requests.discard(job_id)
                self.repository.transition_job(job_id, "running", "cancelled")
                return

            state = "succeeded" if all_succeeded else "partially_succeeded"
            page_entries = []
            stored_pages = self.repository.list_pages(job_id)
            for sp in stored_pages:
                entry = {"url": sp["url"], "state": sp["state"]}
                rj = sp.get("result_json")
                if rj:
                    try:
                        rd = json.loads(rj) if isinstance(rj, str) else rj
                    except json.JSONDecodeError:
                        rd = {}
                    content = rd.get("markdown", "") or rd.get("text", "") or rd.get("extracted_content", "") or ""
                    if len(content) > 22000:
                        content = content[:22000] + "\n...[truncated]"
                    if content.strip():
                        entry["content"] = content
                page_entries.append(entry)
            manifest = {"pages": page_entries, "total_pages": len(urls), "all_succeeded": all_succeeded}
            self.repository.commit_result(job_id, state, manifest)
        except asyncio.CancelledError:
            self._append_event(job_id, "cancelled", {"reason": "task cancelled"})
            self.repository.transition_job(job_id, "running", "cancelled")
        except Exception as exc:
            self._append_event(job_id, "failed", {"error": str(exc)})
            self.repository.commit_result(job_id, "failed", {"error": str(exc)})

    async def cancel_job(self, job_id: str) -> None:
        self._cancel_requests.add(job_id)
        task = self._active_tasks.get(job_id)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _crawl_single(self, url: str, request: dict[str, Any]) -> Any:
        from crawl4ai import AsyncWebCrawler

        browser_cfg = build_browser_config(request.get("browser_config"))
        crawler_cfg = build_crawler_config(request.get("crawler_config"))
        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            result = await crawler.arun(url=url, config=crawler_cfg)
            if result is None:
                raise RuntimeError("crawl4ai returned None")
            return result

    def _store_page_result(self, job_id: str, page_index: int, url: str, state: str, result: dict[str, Any] | None = None) -> None:
        with self.repository.connection:
            self.repository.connection.execute(
                """
                INSERT OR REPLACE INTO pages(job_id, page_index, url, state, result_json, error_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (job_id, page_index, url, state, json.dumps(result) if result else None, None),
            )

    def _append_event(self, job_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with self.repository.connection:
            row = self.repository.connection.execute(
                "SELECT COALESCE(MAX(event_id), 0) + 1 FROM events WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            event_id = row[0]
            self.repository.connection.execute(
                """
                INSERT INTO events(job_id, event_id, event_type, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (job_id, event_id, event_type, json.dumps(payload), _utc_now()),
            )
