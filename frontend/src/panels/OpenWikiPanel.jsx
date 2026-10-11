import { useEffect, useState } from "react";

export function OpenWikiPanel({ request = {}, onAgentEnabledChange, sessionHeaders = {} }) {
  const [sourcePath, setSourcePath] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [workspaceChanges, setWorkspaceChanges] = useState(null);
  const [status, setStatus] = useState({ state: "stopped", enabled: false, pageCount: 0 });

  async function refreshStatus(signal) {
    try {
      const response = await fetch("/api/openwiki/status", { headers: sessionHeaders, ...(signal ? { signal } : {}) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Stato OpenWiki non disponibile");
      if (signal?.aborted) return;
      const nextStatus = body.status || { state: "stopped", enabled: false, pageCount: 0 };
      setStatus(nextStatus);
      setWorkspaceChanges(nextStatus.workspaceChanges || null);
      onAgentEnabledChange?.(nextStatus.enabled === true);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err.message);
    }
  }

  useEffect(() => {
    let active = true;
    const statusController = new AbortController();
    fetch("/api/openwiki/config")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || "Configurazione OpenWiki non disponibile");
        return body;
      })
      .then((body) => {
        if (!active) return;
        setSourcePath(body.sourcePath || "");
        setPath(body.workspacePath || "");
      })
      .catch((err) => { if (active) setError(err.message); });
    refreshStatus(statusController.signal);
    const timer = setInterval(() => refreshStatus(statusController.signal), 1500);
    return () => { active = false; clearInterval(timer); statusController.abort(); };
  }, [onAgentEnabledChange]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/openwiki/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, workspacePath: path })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Impossibile configurare OpenWiki");
      setSourcePath(body.sourcePath || sourcePath);
      setPath(body.workspacePath || path);
      setNotice(`Release ${body.commit || "OpenWiki"} preparata e workspace salvato. Avvia OpenWiki per completare il controllo MCP.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function control(action) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/openwiki/control", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders },
        body: JSON.stringify({ action, request })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Comando OpenWiki ${action} non riuscito`);
      setNotice(body.message || `OpenWiki ${action} completato.`);
      if (action === "start") onAgentEnabledChange?.(true);
      if (action === "stop") onAgentEnabledChange?.(false);
      setWorkspaceChanges(body.openwiki?.workspaceChanges || null);
      await refreshStatus();
    } catch (err) {
      setError(err.message);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  const running = status.state === "running";
  const started = status.enabled === true && ["ready", "running"].includes(status.state);

  return (
    <form className="form-grid openwiki-settings" onSubmit={save}>
      <p className="field full">
        DS4 prepara una release dal commit OpenWiki autorizzato senza leggere o sovrascrivere le modifiche locali del checkout. Inserisci la root del checkout sorgente e una directory da documentare.
      </p>
      <label className="field full">
        <span>Path assoluto del checkout OpenWiki</span>
        <input
          type="text"
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
          placeholder="/mnt/crucial_ai/COPARATOR/openwiki"
          autoComplete="off"
          spellCheck={false}
          required
          data-agent-id="openwiki-source-path"
        />
      </label>
      <label className="field full">
        <span>Path assoluto della directory da documentare</span>
        <input
          type="text"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/percorso/assoluto/alla/directory"
          autoComplete="off"
          spellCheck={false}
          required
          data-agent-id="openwiki-workspace-path"
        />
      </label>
      <div className="field full">
        <button type="submit" disabled={busy || !sourcePath.trim() || !path.trim()} data-agent-id="openwiki-workspace-save">
          {busy ? "Preparazione release e workspace…" : "Prepara OpenWiki e salva"}
        </button>
        {notice ? <small role="status">{notice}</small> : null}
        {error ? <small role="alert">{error}</small> : null}
      </div>
      <div className="field full openwiki-lifecycle" data-agent-id="openwiki-lifecycle">
        <strong>Stato: {status.enabled ? "ON" : "OFF"} · {status.state}</strong>
        {status.generation ? <small>Generazione: {status.generation.state}; pagine {status.generation.pageCount}; byte {status.generation.totalTextBytes}</small> : null}
        {workspaceChanges ? <small role="status">{workspaceChanges.truncated ? "Riepilogo Git incompleto" : "Riepilogo Git"} · openwiki/: {workspaceChanges.changedPathCount} file esistenti cambiati; {workspaceChanges.addedPathCount} aggiunti, {workspaceChanges.removedPathCount} rimossi. File presenti all’avvio: {workspaceChanges.preexistingPathCount}.</small> : null}
        {status.lastError ? <small role="alert">Ultimo errore: {status.lastError}</small> : null}
        <div className="button-row">
          <button type="button" disabled={busy || started} onClick={() => control("start")} data-agent-id="openwiki-start">
            {busy ? "In corso…" : "Start"}
          </button>
          <button type="button" disabled={busy || !started || running || !path.trim()} onClick={() => control("init")} data-agent-id="openwiki-init">
            Init wiki
          </button>
          <button type="button" disabled={busy || !started || running || !path.trim()} onClick={() => control("update")} data-agent-id="openwiki-update">
            Update wiki
          </button>
          <button type="button" disabled={(busy && !running) || !started} onClick={() => control("stop")} data-agent-id="openwiki-stop">
            Stop
          </button>
        </div>
        {running ? <small role="status">OpenWiki sta generando documentazione nel repository configurato.</small> : null}
      </div>
    </form>
  );
}
