import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAgnoRuns } from "./agnoApi.mjs";
import { openAgnoRunEvents } from "./agnoEvents.mjs";
import { applyAgnoEvent, initialAgnoRun } from "./agnoStore.mjs";
import { AgnoRunBody } from "./AgnoPanel.jsx";

export function AgnoHistoryPanel({ onOpenRun }) {
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState({});
  const streamsRef = useRef({});

  useEffect(() => {
    fetchAgnoRuns()
      .then((data) => setRuns(data.runs))
      .catch((err) => setError(err.message));
    const streams = streamsRef.current;
    return () => {
      for (const stream of Object.values(streams)) stream.close();
    };
  }, []);

  const handleOpen = useCallback((runId) => {
    setExpanded((current) => {
      if (current[runId]) return current;
      const stream = openAgnoRunEvents(runId, (event) => {
        setExpanded((c) => {
          const next = applyAgnoEvent(c[runId] ?? initialAgnoRun(), event);
          if (next.terminal) streamsRef.current[runId]?.close();
          return { ...c, [runId]: next };
        });
      });
      streamsRef.current[runId] = stream;
      return { ...current, [runId]: initialAgnoRun() };
    });
  }, []);

  return (
    <div className="agno-panel agno-history-panel" data-agent-id="agno-history-panel">
      <header className="agno-header">
        <h2>Cronologia Agno</h2>
      </header>
      {error ? <div className="agno-notice" role="alert">{error}</div> : null}
      {!error && runs.length === 0 ? <p>Nessuna run disponibile.</p> : null}
      {runs.map((entry) => (
        <details
          key={entry.runId}
          className="agno-history-entry"
          onToggle={(event) => event.target.open && handleOpen(entry.runId)}
        >
          <summary>
            <code>{entry.runId}</code> <span>{entry.status}</span> <time>{entry.createdAt}</time>
            {onOpenRun ? (
              <button
                type="button"
                className="agno-history-open"
                title="Apri in Agno"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenRun(entry.runId);
                }}
              >
                Apri
              </button>
            ) : null}
          </summary>
          {expanded[entry.runId] ? <AgnoRunBody run={expanded[entry.runId]} /> : null}
        </details>
      ))}
    </div>
  );
}
