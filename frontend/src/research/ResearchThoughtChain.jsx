import { useState } from "react";
import { formatNodeResult } from "./researchStore.mjs";

// Each node is a collapsible section: the header shows title + status, and
// clicking expands the node's persisted result (coordinator decision, rewritten
// queries, team synthesis, reporter stats, …) so the user can see what happened
// inside every stage.
export function ResearchThoughtChain({ nodes }) {
  const [open, setOpen] = useState({});
  if (!nodes.length) return null;
  return (
    <ol className="research-chain">
      {nodes.map((node) => {
        const body = formatNodeResult(node.result);
        const expandable = Boolean(body);
        const isOpen = expandable && Boolean(open[node.name]);
        return (
          <li key={node.name} className={`research-node ${node.status}`}>
            <button
              type="button"
              className="research-node-head"
              onClick={() => setOpen((prev) => ({ ...prev, [node.name]: !prev[node.name] }))}
              aria-expanded={isOpen}
              disabled={!expandable}
            >
              <span className="research-node-caret">
                {expandable ? (isOpen ? "▾" : "▸") : "·"}
              </span>
              <span className="research-node-title">{node.title}</span>
              <span className="research-node-status">{node.status === "running" ? "…" : "✓"}</span>
            </button>
            {isOpen ? <pre className="research-node-body">{body}</pre> : null}
          </li>
        );
      })}
    </ol>
  );
}
