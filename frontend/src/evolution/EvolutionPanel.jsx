import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RefreshCw, RotateCcw, ShieldCheck, Square, XCircle } from "lucide-react";

import {
  approveEvolutionRevision,
  cancelEvolutionRun,
  createEvolutionRun,
  fetchEvolutionRevision,
  fetchEvolutionRun,
  listEvolutionRuns,
  openEvolutionStream,
  rejectEvolutionRevision,
  rollbackEvolutionRevision,
  startEvolutionRun
} from "./evolutionApi.mjs";
import { applyEvolutionEvent, initialEvolutionView, replaceEvolutionRun } from "./evolutionStore.mjs";

const DEFAULT_TASK = {
  contractVersion: "ds4_evolution_task_v2",
  taskId: "dashboard-task",
  title: "Dashboard Evolution task",
  objective: "Aggiungere una policy di sicurezza al fixture senza avviare server, senza introdurre dipendenze e senza effetti collaterali all'import",
  workspaceRoot: ".",
  mutablePaths: ["frontend/server/example.mjs"],
  immutablePaths: ["frontend/server/evolution"],
  baselineRef: "HEAD",
  evaluators: [{
    id: "security-policy",
    required: true,
    configuration: {
      type: "security-policy",
      files: ["frontend/server/example.mjs"],
      forbiddenPatterns: [
        { code: "APP_LISTEN_FORBIDDEN", pattern: "\\bapp\\.listen\\s*\\(" },
        { code: "EXPRESS_IMPORT_FORBIDDEN", pattern: "\\b(?:from\\s+[\\\"']express[\\\"']|require\\s*\\(\\s*[\\\"']express[\\\"'])" },
        { code: "CREATE_SERVER_FORBIDDEN", pattern: "\\bcreateServer\\s*\\(" }
      ]
    }
  }],
  metrics: [{ name: "security_passed", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }],
  budgets: {
    maxRevisions: 3, maxFilesChanged: 3, maxAddedLines: 300, maxDeletedLines: 300,
    maxWallTimeMsPerRevision: 120000, maxPromptTokensPerRevision: 8000, maxCompletionTokensPerRevision: 8000,
    maxTotalWallTimeMs: 600000, maxTotalPromptTokens: 24000, maxTotalCompletionTokens: 24000,
    maxModelCallsPerRevision: 4, maxInfrastructureRetries: 1, maxEvaluatorRetries: 1,
    maxCriticRepairs: 1, maxProposerRepairs: 1, maxRepeatedFailureSignatures: 2, maxNoImprovementRevisions: 2
  },
  approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] },
  automation: { level: "D", criticEnabled: true, proposerEnabled: true, autoContinue: true, modelProfile: "default" }
};

export function EvolutionPanel() {
  const [runs, setRuns] = useState([]);
  const [view, setView] = useState(initialEvolutionView);
  const [revision, setRevision] = useState(null);
  const [token, setToken] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [taskText, setTaskText] = useState(() => JSON.stringify(DEFAULT_TASK, null, 2));
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef(null);
  const reviewRef = useRef(null);

  const selectedRunId = view.run?.runId ?? null;
  const canApprove = Boolean(token && reviewer && view.run?.state === "MANUAL_REVIEW" && revision?.reviewHash &&
    revision.revision === view.run.revision && revision.candidateHash && revision.parentHash);

  const refreshRuns = useCallback(async () => {
    const result = await listEvolutionRuns();
    setRuns(result.items || []);
  }, []);

  const selectRun = useCallback(async (runId) => {
    streamRef.current?.close();
    const run = await fetchEvolutionRun(runId);
    setView((current) => replaceEvolutionRun(current, run));
    setRevision(run.revision > 0 ? await fetchEvolutionRevision(runId, run.revision) : null);
    const stream = openEvolutionStream(runId, run.sequence, (event) => {
      setView((current) => applyEvolutionEvent(current, event));
    });
    stream.onopen = () => setView((current) => ({ ...current, connection: "open" }));
    stream.onerror = () => setView((current) => ({ ...current, connection: "reconnecting" }));
    streamRef.current = stream;
  }, []);

  useEffect(() => {
    refreshRuns().catch((error) => setNotice(error.message));
    return () => streamRef.current?.close();
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedRunId || !view.gap) return;
    selectRun(selectedRunId).catch((error) => setNotice(error.message));
  }, [selectedRunId, selectRun, view.gap]);

  useEffect(() => {
    if (!selectedRunId || !view.run?.revision) return;
    fetchEvolutionRevision(selectedRunId, view.run.revision).then(setRevision).catch(() => {});
  }, [selectedRunId, view.run?.revision, view.run?.state]);

  useEffect(() => {
    if (view.run?.state === "MANUAL_REVIEW") reviewRef.current?.focus();
  }, [view.run?.state, revision?.revision]);

  async function action(operation) {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      await refreshRuns();
      if (selectedRunId) await selectRun(selectedRunId);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function createRun() {
    await action(async () => {
      const created = await createEvolutionRun(JSON.parse(taskText), token);
      await selectRun(created.runId);
    });
  }

  async function approve() {
    await action(() => approveEvolutionRevision(selectedRunId, revision.revision, {
      revision: revision.revision,
      candidateHash: revision.candidateHash,
      parentHash: revision.parentHash,
      reviewHash: revision.reviewHash,
      reviewer
    }, token));
  }

  async function rollback() {
    if (!globalThis.confirm?.(`Rollback Evolution revision r${revision.revision}?`)) return;
    await action(() => rollbackEvolutionRevision(selectedRunId, revision.revision, reviewer, token));
  }

  const metrics = useMemo(() => revision?.evaluation?.aggregateMetrics ?? {}, [revision]);

  return (
    <div className="evolution-panel" data-agent-id="evolution-panel">
      <aside className="evolution-runs">
        <div className="evolution-toolbar">
          <h2>Evolution</h2>
          <button type="button" onClick={() => refreshRuns().catch((error) => setNotice(error.message))} title="Refresh runs"><RefreshCw size={15} /></button>
        </div>
        <label>Write token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label>
        <label>Reviewer<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></label>
        <details className="evolution-create">
          <summary>New Level D run</summary>
          <textarea value={taskText} onChange={(event) => setTaskText(event.target.value)} rows={12} spellCheck="false" />
          <button type="button" disabled={busy || !token} onClick={createRun}>Create</button>
        </details>
        <div className="evolution-run-list">
          {runs.map((run) => (
            <button type="button" key={run.runId} className={run.runId === selectedRunId ? "active" : ""} onClick={() => selectRun(run.runId).catch((error) => setNotice(error.message))}>
              <strong>{run.task?.title || run.runId}</strong><span>{run.state} · r{run.revision}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="evolution-workspace" aria-live="polite">
        {view.run ? (
          <>
            <header className="evolution-run-header">
              <div><h3>{view.run.task?.title}</h3><code>{view.run.runId}</code></div>
              <div className="evolution-badges"><span>Level {view.run.task?.automation?.level || "B"}</span><span>{view.run.state}</span><span>SSE {view.connection}</span></div>
            </header>
            <div className="evolution-actions">
              <button type="button" disabled={busy || !token} onClick={() => action(() => startEvolutionRun(selectedRunId, token))}><Play size={15} /> Start / resume</button>
              <button type="button" disabled={busy || !token} onClick={() => action(() => cancelEvolutionRun(selectedRunId, token))}><Square size={15} /> Cancel</button>
              {["PROMOTED", "COMPLETED"].includes(view.run.state) && !view.run.rollback ? (
                <button type="button" disabled={busy || !token || !reviewer || !revision || revision.revision !== view.run.revision} onClick={rollback}><RotateCcw size={15} /> Rollback r{revision?.revision}</button>
              ) : null}
            </div>
            {view.run.rollback ? <div className="evolution-notice">Rollback r{view.run.rollback.revision} completato · <code>{view.run.rollback.restoredHash}</code></div> : null}
            <div className="evolution-budget">Prompt {view.run.budget?.promptTokens || 0}/{view.run.budget?.limits?.promptTokens || "–"} · Completion {view.run.budget?.completionTokens || 0}/{view.run.budget?.limits?.completionTokens || "–"}</div>
            <div className="evolution-timeline">Revisioni: {Array.from({ length: view.run.revision || 0 }, (_, index) => <button type="button" key={index + 1} onClick={() => fetchEvolutionRevision(selectedRunId, index + 1).then(setRevision)}>r{index + 1}</button>)}</div>
            {revision ? (
              <div className="evolution-revision-grid">
                <section><h4>Metriche</h4><pre>{JSON.stringify(metrics, null, 2)}</pre></section>
                <section><h4>Gate deterministico</h4><pre>{JSON.stringify(revision.gateDecision, null, 2)}</pre></section>
                <section className="evolution-diff"><h4>Diff esatto</h4><pre>{revision.patch?.content || (revision.patch?.truncated ? `Artifact ${revision.patch.artifactId} (${revision.patch.bytes} bytes)` : "Non disponibile")}</pre></section>
                <section><h4>Diagnosi <small>consultiva / non autoritativa</small></h4><pre>{JSON.stringify(revision.diagnosis, null, 2)}</pre></section>
                <section><h4>Evidenze del candidato</h4><pre>{JSON.stringify(revision.candidate, null, 2)}</pre></section>
              </div>
            ) : null}
            {view.run.state === "MANUAL_REVIEW" && revision ? (
              <div ref={reviewRef} tabIndex={-1} className="evolution-review" role="dialog" aria-modal="true" aria-label="Evolution manual review">
                <h4><ShieldCheck size={16} /> Revisione manuale r{revision.revision}</h4>
                <p>Candidate <code>{revision.candidateHash}</code></p><p>Parent <code>{revision.parentHash}</code></p>
                <pre>{revision.patch?.content}</pre>
                <div><button type="button" disabled={!canApprove || busy} onClick={approve}>Approve</button><button type="button" disabled={!token || !reviewer || busy} onClick={() => action(() => rejectEvolutionRevision(selectedRunId, revision.revision, reviewer, token))}><XCircle size={15} /> Reject</button></div>
              </div>
            ) : null}
          </>
        ) : <p>Seleziona o crea un run Evolution.</p>}
        {notice ? <div className="evolution-notice" role="alert">{notice}</div> : null}
      </section>
    </div>
  );
}
