import { RefreshCw } from "lucide-react";
import {
  STARTUP_GROUPS,
  FIELD_LABELS,
  STARTUP_PLACEHOLDERS,
  STRATEGY_OPTIONS,
  REQUEST_PLACEHOLDERS,
  fieldType,
  startupHelp,
  serverFieldValue,
  requestHelp
} from "../appLogic.mjs";
import { isAutoMaxTokens } from "../../server/requestPayload.mjs";
import { metricRows, metricsAvailable, metricsSummary } from "../serverMetrics.mjs";

export function RequestPanel({ request, updateRequestField }) {
  return (
    <div className="form-grid">
      <label className="field full" style={{ gridColumn: "1 / -1" }} data-tooltip={requestHelp("max_tokens")}>
        <span>Output budget / max_tokens</span>
        <input
          value={request.max_tokens ?? ""}
          placeholder={REQUEST_PLACEHOLDERS.max_tokens || ""}
          onChange={(event) => updateRequestField("max_tokens", event.target.value)}
        />
        <small>Usa <code>auto</code> per generare fino a EOS/context, limitato dal safety cap.</small>
      </label>
      {isAutoMaxTokens(request.max_tokens) ? (
        <>
          <label className="field" data-tooltip={requestHelp("max_tokens_safety_cap")}>
            <span>Safety cap</span>
            <input
              value={request.max_tokens_safety_cap ?? ""}
              placeholder={REQUEST_PLACEHOLDERS.max_tokens_safety_cap || ""}
              onChange={(event) => updateRequestField("max_tokens_safety_cap", event.target.value)}
            />
          </label>
          <label className="field" data-tooltip={requestHelp("context_margin")}>
            <span>Context margin</span>
            <input
              value={request.context_margin ?? ""}
              placeholder={REQUEST_PLACEHOLDERS.context_margin || ""}
              onChange={(event) => updateRequestField("context_margin", event.target.value)}
            />
          </label>
        </>
      ) : null}
      {Object.entries(request)
        .filter(([key]) => !["system", "model", "endpoint", "max_tokens", "max_tokens_safety_cap", "context_margin"].includes(key))
        .map(([key, value]) => (
          <label className="field" key={key} data-tooltip={requestHelp(key)}>
            <span>{key}</span>
            {typeof value === "boolean" ? (
              <input type="checkbox" checked={value} aria-label={`${key}: ${requestHelp(key)}`} onChange={(event) => updateRequestField(key, event.target.checked)} />
            ) : key === "stop" ? (
              <textarea
                value={value}
                placeholder={REQUEST_PLACEHOLDERS[key] || ""}
                onChange={(event) => updateRequestField(key, event.target.value)}
                rows={3}
              />
            ) : (
              <input
                value={value}
                placeholder={REQUEST_PLACEHOLDERS[key] || ""}
                onChange={(event) => updateRequestField(key, event.target.value)}
              />
            )}
          </label>
        ))}
    </div>
  );
}

export function ProfilePanel({ profiles, status, profileBusy, selectProfile, profileNotice }) {
  return (
    <div className="profile-panel">
      <p className="profile-help">
        I profili impostano sia i parametri server (ctx, KV cache, port, ...) che i default di richiesta
        (temperature, thinking, max_tokens, ...). Le modifiche ai parametri server richiedono il riavvio del
        backend ds4-server.
      </p>
      <div className="profile-list">
        {profiles.length === 0 ? (
          <div className="profile-empty">Nessun profilo trovato in /profiles/</div>
        ) : profiles.map((p) => {
          const isActive = status?.profile?.selected === p.name;
          return (
            <label key={p.name} className={`profile-item${isActive ? " active" : ""}`}>
              <input
                type="radio"
                name="profile"
                checked={isActive}
                disabled={profileBusy}
                onChange={() => selectProfile(p.name)}
              />
              <div className="profile-meta">
                <div className="profile-name">{p.label}</div>
                <div className="profile-file">{p.name}.json</div>
                {p.description ? <div className="profile-desc">{p.description}</div> : null}
                {p.error ? <div className="profile-error">Errore: {p.error}</div> : null}
              </div>
            </label>
          );
        })}
      </div>
      {profileNotice ? <div className="profile-notice">{profileNotice}</div> : null}
    </div>
  );
}

export function StartupPanel({ config, updateServerField, updateNumberServerField }) {
  return (
    <div className="startup-groups">
      {STARTUP_GROUPS.map(([title, keys]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className="form-grid">
            {keys.map((key) => (
              <label className="field" key={key} data-tooltip={startupHelp(key)}>
                <span>{FIELD_LABELS[key]}</span>
                {fieldType(key) === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(serverFieldValue(config.server, key))}
                    aria-label={`${FIELD_LABELS[key]}: ${startupHelp(key)}`}
                    onChange={(event) => updateServerField(key, event.target.checked)}
                  />
                ) : fieldType(key) === "select" ? (
                  <select
                    value={serverFieldValue(config.server, key)}
                    aria-label={`${FIELD_LABELS[key]}: ${startupHelp(key)}`}
                    onChange={(event) => updateServerField(key, event.target.value)}
                  >
                    <option value="auto">auto</option>
                    <option value="metal">metal</option>
                    <option value="cuda">cuda</option>
                    <option value="cpu">cpu</option>
                  </select>
                ) : (
                  <input
                    type={fieldType(key)}
                    value={serverFieldValue(config.server, key)}
                    placeholder={STARTUP_PLACEHOLDERS[key] || ""}
                    onChange={(event) =>
                      fieldType(key) === "number"
                        ? updateNumberServerField(key, event.target.value)
                        : updateServerField(key, event.target.value)
                    }
                  />
                )}
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function StrategyPanel({ searchChunkTokens, setSearchChunkTokens, searchStrategy, setSearchStrategy }) {
  return (
    <div className="strategy-panel">
      <p className="strategy-intro">
        Analysis strategy when a file is attached to the message.
        Documenti lunghi superano il context: la strategia spezza il file e processa a pezzi.
      </p>
      <label className="field full" data-tooltip="Target tokens per chunk. Leave headroom below the context size.">
        <span>Chunk tokens</span>
        <input
          type="number"
          min={2000}
          step={1000}
          value={searchChunkTokens}
          onChange={(event) => setSearchChunkTokens(Number(event.target.value) || 25000)}
        />
      </label>
      {STRATEGY_OPTIONS.map((opt) => (
        <label
          key={opt.key}
          className={`strategy-option ${searchStrategy === opt.key ? "selected" : ""} ${opt.disabled ? "disabled" : ""}`}
        >
          <input
            type="radio"
            name="search-strategy"
            value={opt.key}
            checked={searchStrategy === opt.key}
            disabled={opt.disabled}
            onChange={() => setSearchStrategy(opt.key)}
          />
          <div className="strategy-body">
            <strong>
              {opt.key}. {opt.title}
              {opt.disabled ? <span className="strategy-badge">in arrivo</span> : null}
              {opt.recommended ? <span className="strategy-badge ok">consigliata</span> : null}
            </strong>
            <p>{opt.description}</p>
            <p className="strategy-meta">{opt.tradeoff}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

export function LogsPanel({ status }) {
  return (
    <div className="logs-large">
      {(status.logs || []).map((line, index) => (
        <pre key={`${line.time}-${index}`}>
          {line.time} {line.stream}: {line.message}
        </pre>
      ))}
    </div>
  );
}

export function MetricsPanel({ serverMetrics, metricsError }) {
  return (
    <div className="metrics-panel">
      <div className={`status-pill ${metricsAvailable(serverMetrics) ? "ok" : "warn"}`}>
        {metricsSummary(serverMetrics)}
      </div>
      {metricsError ? <div className="status-pill bad">{metricsError}</div> : null}
      <div className="metrics-grid">
        {metricRows(serverMetrics).map((row) => (
          <div key={row.label} className={`metric-row ${row.kind}`}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function bytesLabel(value) {
  if (value === null || value === undefined) return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = n / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && scaled >= 1024; i++) {
    scaled /= 1024;
    unit = units[i];
  }
  return `${scaled.toFixed(1)} ${unit}`;
}

export function CompressionPanel({ metrics }) {
  if (!metrics || !metrics.ok) return null;
  const { events, originalBytes, compressedBytes, blobCount, retrieveCount, lastStrategy } = metrics;
  const saving = originalBytes > 0
    ? ((originalBytes - compressedBytes) * 100 / originalBytes).toFixed(1)
    : 0;
  const ratio = originalBytes > 0
    ? (compressedBytes / originalBytes).toFixed(4)
    : 0;
  return (
    <div className="compression-panel">
      <h2>Tool Output Compression</h2>
      <div className="metrics-grid">
        <div className="metric-row plain">
          <span>Events</span>
          <strong>{events != null ? String(events) : "-"}</strong>
        </div>
        <div className="metric-row plain">
          <span>Original bytes</span>
          <strong>{bytesLabel(originalBytes)}</strong>
        </div>
        <div className="metric-row ok">
          <span>Compressed bytes</span>
          <strong>{bytesLabel(compressedBytes)}</strong>
        </div>
        <div className="metric-row ok">
          <span>Saved</span>
          <strong>{saving}%</strong>
        </div>
        <div className="metric-row ok">
          <span>Ratio</span>
          <strong>{ratio}x</strong>
        </div>
        <div className="metric-row plain">
          <span>Blobs stored</span>
          <strong>{blobCount != null ? String(blobCount) : "-"}</strong>
        </div>
        <div className="metric-row plain">
          <span>Retrieves</span>
          <strong>{retrieveCount != null ? String(retrieveCount) : "-"}</strong>
        </div>
        <div className="metric-row plain">
          <span>Last strategy</span>
          <strong>{lastStrategy || "-"}</strong>
        </div>
      </div>
    </div>
  );
}

export function CallDebugPanel({
  refreshCallDebug, callDebugBusy, handleClearCallDebug,
  callDebugEntries, callDebugEnabled, callDebugNotice,
  callDebugOpen, setCallDebugOpen
}) {
  return (
    <div className="call-debug-panel">
      <div className="call-debug-toolbar">
        <button type="button" onClick={refreshCallDebug} disabled={callDebugBusy}>
          <RefreshCw size={14} /> {callDebugBusy ? "Loading…" : "Refresh"}
        </button>
        <button type="button" onClick={handleClearCallDebug} disabled={callDebugBusy || !callDebugEntries.length}>
          Clear
        </button>
        <span className="call-debug-count">{callDebugEntries.length} calls</span>
      </div>
      {!callDebugEnabled ? (
        <div className="status-pill warn">Call Debug disabled in config (callDebug.enabled)</div>
      ) : null}
      {callDebugNotice ? <div className="status-pill bad">{callDebugNotice}</div> : null}
      {callDebugEnabled && !callDebugEntries.length && !callDebugBusy ? (
        <div className="status-pill">No calls recorded yet</div>
      ) : null}
      <div className="call-debug-list">
        {callDebugEntries.map((entry) => {
          const isOpen = Boolean(callDebugOpen[entry.id]);
          const statusClass = entry.error ? "bad" : entry.ok ? "ok" : "warn";
          return (
            <div key={entry.id} className={`call-debug-row ${statusClass}`}>
              <button
                type="button"
                className="call-debug-head"
                onClick={() => setCallDebugOpen((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                aria-expanded={isOpen}
              >
                <span className="call-debug-caret">{isOpen ? "▾" : "▸"}</span>
                <span className={`call-debug-cat ${entry.category}`}>{entry.category}</span>
                <span className="call-debug-method">{entry.method}</span>
                <span className="call-debug-status">{entry.error ? "ERR" : entry.status}</span>
                <span className="call-debug-dur">{entry.durationMs}ms</span>
                <span className="call-debug-url" title={entry.url}>{entry.url}</span>
              </button>
              {isOpen ? (
                <div className="call-debug-detail">
                  <div className="call-debug-meta">
                    {new Date(entry.ts).toLocaleString()} · {entry.host}
                    {entry.error ? ` · error: ${entry.error}` : ""}
                  </div>
                  {entry.reqHeaders && Object.keys(entry.reqHeaders).length ? (
                    <>
                      <div className="call-debug-label">request headers</div>
                      <pre>{JSON.stringify(entry.reqHeaders, null, 2)}</pre>
                    </>
                  ) : null}
                  {entry.reqBody ? (
                    <>
                      <div className="call-debug-label">request body</div>
                      <pre>{entry.reqBody}</pre>
                    </>
                  ) : null}
                  {entry.respBody ? (
                    <>
                      <div className="call-debug-label">response body</div>
                      <pre>{entry.respBody}</pre>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
