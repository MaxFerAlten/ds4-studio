import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";

import { fetchAgnoStatus, startAgno, createAgnoRun, cancelAgnoRun } from "./agnoApi.mjs";
import { openAgnoRunEvents } from "./agnoEvents.mjs";
import { applyAgnoEvent, initialAgnoRun } from "./agnoStore.mjs";

const NATIVE_AGENT_CONFLICT_NOTICE =
  "L'agente nativo DS4 è attivo. Arrestalo prima di avviare una run Agno, per evitare la perdita o il cambio implicito della sessione.";

const HISTORY_LIMIT = 10;

function archiveRun(current, runToArchive) {
  if (!runToArchive.runId) return current;
  return [runToArchive, ...current.filter((entry) => entry.runId !== runToArchive.runId)].slice(0, HISTORY_LIMIT);
}

export function AgnoRunBody({ run }) {
  return (
    <>
      {run.content ? <div className="agno-run-content">{run.content}</div> : null}
      {run.reasoning ? (
        <details className="agno-run-reasoning">
          <summary>Reasoning</summary>
          <pre>{run.reasoning}</pre>
        </details>
      ) : null}
      {run.toolCalls.length ? (
        <div className="agno-run-tools">
          {run.toolCalls.map((entry, index) => (
            <pre key={index} className={`agno-tool-${entry.type}`}>{JSON.stringify(entry.content, null, 2)}</pre>
          ))}
        </div>
      ) : null}
      {run.error ? <div className="agno-notice" role="alert">{run.error}</div> : null}
    </>
  );
}

export function AgnoPanel({ openRunId, onRunOpened } = {}) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [message, setMessage] = useState("");
  const [run, setRun] = useState(initialAgnoRun());
  const [history, setHistory] = useState([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchAgnoStatus();
      setStatus(data);
      setStatusError("");
    } catch (error) {
      setStatusError(error.message);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    return () => streamRef.current?.close();
  }, [refreshStatus]);

  useEffect(() => {
    if (!openRunId) return;
    streamRef.current?.close();
    setHistory((current) => {
      const archived = run.runId !== openRunId ? archiveRun(current, run) : current;
      return archived.filter((entry) => entry.runId !== openRunId);
    });
    setRun(initialAgnoRun());
    streamRef.current = openAgnoRunEvents(openRunId, (event) => {
      setRun((current) => applyAgnoEvent(current, event));
    });
    onRunOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRunId]);

  const nativeAgentActive = Boolean(status?.model?.nativeAgentActive);
  const serviceReady = Boolean(status?.process?.running && status?.process?.healthy);

  async function handleStart() {
    setBusy(true);
    setNotice("");
    try {
      await startAgno();
      await refreshStatus();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRun() {
    if (!message.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const created = await createAgnoRun({ message, agentId: "ds4-assistant" });
      streamRef.current?.close();
      setHistory((current) => archiveRun(current, run));
      setRun(initialAgnoRun());
      streamRef.current = openAgnoRunEvents(created.runId, (event) => {
        setRun((current) => applyAgnoEvent(current, event));
      });
      setMessage("");
    } catch (error) {
      if (error.code === "NATIVE_AGENT_ACTIVE") {
        setNotice(NATIVE_AGENT_CONFLICT_NOTICE);
      } else if (error.code === "DS4_BACKEND_UNAVAILABLE") {
        setNotice("Backend DS4 non disponibile. Riprova più tardi.");
      } else {
        setNotice(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!run.runId) return;
    setBusy(true);
    try {
      await cancelAgnoRun(run.runId);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status && !statusError) {
    return (
      <div className="agno-panel" data-agent-id="agno-panel">
        <p>Caricamento stato Agno...</p>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="agno-panel" data-agent-id="agno-panel">
        <p className="agno-notice">Errore stato Agno: {statusError}</p>
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <div className="agno-panel" data-agent-id="agno-panel">
        <p>Agno non è abilitato su questo server.</p>
      </div>
    );
  }

  return (
    <div className="agno-panel" data-agent-id="agno-panel">
      <header className="agno-header">
        <h2>Agno</h2>
        <button type="button" onClick={refreshStatus} title="Aggiorna stato">
          <RefreshCw size={15} />
        </button>
        <span className={`agno-status-pill ${serviceReady ? "ok" : "warn"}`}>
          {serviceReady ? "Servizio attivo" : "Servizio non attivo"}
        </span>
      </header>

      {!serviceReady ? (
        <div className="agno-service-down">
          <p>Il servizio Agno non è in esecuzione.</p>
          <button type="button" disabled={busy} onClick={handleStart}>
            <Play size={15} /> Avvia servizio
          </button>
        </div>
      ) : null}

      {nativeAgentActive ? (
        <div className="agno-notice agno-native-conflict" role="alert">{NATIVE_AGENT_CONFLICT_NOTICE}</div>
      ) : null}

      <div className="agno-composer">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Messaggio per l'agente Agno..."
          rows={3}
          disabled={busy || !serviceReady || nativeAgentActive}
        />
        <button
          type="button"
          disabled={busy || !serviceReady || nativeAgentActive || !message.trim()}
          onClick={handleCreateRun}
        >
          <Play size={15} /> Avvia run
        </button>
      </div>

      {notice ? <div className="agno-notice" role="alert">{notice}</div> : null}

      {run.runId ? (
        <section className="agno-run" aria-live="polite">
          <header className="agno-run-header">
            <code>{run.runId}</code>
            <span>{run.status}</span>
            {!run.terminal ? (
              <button type="button" onClick={handleCancel} disabled={busy}>
                <Square size={15} /> Cancella
              </button>
            ) : null}
          </header>
          <AgnoRunBody run={run} />
        </section>
      ) : null}

      {history.length ? (
        <section className="agno-history" aria-label="Run precedenti">
          <h3>Run precedenti</h3>
          {history.map((entry) => (
            <details key={entry.runId} className="agno-history-entry">
              <summary>
                <code>{entry.runId}</code> <span>{entry.status}</span>
              </summary>
              <AgnoRunBody run={entry} />
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
