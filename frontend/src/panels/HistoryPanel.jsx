import { historyHasPersistableAssistant, sessionHasAgentMetadata, sessionsExposeMetadata } from "../utils.mjs";

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
  sessionStorage, setError
}) {
  return (
        <div className="history-panel">
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
            {historyTab !== "deepresearch" ? (
              <>
                <div className="history-section-header">
                  <strong>{activeConversationHistoryLabel}</strong>
                </div>
                {historyTab === "agent" && historySessions.length > 0 && !historyMetadataAvailable ? (
                  <div className="status-pill warn">
                    Agent history is enabled, but the live history endpoint is not returning metadata yet. Restart DS4 Studio to populate this tab.
                  </div>
                ) : null}
            <label className="setting-row">
              <input
                type="checkbox"
                checked={Boolean((historyDraft || historyConfig).enabled)}
                onChange={(event) => updateHistoryDraft("enabled", event.target.checked)}
              />
              <span>Keep chat history</span>
            </label>
            <label className="field full" data-tooltip="Server-side directory where Markdown history files are saved.">
              <span>History folder</span>
              <input
                value={(historyDraft || historyConfig).dir || ""}
                placeholder="/home/tendermachine/workspace_ds4studio/history"
                onChange={(event) => updateHistoryDraft("dir", event.target.value)}
              />
            </label>
            <div className="button-row">
              <button type="button" onClick={saveHistorySettings} disabled={historyBusy}>
                Save history settings
              </button>
              <button type="button" onClick={() => refreshHistorySessions()} disabled={historyListBusy}>
                Refresh sessions
              </button>
              <button
                type="button"
                onClick={deleteAllHistorySessions}
                disabled={historyListBusy || !historySessions.length}
                title="Delete every session file in the history folder"
              >
                Delete all
              </button>
            </div>
            {historyStatus ? <div className="status-pill">{historyStatus}</div> : null}
            <div className="history-session-list">
              {historyListBusy ? <div className="status-pill">Loading sessions...</div> : null}
              {!historyListBusy && !activeConversationHistorySessions.length ? (
                <div className="status-pill warn">
                  No saved {historyTab === "agent" ? "agent sessions" : "chat sessions"}
                </div>
              ) : null}
              {activeConversationHistorySessions.map((session) => (
                <div
                  className="history-session-row"
                  key={session.fileName}
                >
                  <button
                    type="button"
                    className="history-session"
                    onClick={() => loadHistorySession(session.fileName)}
                    title={session.fileName}
                  >
                    <strong>{session.title}</strong>
                    <span>{session.fileName}</span>
                    <small>
                      {session.metadata?.agentMode ? "Agent mode · " : ""}
                      {session.messages} messages · {(session.size / 1024).toFixed(1)} KB
                    </small>
                  </button>
                  <button
                    type="button"
                    className="history-session-delete"
                    onClick={() => deleteHistorySession(session.fileName)}
                    title={`Delete ${session.fileName}`}
                    disabled={historyListBusy}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
              </>
            ) : null}
          </div>
  );
}
