import asyncio
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from uuid import uuid4

@dataclass
class RunRecord:
    """A running or completed run in the Agno service."""
    run_id: str
    target_type: str
    target_id: str
    status: str  # queued, running, completed, failed, cancelled
    task: Optional[asyncio.Task] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    cancel_requested: bool = False
    terminal_emitted: bool = False
    next_seq: int = 1
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    events: list[dict] = field(default_factory=list)

class RunRegistry:
    """Registry for tracking runs and their subscribers."""

    def __init__(self):
        self._runs: dict[str, RunRecord] = {}
        self._lock = asyncio.Lock()

    async def create_run(self, target_type: str, target_id: str) -> str:
        run_id = str(uuid4())
        async with self._lock:
            self._runs[run_id] = RunRecord(
                run_id=run_id,
                target_type=target_type,
                target_id=target_id,
                status="queued",
            )
        return run_id

    async def get_run(self, run_id: str) -> Optional[RunRecord]:
        async with self._lock:
            return self._runs.get(run_id)

    async def list_runs(self) -> list[RunRecord]:
        """Most recent first. In-memory only: history is lost on service restart."""
        async with self._lock:
            return sorted(self._runs.values(), key=lambda r: r.created_at, reverse=True)

    async def start_task(self, run_id: str, coro) -> None:
        record = await self.get_run(run_id)
        if not record:
            raise KeyError(f"run {run_id} not found")
        record.task = asyncio.create_task(coro)
        record.status = "running"

    async def publish(self, run_id: str, event: dict) -> None:
        record = await self.get_run(run_id)
        if not record:
            return
        async with self._lock:
            record.events.append(event)
            for q in list(record.subscribers):
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    # Drop non-terminal events for slow consumers
                    if event["type"] not in ("run_completed", "run_failed", "run_cancelled"):
                        continue
                    # Terminal events must be delivered; block briefly
                    await q.put(event)

    async def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        record = await self.get_run(run_id)
        if not record:
            raise KeyError(f"run {run_id} not found")
        async with self._lock:
            record.subscribers.add(q)
            # Replay buffered events so late subscribers don't miss them
            for event in record.events:
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    pass
        return q

    async def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        record = await self.get_run(run_id)
        if not record:
            return
        record.subscribers.discard(queue)

    async def request_cancel(self, run_id: str) -> bool:
        record = await self.get_run(run_id)
        if not record:
            return False
        record.cancel_requested = True
        if record.task and not record.task.done():
            record.task.cancel()
        return True

    async def mark_terminal(self, run_id: str, status: str) -> None:
        record = await self.get_run(run_id)
        if not record:
            return
        record.status = status
        record.completed_at = datetime.utcnow()
        record.terminal_emitted = True

    async def shutdown(self) -> None:
        async with self._lock:
            for record in self._runs.values():
                if record.task and not record.task.done():
                    record.task.cancel()
            self._runs.clear()
