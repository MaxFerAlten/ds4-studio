"""Principal and scope checks (plan §29.3, §45).

A Principal is built by the server from the peer credentials and the host
token map; it is never parsed from a request body.  Every read and write path
calls `ensure_scope` (or `visible_agents`) before touching memory content.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..api.errors import CmfError

OPERATIONS = frozenset({"observe", "search", "source.read", "source.raw", "admin"})


@dataclass(frozen=True)
class Grant:
    project_id: str
    operation: str
    # None = every agent of the project; only for explicitly provisioned owners.
    agent_id: str | None


@dataclass(frozen=True)
class Principal:
    principal_id: str
    user_id: str
    agent_id: str | None
    instance_id: str
    grants: frozenset[Grant]
    # Whole-store authority (backup/restore).  Distinct from project admin.
    store_owner: bool = False

    def allowed(self, project_id: str, operation: str, agent_id: str | None) -> bool:
        for g in self.grants:
            if g.project_id != project_id or g.operation != operation:
                continue
            if g.agent_id is None or g.agent_id == agent_id:
                return True
        return False


def ensure_scope(p: Principal, project_id: str, operation: str,
                 agent_id: str | None = None) -> None:
    """Raise SCOPE unless `p` holds `operation` on (project, agent).

    The answer depends only on the grants, never on whether the project or
    any resource exists, so it reveals nothing about other scopes."""
    if operation not in OPERATIONS or not p.allowed(project_id, operation, agent_id):
        raise CmfError("SCOPE")


def visible_agents(p: Principal, project_id: str, operation: str) -> frozenset[str] | None:
    """Agents whose memories `p` may read in a project for `operation`.

    None means every agent (a project-wide grant).  Raises SCOPE when there
    is no grant at all."""
    agents: set[str] = set()
    for g in p.grants:
        if g.project_id != project_id or g.operation != operation:
            continue
        if g.agent_id is None:
            return None
        agents.add(g.agent_id)
    if not agents:
        raise CmfError("SCOPE")
    return frozenset(agents)
