import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime
} from "@assistant-ui/react";
import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import "./aguiPoc.css";

const THREAD_URL = "/api/agui/thread";
const THREADS_URL = "/api/agui/threads";
const AGENT_URL = "/api/agui/agent";

function textOf(append) {
  return append.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { code: body.code || "HTTP_ERROR", status: response.status });
  return body;
}

function fromServerMessage(message) {
  return { id: message.id, role: message.role, content: [{ type: "text", text: message.content }] };
}

function useDs4Agui() {
  const [capability, setCapability] = useState(null);
  const [thread, setThread] = useState(null);
  const [threads, setThreads] = useState([]);
  const [threadCursor, setThreadCursor] = useState(null);
  const [messageCursor, setMessageCursor] = useState(null);
  const [pages, setPages] = useState([]);
  const [pageDrafts, setPageDrafts] = useState([]);
  const [pageDraft, setPageDraft] = useState(null);
  const [pageForm, setPageForm] = useState({ pageId: null, baseRevision: 0, slug: "", title: "", content: "" });
  const [dots, setDots] = useState([]);
  const [dotBinding, setDotBinding] = useState(null);
  const [dotName, setDotName] = useState("");
  const [dotId, setDotId] = useState(null);
  const [dotRevision, setDotRevision] = useState(null);
  const [dotJson, setDotJson] = useState('{\n  "instructions": "",\n  "skills": [],\n  "profile": {}\n}');
  const [dotToolOptions, setDotToolOptions] = useState([]);
  const [selectedDotTools, setSelectedDotTools] = useState([]);
  const [selectedDotPageIds, setSelectedDotPageIds] = useState([]);
  const [selectedDotId, setSelectedDotId] = useState("");
  const [messages, setMessages] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("Avvio…");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  const activeAgent = useRef(null);
  const activeToolParents = useRef(new Map());
  const cancelRequested = useRef(false);

  const refreshThread = useCallback(async (threadId = null) => {
    const next = threadId
      ? await readJson(await fetch(`${THREADS_URL}/${encodeURIComponent(threadId)}?limit=199`))
      : await readJson(await fetch(THREAD_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    setThread(next);
    setMessageCursor(next.previousCursor || null);
    return next;
  }, []);

  const refreshThreads = useCallback(async ({ after = null, append = false } = {}) => {
    const query = new URLSearchParams({ limit: "50" });
    if (after) query.set("after", after);
    const page = await readJson(await fetch(`${THREADS_URL}?${query}`));
    setThreads((previous) => append ? [...previous, ...(page.threads || [])] : page.threads || []);
    setThreadCursor(page.nextCursor || null);
    return page.threads || [];
  }, []);

  const refreshPages = useCallback(async (threadId) => {
    if (!threadId) return;
    const result = await readJson(await fetch(`/api/agui/pages?threadId=${encodeURIComponent(threadId)}`));
    setPages(result.pages || []);
    setPageDrafts(result.drafts || []);
  }, []);

  const refreshDots = useCallback(async (threadId) => {
    if (!threadId) { setDots([]); setDotBinding(null); setDotToolOptions([]); return; }
    const result = await readJson(await fetch(`/api/agui/dots?threadId=${encodeURIComponent(threadId)}`));
    setDots(result.dots || []);
    setDotToolOptions(result.tools || []);
    setDotBinding(result.binding || null);
    setSelectedDotId(result.binding?.dotId || "");
  }, []);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const info = await readJson(await fetch("/api/agui/capability"));
        if (!current) return;
        setCapability(info);
        if (!info.enabled) {
          setStatus(info.reason || "AG-UI non disponibile");
          return;
        }
        const available = info.durableHistory ? await refreshThreads() : [];
        const next = available.length ? await refreshThread(available[0].threadId) : await refreshThread();
        if (info.durableHistory && available.length === 0) await refreshThreads();
        if (info.durableHistory) await refreshPages(next.threadId);
        if (info.durableHistory) await refreshDots(next.threadId);
        if (current) {
          setMessages(next.messages.map(fromServerMessage));
          setStatus(info.durableHistory ? "Cronologia locale pronta · loop DS4 JS" : "Connesso al loop DS4 JS");
        }
      } catch (cause) {
        if (current) { setError(cause.message); setStatus("Errore di inizializzazione"); }
      }
    })();
    return () => { current = false; activeAgent.current?.abortRun(); };
  }, [refreshDots, refreshPages, refreshThread, refreshThreads]);

  const upsert = useCallback((id, update) => {
    setMessages((previous) => {
      const index = previous.findIndex((message) => message.id === id);
      const original = index < 0 ? { id, role: "assistant", content: [], status: { type: "running" } } : previous[index];
      const next = update(original);
      if (index < 0) return [...previous, next];
      return previous.map((message, at) => at === index ? next : message);
    });
  }, []);

  const onNew = useCallback(async (append) => {
    if (!thread || isRunning || activeAgent.current) return;
    const content = textOf(append);
    const userId = `u-${crypto.randomUUID()}`;
    cancelRequested.current = false;
    const agent = new HttpAgent({ url: AGENT_URL, threadId: thread.threadId });
    for (const message of thread.messages) agent.addMessage({ id: message.id, role: message.role, content: message.content });
    agent.addMessage({ id: userId, role: "user", content });
    activeAgent.current = agent;
    activeToolParents.current = new Map();
    setMessages((previous) => [...previous, { id: userId, role: "user", content: [{ type: "text", text: content }] }]);
    setIsRunning(true);
    setError("");
    setOutcome("in esecuzione");
    setStatus("Richiesta al loop DS4…");
    try {
      await agent.runAgent({ forwardedProps: { ds4: { baseRevision: thread.revision } } }, {
        onEvent: ({ event }) => {
          switch (event.type) {
            case EventType.TEXT_MESSAGE_START:
              upsert(event.messageId, (message) => message);
              break;
            case EventType.TEXT_MESSAGE_CONTENT:
              upsert(event.messageId, (message) => {
                const parts = [...message.content];
                const last = parts.at(-1);
                if (last?.type === "text") parts[parts.length - 1] = { ...last, text: last.text + event.delta };
                else parts.push({ type: "text", text: event.delta });
                return { ...message, content: parts };
              });
              break;
            case EventType.TOOL_CALL_START: {
              const parent = event.parentMessageId || `${event.toolCallId}-msg`;
              activeToolParents.current.set(event.toolCallId, parent);
              upsert(parent, (message) => ({ ...message, content: [...message.content, { type: "tool-call", toolCallId: event.toolCallId, toolName: event.toolCallName, argsText: "" }] }));
              break;
            }
            case EventType.TOOL_CALL_ARGS: {
              const parent = activeToolParents.current.get(event.toolCallId);
              upsert(parent, (message) => ({ ...message, content: message.content.map((part) => part.toolCallId === event.toolCallId ? { ...part, argsText: part.argsText + event.delta } : part) }));
              break;
            }
            case EventType.TOOL_CALL_END: {
              const parent = activeToolParents.current.get(event.toolCallId);
              upsert(parent, (message) => ({ ...message, content: message.content.map((part) => part.toolCallId === event.toolCallId ? { ...part, args: JSON.parse(part.argsText || "{}") } : part) }));
              break;
            }
            case EventType.TOOL_CALL_RESULT: {
              const parent = activeToolParents.current.get(event.toolCallId) || `${event.toolCallId}-msg`;
              activeToolParents.current.set(event.toolCallId, parent);
              upsert(parent, (message) => {
                const hasCall = message.content.some((part) => part.toolCallId === event.toolCallId);
                const contentParts = hasCall
                  ? message.content.map((part) => part.toolCallId === event.toolCallId ? { ...part, result: event.content } : part)
                  : [...message.content, { type: "tool-call", toolCallId: event.toolCallId, toolName: "tool", args: {}, result: event.content }];
                return { ...message, content: contentParts };
              });
              break;
            }
            case EventType.CUSTOM:
              if (event.name === "ds4.status" || event.name === "ds4.verification") setStatus(JSON.stringify(event.value));
              if (event.name === "ds4.error") setError(event.value?.message || "Errore DS4");
              break;
            default:
              break;
          }
        },
        onRunFinishedEvent: ({ outcome: result }) => {
          setOutcome(result);
          setStatus(result === "success" ? "Turno completato" : `Turno: ${result}`);
          setMessages((previous) => previous.map((message) => message.status?.type === "running" ? { ...message, status: { type: "complete", reason: "stop" } } : message));
        },
        onRunErrorEvent: ({ event }) => {
          if (cancelRequested.current) {
            setOutcome("cancelled");
            setStatus("Turno annullato");
          } else {
            setError(`${event.code}: ${event.message}`);
            setOutcome("error");
            setStatus("Il run DS4 ha restituito un errore");
          }
        }
      });
      await refreshThread(thread.threadId);
      if (capability?.durableHistory) await refreshThreads();
    } catch (cause) {
      if (cancelRequested.current) {
        setOutcome("cancelled");
        setStatus("Turno annullato");
      } else {
        setError(`${cause.code || "AGUI_CLIENT_ERROR"}: ${cause.message}`);
        setOutcome("error");
        setStatus("Richiesta fallita");
      }
    } finally {
      activeAgent.current = null;
      setIsRunning(false);
    }
  }, [capability?.durableHistory, isRunning, refreshThread, refreshThreads, thread, upsert]);

  const openThread = useCallback(async (threadId) => {
    try {
      const next = await refreshThread(threadId);
      setMessages(next.messages.map(fromServerMessage));
      await refreshPages(next.threadId);
      await refreshDots(next.threadId);
      setPageDraft(null);
      setError("");
      setOutcome("");
      setStatus("Thread locale aperto");
    } catch (cause) { setError(cause.message); }
  }, [refreshDots, refreshPages, refreshThread]);

  const loadPreviousMessages = useCallback(async () => {
    if (!thread || messageCursor === null) return;
    try {
      const page = await readJson(await fetch(`${THREADS_URL}/${encodeURIComponent(thread.threadId)}?limit=199&before=${messageCursor}`));
      setMessages((previous) => [...page.messages.map(fromServerMessage), ...previous]);
      setMessageCursor(page.previousCursor || null);
    } catch (cause) { setError(cause.message); }
  }, [messageCursor, thread]);

  const startPage = useCallback(() => {
    setPageDraft(null);
    setPageForm({ pageId: null, baseRevision: 0, slug: "", title: "", content: "" });
  }, []);

  const editDot = useCallback((dot) => {
    setDotId(dot?.dotId || null);
    setDotRevision(dot?.revision || null);
    setDotName(dot?.name || "");
    setDotJson(JSON.stringify({ instructions: dot?.instructions || "", skills: dot?.skills || [], profile: dot?.profile || {} }, null, 2));
    setSelectedDotTools(dot?.allowedTools || []);
    setSelectedDotPageIds(dot?.allowedPageIds || []);
  }, []);

  const saveDot = useCallback(async () => {
    try {
      const preset = JSON.parse(dotJson);
      const body = { ...preset, allowedTools: selectedDotTools, allowedPageIds: selectedDotPageIds, name: dotName, ...(dotId ? { baseRevision: dotRevision } : {}) };
      const result = await readJson(await fetch(dotId ? `/api/agui/dots/${encodeURIComponent(dotId)}` : "/api/agui/dots", {
        method: dotId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      }));
      editDot(result);
      await refreshDots(thread?.threadId);
      setStatus(dotId ? "Dot versionato" : "Dot creato");
    } catch (cause) { setError(cause instanceof SyntaxError ? "Configurazione Dot: JSON non valido" : cause.message); }
  }, [dotId, dotJson, dotName, dotRevision, editDot, refreshDots, selectedDotPageIds, selectedDotTools, thread]);

  const assignDot = useCallback(async () => {
    if (!thread) return;
    try {
      const dot = dots.find((item) => item.dotId === selectedDotId);
      const result = await readJson(await fetch(`/api/agui/threads/${encodeURIComponent(thread.threadId)}/dot`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dot ? { dotId: dot.dotId, revision: dot.revision } : { dotId: null })
      }));
      setDotBinding(result.binding || null);
      setStatus(result.binding ? `Dot ${result.binding.name} r${result.binding.revision} assegnato` : "Dot rimosso dal thread");
      await refreshDots(thread.threadId);
    } catch (cause) { setError(cause.message); }
  }, [dots, refreshDots, selectedDotId, thread]);

  const openPage = useCallback(async (pageId) => {
    try {
      const page = await readJson(await fetch(`/api/agui/pages/${encodeURIComponent(pageId)}`));
      setPageDraft(null);
      setPageForm({ pageId: page.pageId, baseRevision: page.revision, slug: page.slug, title: page.title, content: page.content });
    } catch (cause) { setError(cause.message); }
  }, []);

  const reviewPageDraft = useCallback((draft) => {
    setPageDraft(draft);
    setPageForm({ pageId: draft.candidate.pageId, baseRevision: draft.candidate.baseRevision, slug: draft.candidate.slug, title: draft.candidate.title, content: draft.candidate.content });
  }, []);

  const proposePage = useCallback(async (action = "upsert") => {
    if (!thread) return;
    try {
      const draft = await readJson(await fetch("/api/agui/pages/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pageForm, threadId: thread.threadId, action }) }));
      setPageDraft(draft);
      await refreshPages(thread.threadId);
      setStatus("Bozza pagina pronta per revisione");
    } catch (cause) { setError(cause.message); }
  }, [pageForm, refreshPages, thread]);

  const decidePageDraft = useCallback(async (decision) => {
    if (!thread || !pageDraft) return;
    try {
      const result = await readJson(await fetch(`/api/agui/pages/drafts/${encodeURIComponent(pageDraft.draftId)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.threadId, decision, candidateHash: pageDraft.candidateHash })
      }));
      setPageDraft(null);
      if (result.page) setPageForm({ pageId: result.page.pageId, baseRevision: result.page.revision, slug: result.page.slug, title: result.page.title, content: result.page.content });
      await refreshPages(thread.threadId);
      setStatus(decision === "approve" ? "Pagina applicata una volta" : "Bozza rifiutata");
    } catch (cause) { setError(cause.message); }
  }, [pageDraft, refreshPages, thread]);

  const newThread = useCallback(async () => {
    try {
      const next = await readJson(await fetch(THREADS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nuova conversazione" }) }));
      setThread(next);
      setMessages([]);
      await refreshThreads();
      await refreshPages(next.threadId);
      await refreshDots(next.threadId);
      setPageDraft(null);
      setStatus("Nuovo thread locale");
    } catch (cause) { setError(cause.message); }
  }, [refreshDots, refreshPages, refreshThreads]);

  const archiveCurrentThread = useCallback(async () => {
    if (!thread || isRunning) return;
    try {
      await readJson(await fetch(`${THREADS_URL}/${encodeURIComponent(thread.threadId)}/archive`, { method: "POST" }));
      const available = await refreshThreads();
      if (available.length) await openThread(available[0].threadId);
      else {
        const next = await readJson(await fetch(THREADS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nuova conversazione" }) }));
        setThread(next); setMessages([]);
        await refreshPages(next.threadId);
        await refreshDots(next.threadId);
        await refreshThreads();
      }
      setStatus("Thread archiviato");
    } catch (cause) { setError(cause.message); }
  }, [isRunning, openThread, refreshDots, refreshPages, refreshThreads, thread]);

  const deleteCurrentThread = useCallback(async () => {
    if (!thread || isRunning || !window.confirm("Eliminare definitivamente questa conversazione e la sua cronologia?")) return;
    try {
      await readJson(await fetch(`${THREADS_URL}/${encodeURIComponent(thread.threadId)}`, { method: "DELETE" }));
      const available = await refreshThreads();
      if (available.length) await openThread(available[0].threadId);
      else {
        const next = await readJson(await fetch(THREADS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nuova conversazione" }) }));
        setThread(next);
        setMessages([]);
        await refreshPages(next.threadId);
        await refreshDots(next.threadId);
        await refreshThreads();
      }
      setStatus("Conversazione eliminata");
      setOutcome("");
    } catch (cause) { setError(cause.message); }
  }, [isRunning, openThread, refreshDots, refreshPages, refreshThreads, thread]);

  const exportCurrentThread = useCallback(async () => {
    if (!thread) return;
    try {
      const data = await readJson(await fetch(`${THREADS_URL}/${encodeURIComponent(thread.threadId)}/export`));
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${thread.threadId}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause.message); }
  }, [thread]);

  const importLegacy = useCallback(async () => {
    try {
      const raw = localStorage.getItem("ds4.session");
      if (!raw) throw new Error("Nessuna sessione legacy ds4.session trovata nel browser");
      const legacy = JSON.parse(raw);
      const result = await readJson(await fetch("/api/agui/import/legacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legacy) }));
      await openThread(result.thread.threadId);
      await refreshThreads();
      setStatus(result.imported ? "Sessione legacy importata" : "Sessione legacy già importata");
      if (result.warnings?.length) setError(result.warnings.join(" · "));
    } catch (cause) { setError(cause.message); }
  }, [openThread, refreshThreads]);

  const loadMoreThreads = useCallback(async () => {
    if (threadCursor) await refreshThreads({ after: threadCursor, append: true });
  }, [refreshThreads, threadCursor]);

  const onCancel = useCallback(async () => {
    cancelRequested.current = true;
    activeAgent.current?.abortRun();
    setOutcome("cancelled");
    setStatus("Stop richiesto; attendo il teardown DS4");
  }, []);

  const runtime = useExternalStoreRuntime({ messages, isRunning, onNew, onCancel, convertMessage: (message) => message });
  return { runtime, capability, status, outcome, error, isRunning, onCancel, thread, threads, messages, threadCursor, messageCursor, pages, pageDrafts, pageDraft, pageForm, setPageForm, dots, dotBinding, dotName, setDotName, dotJson, setDotJson, dotToolOptions, selectedDotTools, setSelectedDotTools, selectedDotPageIds, setSelectedDotPageIds, dotId, selectedDotId, setSelectedDotId, editDot, saveDot, assignDot, openThread, newThread, archiveCurrentThread, deleteCurrentThread, exportCurrentThread, importLegacy, loadMoreThreads, loadPreviousMessages, startPage, openPage, reviewPageDraft, proposePage, decidePageDraft };
}

const Text = ({ text }) => <span>{text}</span>;
const ToolFallback = ({ toolName, argsText, result }) => (
  <article className="agui-tool" data-tool={toolName}>
    <strong>{toolName}</strong><pre>{argsText || "{}"}</pre><div>{result ?? "in esecuzione"}</div>
  </article>
);
function Message() {
  return <MessagePrimitive.Root className="agui-message"><MessagePrimitive.Parts components={{ Text, tools: { Fallback: ToolFallback } }} /></MessagePrimitive.Root>;
}

function AguiPoc() {
  const { runtime, capability, status, outcome, error, isRunning, onCancel, thread, threads, messages, threadCursor, messageCursor, pages, pageDrafts, pageDraft, pageForm, setPageForm, dots, dotBinding, dotName, setDotName, dotJson, setDotJson, dotToolOptions, selectedDotTools, setSelectedDotTools, selectedDotPageIds, setSelectedDotPageIds, dotId, selectedDotId, setSelectedDotId, editDot, saveDot, assignDot, openThread, newThread, archiveCurrentThread, deleteCurrentThread, exportCurrentThread, importLegacy, loadMoreThreads, loadPreviousMessages, startPage, openPage, reviewPageDraft, proposePage, decidePageDraft } = useDs4Agui();
  const components = useMemo(() => ({ UserMessage: Message, AssistantMessage: Message }), []);
  return (
    <main className="agui-poc">
      <aside className="agui-sidebar" aria-label="Navigazione OpenDots">
        <a className="agui-brand" href="/agui-poc.html" aria-label="DS4 OpenDots">● <strong>OpenDots</strong><span>DS4</span></a>
        <button className="agui-new-thread" type="button" onClick={newThread}>＋ <span>Nuova conversazione</span></button>
        <div className="agui-sidebar-label">Conversazioni</div>
        <nav className="agui-thread-list" aria-label="Conversazioni locali">
          {threads.map((item) => <button type="button" key={item.threadId} aria-current={item.threadId === thread?.threadId ? "page" : undefined} onClick={() => openThread(item.threadId)}>
            <span className="agui-thread-dot" aria-hidden="true">●</span><span>{item.title || item.preview?.slice(0, 48) || "Nuova conversazione"}</span>
          </button>)}
        </nav>
        {threadCursor && <button className="agui-load-threads" type="button" onClick={loadMoreThreads}>Carica altre</button>}
        <div className="agui-sidebar-bottom">
          <button type="button" onClick={importLegacy}>Importa ds4.session</button>
          <a href="/">← Torna a DS4</a>
        </div>
      </aside>
      <section className="agui-main">
      <header className="agui-topbar"><div><span className="agui-breadcrumb">DS4 Studio <span>/</span> <strong>{thread?.title || "Conversazione"}</strong></span></div><div className="agui-top-actions">
        <span className="agui-engine-badge"><i /> Loop JS DS4</span>
        {thread && <><button type="button" onClick={exportCurrentThread} aria-label="Esporta conversazione">Esporta JSON</button><button type="button" onClick={archiveCurrentThread} disabled={isRunning}>Archivia</button><button className="agui-danger" type="button" onClick={deleteCurrentThread} disabled={isRunning}>Elimina</button></>}
      </div></header>
      <div className="agui-chat-heading"><div className="agui-avatar" aria-hidden="true">D</div><div><h1>{dotBinding?.name || "DS4"}</h1><span data-testid="status">{status}</span></div><div className="agui-chat-controls"><span>{outcome ? `Esito: ${outcome}` : ""}</span></div></div>
      {error && <pre className="agui-error" role="alert">{error}</pre>}
      {capability?.enabled ? (
        <>
        {capability.durableHistory && <details className="agui-settings">
          <summary>Dot e Pages <span>{dotBinding ? `${dotBinding.name} · r${dotBinding.revision}` : "Gestisci preset e pagine locali"}</span></summary>
          <div className="agui-settings-content">
          <aside className="agui-workspace" aria-label="Dots locali">
          <div className="agui-pages-heading"><h2>Dots locali</h2><span>{dotBinding ? `${dotBinding.name} · r${dotBinding.revision}` : "Preset versionati per thread nuovi"}</span></div>
          <nav className="agui-page-list">{dots.map((dot) => <button type="button" key={dot.dotId} onClick={() => editDot(dot)}>{dot.name} · r{dot.revision}</button>)}</nav>
          <div className="agui-page-form">
            <div className="agui-library-actions"><button type="button" onClick={() => editDot(null)}>Nuovo Dot</button><button type="button" onClick={saveDot}>{dotId ? "Salva nuova revisione" : "Crea Dot"}</button></div>
            <label>Nome<input value={dotName} onChange={(event) => setDotName(event.target.value)} /></label>
            <label>Impostazioni Dot JSON<textarea aria-label="Preset Dot JSON" value={dotJson} onChange={(event) => setDotJson(event.target.value)} /></label>
            <fieldset className="agui-tool-checks"><legend>Strumenti consentiti</legend>
              {dotToolOptions.length ? dotToolOptions.map((tool) => <label key={tool.id} title={tool.description}>
                <input type="checkbox" aria-label={`Tool ${tool.id}`} checked={selectedDotTools.includes(tool.id)} onChange={(event) => setSelectedDotTools((current) => event.target.checked ? [...current, tool.id] : current.filter((name) => name !== tool.id))} />
                <span><strong>{tool.id}</strong><small>{tool.description}</small></span>
              </label>) : <small>Caricamento catalogo strumenti…</small>}
            </fieldset>
            <fieldset className="agui-tool-checks agui-page-checks" aria-label="Pages accessibili"><legend>Pages condivise col Dot</legend>
              {pages.length ? pages.map((page) => <label key={page.pageId} title={`${page.title} · revisione ${page.revision}`}>
                <input type="checkbox" aria-label={`Page ${page.slug}`} checked={selectedDotPageIds.includes(page.pageId)} onChange={(event) => setSelectedDotPageIds((current) => event.target.checked ? [...current, page.pageId] : current.filter((id) => id !== page.pageId))} />
                <span><strong>{page.title || page.slug}</strong><small>{page.slug} · r{page.revision}</small></span>
              </label>) : <small>Crea prima una Page nel pannello Pages locali.</small>}
            </fieldset>
            <label>Assegna al thread vuoto<select value={selectedDotId} onChange={(event) => setSelectedDotId(event.target.value)} disabled={!thread || thread.revision !== 0 || isRunning}>
              <option value="">Nessun Dot</option>{dots.map((dot) => <option key={dot.dotId} value={dot.dotId}>{dot.name} · r{dot.revision}</option>)}
            </select></label>
            <button type="button" onClick={assignDot} disabled={!thread || thread.revision !== 0 || isRunning}>Applica preset selezionato</button>
            {thread?.revision !== 0 && <small>Per cambiare Dot, crea un thread nuovo.</small>}
          </div>
          </aside>
          <aside className="agui-workspace" aria-label="Pages locali">
          <div className="agui-pages-heading"><h2>Pages locali</h2><span>Owner corrente · revisione draft/apply</span></div>
          <nav className="agui-page-list">{pages.map((page) => <button type="button" key={page.pageId} onClick={() => openPage(page.pageId)}>{page.title} · r{page.revision}</button>)}</nav>
          <div className="agui-page-form">
            <div className="agui-library-actions"><button type="button" onClick={startPage}>Nuova pagina</button>{pageForm.pageId && <button type="button" onClick={() => proposePage("delete")}>Proponi archiviazione</button>}</div>
            <label>Slug<input value={pageForm.slug} onChange={(event) => setPageForm((value) => ({ ...value, slug: event.target.value }))} /></label>
            <label>Titolo<input value={pageForm.title} onChange={(event) => setPageForm((value) => ({ ...value, title: event.target.value }))} /></label>
            <label>Contenuto<textarea value={pageForm.content} onChange={(event) => setPageForm((value) => ({ ...value, content: event.target.value }))} /></label>
            <button type="button" onClick={() => proposePage("upsert")}>Prepara bozza</button>
          </div>
          {pageDraft && <article className="agui-page-review"><h3>Revisione {pageDraft.candidate.action} · SHA-256</h3><code>{pageDraft.candidateHash}</code><pre>{pageDraft.candidate.content}</pre><div className="agui-library-actions"><button type="button" onClick={() => decidePageDraft("approve")}>Approva e applica</button><button type="button" onClick={() => decidePageDraft("decline")}>Rifiuta</button></div></article>}
          {!!pageDrafts.filter((draft) => draft.status === "pending").length && <nav className="agui-page-drafts" aria-label="Bozze in revisione">{pageDrafts.filter((draft) => draft.status === "pending").map((draft) => <button type="button" key={draft.draftId} onClick={() => reviewPageDraft(draft)}>Rivedi: {draft.candidate.title || draft.candidate.slug}</button>)}</nav>}
          </aside>
          </div>
        </details>}
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="agui-thread">
            {messageCursor !== null && <button className="agui-history-more" type="button" onClick={loadPreviousMessages}>Carica messaggi precedenti</button>}
            <ThreadPrimitive.Viewport className="agui-viewport">
              {messages.length === 0 && <div className="agui-empty"><span className="agui-empty-orb">✦</span><h2>Da dove vuoi iniziare?</h2><p>Scrivi al tuo Dot. La conversazione resta salvata localmente.</p></div>}
              <ThreadPrimitive.Messages components={components} />
            </ThreadPrimitive.Viewport>
            <ComposerPrimitive.Root className="agui-composer">
              <ComposerPrimitive.Input aria-label="Messaggio" placeholder="Scrivi al loop DS4…" disabled={isRunning} />
              {isRunning ? <button type="button" onClick={onCancel}>Stop</button> : <ComposerPrimitive.Send>Invia</ComposerPrimitive.Send>}
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
        </>
      ) : <section className="agui-disabled">Chat locale non disponibile. Avvia il server con AG-UI e il motore JavaScript.</section>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<AguiPoc />);
