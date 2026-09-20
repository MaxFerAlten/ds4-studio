import { historyHasPersistableAssistant, sessionHasAgentMetadata, sessionsExposeMetadata } from "../utils.mjs";
import { AgnoHistoryPanel } from "../agno/AgnoHistoryPanel.jsx";
import { LeanHistoryPanel } from "../lean/LeanHistoryPanel.jsx";

export function HistoryPanel({
  historyTab, setHistoryTab,
  researchSessions, selectedResearchSessionId, setSelectedResearchSessionId,
  loadResearchSession, handleResearchHistoryChange, researchHistoryBusy,
  config, historyDraft, historyConfig, updateHistoryDraft,
  saveHistorySettings, refreshHistorySessions, deleteAllHistorySessions,
  historyStatus, historyListBusy, historyBusy, activeConversationHistorySessions,
  historySessions, historyMetadataAvailable, chatHistorySessions, agentHistorySessions,
  activeConversationHistoryLabel, deleteHistorySession, loadHistorySession, currentSessionFileName,
  setMessages, setCurrentSessionFileName, historyAutoLoaded, setHistoryAutoLoaded,
  lastSavedHistorySignatureRef, clearStoredSession,
  sessionStorage, setError, onOpenAgnoRun
}) {
  return (
        <div className="history-panel" data-agent-id="history-panel">
            <div className="history-mode-tabs" role="tablist" aria-label="History type">
              <button
                type="button"
                className={historyTab === "deepresearch" ? "active" : ""}
                onClick={() => setHistoryTab("deepresearch")}
                aria-selected={historyTab === "deepresearch"}
              >
                <span className="history-mode-label">deepresearch</span>
                <span className="history-mode-count">{researchSessions.length}</span>
              </button>
              <button
                type="button"
                className={historyTab === "chat" ? "active" : ""}
                onClick={() => setHistoryTab("chat")}
                aria-selected={historyTab === "chat"}
              >
                <span className="history-mode-label">chat</span>
                <span className="history-mode-count">{chatHistorySessions.length}</span>
              </button>
              <button
                type="button"
                className={historyTab === "agent" ? "active" : ""}
                onClick={() => setHistoryTab("agent")}
                aria-selected={historyTab === "agent"}
              >
                <span className="history-mode-label">agent</span>
                <span className="history-mode-count">{agentHistorySessions.length}</span>
              </button>
              {config?.agno?.uiEnabled ? (
                <button
                  type="button"
                  className={historyTab === "agno" ? "active" : ""}
                  onClick={() => setHistoryTab("agno")}
                  aria-selected={historyTab === "agno"}
                >
                  <span className="history-mode-label">agno</span>
                </button>
              ) : null}
              {config?.lean?.enabled ? (
                <button
                  type="button"
                  className={historyTab === "lean4" ? "active" : ""}
                  onClick={() => setHistoryTab("lean4")}
                  aria-selected={historyTab === "lean4"}
                >
                  <span className="history-mode-label">Lean 4</span>
                </button>
              ) : null}
            </div>
            {historyTab === "deepresearch" && config?.research?.enabled ? (
              <section className="research-history-section">
                <div className="history-section-header">
                  <strong>Deep Research</strong>
                  <button
                    type="button"
                    onClick={handleResearchHistoryChange}
                    disabled={researchHistoryBusy}
                  >
                    Refresh research
                  </button>
                </div>
                <div className="history-session-list research-history-list">
                  {researchHistoryBusy ? <div className="status-pill">Loading research...</div> : null}
                  {!researchHistoryBusy && !researchSessions.length ? (
                    <div className="status-pill warn">No Deep Research sessions</div>
                  ) : null}
                  {researchSessions.map((session) => (
                    <div className="history-session-row" key={session.sessionId}>
                      <button
                        type="button"
                        className={`history-session research-history-session${
                          selectedResearchSessionId === session.sessionId ? " selected" : ""
                        }`}
                        onClick={() => loadResearchSession(session.sessionId)}
                        title={session.sessionId}
                      >
                        <strong>{session.query || "Untitled research"}</strong>
                        <span>
                          {session.sessionId}
                          <span className={`research-engine-badge ${session.engine || "local"}`}>
                            {session.engine || "local"}
                          </span>
                        </span>
                        <small>
                          {session.status} · {new Date(session.updatedAt).toLocaleString()}
                        </small>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {historyTab === "deepresearch" && !config?.research?.enabled ? (
              <div className="status-pill warn">Deep Research history is disabled</div>
            ) : null}
            {historyTab === "agno" ? <AgnoHistoryPanel onOpenRun={onOpenAgnoRun} /> : null}
            {historyTab === "lean4" && config?.lean?.enabled ? (
              <LeanHistoryPanel />
            ) : null}
          </div>
  );
}
