import { Play, Power, RefreshCw, Terminal } from "lucide-react";
import { backendHealthLabel, backendStartupDetail, streamFailureNotice } from "../utils.mjs";

export function LeftRail({
  status, error, startupDetail,
  serverBusy, serverAction,
  effectiveCommand, commandDraft, setCommandDraft, commandIsCustom, hasPendingStartup
}) {
  return (
        <aside className="left-rail panel">
        <div className="brand-row">
          <Terminal size={20} />
          <h1>DS4 Studio</h1>
        </div>
        <div className={`status-pill ${status.running ? "ok" : "bad"}`}>{status.running ? "Running" : "Stopped"}</div>
        <div className={`status-pill ${status.healthy ? "ok" : "warn"}`}>
          {backendHealthLabel(status)}
        </div>
        {startupDetail ? <div className="status-detail">{startupDetail}</div> : null}
        {error ? <div className="status-pill bad">{error}</div> : null}
        <div className="button-row">
          <button type="button" onClick={() => serverAction("start")} disabled={serverBusy}>
            <Play size={16} />
            Start
          </button>
          <button type="button" onClick={() => serverAction("stop")} disabled={serverBusy}>
            <Power size={16} />
            Stop
          </button>
          <button type="button" onClick={() => serverAction("restart")} disabled={serverBusy}>
            <RefreshCw size={16} />
            Restart
          </button>
        </div>
        <label className="field full">
          <span>Command preview</span>
          <textarea
            value={effectiveCommand}
            rows={6}
            spellCheck={false}
            onChange={(event) => setCommandDraft(event.target.value)}
            title="Edit to start ds4-server with a custom command. Reset returns to the form."
          />
          {commandIsCustom ? (
            <button
              type="button"
              className="command-reset"
              onClick={() => setCommandDraft(null)}
              title="Discard override and use the Startup form"
            >
              Reset to form
            </button>
          ) : null}
        </label>
        {commandIsCustom ? <div className="status-pill warn">Custom command override</div> : null}
        {hasPendingStartup ? <div className="status-pill warn">Pending restart</div> : null}
        <section className="log-tail">
          <h2>Logs</h2>
          {(status.logs || []).slice(-12).map((line, index) => (
            <pre key={`${line.time}-${index}`}>{line.message}</pre>
          ))}
        </section>
        </aside>
  );
}
