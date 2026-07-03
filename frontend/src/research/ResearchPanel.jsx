import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Upload, Download, RefreshCw } from "lucide-react";
import {
  cancelResearch,
  createResearchSession,
  fetchResearchState,
  launchResearch,
  openResearchStream,
  prismReauth,
  researchExportUrl,
  sendFeedback,
  startResearch,
  uploadResearchDocument
} from "./researchApi.mjs";
import {
  applyResearchEvent,
  initialResearchView,
  researchViewFromState
} from "./researchStore.mjs";
import { ResearchThoughtChain } from "./ResearchThoughtChain.jsx";
import { ResearchPlanReview } from "./ResearchPlanReview.jsx";
import { ResearchSources } from "./ResearchSources.jsx";
import { MessageContent } from "../MessageContent.mjs";

const NOOP = () => {};
const HISTORY_REFRESH_EVENTS = new Set([
  "feedback_required",
  "research_completed",
  "research_error",
  "research_cancelled"
]);

export function ResearchPanel({
  sessionId = null,
  onSessionChange = NOOP,
  onHistoryChange = NOOP
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState(initialResearchView);
  const [notice, setNotice] = useState(null);
  const [pendingDocs, setPendingDocs] = useState([]); // { name } uploaded to the draft
  const [draftSessionId, setDraftSessionId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [engine, setEngine] = useState("local");
  const streamRef = useRef(null);

  const onEvent = useCallback((event) => {
    setView((prev) => applyResearchEvent(prev, event));
    if (HISTORY_REFRESH_EVENTS.has(event.type)) onHistoryChange();
  }, [onHistoryChange]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let active = true;
    streamRef.current?.close();
    streamRef.current = null;
    setNotice(null);

    fetchResearchState(sessionId)
      .then(({ state }) => {
        if (!active) return;
        setQuery(state.query || "");
        setView(researchViewFromState(state));
        setDraftSessionId(state.status === "draft" ? state.sessionId : null);
        setPendingDocs(
          Array.isArray(state.documents)
            ? state.documents.map((document) => ({ name: document.name || document.docId }))
            : []
        );
        if (state.status === "running" || state.status === "waiting_feedback") {
          streamRef.current = openResearchStream(sessionId, onEvent, {
            lastSeq: Number.isFinite(state.seq) ? state.seq : 0
          });
        }
      })
      .catch((err) => {
        if (active) setNotice(err.message);
      });

    return () => {
      active = false;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [sessionId, onEvent]);

  const busy = view.status === "running" || view.status === "waiting_feedback";

  // Ensure a draft session exists so a document can be attached before launch.
  async function ensureDraft() {
    if (draftSessionId) return draftSessionId;
    const { sessionId } = await createResearchSession(query.trim() || "(untitled research)", { engine });
    setDraftSessionId(sessionId);
    return sessionId;
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotice(null);
    setUploading(true);
    try {
      const sessionId = await ensureDraft();
      const { document } = await uploadResearchDocument(sessionId, file);
      setPendingDocs((docs) => [...docs, { name: document.name || file.name }]);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleStart(e) {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setNotice(null);
    try {
      streamRef.current?.close();
      const { sessionId } = draftSessionId
        ? await launchResearch(draftSessionId)
        : await startResearch(query.trim(), { engine });
      setView({ ...initialResearchView(), sessionId, status: "running" });
      setDraftSessionId(null);
      setPendingDocs([]);
      onSessionChange(sessionId);
      onHistoryChange();
      streamRef.current = openResearchStream(sessionId, onEvent);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleCancel() {
    if (!view.sessionId) return;
    try {
      await cancelResearch(view.sessionId);
      onHistoryChange();
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handlePrismReauth() {
    setNotice(null);
    try {
      const { message } = await prismReauth();
      setNotice(message);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleFeedback(action) {
    try {
      await sendFeedback(view.sessionId, action);
      onHistoryChange();
    } catch (err) {
      setNotice(err.message);
    }
  }

  return (
    <div className="research-panel" data-agent-id="research-panel">
      <div className="research-header">
        <h2 className="research-title">Deep Research</h2>
        <span className={`research-status ${view.status}`}>{view.status}</span>
      </div>
      <div className="research-engine-toggle">
        <span className="research-engine-label">Engine</span>
        <button
          type="button"
          className={engine === "local" ? "active" : ""}
          disabled={busy}
          onClick={() => setEngine("local")}
          title="Self-hosted ds4-server + your providers + ORCID"
        >
          Local
        </button>
        <button
          type="button"
          className={engine === "gemini" ? "active" : ""}
          disabled={busy}
          onClick={() => setEngine("gemini")}
          title="Google Gemini Deep Research — paid cloud (~$1–7/task), data leaves this host"
        >
          Gemini
        </button>
        <button
          type="button"
          className={engine === "prism" ? "active" : ""}
          disabled={busy}
          onClick={() => setEngine("prism")}
          title="Prism web runtime via prism-pp-cli and PRISM_COOKIES"
        >
          Prism
        </button>
        {engine === "prism" ? (
          <button
            type="button"
            className="research-reauth"
            onClick={handlePrismReauth}
            title="Refresh Prism authentication cookies"
          >
            <RefreshCw size={14} /> Reauth
          </button>
        ) : null}
      </div>
      <form className="research-form" onSubmit={handleStart}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Research question…"
          rows={3}
          disabled={busy}
        />
        <div className="research-actions">
          <button type="submit" disabled={busy || !query.trim()}>
            <Play size={16} /> Start
          </button>
          <button type="button" onClick={handleCancel} disabled={!busy}>
            <Square size={16} /> Cancel
          </button>
          <label className={`research-upload ${busy ? "disabled" : ""}`} title="Attach a document for RAG">
            <Upload size={16} /> {uploading ? "Uploading…" : "Add document"}
            <input type="file" onChange={handleUpload} disabled={busy || uploading} hidden />
          </label>
        </div>
      </form>
      {pendingDocs.length ? (
        <div className="research-docs">
          {pendingDocs.map((d, i) => (
            <span key={`${d.name}-${i}`} className="research-doc-chip">{d.name}</span>
          ))}
        </div>
      ) : null}
      {notice ? <div className="research-notice error">{notice}</div> : null}
      <ResearchThoughtChain nodes={view.nodes} />
      {view.status === "waiting_feedback" && view.plan ? (
        <ResearchPlanReview
          plan={view.plan}
          onAccept={() => handleFeedback("accept")}
          onRegenerate={() => handleFeedback("regenerate")}
        />
      ) : null}
      <ResearchSources sources={view.sources} />
      {view.report ? (
        <div className="research-report">
          <div className="research-export">
            <a href={researchExportUrl(view.sessionId, "md")} download>
              <Download size={14} /> MD
            </a>
            <a href={researchExportUrl(view.sessionId, "html")} download>
              <Download size={14} /> HTML
            </a>
            <a href={researchExportUrl(view.sessionId, "pdf")} download>
              <Download size={14} /> PDF
            </a>
          </div>
          <MessageContent content={view.report} />
        </div>
      ) : null}
      {view.error ? <div className="research-notice error">{view.error}</div> : null}
    </div>
  );
}
