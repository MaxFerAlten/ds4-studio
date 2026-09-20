// Records what each backend launch actually cost, so the startup model picker
// sizes ctx from this machine's own history instead of a hardcoded constant.
//
// The engine already prints everything needed:
//   ds4: memory: KV 7.15 GiB (raw 0.10 + compressed 7.05) + buffers 1.05 GiB
//        + resident model 90.88 GiB = 99.09 GiB planned
//   ds4: memory detail: ctx=550000 prefill_cap=1024 ...
//   ds4: ROCm allocation refused: ... / ds4-wrapper: HTTP server listening ...
//
// One observation per launch, appended only once the outcome is known.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_OBSERVATIONS = 200;

export function calibrationPath() {
  return process.env.DS4_CALIBRATION_FILE
    || path.join(os.homedir(), ".ds4", "launch-calibration.json");
}

function ramGib() {
  try {
    const line = fs.readFileSync("/proc/meminfo", "utf8")
      .split("\n").find((l) => l.startsWith("MemTotal:"));
    return line ? Number(line.match(/(\d+)/)[1]) / 1048576 : 0;
  } catch { return 0; }
}

/** Accumulates lines from one launch; emits an observation when it resolves. */
export class LaunchCalibrator {
  constructor(writer = appendObservation) {
    this.writer = writer;
    // KV cost per token follows the architecture, so an observation without
    // one cannot be reused for sizing. Set by the caller before a launch.
    this.arch = null;
    this.reset();
  }

  /** Architecture of the model about to be launched, e.g. "deepseek4". */
  setArch(arch) {
    this.arch = typeof arch === "string" && arch ? arch : null;
  }

  reset() {
    this.pending = null;
    this.spans = [];
    this.done = false;
  }

  /** Call for every backend log line. Returns the observation if one closed. */
  observe(message) {
    if (typeof message !== "string") return null;

    // A fresh launch: forget whatever the previous one was building up.
    if (/ROCm backend initialized|Metal backend initialized|backend initialized on/.test(message)) {
      this.reset();
    }

    const span = message.match(/startup model preparation covered ([\d.]+) GiB/);
    if (span) this.spans.push(Number(span[1]));

    const mem = message.match(
      /memory: KV ([\d.]+) GiB .*?\+ buffers ([\d.]+) GiB \+ resident model ([\d.]+) GiB = ([\d.]+) GiB planned/);
    if (mem) {
      this.pending = {
        kvGib: Number(mem[1]),
        buffersGib: Number(mem[2]),
        modelGib: Number(mem[3]),
        plannedGib: Number(mem[4]),
        ctx: null,
      };
      return null;
    }

    const detail = message.match(/memory detail: ctx=(\d+)/);
    if (detail && this.pending) this.pending.ctx = Number(detail[1]);

    if (this.done || !this.pending || !this.pending.ctx) return null;

    let outcome = null;
    if (/allocation refused|session startup failed|failed to create ds4_session/.test(message)) {
      outcome = "refused";
    } else if (/HTTP server listening|server session created/.test(message)) {
      outcome = "ok";
    }
    if (!outcome) return null;

    // Sidecars (vision encoder, DSpark support) are separate span lines; the
    // first covers the target, which "resident model" already counts.
    const extraGib = this.spans.slice(1).reduce((a, b) => a + b, 0);
    const observation = {
      ts: new Date().toISOString(),
      ...this.pending,
      arch: this.arch,
      extraGib: Number(extraGib.toFixed(2)),
      totalGib: Number((this.pending.plannedGib + extraGib).toFixed(2)),
      ramGib: Number(ramGib().toFixed(1)),
      outcome,
    };
    this.done = true;
    try { this.writer(observation); } catch { /* telemetry must never break a launch */ }
    return observation;
  }
}

export function readObservations(file = calibrationPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed.observations) ? parsed.observations : [];
  } catch { return []; }
}

export function appendObservation(observation, file = calibrationPath()) {
  const observations = readObservations(file);
  observations.push(observation);
  while (observations.length > MAX_OBSERVATIONS) observations.shift();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ observations }, null, 2) + "\n");
}
