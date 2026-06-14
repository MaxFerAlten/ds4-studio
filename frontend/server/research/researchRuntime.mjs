import { makeEvent } from "./researchEvents.mjs";
import { runResearchGraph } from "./researchGraph.mjs";
import { buildSearchService } from "./researchSearchService.mjs";

export class ResearchRuntime {
  constructor({ store, clientFactory, getConfig, logger = console, searchServiceFactory }) {
    this.store = store;
    this.clientFactory = clientFactory;
    this.getConfig = getConfig;
    this.logger = logger;
    // Web search layer; overridable in tests. Defaults to building real
    // providers from config (disabled providers/keys are skipped).
    this.searchServiceFactory =
      searchServiceFactory || ((config) => buildSearchService(config.search || {}, { logger }));
    this.jobs = new Map();
  }

  #ensureJob(sessionId) {
    let job = this.jobs.get(sessionId);
    if (!job) {
      job = {
        controller: null,
        listeners: new Set(),
        pendingWrites: Promise.resolve(),
        running: false,
        promise: null
      };
      this.jobs.set(sessionId, job);
    }
    return job;
  }

  subscribe(sessionId, listener) {
    const job = this.#ensureJob(sessionId);
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  async flush(sessionId) {
    const job = this.jobs.get(sessionId);
    if (job) await job.pendingWrites;
  }

  #emit(job, state, type, content = {}, nodeName = null) {
    const event = makeEvent(state, type, content, nodeName);
    job.pendingWrites = job.pendingWrites
      .then(() => this.store.appendEvent(event))
      .catch((err) => this.logger.error(`research: failed to persist event: ${err.message}`));
    for (const listener of [...job.listeners]) {
      try {
        listener(event);
      } catch {
        // a broken subscriber must not break the research job
      }
    }
    return event;
  }

  // Create a session without launching it, so documents can be uploaded into
  // its RAG corpus before the graph runs. Status is "draft" until launched.
  async createSession(query) {
    if (typeof query !== "string" || !query.trim()) {
      throw Object.assign(new Error("query is required"), { status: 400 });
    }
    const state = await this.store.createSession(query.trim());
    state.status = "draft";
    await this.store.saveState(state);
    return { sessionId: state.sessionId };
  }

  // Launch a previously-created draft session.
  async launch(sessionId) {
    const state = await this.#loadOrThrow(sessionId);
    if (state.status !== "draft") {
      throw Object.assign(
        new Error(`session already started (status: ${state.status})`),
        { status: 409 }
      );
    }
    const job = this.#ensureJob(sessionId);
    state.status = "running";
    await this.store.saveState(state);
    this.#emit(job, state, "research_started", { query: state.query });
    this.#launch(job, state);
    return { sessionId };
  }

  async start(query) {
    const { sessionId } = await this.createSession(query);
    return this.launch(sessionId);
  }

  // Add an uploaded, already-extracted document to a draft session's corpus.
  async addDocument(sessionId, { name, markdown }) {
    const state = await this.#loadOrThrow(sessionId);
    if (state.status !== "draft") {
      throw Object.assign(
        new Error(`documents can only be added before research starts (status: ${state.status})`),
        { status: 409 }
      );
    }
    return this.store.addDocument(sessionId, { name, markdown });
  }

  #launch(job, state) {
    if (job.running) return;
    job.running = true;
    job.controller = new AbortController();
    const ctx = {
      state,
      config: this.getConfig(),
      client: this.clientFactory(),
      signal: job.controller.signal,
      rag: null,
      save: () => this.store.saveState(state),
      emit: (type, content, nodeName) => this.#emit(job, state, type, content, nodeName)
    };
    job.promise = (async () => {
      // Load the session RAG corpus (if any uploaded documents) before the graph
      // runs, so the background investigator and researchers can retrieve from it.
      ctx.rag = await this.store.loadRagIndex(state.sessionId).catch(() => null);
      // Web search layer (no-op unless research.search.enabled and a provider is
      // configured).
      try {
        ctx.searchService = this.searchServiceFactory(ctx.config);
      } catch (err) {
        this.logger?.warn?.(`research: search service unavailable: ${err.message}`);
        ctx.searchService = null;
      }
      return runResearchGraph(ctx);
    })()
      .catch(async (err) => {
        if (job.controller.signal.aborted || err?.name === "AbortError") {
          state.status = "cancelled";
          await this.store.saveState(state).catch(() => {});
          this.#emit(job, state, "research_cancelled", {});
          return;
        }
        state.status = "failed";
        state.error = err.message || String(err);
        await this.store.saveState(state).catch(() => {});
        this.#emit(job, state, "research_error", { error: state.error });
      })
      .finally(() => {
        job.running = false;
      });
  }

  async feedback(sessionId, { action, plan } = {}) {
    const state = await this.#loadOrThrow(sessionId);
    if (state.status !== "waiting_feedback") {
      throw Object.assign(
        new Error(`session is not waiting for feedback (status: ${state.status})`),
        { status: 409 }
      );
    }
    const job = this.#ensureJob(sessionId);
    if (action === "accept") {
      state.feedback = { action, accepted: true, at: new Date().toISOString() };
    } else if (action === "edit") {
      if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
        throw Object.assign(new Error("edit feedback requires plan.steps"), { status: 400 });
      }
      state.currentPlan = plan;
      state.feedback = { action, accepted: true, at: new Date().toISOString() };
    } else if (action === "regenerate") {
      const config = this.getConfig();
      if (state.planIterations >= config.maxPlanIterations) {
        throw Object.assign(
          new Error(`plan iteration limit reached (${config.maxPlanIterations})`),
          { status: 400 }
        );
      }
      state.currentPlan = null;
      state.feedback = null;
    } else {
      throw Object.assign(new Error(`unknown feedback action: ${action}`), { status: 400 });
    }
    state.status = "running";
    await this.store.saveState(state);
    this.#emit(job, state, "feedback_received", { action });
    this.#launch(job, state);
    return state;
  }

  async cancel(sessionId) {
    const state = await this.#loadOrThrow(sessionId);
    const job = this.#ensureJob(sessionId);
    if (job.running && job.controller) {
      job.controller.abort();
      await job.promise.catch(() => {});
    } else if (["running", "waiting_feedback", "draft"].includes(state.status)) {
      state.status = "cancelled";
      await this.store.saveState(state);
      this.#emit(job, state, "research_cancelled", {});
    }
    return this.store.loadState(sessionId);
  }

  async getState(sessionId) {
    return this.#loadOrThrow(sessionId);
  }

  async #loadOrThrow(sessionId) {
    const state = await this.store.loadState(sessionId);
    if (!state) {
      throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 });
    }
    return state;
  }
}
