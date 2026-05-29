/**
 * Agent Session Manager — stateful reset/delta protocol for the agentic
 * tooling loop.  Inspired by pi-ds4-stateful/session-state.ts but running
 * inside the DS4 Studio Express server.
 *
 * Each agent session tracks message hashes so that follow-up user turns and
 * tool-result continuations can be sent as lightweight delta payloads instead
 * of replaying the entire transcript.
 *
 * Hashing is stable (sorted JSON keys) and incremental: existing transcript
 * hashes are cached and reused, so a chat session that grows to N turns
 * performs O(N) hashing work in total instead of O(N^2).
 */

import { createHash } from "node:crypto";
import { ReadGuard } from "./agentTools.mjs";

/** Recursively convert any value into a key-sorted, stable representation. */
function stable(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stable);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (v !== undefined) out[key] = stable(v);
  }
  return out;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

/** Stable SHA-1 of any JSON-serialisable value. */
function sha1(value) {
  return createHash("sha1").update(stableJson(value)).digest("hex");
}

/** Cache hash of a message object; survives across choosePayload calls. */
const messageHashCache = new WeakMap();
function hashMessage(msg) {
  if (msg && typeof msg === "object") {
    const cached = messageHashCache.get(msg);
    if (cached) return cached;
    const h = sha1(msg);
    messageHashCache.set(msg, h);
    return h;
  }
  return sha1(msg);
}

/** Agent-facing system prompt with tool schemas (OpenAI function calling). */
const AGENT_SYSTEM_PROMPT = `You are a coding agent running inside DS4 Studio. When the user asks you to inspect, create, modify, build, test, or otherwise operate on local files, use the provided tools instead of printing large file contents as the answer.

File exploration strategy (follow in order):
1. For large files, start with 'search' (grep) for specific symbols, patterns, or anchors. Use 'list' to map a directory.
2. Use 'read' only on targeted ranges driven by what search/list returned.
3. NEVER re-read a range that overlaps an earlier read in this session: the previous content is still in your context. A duplicate or covered read will be blocked by the server.
4. NEVER bypass the read tool with bash dumps such as cat/head/tail/sed/awk, find -exec cat, xargs cat, or python/node file reads. The bash guard will refuse these.
5. After reading enough to form a working theory, stop reading and produce a textual answer for the user. Do not paginate through whole files looking for context that is not required.

Other rules:
- The default 'read' returns up to 500 lines starting at start_line=1 unless you specify otherwise. The result header tells you the exact range that was returned; remember it before issuing the next read.
- For long-running bash commands, set a reasonable timeout.
- After tools run, summarize the result briefly for the user.
- Write code that is reliable and works well.
- Preserve the current system configuration integrity, unless explicitly asked otherwise by the user.
- If a tool returns an error, explain the issue and suggest a fix.`;

/** OpenAI function-calling tool schemas, matching ds4_agent.c capabilities. */
const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command and return its output.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute." },
          timeout_sec: { type: "number", description: "Timeout in seconds. Default 30." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a text file or a range of lines. Returns the first 500 lines by default.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative file path." },
          start_line: { type: "number", description: "First line to read (1-indexed)." },
          max_lines: { type: "number", description: "Maximum lines to return. Default 500." },
          whole: { type: "boolean", description: "If true, read the entire file." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write",
      description: "Create or overwrite a text file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write." },
          content: { type: "string", description: "Content to write." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit",
      description: "Edit a file by replacing old text with new text, or by line/range.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to edit." },
          old: { type: "string", description: "Exact text to find and replace. Must match exactly once." },
          new: { type: "string", description: "Replacement text." },
          line: { type: "number", description: "Single line number to replace (1-indexed)." },
          range: { type: "string", description: "Line range 'start:end' to replace, or 'all'." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "Search files for a pattern and return compact matches with line numbers.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search pattern (regex or literal)." },
          path: { type: "string", description: "Directory or file path to search. Default: current directory." },
          glob: { type: "string", description: "Glob filter, e.g. '*.js'." },
          max_results: { type: "number", description: "Max results. Default 50." },
          case_sensitive: { type: "boolean", description: "Case sensitive search. Default true." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list",
      description: "List the contents of a directory compactly.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path." }
        },
        required: ["path"]
      }
    }
  }
];

/**
 * Returns true if a message is eligible for delta mode (user, tool result).
 * Assistant and system messages cannot be sent as delta — they require a reset.
 */
function isDeltaRole(msg) {
  const role = msg?.role;
  return role === "user" || role === "tool" || role === "function";
}

function hasUserMessage(messages) {
  return messages.some((message) => message?.role === "user");
}

let _agentManagerCounter = 0;

export class AgentSessionManager {
  constructor() {
    /** @type {{ sessionId: string, revision: number, messageHashes: string[], messages: Array, toolsHash: string } | null} */
    this.state = null;
    this.active = false;
    this.lastMode = "none";
    this.lastReason = "not started";
    this.readGuard = new ReadGuard();
    this.usageTotals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }

  /** Start the agent session. */
  start() {
    this.state = {
      sessionId: `ds4studio_agent_${Date.now()}_${++_agentManagerCounter}`,
      revision: 0,
      messageHashes: [],
      messages: [],
      toolsHash: sha1(AGENT_TOOLS)
    };
    this.active = true;
    this.lastMode = "none";
    this.lastReason = "agent started";
    return this.status();
  }

  /** Stop and clear the agent session. */
  stop() {
    this.state = null;
    this.active = false;
    this.lastMode = "none";
    this.lastReason = "agent stopped";
    this.readGuard.clearAll();
    this.usageTotals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return this.status();
  }

  /** Accumulate usage tokens reported by the backend. */
  recordUsage(usage) {
    if (!usage || typeof usage !== "object") return;
    const prompt = Number(usage.prompt_tokens) || 0;
    const completion = Number(usage.completion_tokens) || 0;
    const total = Number(usage.total_tokens) || (prompt + completion);
    this.usageTotals = {
      prompt_tokens: this.usageTotals.prompt_tokens + prompt,
      completion_tokens: this.usageTotals.completion_tokens + completion,
      total_tokens: this.usageTotals.total_tokens + total
    };
    return this.usageTotals;
  }

  /** Return current status object. */
  status() {
    return {
      active: this.active,
      sessionId: this.state?.sessionId || null,
      revision: this.state?.revision || 0,
      lastMode: this.lastMode,
      lastReason: this.lastReason
    };
  }

  /** Return a copy of the canonical backend transcript for this agent session. */
  messages() {
    return this.state?.messages ? [...this.state.messages] : [];
  }

  /**
   * Hash a full message array using the cached prefix when possible.
   * Returns the per-index hashes in the same order as `fullMessages`.
   * When the caller passes back messages obtained from `messages()` they
   * compare by reference and the corresponding stored hash is reused.
   */
  _hashFullMessages(fullMessages) {
    if (!this.state) return fullMessages.map(hashMessage);
    const stored = this.state.messages;
    const storedHashes = this.state.messageHashes;
    const limit = Math.min(stored.length, fullMessages.length);
    const out = new Array(fullMessages.length);
    let prefixLen = 0;
    for (; prefixLen < limit; prefixLen++) {
      if (fullMessages[prefixLen] === stored[prefixLen]) {
        out[prefixLen] = storedHashes[prefixLen];
      } else {
        break;
      }
    }
    for (let i = prefixLen; i < fullMessages.length; i++) {
      out[i] = hashMessage(fullMessages[i]);
    }
    return out;
  }

  /**
   * Choose the backend payload for the current transcript.
   *
   * When `allowDelta:false` (the default), the payload is always sent as a
   * full replay so it remains compatible with classic OpenAI chat completions.
   * The delta path is exercised when the backend exposes
   * `/v1/ds4/stateful/chat/completions` and the caller opts in.
   *
   * `forceReset` is used after an HTTP 409 from the stateful backend to
   * retry the same payload as a full reset on the same session id.
   *
   * @param {object} payload – OpenAI-style request payload
   * @param {{ allowDelta?: boolean, userTurnPolicy?: "reset" | "delta" | "auto", forceReset?: boolean }} options
   */
  choosePayload(payload = {}, { allowDelta = false, userTurnPolicy = "reset", forceReset = false } = {}) {
    const p = payload && typeof payload === "object" ? { ...payload } : {};
    const fullMessages = Array.isArray(p.messages) ? [...p.messages] : [];
    const fullHashes = this._hashFullMessages(fullMessages);
    const toolsHash = sha1(p.tools ?? []);

    if (!this.state || !this.active) {
      this.lastMode = "reset";
      this.lastReason = "session not active; full reset";
      p.messages = fullMessages;
      delete p.delta;
      return {
        payload: p,
        mode: "reset",
        reason: this.lastReason,
        messages: fullMessages,
        pending: undefined
      };
    }

    let mode = "reset";
    let reason = "initial request; full reset";
    let requestMessages = fullMessages;
    let parentRevision = 0;

    if (forceReset) {
      reason = "delta rejected by server; retrying full reset";
    } else if (this.state.revision > 0 && this.state.messageHashes.length > 0) {
      const storedHashes = this.state.messageHashes;
      let prefixMatches = storedHashes.length <= fullHashes.length;
      if (prefixMatches) {
        for (let i = 0; i < storedHashes.length; i++) {
          if (storedHashes[i] !== fullHashes[i]) { prefixMatches = false; break; }
        }
      }
      if (this.state.toolsHash !== toolsHash) {
        reason = "tool schema changed; full reset";
      } else if (!prefixMatches) {
        reason = "message prefix changed; full reset";
      } else {
        const appended = fullMessages.slice(storedHashes.length);
        if (!allowDelta) {
          reason = "stateful disabled; full reset";
        } else if (appended.length === 0) {
          reason = "no new messages; full reset";
        } else if (appended.every(isDeltaRole)) {
          const includesUser = hasUserMessage(appended);
          if (!includesUser || userTurnPolicy === "delta") {
            mode = "delta";
            requestMessages = appended;
            parentRevision = this.state.revision;
            reason = includesUser
              ? `user-turn delta (${appended.length} new message(s))`
              : `append-only delta (${appended.length} new message(s))`;
          } else {
            reason = `new user turn reset (${appended.length} new message(s))`;
          }
        } else {
          reason = "append contained assistant/system replay; full reset";
        }
      }
    }

    p.session_id = this.state.sessionId;
    p.mode = mode;
    p.parent_revision = parentRevision;
    p.stateful_debug = {
      reason,
      full_messages: fullMessages.length,
      sent_messages: requestMessages.length,
      previous_messages: this.state.messageHashes.length,
      stored_revision: this.state.revision
    };
    p.stateful_debug_reason = reason;
    p.stateful_debug_full_messages = fullMessages.length;
    p.stateful_debug_sent_messages = requestMessages.length;
    p.stateful_debug_previous_messages = this.state.messageHashes.length;
    p.stateful_debug_stored_revision = this.state.revision;
    p.messages = requestMessages;
    if (mode === "delta") p.delta = { messages: requestMessages };
    else delete p.delta;

    this.lastMode = mode;
    this.lastReason = reason;
    return {
      payload: p,
      mode,
      reason,
      messages: requestMessages,
      pending: {
        mode,
        parentRevision,
        requestMessages,
        fullMessages,
        fullHashes,
        toolsHash,
        sessionId: this.state.sessionId
      }
    };
  }

  /**
   * Choose between reset and delta mode for the given messages.
   *
   * @param {Array} fullMessages – The complete conversation messages array
   * @returns {{ mode: string, reason: string, messages: Array, pending: object }}
   */
  chooseMode(fullMessages) {
    const selected = this.choosePayload(
      { messages: fullMessages, tools: AGENT_TOOLS },
      { allowDelta: true, userTurnPolicy: "delta" }
    );
    return {
      mode: selected.mode,
      reason: selected.reason,
      messages: selected.payload.messages,
      pending: selected.pending
    };
  }

  /**
   * Commit a successful response. Appends the request messages and assistant
   * response to the committed state.
   *
   * @param {object|string} pendingOrMode – Pending payload metadata, or legacy "reset"/"delta"
   * @param {Array|object} requestMessages – Legacy request messages, or assistant response message
   * @param {object} assistantMessage – Legacy assistant response message
   */
  commit(pendingOrMode, requestMessages, assistantMessage) {
    if (!this.state) return;

    let pending;
    let assistant;
    if (typeof pendingOrMode === "string") {
      pending = {
        mode: pendingOrMode,
        parentRevision: pendingOrMode === "delta" ? this.state.revision : 0,
        requestMessages: Array.isArray(requestMessages) ? requestMessages : [],
        toolsHash: this.state.toolsHash,
        sessionId: this.state.sessionId
      };
      assistant = assistantMessage;
    } else {
      pending = pendingOrMode;
      assistant = requestMessages;
    }
    if (!pending || !assistant) return;

    const previousMessages = pending.mode === "delta" ? this.state.messages : [];
    const messages = [...previousMessages, ...pending.requestMessages, assistant];

    let nextHashes;
    if (pending.mode === "reset" && Array.isArray(pending.fullHashes) && pending.fullHashes.length === pending.requestMessages.length) {
      nextHashes = [...pending.fullHashes, hashMessage(assistant)];
    } else if (pending.mode === "delta" && Array.isArray(pending.fullHashes)) {
      nextHashes = [...pending.fullHashes, hashMessage(assistant)];
    } else {
      nextHashes = messages.map(hashMessage);
    }

    this.state.revision = pending.mode === "delta"
      ? pending.parentRevision + 1
      : this.state.revision + 1;
    this.state.messages = messages;
    this.state.messageHashes = nextHashes;
    this.state.toolsHash = pending.toolsHash;
  }

  /** Reset session state without deactivating. */
  reset() {
    if (!this.state) return;
    this.state.revision = 0;
    this.state.messageHashes = [];
    this.state.messages = [];
    this.lastMode = "none";
    this.lastReason = "session reset by user";
    this.readGuard.clearAll();
    this.usageTotals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
}

/**
 * Multi-session store for concurrent agent sessions, keyed by a caller-
 * supplied string (e.g. browser tab id).  Mirrors
 * pi-ds4-stateful's StatefulSessionStore but reuses AgentSessionManager
 * per key so the existing single-session API is preserved.
 */
export class AgentSessionStore {
  constructor() {
    /** @type {Map<string, AgentSessionManager>} */
    this.sessions = new Map();
  }

  static defaultKey() {
    return "__default__";
  }

  key(input) {
    if (typeof input === "string" && input.trim()) return input.trim();
    return AgentSessionStore.defaultKey();
  }

  get(key) {
    return this.sessions.get(this.key(key));
  }

  /** Get-or-create the agent session manager for `key`. */
  ensure(key) {
    const k = this.key(key);
    let mgr = this.sessions.get(k);
    if (!mgr) {
      mgr = new AgentSessionManager();
      this.sessions.set(k, mgr);
    }
    return mgr;
  }

  start(key) {
    const mgr = this.ensure(key);
    return mgr.start();
  }

  stop(key) {
    const mgr = this.sessions.get(this.key(key));
    if (!mgr) return { active: false, sessionId: null, revision: 0, lastMode: "none", lastReason: "agent stopped" };
    const status = mgr.stop();
    this.sessions.delete(this.key(key));
    return status;
  }

  status(key) {
    const mgr = this.sessions.get(this.key(key));
    if (!mgr) return { active: false, sessionId: null, revision: 0, lastMode: "none", lastReason: "no session" };
    return mgr.status();
  }

  size() {
    return this.sessions.size;
  }

  clearAll() {
    this.sessions.clear();
  }
}

export { AGENT_SYSTEM_PROMPT, AGENT_TOOLS, sha1, stableJson };
