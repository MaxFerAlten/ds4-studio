/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md sections 6 and 15.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: ToolBlobStore for bounded content-addressed output.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ToolBlobStore } from "../toolBlobStore.mjs";
import { validateEvolutionTask } from "./evolutionContracts.mjs";
import { atomicWriteJson, canonicalJson, hashFile, hashJson, sha256, timingSafeHexEqual } from "./evolutionIntegrity.mjs";
import { assertTransition } from "./evolutionStateMachine.mjs";

const execFileAsync = promisify(execFile);

export const EVOLUTION_RUN_VERSION = "ds4_evolution_run_v1";
export const EVOLUTION_EVENT_VERSION = "ds4_evolution_event_v1";
export const EVOLUTION_BASELINE_VERSION = "ds4_evolution_baseline_v1";
export const MAX_EVENT_BYTES = 64_000;
export const REVISION_ARTIFACT_ALLOWLIST = Object.freeze(new Set([
  "proposal.json", "candidate.patch", "candidate.json", "execution.json", "evaluation.json",
  "diagnosis.json", "promotion.json", "rollback.json", "parent-snapshot.json",
  "candidate-snapshot.json", "promoted-snapshot.json", "evidence-packet.json",
  "critic-model-evidence.json", "proposer-model-evidence.json", "patcher-model-evidence.json",
  "generated-proposal.json", "generated-patch.json", "feedback-context.json"
]));

const RUN_ID_PATTERN = /^evo_[a-f0-9]{20}$/;
const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;
const ZERO_HASH = "0".repeat(64);

export class EvolutionRunStoreError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionRunStoreError";
    this.code = code;
    this.details = details;
  }
}

export function newEvolutionRunId() {
  return `evo_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function assertRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId))) {
    throw new EvolutionRunStoreError("INVALID_RUN_ID", "runId is not safe");
  }
  return String(runId);
}

function assertRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999_999) {
    throw new EvolutionRunStoreError("INVALID_REVISION", "revision must be between 0 and 999999");
  }
  return revision;
}

export function assertSafeArtifactPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0") ||
      path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new EvolutionRunStoreError("INVALID_ARTIFACT_PATH", "artifact path must be relative");
  }
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new EvolutionRunStoreError("INVALID_ARTIFACT_PATH", "artifact path escapes the run directory");
  }
  return normalized;
}

function eventCore(event) {
  return {
    eventVersion: event.eventVersion,
    eventId: event.eventId,
    runId: event.runId,
    revision: event.revision,
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
    payloadHash: event.payloadHash,
    previousEventHash: event.previousEventHash
  };
}

function validateEventShape(event, expectedRunId, expectedSequence, previousEventHash) {
  const keys = new Set([
    "eventVersion", "eventId", "runId", "revision", "sequence", "type", "timestamp",
    "payload", "payloadHash", "previousEventHash", "eventHash"
  ]);
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      Object.keys(event).some((key) => !keys.has(key))) {
    throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "event shape is invalid");
  }
  if (event.eventVersion !== EVOLUTION_EVENT_VERSION || event.runId !== expectedRunId ||
      event.sequence !== expectedSequence || !Number.isSafeInteger(event.revision) || event.revision < 0 ||
      !EVENT_TYPE_PATTERN.test(String(event.type)) || !event.eventId ||
      Number.isNaN(Date.parse(event.timestamp))) {
    throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "event identity or sequence is invalid", {
      expectedSequence,
      actualSequence: event.sequence
    });
  }
  const payloadHash = hashJson(event.payload);
  if (!timingSafeHexEqual(payloadHash, event.payloadHash) ||
      !timingSafeHexEqual(previousEventHash, event.previousEventHash)) {
    throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "payload or chain hash mismatch");
  }
  const calculatedEventHash = hashJson(eventCore(event));
  if (!timingSafeHexEqual(calculatedEventHash, event.eventHash)) {
    throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "event hash mismatch");
  }
  return event;
}

async function appendDurably(file, line) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, "a", 0o600);
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonExclusive(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST") {
      throw new EvolutionRunStoreError("IMMUTABLE_ARTIFACT_EXISTS", `${path.basename(file)} already exists`);
    }
    throw error;
  });
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(file, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
}

function snapshotPathIsSafe(relativePath) {
  return typeof relativePath === "string" && relativePath && !relativePath.includes("\0") &&
    !path.isAbsolute(relativePath) && !path.win32.isAbsolute(relativePath) &&
    !path.posix.normalize(relativePath.replaceAll("\\", "/")).startsWith("../");
}

async function collectSnapshotEntry(root, relativePath, entries, limit) {
  if (entries.size >= limit) throw new EvolutionRunStoreError("BASELINE_FILE_LIMIT", `baseline exceeds ${limit} entries`);
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!snapshotPathIsSafe(normalized)) throw new EvolutionRunStoreError("INVALID_BASELINE_PATH", normalized);
  const absolute = path.join(root, ...normalized.split("/"));
  const stat = await fs.lstat(absolute).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) {
    entries.set(normalized, { path: normalized, type: "missing" });
    return;
  }
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(absolute);
    entries.set(normalized, { path: normalized, type: "symlink", mode, target, hash: sha256(target) });
    return;
  }
  if (stat.isFile()) {
    const content = await fs.readFile(absolute);
    entries.set(normalized, { path: normalized, type: "file", mode, size: stat.size, hash: sha256(content) });
    return;
  }
  if (!stat.isDirectory()) {
    entries.set(normalized, { path: normalized, type: "special", mode });
    return;
  }
  entries.set(normalized, { path: normalized, type: "directory", mode });
  const children = await fs.readdir(absolute);
  children.sort();
  for (const child of children) {
    await collectSnapshotEntry(root, path.posix.join(normalized, child), entries, limit);
  }
}

async function resolveRepositoryIdentity(repositoryRoot) {
  try {
    const [{ stdout: revision }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", timeout: 5_000 }),
      execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=no"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 1_000_000
      })
    ]);
    return {
      kind: "git",
      revision: revision.trim(),
      trackedStateHash: sha256(status)
    };
  } catch {
    return { kind: "filesystem", revision: null, trackedStateHash: null };
  }
}

export async function captureBaselineSnapshot(options) {
  const repositoryRoot = path.resolve(options?.repositoryRoot ?? "");
  const relevantPaths = [...new Set(options?.relevantPaths ?? [])].sort();
  if (!repositoryRoot || !relevantPaths.length) {
    throw new EvolutionRunStoreError("INVALID_BASELINE_INPUT", "repositoryRoot and relevantPaths are required");
  }
  const entries = new Map();
  for (const relativePath of relevantPaths) {
    await collectSnapshotEntry(repositoryRoot, relativePath, entries, options.maxEntries ?? 100_000);
  }
  const files = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
  const repositoryIdentity = options.repositoryIdentity ?? await resolveRepositoryIdentity(repositoryRoot);
  const toolchainIdentity = options.toolchainIdentity ?? {
    node: process.version,
    platform: process.platform,
    architecture: process.arch
  };
  return Object.freeze({
    baselineVersion: EVOLUTION_BASELINE_VERSION,
    capturedAt: (options.now ?? new Date()).toISOString(),
    repositoryIdentity,
    relevantPaths,
    files,
    contentHash: hashJson(files),
    toolchainIdentity,
    toolchainHash: hashJson(toolchainIdentity),
    configurationHash: hashJson(options.configuration ?? {})
  });
}

export class EvolutionRunStore {
  constructor({ rootDir, now = () => new Date(), runIdFactory = newEvolutionRunId, eventIdFactory = crypto.randomUUID } = {}) {
    if (typeof rootDir !== "string" || !rootDir) throw new TypeError("rootDir is required");
    this.rootDir = path.resolve(rootDir);
    this.now = now;
    this.runIdFactory = runIdFactory;
    this.eventIdFactory = eventIdFactory;
    this.queues = new Map();
    this.listeners = new Map();
  }

  subscribe(runId, listener) {
    assertRunId(runId);
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    const listeners = this.listeners.get(runId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(runId);
    };
  }

  _notify(runId, event) {
    for (const listener of [...(this.listeners.get(runId) ?? [])]) {
      try { listener(event); } catch { /* subscriber failures cannot affect the durable ledger */ }
    }
  }

  runDir(runId) {
    return path.join(this.rootDir, assertRunId(runId));
  }

  manifestPath(runId) {
    return path.join(this.runDir(runId), "manifest.json");
  }

  eventsPath(runId) {
    return path.join(this.runDir(runId), "events.jsonl");
  }

  baselinePath(runId, name) {
    return path.join(this.runDir(runId), "baseline", name);
  }

  revisionDir(runId, revision) {
    assertRevision(revision);
    if (revision === 0) throw new EvolutionRunStoreError("INVALID_REVISION", "revision artifacts start at 1");
    return path.join(this.runDir(runId), "revisions", `r${String(revision).padStart(4, "0")}`);
  }

  async withRunLock(runId, operation) {
    assertRunId(runId);
    const previous = this.queues.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.queues.set(runId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(runId) === current) this.queues.delete(runId);
    }
  }

  async createRun(taskInput, options = {}) {
    const taskContract = validateEvolutionTask(taskInput, { repositoryRoot: options.repositoryRoot });
    const runId = assertRunId(options.runId ?? this.runIdFactory());
    const directory = this.runDir(runId);
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(directory, { recursive: false, mode: 0o700 }).catch((error) => {
      if (error.code === "EEXIST") throw new EvolutionRunStoreError("RUN_ALREADY_EXISTS", runId);
      throw error;
    });
    const createdAt = this.now().toISOString();
    const manifest = {
      runVersion: EVOLUTION_RUN_VERSION,
      runId,
      createdAt,
      taskContract,
      taskContractHash: hashJson(taskContract)
    };
    try {
      await atomicWriteJson(this.manifestPath(runId), manifest);
      await fs.mkdir(path.join(directory, "baseline"), { recursive: true, mode: 0o700 });
      await fs.mkdir(path.join(directory, "revisions"), { recursive: true, mode: 0o700 });
      await this._appendEventUnlocked(runId, {
        revision: 0,
        type: "RUN_CREATED",
        timestamp: createdAt,
        payload: { state: "CREATED", taskContractHash: manifest.taskContractHash }
      }, []);
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return { runId, state: "CREATED", manifest };
  }

  async loadManifest(runId) {
    const raw = await fs.readFile(this.manifestPath(runId), "utf8").catch((error) => {
      if (error.code === "ENOENT") throw new EvolutionRunStoreError("RUN_NOT_FOUND", runId);
      throw error;
    });
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      throw new EvolutionRunStoreError("MANIFEST_INTEGRITY_FAILURE", "manifest is not valid JSON");
    }
    if (manifest.runVersion !== EVOLUTION_RUN_VERSION || manifest.runId !== runId ||
        !timingSafeHexEqual(hashJson(manifest.taskContract), manifest.taskContractHash)) {
      throw new EvolutionRunStoreError("MANIFEST_INTEGRITY_FAILURE", "manifest hash or identity mismatch");
    }
    return manifest;
  }

  async _readEventsUnlocked(runId, { recoverTail = true } = {}) {
    const file = this.eventsPath(runId);
    let raw = await fs.readFile(file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (raw && !raw.endsWith("\n")) {
      if (!recoverTail) throw new EvolutionRunStoreError("LEDGER_PARTIAL_WRITE", "ledger has a partial final line");
      const boundary = raw.lastIndexOf("\n") + 1;
      await fs.truncate(file, Buffer.byteLength(raw.slice(0, boundary), "utf8"));
      raw = raw.slice(0, boundary);
    }
    const lines = raw ? raw.slice(0, -1).split("\n") : [];
    const events = [];
    let previousEventHash = ZERO_HASH;
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index]) throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "empty event line");
      let event;
      try {
        event = JSON.parse(lines[index]);
      } catch {
        throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", `event ${index + 1} is invalid JSON`);
      }
      validateEventShape(event, runId, index + 1, previousEventHash);
      events.push(event);
      previousEventHash = event.eventHash;
    }
    return events;
  }

  async readEvents(runId, options = {}) {
    return this.withRunLock(runId, () => this._readEventsUnlocked(runId, options));
  }

  async _appendEventUnlocked(runId, input, existingEvents = null) {
    assertRunId(runId);
    const events = existingEvents ?? await this._readEventsUnlocked(runId);
    const expectedSequence = events.length + 1;
    if (input.sequence !== undefined && input.sequence !== expectedSequence) {
      throw new EvolutionRunStoreError("DUPLICATE_OR_OUT_OF_ORDER_SEQUENCE", "event sequence is not next", {
        expectedSequence,
        suppliedSequence: input.sequence
      });
    }
    const revision = assertRevision(input.revision ?? 0);
    if (!EVENT_TYPE_PATTERN.test(String(input.type ?? ""))) {
      throw new EvolutionRunStoreError("INVALID_EVENT_TYPE", "event type is invalid");
    }
    const payload = input.payload ?? {};
    const payloadText = canonicalJson(payload);
    if (Buffer.byteLength(payloadText, "utf8") > MAX_EVENT_BYTES) {
      throw new EvolutionRunStoreError("EVENT_TOO_LARGE", "large output must be externalized as a blob");
    }
    const event = {
      eventVersion: EVOLUTION_EVENT_VERSION,
      eventId: String(input.eventId ?? this.eventIdFactory()),
      runId,
      revision,
      sequence: expectedSequence,
      type: input.type,
      timestamp: input.timestamp ?? this.now().toISOString(),
      payload,
      payloadHash: hashJson(payload),
      previousEventHash: events.at(-1)?.eventHash ?? ZERO_HASH
    };
    event.eventHash = hashJson(eventCore(event));
    await appendDurably(this.eventsPath(runId), `${canonicalJson(event)}\n`);
    const durableEvent = Object.freeze(event);
    this._notify(runId, durableEvent);
    return durableEvent;
  }

  async appendEvent(runId, input) {
    return this.withRunLock(runId, () => this._appendEventUnlocked(runId, input));
  }

  reconstruct(events) {
    if (!Array.isArray(events) || events.length === 0 || events[0].type !== "RUN_CREATED" ||
        events[0].payload?.state !== "CREATED") {
      throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "ledger does not start with RUN_CREATED");
    }
    let state = "CREATED";
    let revision = 0;
    for (const event of events.slice(1)) {
      revision = Math.max(revision, event.revision);
      if (event.type !== "STATE_TRANSITION") continue;
      if (event.payload?.from !== state) {
        throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "transition source does not match reconstructed state");
      }
      try {
        assertTransition(state, event.payload.to, {
          kind: event.payload.kind,
          reasonCode: event.payload.reasonCode
        });
      } catch (error) {
        throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", error.message);
      }
      state = event.payload.to;
    }
    return Object.freeze({ state, revision, sequence: events.at(-1).sequence, events: Object.freeze([...events]) });
  }

  async loadRun(runId) {
    const [manifest, events] = await Promise.all([this.loadManifest(runId), this.readEvents(runId)]);
    const reconstructed = this.reconstruct(events);
    if (!timingSafeHexEqual(events[0].payload.taskContractHash, manifest.taskContractHash)) {
      throw new EvolutionRunStoreError("LEDGER_INTEGRITY_FAILURE", "run creation event does not match manifest");
    }
    return Object.freeze({ runId, manifest, ...reconstructed });
  }

  async listRuns({ cursor = null, limit = 50 } = {}) {
    const boundedLimit = Math.min(100, Math.max(1, Number.isSafeInteger(limit) ? limit : 50));
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue;
      const run = await this.loadRun(entry.name).catch(() => null);
      if (run) manifests.push(run);
    }
    manifests.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt) || left.runId.localeCompare(right.runId));
    const start = cursor ? Math.max(0, manifests.findIndex((run) => run.runId === cursor) + 1) : 0;
    const items = manifests.slice(start, start + boundedLimit);
    return Object.freeze({
      items: Object.freeze(items),
      nextCursor: start + boundedLimit < manifests.length ? items.at(-1)?.runId ?? null : null
    });
  }

  async listRevisions(runId) {
    const run = await this.loadRun(runId);
    const revisions = new Map();
    for (const event of run.events) {
      if (event.revision <= 0) continue;
      const value = revisions.get(event.revision) ?? { revision: event.revision, state: null, events: 0 };
      value.events += 1;
      if (event.type === "STATE_TRANSITION") value.state = event.payload.to;
      revisions.set(event.revision, value);
    }
    return Object.freeze([...revisions.values()].sort((left, right) => left.revision - right.revision).map(Object.freeze));
  }

  async readRevisionArtifact(runId, revision, name, { maxBytes = 200_000 } = {}) {
    assertRunId(runId);
    assertRevision(revision);
    if (!REVISION_ARTIFACT_ALLOWLIST.has(name)) {
      throw new EvolutionRunStoreError("ARTIFACT_NOT_ALLOWED", String(name));
    }
    const file = path.join(this.revisionDir(runId, revision), name);
    const stat = await fs.stat(file).catch((error) => {
      if (error.code === "ENOENT") throw new EvolutionRunStoreError("ARTIFACT_NOT_FOUND", name);
      throw error;
    });
    if (!stat.isFile()) throw new EvolutionRunStoreError("ARTIFACT_NOT_ALLOWED", name);
    if (stat.size > maxBytes) {
      return Object.freeze({ runId, revision, name, bytes: stat.size, truncated: true, artifactId: `sha256:${await hashFile(file)}` });
    }
    const content = await fs.readFile(file, "utf8");
    return Object.freeze({ runId, revision, name, bytes: stat.size, truncated: false, artifactId: `sha256:${sha256(content)}`, content });
  }

  async transitionRun(runId, to, options = {}) {
    return this.withRunLock(runId, async () => {
      const events = await this._readEventsUnlocked(runId);
      const current = this.reconstruct(events);
      assertTransition(current.state, to, { kind: options.kind, reasonCode: options.reasonCode });
      const payload = {
        from: current.state,
        to,
        kind: options.kind ?? "ordinary",
        reasonCode: options.reasonCode ?? null,
        details: options.details ?? null
      };
      return this._appendEventUnlocked(runId, {
        revision: options.revision ?? current.revision,
        type: "STATE_TRANSITION",
        payload
      }, events);
    });
  }

  async saveBaseline(runId, snapshot, evaluation = null) {
    assertRunId(runId);
    if (snapshot?.baselineVersion !== EVOLUTION_BASELINE_VERSION ||
        !timingSafeHexEqual(hashJson(snapshot.files), snapshot.contentHash)) {
      throw new EvolutionRunStoreError("INVALID_BASELINE_SNAPSHOT", "baseline content hash is invalid");
    }
    await writeJsonExclusive(this.baselinePath(runId, "snapshot.json"), snapshot);
    if (evaluation !== null) await writeJsonExclusive(this.baselinePath(runId, "evaluation.json"), evaluation);
    await this.appendEvent(runId, {
      revision: 0,
      type: "BASELINE_CAPTURED",
      payload: { contentHash: snapshot.contentHash, evaluationHash: evaluation === null ? null : hashJson(evaluation) }
    });
    return snapshot;
  }

  async loadBaseline(runId) {
    const raw = await fs.readFile(this.baselinePath(runId, "snapshot.json"), "utf8").catch((error) => {
      if (error.code === "ENOENT") throw new EvolutionRunStoreError("BASELINE_NOT_FOUND", runId);
      throw error;
    });
    const snapshot = JSON.parse(raw);
    if (snapshot.baselineVersion !== EVOLUTION_BASELINE_VERSION ||
        !timingSafeHexEqual(hashJson(snapshot.files), snapshot.contentHash)) {
      throw new EvolutionRunStoreError("BASELINE_INTEGRITY_FAILURE", "stored baseline hash mismatch");
    }
    const events = await this.readEvents(runId);
    const captured = events.find((event) => event.type === "BASELINE_CAPTURED" && event.revision === 0);
    if (!captured || !timingSafeHexEqual(captured.payload?.contentHash, snapshot.contentHash)) {
      throw new EvolutionRunStoreError("BASELINE_INTEGRITY_FAILURE", "baseline is not bound to the run ledger");
    }
    if (captured.payload?.evaluationHash) {
      const evaluationText = await fs.readFile(this.baselinePath(runId, "evaluation.json"), "utf8").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      let evaluation;
      try {
        evaluation = evaluationText === null ? null : JSON.parse(evaluationText);
      } catch {
        evaluation = null;
      }
      if (!evaluation || !timingSafeHexEqual(captured.payload.evaluationHash, hashJson(evaluation))) {
        throw new EvolutionRunStoreError("BASELINE_INTEGRITY_FAILURE", "baseline evaluation is not bound to the run ledger");
      }
    }
    return snapshot;
  }

  async verifyBaseline(runId, repositoryRoot) {
    const snapshot = await this.loadBaseline(runId);
    const current = await captureBaselineSnapshot({
      repositoryRoot,
      relevantPaths: snapshot.relevantPaths,
      repositoryIdentity: snapshot.repositoryIdentity,
      toolchainIdentity: snapshot.toolchainIdentity,
      configuration: {},
      now: new Date(snapshot.capturedAt)
    });
    if (!timingSafeHexEqual(snapshot.contentHash, current.contentHash)) {
      throw new EvolutionRunStoreError("BASELINE_MUTATED", "current files differ from immutable baseline", {
        expected: snapshot.contentHash,
        actual: current.contentHash
      });
    }
    return { ok: true, contentHash: snapshot.contentHash };
  }

  async writeArtifact(runId, relativePath, value) {
    const normalized = assertSafeArtifactPath(relativePath);
    const file = path.join(this.runDir(runId), ...normalized.split("/"));
    const resolvedRun = this.runDir(runId);
    const relative = path.relative(resolvedRun, file);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new EvolutionRunStoreError("INVALID_ARTIFACT_PATH", "artifact escaped run root");
    }
    const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(file, "wx", 0o600).catch((error) => {
      if (error.code === "EEXIST") throw new EvolutionRunStoreError("IMMUTABLE_ARTIFACT_EXISTS", normalized);
      throw error;
    });
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return Object.freeze({
      runId,
      path: normalized,
      artifactId: `sha256:${sha256(text)}`,
      bytes: Buffer.byteLength(text, "utf8")
    });
  }

  async writeRevisionArtifact(runId, revision, name, value) {
    const normalizedName = assertSafeArtifactPath(name);
    return this.writeArtifact(runId, path.posix.join("revisions", `r${String(assertRevision(revision)).padStart(4, "0")}`, normalizedName), value);
  }

  blobStore(runId) {
    return new ToolBlobStore(path.join(this.runDir(runId), "blobs"));
  }

  async putBlob(runId, text) {
    assertRunId(runId);
    const stored = await this.blobStore(runId).put(text);
    return Object.freeze({ runId, artifactId: stored.id, bytes: stored.bytes });
  }

  async getBlob(runId, reference, offset = 0, length = 20_000) {
    assertRunId(runId);
    if (!reference || reference.runId !== runId) {
      throw new EvolutionRunStoreError("CROSS_RUN_ACCESS_ATTEMPT", "blob does not belong to this run");
    }
    return this.blobStore(runId).get(reference.artifactId, offset, length);
  }
}
