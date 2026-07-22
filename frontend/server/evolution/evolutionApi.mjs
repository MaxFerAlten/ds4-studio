/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md UI/API requirements.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: Express server and SSE conventions.
 */

import express from "express";

import { timingSafeHexEqual } from "./evolutionIntegrity.mjs";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function integer(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

function conflict(message) {
  const error = new Error(message);
  error.code = "REVIEW_HASH_MISMATCH";
  error.status = 409;
  return error;
}

const LEVEL_RANK = Object.freeze({ B: 0, C: 1, D: 2, E: 3 });

export function assertConfiguredLevel(task, maxLevel = "B") {
  const requested = task?.contractVersion === "ds4_evolution_task_v2" ? task?.automation?.level : "B";
  if (!Object.hasOwn(LEVEL_RANK, requested) || !Object.hasOwn(LEVEL_RANK, maxLevel) || LEVEL_RANK[requested] > LEVEL_RANK[maxLevel]) {
    const error = new Error(`Evolution Level ${requested ?? "unknown"} is disabled by maxLevel ${maxLevel}`);
    error.code = "EVOLUTION_LEVEL_DISABLED";
    error.status = 403;
    throw error;
  }
  return requested;
}

export function assertReviewBinding(body, current) {
  if (body?.revision !== current?.revision || !timingSafeHexEqual(body?.candidateHash, current?.candidateHash) ||
      !timingSafeHexEqual(body?.parentHash, current?.parentHash) || !timingSafeHexEqual(body?.reviewHash, current?.reviewHash)) {
    throw conflict("review is stale or not bound to the current candidate");
  }
  return true;
}

export function createEvolutionRouter({ runtime, runStore, auth, views, repositoryRoot, enabled = true, maxLevel = "B", maxReplay = 1000 } = {}) {
  if (!runtime || !runStore || !auth || !views) throw new TypeError("runtime, runStore, auth and views are required");
  const router = express.Router();
  router.use((req, res, next) => enabled ? next() : res.status(404).json({ error: "EVOLUTION_DISABLED" }));
  const write = auth.requireWrite.bind(auth);

  router.get("/runs", asyncRoute(async (req, res) => {
    const limit = integer(req.query.limit, 50, 100);
    if (limit === null) return res.status(400).json({ error: "INVALID_LIMIT" });
    const listed = await runStore.listRuns({ cursor: req.query.cursor || null, limit });
    res.json({ items: listed.items.map((run) => views.run(run)), nextCursor: listed.nextCursor });
  }));

  router.post("/runs", write, asyncRoute(async (req, res) => {
    assertConfiguredLevel(req.body, maxLevel);
    const created = await runtime.orchestrator.createRun(req.body, { repositoryRoot });
    res.status(201).json(views.run(await runStore.loadRun(created.runId)));
  }));

  router.get("/runs/:runId", asyncRoute(async (req, res) => res.json(views.run(await runStore.loadRun(req.params.runId)))));

  router.post("/runs/:runId/start", write, asyncRoute(async (req, res) => {
    runtime.resume(req.params.runId);
    res.status(202).json({ runId: req.params.runId, running: true });
  }));

  router.post("/runs/:runId/cancel", write, asyncRoute(async (req, res) => {
    res.json(views.run(await runtime.cancel(req.params.runId)));
  }));

  router.get("/runs/:runId/events", asyncRoute(async (req, res) => {
    const afterSequence = integer(req.query.afterSequence, 0);
    const limit = integer(req.query.limit, 100, maxReplay);
    if (afterSequence === null || limit === null) return res.status(400).json({ error: "INVALID_CURSOR" });
    const events = (await runStore.readEvents(req.params.runId)).filter((event) => event.sequence > afterSequence).slice(0, limit);
    res.json({ events: events.map((event) => views.event(event)), nextSequence: events.at(-1)?.sequence ?? afterSequence });
  }));

  router.get("/runs/:runId/stream", asyncRoute(async (req, res) => {
    const afterSequence = integer(req.query.afterSequence, 0);
    if (afterSequence === null) return res.status(400).json({ error: "INVALID_CURSOR" });
    res.status(200);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders?.();
    let closed = false;
    let replaying = true;
    let lastSequence = afterSequence;
    let unsubscribe = () => {};
    const pending = [];
    const send = (event) => {
      if (closed || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      if (!res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(views.event(event))}\n\n`)) {
        closed = true;
        unsubscribe();
        res.end();
      }
    };
    unsubscribe = runtime.subscribe(req.params.runId, (event) => replaying ? pending.push(event) : send(event));
    let replay;
    try {
      replay = (await runStore.readEvents(req.params.runId)).filter((event) => event.sequence > afterSequence).slice(0, maxReplay);
    } catch (error) {
      unsubscribe();
      throw error;
    }
    replay.forEach(send);
    replaying = false;
    pending.sort((left, right) => left.sequence - right.sequence).forEach(send);
    const heartbeat = setInterval(() => { if (!closed) res.write(": heartbeat\n\n"); }, 15_000);
    heartbeat.unref?.();
    req.on("close", () => { closed = true; clearInterval(heartbeat); unsubscribe(); });
  }));

  router.post("/runs/:runId/candidates", write, asyncRoute(async (req, res) => {
    const run = await runStore.loadRun(req.params.runId);
    assertConfiguredLevel(run.manifest.taskContract, maxLevel);
    if (run.manifest.taskContract.automation?.proposerEnabled === true) {
      const error = new Error("Cannot submit manual candidate to an automated run");
      error.code = "MANUAL_CANDIDATE_FOR_AUTOMATED_RUN";
      error.status = 409;
      throw error;
    }
    const result = await runtime.orchestrator.runManualCandidate(req.params.runId, {
      proposal: req.body?.proposal,
      patchText: req.body?.patchText
    });
    res.status(202).json({
      run: views.run(await runStore.loadRun(req.params.runId)),
      result: { state: result.state, gateDecision: result.gateDecision ?? null }
    });
  }));

  router.get("/runs/:runId/revisions/:revision", asyncRoute(async (req, res) => {
    const revision = integer(req.params.revision, null);
    if (!revision || revision <= 0) return res.status(400).json({ error: "INVALID_REVISION" });
    res.json(await views.revision(req.params.runId, revision));
  }));

  router.post("/runs/:runId/revisions/:revision/approve", write, asyncRoute(async (req, res) => {
    const revision = integer(req.params.revision, null);
    const current = await views.revision(req.params.runId, revision);
    assertReviewBinding(req.body, { ...current, revision });
    const reviewer = auth.validateReviewer(req.body?.reviewer);
    const approval = await runtime.orchestrator.issueManualApproval(req.params.runId, revision, reviewer);
    const result = await runtime.orchestrator.approveRevision(req.params.runId, revision, approval);
    if (result.state === "PROMOTED") runtime.resume(req.params.runId);
    res.json({ run: views.run(await runStore.loadRun(req.params.runId)), result: { state: result.state } });
  }));

  router.post("/runs/:runId/revisions/:revision/reject", write, asyncRoute(async (req, res) => {
    const revision = integer(req.params.revision, null);
    auth.validateReviewer(req.body?.reviewer);
    const run = await runtime.orchestrator.rejectManualRevision(req.params.runId, revision, "HUMAN_REJECTED");
    res.json(views.run(run));
  }));

  router.post("/runs/:runId/revisions/:revision/rollback", write, asyncRoute(async (req, res) => {
    const revision = integer(req.params.revision, null);
    const reviewer = auth.validateReviewer(req.body?.reviewer);
    res.json(await runtime.orchestrator.rollbackRevision(req.params.runId, revision, reviewer));
  }));

  router.use((error, _req, res, _next) => {
    const status = error.status ?? (error.code?.includes("NOT_FOUND") ? 404 : error.code?.includes("INVALID") ? 400 : 500);
    res.status(status).json({ error: error.code ?? "EVOLUTION_ERROR", message: status >= 500 ? "Evolution request failed" : error.message });
  });
  return router;
}
