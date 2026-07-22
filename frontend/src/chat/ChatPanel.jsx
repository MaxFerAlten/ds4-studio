import { memo } from "react";
import { Download, Plus, Square, Send } from "lucide-react";
import { MessageContent } from "../MessageContent.mjs";
import { ResearchPanel } from "../research/ResearchPanel.jsx";
import { EvolutionPanel } from "../evolution/EvolutionPanel.jsx";
import { SageActivityCard } from "../sage/SageActivityCard.jsx";

/* Memoized: typing in the composer re-renders ChatPanel on every keystroke,
 * but messages/messagesRef are unchanged, so the whole list (and every
 * ReactMarkdown parse inside MessageContent) is skipped. */
const MessagesList = memo(function MessagesList({ messages, messagesRef, sageActivities }) {
  return (
    <div className="messages" ref={messagesRef} data-agent-id="chat-messages">
      {messages.map((message, index) => (
        <article className={`message ${message.role}`} key={index}>
          <strong>{message.role}</strong>
          {message.reasoning ? (
            <details>
              <summary>Reasoning</summary>
              <MessageContent content={message.reasoning} />
            </details>
          ) : null}
          {message.sageRunId && sageActivities?.[message.sageRunId] ? (
            <SageActivityCard activity={sageActivities[message.sageRunId]} />
          ) : null}
          {message.tool_calls ? (
            <div className="tool-calls-container">
              {message.tool_calls.filter((tc) => tc.name !== "sage").map(tc => (
                <div key={tc.id} className="tool-call-block">
                  <div className="tool-call-header">Tool Call: <code>{tc.name}</code></div>
                  <pre className="tool-call-args">{tc.arguments}</pre>
                  {tc.progress ? (
                    <pre className="tool-call-progress" aria-live="polite">{tc.progress}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {message.role === "tool" ? (
            message.name === "sage" && message.hiddenByDefault ? null : (
              <div className={`tool-result-block ${message.isError ? "error" : ""} ${message.guarded ? "guarded" : ""}`}>
                <div className="tool-result-header">
                  Tool Result: <code>{message.name}</code>
                  {message.guarded ? <span className="tool-result-guard">guarded</span> : null}
                </div>
                <pre className="tool-result-content">{message.content}</pre>
              </div>
            )
          ) : (
            <MessageContent content={message.content} />
          )}
        </article>
      ))}
    </div>
  );
});

export function ChatPanel({
  messages,
  input,
  generationBusy,
  uploadBusy,
  fileAccept,
  uploadedFiles,
  attachedDoc, setAttachedDoc,
  chunkProgress,
  searchStrategy,
  agentMode,
  agentStatus,
  headroomEnabled,
  composerRef,
  fileInputRef,
  messagesRef,
  exportNotice, setExportNotice,
  config,
  workspaceMode, onWorkspaceMode,
  selectedResearchSessionId, setSelectedResearchSessionId,
  sageActivities,
  canSend,
  filteredSuggestions,
  setActiveSuggestionIndex,
  setHideSuggestions,
  isSuggestionsOpen,
  activeIndex,
  sendMessage,
  toggleAgentMode,
  startNewSession, downloadConversation, downloadProfessionalConversation,
  uploadFile,
  abortGeneration,
  handleInputChange, handleSelectSuggestion,
  handleResearchHistoryChange
}) {
  return (
    <section className={`chat-panel panel workspace-${workspaceMode}`} data-agent-id="chat-panel">
      <div className="chat-header">
        <button
          type="button"
          className="new-session-btn"
          onClick={startNewSession}
          disabled={generationBusy || !messages.length}
          title="Start a new chat session (clears messages and attachments)"
          data-agent-id="chat-new-session-button"
        >
          <Plus size={16} />
          New session
        </button>
        {config?.research?.enabled ? (
          <button
            type="button"
            className={`research-toggle ${workspaceMode === "research" ? "active" : ""}`}
            onClick={() => onWorkspaceMode(workspaceMode === "research" ? "chat" : "research")}
            disabled={agentMode}
            title="Toggle Deep Research mode"
            data-agent-id="chat-research-toggle"
          >
            Deep Research
          </button>
        ) : null}
        {config?.evolution?.enabled ? (
          <button
            type="button"
            className={`research-toggle evolution-toggle ${workspaceMode === "evolution" ? "active" : ""}`}
            onClick={() => onWorkspaceMode(workspaceMode === "evolution" ? "chat" : "evolution")}
            disabled={agentMode || generationBusy}
            title="Toggle DS4 Evolution workspace"
            data-agent-id="chat-evolution-toggle"
          >
            Evolution
          </button>
        ) : null}
        {agentMode && (
          <div className="agent-badge" data-agent-id="chat-agent-badge" title={`Agent Mode Active - Iteration ${agentStatus?.iteration || 0} · Pony ${agentStatus?.ponyMode || "off"} · Headroom ${headroomEnabled ? "on" : "off"} · GitNexus ${agentStatus?.gitnexusEnabled ? "on" : "off"}`}>
            <div className="agent-indicator"></div>
            <span>Agent Active · Pony: {agentStatus?.ponyMode || "off"} · Headroom: {headroomEnabled ? "ON" : "OFF"} · GitNexus: {agentStatus?.gitnexusEnabled ? "ON" : "OFF"}</span>
            <button
              type="button"
              className="agent-stop-btn"
              onClick={() => toggleAgentMode(false)}
              title="Stop Agent Mode"
              data-agent-id="chat-agent-stop-button"
            >
              <Square size={12} />
            </button>
          </div>
        )}
      </div>
      {workspaceMode === "research" ? (
        <ResearchPanel
          sessionId={selectedResearchSessionId}
          onSessionChange={setSelectedResearchSessionId}
          onHistoryChange={handleResearchHistoryChange}
        />
      ) : null}
      {workspaceMode === "evolution" ? <EvolutionPanel /> : null}
      <div className="chat-workspace" hidden={workspaceMode !== "chat"}>
      <MessagesList messages={messages} messagesRef={messagesRef} sageActivities={sageActivities} />
      <div className="export-row">
        <button
          type="button"
          onClick={downloadConversation}
          disabled={!messages.length}
          title="Export the whole conversation as Obsidian-compatible Markdown"
          data-agent-id="chat-export-button"
        >
          <Download size={16} />
          Export MD
        </button>
        <button
          type="button"
          onClick={downloadProfessionalConversation}
          disabled={!messages.length}
          title="Export only the professional editorial answer with Sage graphs embedded as base64"
          data-agent-id="chat-export-pro-button"
        >
          <Download size={16} />
          Export Pro MD
        </button>
        {exportNotice ? (
          <div className={`export-notice ${exportNotice.kind}`} role="status" aria-live="polite">
            {exportNotice.message}
            <button
              type="button"
              className="export-notice-close"
              onClick={() => setExportNotice(null)}
              aria-label="Dismiss notice"
              title="Dismiss"
            >×</button>
          </div>
        ) : null}
      </div>
      {attachedDoc ? (
        <div className="attachments">
          <span className="attachment-chip">
            {attachedDoc.name} · ~{attachedDoc.approxTokens.toLocaleString()} tokens · strategy {searchStrategy}
            <button
              type="button"
              className="attachment-remove"
              onClick={() => setAttachedDoc(null)}
              title="Remove attachment"
              disabled={generationBusy}
            >×</button>
          </span>
        </div>
      ) : null}
      {chunkProgress ? (
        <div className="attachments">
          <span className="attachment-chip">
            {chunkProgress.phase === "map"
              ? `Map ${chunkProgress.current}/${chunkProgress.total}`
              : chunkProgress.phase === "reduce"
                ? `Reduce over ${chunkProgress.total} sections`
                : `Split: ${chunkProgress.total} sections`}
          </span>
        </div>
      ) : null}
      {uploadedFiles.length && !attachedDoc ? (
        <div className="attachments">
          {uploadedFiles.map((file) => (
            <span key={file.extractPath}>{file.name}</span>
          ))}
        </div>
      ) : null}
      <div className="composer">
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept={fileAccept}
          onChange={(event) => {
            uploadFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          className="icon-button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadBusy || generationBusy}
          title="Add file"
          aria-label="Add file"
        >
          <Plus size={18} />
        </button>
        {isSuggestionsOpen && (
          <div className="composer-suggestions">
            {filteredSuggestions.map((cmd, idx) => (
              <div
                key={cmd.name}
                className={`suggestion-item ${idx === activeIndex ? "active" : ""}`}
                onClick={() => handleSelectSuggestion(cmd)}
                onMouseEnter={() => setActiveSuggestionIndex(idx)}
              >
                <strong className="suggestion-name">{cmd.name}</strong>
                <span className="suggestion-desc">{cmd.desc}</span>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={composerRef}
          value={input}
          title="Message to send to the model. Paste text with right-click."
          placeholder="Write a message..."
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (isSuggestionsOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((prev) => (prev + 1) % filteredSuggestions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
              } else if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const selected = filteredSuggestions[activeIndex];
                if (selected) {
                  handleSelectSuggestion(selected);
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                setHideSuggestions(true);
              }
            } else {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendMessage();
            }
          }}
          data-agent-id="chat-input"
        />
        {generationBusy ? (
          <button
            className="send-button stop-button"
            type="button"
            onClick={() => abortGeneration("Interrupted.")}
            title="Stop generation"
            aria-label="Stop"
            data-agent-id="chat-stop-button"
          >
            <Square size={16} />
            Stop
          </button>
        ) : (
          <button className="send-button" type="button" onClick={sendMessage} disabled={!canSend || uploadBusy} data-agent-id="chat-send-button">
            <Send size={16} />
            Send
          </button>
        )}
      </div>
      </div>
    </section>
  );
}
