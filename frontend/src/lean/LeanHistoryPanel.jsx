import { useCallback, useEffect, useState } from "react";

import { fetchLeanHistory } from "./leanApi.mjs";

const HISTORY_LIMIT = 50;

function statusIcon(status) {
  if (status === "checked") return "\u2713";
  if (status === "failed" || status?.isError) return "\u2716";
  return "?";
}

function sourcePreview(code) {
  if (!code) return "";
  const firstLine = code.split("\n")[0] || "";
  if (firstLine.length > 80) return firstLine.slice(0, 77) + "...";
  return firstLine;
}

export function LeanHistoryEntry({ entry }) {
  const req = entry.request || {};
  const res = entry.response || {};
  const status = res.status || "unknown";
  const summary = res.summary || "";
  const isError = Boolean(res.isError);
  const profile = req.profile || "core";
  const time = new Date(entry.timestamp).toLocaleString();

  return (
    <div className={`lean-history-entry ${isError ? "lean-history-entry-error" : ""}`}>
      <div className="lean-history-header">
        <span className="lean-history-icon">{statusIcon(isError ? "failed" : status)}</span>
        <span className="lean-history-status">{status}</span>
        <span className="lean-history-profile">{profile}</span>
        <span className="lean-history-time">{time}</span>
      </div>
      {req.code ? (
        <details className="lean-history-source">
          <summary>Source: {sourcePreview(req.code)}</summary>
          <pre className="lean-code-block"><code>{req.code}</code></pre>
        </details>
      ) : null}
      {summary ? (
        <div className="lean-history-summary">{summary}</div>
      ) : null}
      {res.diagnostics && res.diagnostics.length > 0 ? (
        <details className="lean-history-diagnostics">
          <summary>Diagnostics ({res.diagnostics.length})</summary>
          <ul className="lean-diag-list">
            {res.diagnostics.map((d, i) => (
              <li key={i} className="lean-diag-item">
                {d.message || d.msg || JSON.stringify(d)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function LeanHistoryPanel({ sessionId }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const data = await fetchLeanHistory({ sessionId });
      setEntries(data.entries || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 5 seconds while there are recent entries
  useEffect(() => {
    if (!entries.length) return;
    const latest = entries[entries.length - 1];
    const age = Date.now() - (latest.timestamp || 0);
    if (age > 30000) return; // only poll if last entry is fresh
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [entries.length, refresh]);

  const visible = entries.slice(-HISTORY_LIMIT);

  return (
    <div className="lean-history-panel" data-agent-id="lean-history-panel">
      <div className="lean-history-toolbar">
        <button type="button" onClick={refresh} disabled={busy}>
          {busy ? "Loading..." : "Refresh"}
        </button>
        <span className="lean-history-count">{entries.length} entries</span>
      </div>
      {error ? <div className="status-pill bad">{error}</div> : null}
      {!visible.length && !error ? (
        <div className="status-pill warn">No Lean check history yet.</div>
      ) : null}
      {visible.map((entry, i) => (
        <LeanHistoryEntry key={entry.timestamp ?? i} entry={entry} />
      ))}
    </div>
  );
}
