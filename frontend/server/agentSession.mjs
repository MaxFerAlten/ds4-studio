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
import { AgentLoopGuard } from "./agentLoopGuard.mjs";
import { normalizePonyMode } from "./agentPonyPolicy.mjs";

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
- If a tool returns an error, explain the issue and suggest a fix.
- **SageMath — CRITICAL RULES** (read before anything else):
  (a) USE the **sage** tool (send code as the \`code\` parameter) — NEVER write .sage files and run with bash. The bash guard will BLOCK \`sage\` in any bash command.
  (b) NEVER use \`solve()\` for sin/cos equations — it returns only the principal branch, silently MISSING most roots. Enumerate over integer k instead (see examples below).
  (c) ALWAYS classify every critical point with f''(x) sign (minimo/massimo).
  (d) NEVER use \`solve()\` for polynomial zeros of degree >= 3 — use \`find_root()\` or sampling instead.

  WRONG (solve gives only x=0, misses 7.5,8,8.5,9,9.5):
  > solve(df3, x)

  RIGHT (enumerate sin(2*pi*x)=0 -> x=k/2):
  > for k in range(15, 21): print(k/2)

  WRONG (solve gives implicit unsolved form):
  > solve(df2, x)

  RIGHT (trig identity + find_root per subinterval):
  > # df2 = 2 + pi*sin(2*pi*x)
  > for k in range(3, 8):
  >     find_root(df2, k, k+0.5)
  >     find_root(df2, k+0.5, k+1)

- **Function study — 7 steps**:

  1. **Define & differentiate**: var('x'), define each branch, compute df,d2f. Print with .factor() (polynomial), .trig_reduce() (trigonometric), .expand() (otherwise).
  2. **Continuity & differentiability** at junctions via limit(f1,x,3,dir='minus'), limit(f2,x,3,dir='plus').
  3. **Critical points (polynomial)**: solve(df==0,x), filter to domain.
  4. **Critical points (periodic)**: enumerate (see CRITICAL RULES). NEVER solve().
  5. **Zeros**: degree >= 3 use find_root(); periodic enumerate; if sign never changes state no zeros.
  6. **Classify every critical point**: f''(x0) > 0 -> min, < 0 -> max. Mark boundary/non-derivable points.
  7. **Inflection points**: solve(d2f==0,x) for polynomials; enumerate cos(2*pi*x)=0 -> x=1/4+k/2.

- **Output format**: $$...$$ KaTeX blocks or markdown tables. Use \\lt, \\gt, \\le, \\ge. Tables for extrema/flessi. Image links for plots.

- **Validation**: never assert without Sage producing the number this session. Fix errors and re-run.

`;

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
  },
  {
    type: "function",
    function: {
      name: "retrieve_context_blob",
      description: "Retrieve an exact byte range from a compressed tool-output blob.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Blob id from a compressed tool result." },
          offset: { type: "integer", minimum: 0, description: "Byte offset. Default 0." },
          length: {
            type: "integer",
            minimum: 1,
            maximum: 200000,
            description: "Bytes to retrieve. Default 20000."
          }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sage",
      description: "**PREFERRED tool for ALL mathematical computations.** Execute SageMath and return LaTeX + plain text. Use for: calculus (derivatives, integrals, limits), algebra (factor, solve, expand), number theory, linear algebra (matrices, eigenvalues), symbolic computation, plotting. Returns LaTeX ready for KaTeX rendering. MUCH BETTER than using bash to call sage manually.", 
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "SageMath code to execute. Use Sage syntax (not plain Python). Sage's latex() function is available. IMPORTANT: use diff(f,x).factor() for polynomial derivatives, diff(f,x).trig_reduce() for trigonometric ones, diff(f,x,2).expand() for second derivatives. Use find_root(f,a,b) for numeric zeros, NOT solve(). For periodic equations like sin(2πx)=c, enumerate points from the closed form over integer k. Examples: integral(exp(x)*sin(x), x), factor(x^2 - 5*x + 6), solve(x^2 - 3*x + 2 == 0, x), diff(sin(x)^2, x).trig_reduce(), find_root(cos(x)-0.5, 0, 2), latex(matrix([[1,2],[3,4]]).det()), is_prime(7919), plot(sin(x), x, -pi, pi)." },
          timeout_sec: { type: "number", description: "Timeout in seconds. Default 60. Increase for large computations." }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web via Google. Returns titles, snippets, and URLs. Use for queries needing current web information. Produces large output suitable for compression.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          max_results: { type: "number", description: "Max results to return (1-20). Default 10." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_read",
      description: "Read the full text content of a web page. Use after web_search to get details from a result. Produces large output suitable for compression.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of the web page to read." }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crawl",
      description: "Fetch and extract the readable content of a web page via the crawl service. Prefer this over web_read to open links you found but have not yet read — especially when the user asks you to crawl/open links, call this tool yourself for each URL rather than telling the user to run /crawl. Returns extracted text per page. Produces large output suitable for compression.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of the page to crawl (http or https)." }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "research_discover",
      description: "Find, dedupe, rank, and (when configured) enrich web sources for a research question. Prefer this over raw web_search for non-trivial research needing multiple sources, comparison, or primary sources. Falls back to web_search if the research service is not configured. Produces large output suitable for compression.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Research question or topic." },
          depth: { type: "string", enum: ["shallow", "normal", "deep"], description: "How many ranked sources to return. Default normal." },
          requirePrimarySources: { type: "boolean", description: "If true, prefer primary/citable sources." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "chat_history_search",
      description: "Search this conversation's own history for links, pending actions, prior tool results, or claims. Use this to recover things already mentioned (e.g. links you found but didn't open) instead of asking the user to repeat them.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional keyword to filter history." },
          kind: { type: "string", enum: ["all", "links", "pending_actions", "tool_results", "claims"], description: "What to look for. Default all." },
          max_results: { type: "number", description: "Max items to return. Default 10." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_snapshot",
      description: "Read a guarded snapshot of the current DS4 Studio UI or an allowed browser page. Use this before requesting UI actions.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Optional URL. If omitted, snapshots the current DS4 Studio UI/browser session." },
          includeControls: { type: "boolean", description: "Include visible buttons, inputs, selects, links." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_action",
      description: "Perform one guarded UI action on the DS4 Studio UI or an allowed page. Always inspect with page_snapshot first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["click", "input", "select", "scroll", "wait"], description: "Action to perform." },
          target: { type: "string", description: "data-agent-id, visible label, or stable selector." },
          value: { type: "string", description: "Text/value for input or select." },
          requireConfirmation: { type: "boolean", description: "Require user confirmation for potentially destructive action." }
        },
        required: ["action", "target"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_task",
      description: "Perform a high-level UI task described in natural language. Automatically inspects the page, plans and executes actions, and confirms the result. Use for multi-step tasks instead of chaining page_snapshot + page_action manually.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Natural language description of the task (e.g., 'Click the send button', 'Type hello in the chat input and click send')." },
          timeout_sec: { type: "number", description: "Timeout in seconds. Default 30." }
        },
        required: ["task"]
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
    this.ponyMode = "off";
    this.gitnexusEnabled = false;
    this.readGuard = new ReadGuard();
    this.loopGuard = new AgentLoopGuard({
      maxSameIntent: Number(process.env.DS4_AGENT_MAX_SAME_INTENT || 2),
      maxSameAction: Number(process.env.DS4_AGENT_MAX_SAME_ACTION || 1),
      maxNoProgress: Number(process.env.DS4_AGENT_MAX_NO_PROGRESS || 3),
      loopMode: process.env.DS4_AGENT_LOOP_GUARD || "block",
      outputEchoMode: process.env.DS4_AGENT_OUTPUT_ECHO_GUARD || "block"
    });
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
    this.ponyMode = "off";
    this.gitnexusEnabled = false;
    this.lastMode = "none";
    this.lastReason = "agent started";
    return this.status();
  }

  /** Stop and clear the agent session. */
  stop() {
    this.state = null;
    this.active = false;
    this.ponyMode = "off";
    this.gitnexusEnabled = false;
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
      lastReason: this.lastReason,
      ponyMode: this.ponyMode
    };
  }

  /** Set the DS4 lean-agent policy mode and reset prompt state so it applies. */
  setPonyMode(mode) {
    const normalized = normalizePonyMode(mode);
    if (!normalized) {
      const err = new Error("invalid pony mode");
      err.code = "EINVAL";
      throw err;
    }
    this.ponyMode = normalized;
    if (this.active) {
      this.reset(`pony mode set to ${normalized}; session reset`);
    }
    return this.status();
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
  reset(reason = "session reset by user") {
    if (!this.state) return;
    this.state.revision = 0;
    this.state.messageHashes = [];
    this.state.messages = [];
    this.lastMode = "none";
    this.lastReason = reason;
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
    if (!mgr) return { active: false, sessionId: null, revision: 0, lastMode: "none", lastReason: "agent stopped", ponyMode: "off" };
    const status = mgr.stop();
    this.sessions.delete(this.key(key));
    return status;
  }

  status(key) {
    const mgr = this.sessions.get(this.key(key));
    if (!mgr) return { active: false, sessionId: null, revision: 0, lastMode: "none", lastReason: "no session", ponyMode: "off" };
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
