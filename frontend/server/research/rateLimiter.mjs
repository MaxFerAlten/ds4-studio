// Per-provider rate limiter: a sliding 60s window cap plus a concurrency
// gate. acquire(name) resolves to an idempotent release callback.

export class RateLimiter {
  constructor(limits = {}, { now = () => Date.now() } = {}) {
    this.limits = limits;
    this.now = now;
    this.state = new Map();
  }

  #limitFor(name) {
    return this.limits[name] || this.limits.default || { perMinute: 60, concurrent: 4 };
  }

  #stateFor(name) {
    let state = this.state.get(name);
    if (!state) {
      state = { active: 0, timestamps: [], waiters: [] };
      this.state.set(name, state);
    }
    return state;
  }

  #canProceed(name) {
    const limit = this.#limitFor(name);
    const state = this.#stateFor(name);
    const cutoff = this.now() - 60000;
    state.timestamps = state.timestamps.filter((timestamp) => timestamp > cutoff);
    return state.active < limit.concurrent && state.timestamps.length < limit.perMinute;
  }

  #grant(name) {
    const state = this.#stateFor(name);
    state.active += 1;
    state.timestamps.push(this.now());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active -= 1;
      this.#pump(name);
    };
  }

  #pump(name) {
    const state = this.#stateFor(name);
    while (state.waiters.length && this.#canProceed(name)) {
      const resolve = state.waiters.shift();
      resolve(this.#grant(name));
    }
    if (state.waiters.length && state.active < this.#limitFor(name).concurrent) {
      setTimeout(() => this.#pump(name), 50);
    }
  }

  async acquire(name) {
    if (this.#canProceed(name)) return this.#grant(name);
    return new Promise((resolve) => {
      this.#stateFor(name).waiters.push(resolve);
      this.#pump(name);
    });
  }
}
