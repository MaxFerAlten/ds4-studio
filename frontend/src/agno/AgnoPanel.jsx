import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Play, RefreshCw, Square } from "lucide-react";

import { fetchAgnoStatus, startAgno, createAgnoRun, cancelAgnoRun, ensureAgnoUi } from "./agnoApi.mjs";
import { launchAgnoUi } from "./agnoUiLauncher.mjs";
import { openAgnoRunEvents } from "./agnoEvents.mjs";
import { applyAgnoEvent, initialAgnoRun } from "./agnoStore.mjs";

const NATIVE_AGENT_CONFLICT_NOTICE =
  "L'agente nativo DS4 è attivo. Arrestalo prima di avviare una run Agno, per evitare la perdita o il cambio implicito della sessione.";

const HISTORY_LIMIT = 10;

function archiveRun(current, runToArchive) {
  if (!runToArchive.runId) return current;
  return [runToArchive, ...current.filter((entry) => entry.runId !== runToArchive.runId)].slice(0, HISTORY_LIMIT);
}

function ToolTimeline({ toolCalls }) {
  if (!toolCalls.length) return null;
  return (
    <div className="agno-tool-timeline">
      {toolCalls.map((tc, i) => (
        <div key={tc.toolCallId ?? i} className={`agno-tool-entry agno-tool-entry-${tc.status}`}>
          <span className="agno-tool-indicator">
            {tc.status === "running" ? (
              <span className="agno-tool-spinner" />
            ) : tc.status === "error" ? "\u2716" : "\u2713"}
          </span>
          <span className="agno-tool-name">{tc.toolName ?? tc.toolCallId ?? "tool"}</span>
          {tc.isError ? <span className="agno-tool-error-badge">error</span> : null}
        </div>
      ))}
    </div>
  );
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
      <ToolTimeline toolCalls={run.toolCalls} />
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
  const [uiBusy, setUiBusy] = useState(false);
  const streamRef = useRef(null);
  const sessionIdRef = useRef(crypto.randomUUID());

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
  const agentUiEnabled = Boolean(status?.agentUi?.enabled);
  const agentUiReady = Boolean(status?.agentUi?.running && status?.agentUi?.healthy);
  const toolsEnabled = Boolean(status?.tools?.enabled);
  const toolsReady = !toolsEnabled || Boolean(status?.tools?.parity);
  const integrationReady = serviceReady && toolsReady;

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
      const created = await createAgnoRun({ message, agentId: "ds4-assistant", sessionId: sessionIdRef.current });
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

  async function handleOpenAgentUi() {
    setUiBusy(true);
    setNotice("");

    try {
      await launchAgnoUi({
        ensureUi: () => ensureAgnoUi()
      });
      await refreshStatus();
    } catch (error) {
      if (error.code === "POPUP_BLOCKED") {
        setNotice(
          "Il browser ha bloccato la nuova scheda. " +
          "Consenti i popup locali per DS4-Studio e riprova."
        );
      } else if (error.code === "AGNO_UI_DISABLED") {
        setNotice("Agno-UI non è abilitata nella configurazione DS4.");
      } else if (error.code === "AGNO_UI_START_FAILED") {
        setNotice(
          "Agno-UI non è riuscita ad avviarsi. " +
          "Controlla il bootstrap e i log del processo."
        );
      } else if (error.code === "AGENTOS_NOT_READY") {
        setNotice("AgentOS non è pronto.");
      } else {
        setNotice(error.message || "Errore durante l'apertura di Agno-UI.");
      }
    } finally {
      setUiBusy(false);
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
        <button type="button" onClick={refreshStatus} title="Aggiorna stato" aria-label="Aggiorna stato Agno">
          <RefreshCw size={15} />
        </button>
        <span className={`agno-status-pill ${serviceReady ? "ok" : "warn"}`}>
          {serviceReady ? "Servizio attivo" : "Servizio non attivo"}
        </span>
        <span className={`agno-status-pill ${toolsReady ? "ok" : "warn"}`}>
          {toolsEnabled
            ? `Tool ${status.tools.profile}: ${status.tools.registeredCount ?? status.tools.catalogCount}/${status.tools.expectedProfileCount}`
            : "Tool disabilitati"}
        </span>
        <button
          type="button"
          className={`agno-native-ui-button ${agentUiReady ? "ready" : ""}`}
          onClick={handleOpenAgentUi}
          disabled={uiBusy || !serviceReady || !agentUiEnabled || nativeAgentActive}
          title={
            nativeAgentActive
              ? "Arresta prima l'agente nativo DS4"
              : agentUiReady
                ? "Apri l'interfaccia nativa Agno"
                : "Avvia e apri l'interfaccia nativa Agno"
          }
          data-agent-id="agno-native-ui-button"
        >
          <ExternalLink size={15} />
          {uiBusy ? "Avvio Agno-UI…" : "Agno-UI"}
        </button>
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

      <div className="agno-capability-note">
        Solo testo. Immagini, allegati, audio, video e OCR non sono supportati.
      </div>

      {serviceReady && !toolsReady ? (
        <div className="agno-notice" role="alert">
          Il catalogo tool del sidecar non coincide con il profilo Node.
          Riavvia il servizio Agno prima di eseguire una run.
        </div>
      ) : null}

      <div className="agno-composer">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Messaggio per l'agente Agno..."
          rows={3}
          disabled={busy || !integrationReady || nativeAgentActive}
        />
        <button
          type="button"
          disabled={busy || !integrationReady || nativeAgentActive || !message.trim()}
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
