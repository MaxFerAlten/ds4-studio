/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md runtime recovery and cancellation.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: ResearchRuntime subscriber isolation pattern.
 */

export class EvolutionRuntime {
  constructor({ orchestrator, loopController, logger = console } = {}) {
    if (!orchestrator || !loopController) throw new TypeError("orchestrator and loopController are required");
    this.orchestrator = orchestrator;
    this.loopController = loopController;
    this.store = orchestrator.runStore;
    this.logger = logger;
    this.jobs = new Map();
  }

  #job(runId) {
    let job = this.jobs.get(runId);
    if (!job) {
      job = { abortController: null, listeners: new Set(), running: false, promise: null, publishedSequence: 0 };
      this.jobs.set(runId, job);
    }
    return job;
  }

  subscribe(runId, listener) {
    if (typeof this.store.subscribe === "function") return this.store.subscribe(runId, listener);
    const job = this.#job(runId);
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  async #publish(runId, job) {
    const events = await this.store.readEvents(runId);
    for (const event of events) {
      if (event.sequence <= job.publishedSequence) continue;
      job.publishedSequence = event.sequence;
      for (const listener of [...job.listeners]) {
        try { listener(event); } catch { /* subscriber isolation */ }
      }
    }
  }

  async start(task, options = {}) {
    const created = await this.orchestrator.createRun(task, options);
    this.resume(created.runId);
    return created;
  }

  resume(runId) {
    const job = this.#job(runId);
    if (job.running) return job.promise;
    job.running = true;
    job.abortController = new AbortController();
    job.promise = this.loopController.runUntilPause(runId, { signal: job.abortController.signal })
      .catch(async (error) => {
        if (job.abortController.signal.aborted || error?.name === "AbortError") {
          const run = await this.store.loadRun(runId).catch(() => null);
          if (run && !["COMPLETED", "STOPPED", "FAILED"].includes(run.state)) {
            await this.orchestrator.stop(runId, "CANCELLED").catch(() => {});
          }
          return this.store.loadRun(runId);
        }
        this.logger.error?.(`evolution ${runId}: ${error.message}`);
        throw error;
      })
      .finally(async () => {
        await this.#publish(runId, job).catch(() => {});
        job.running = false;
      });
    return job.promise;
  }

  async cancel(runId) {
    const job = this.#job(runId);
    job.abortController?.abort(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    if (job.promise) await job.promise.catch(() => {});
    const run = await this.store.loadRun(runId);
    if (!["COMPLETED", "STOPPED", "FAILED"].includes(run.state)) await this.orchestrator.stop(runId, "CANCELLED");
    await this.#publish(runId, job);
    return this.store.loadRun(runId);
  }

  async flush(runId) {
    const job = this.jobs.get(runId);
    if (job?.promise) await job.promise;
  }

  status(runId) {
    const job = this.jobs.get(runId);
    return Object.freeze({ running: job?.running === true });
  }
}
