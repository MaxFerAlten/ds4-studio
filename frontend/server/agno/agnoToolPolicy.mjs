/**
 * Metadata and authorization policy for Agno-originated tool calls.
 *
 * Separate from the OpenAI-facing tool schemas (agentToolCatalog.mjs,
 * agentToolSchema.mjs): this module governs *whether* a tool call is
 * currently permitted, not how its arguments are shaped.
 */

export const AGNO_TOOL_PROFILE = Object.freeze({
  safe: Object.freeze([
    "read",
    "search",
    "list",
    "retrieve_context_blob",
    "sage",
    "web_search",
    "web_read",
    "crawl",
    "research_discover",
    "chat_history_search",
    "page_snapshot"
  ]),
  full: Object.freeze([
    "bash",
    "read",
    "write",
    "edit",
    "search",
    "list",
    "retrieve_context_blob",
    "sage",
    "web_search",
    "web_read",
    "crawl",
    "research_discover",
    "chat_history_search",
    "page_snapshot",
    "page_action",
    "page_task"
  ])
});

export const AGNO_TOOL_METADATA = Object.freeze({
  bash: {
    class: "process",
    mutating: true,
    maxTimeoutMs: 120_000
  },
  read: {
    class: "filesystem-read",
    mutating: false,
    maxTimeoutMs: 30_000
  },
  write: {
    class: "filesystem-write",
    mutating: true,
    maxTimeoutMs: 30_000
  },
  edit: {
    class: "filesystem-write",
    mutating: true,
    maxTimeoutMs: 30_000
  },
  search: {
    class: "filesystem-read",
    mutating: false,
    maxTimeoutMs: 30_000
  },
  list: {
    class: "filesystem-read",
    mutating: false,
    maxTimeoutMs: 30_000
  },
  retrieve_context_blob: {
    class: "context-read",
    mutating: false,
    maxTimeoutMs: 10_000
  },
  sage: {
    class: "compute",
    mutating: false,
    maxTimeoutMs: 120_000
  },
  web_search: {
    class: "network-read",
    mutating: false,
    maxTimeoutMs: 60_000
  },
  web_read: {
    class: "network-read",
    mutating: false,
    maxTimeoutMs: 60_000
  },
  crawl: {
    class: "network-read",
    mutating: false,
    maxTimeoutMs: 120_000
  },
  research_discover: {
    class: "network-read",
    mutating: false,
    maxTimeoutMs: 120_000
  },
  chat_history_search: {
    class: "context-read",
    mutating: false,
    maxTimeoutMs: 10_000
  },
  page_snapshot: {
    class: "ui-read",
    mutating: false,
    maxTimeoutMs: 30_000
  },
  page_action: {
    class: "ui-write",
    mutating: true,
    maxTimeoutMs: 120_000
  },
  page_task: {
    class: "ui-write",
    mutating: true,
    maxTimeoutMs: 120_000
  }
});

export class AgnoToolPolicyError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "AgnoToolPolicyError";
    this.code = code;
    this.status = status;
  }
}

export class AgnoToolPolicy {
  constructor({
    enabled,
    profile,
    allowedTools,
    deniedTools
  }) {
    this.enabled = Boolean(enabled);
    this.profile = profile;
    this.allowed = new Set(
      allowedTools?.length
        ? allowedTools
        : AGNO_TOOL_PROFILE[profile] || []
    );
    this.denied = new Set(deniedTools || []);
  }

  assertAllowed(name) {
    if (!this.enabled) {
      throw new AgnoToolPolicyError(
        "AGNO_TOOLS_DISABLED",
        "Agno tools are disabled",
        503
      );
    }

    if (!AGNO_TOOL_METADATA[name]) {
      throw new AgnoToolPolicyError(
        "UNKNOWN_TOOL",
        `Unknown tool: ${name}`,
        404
      );
    }

    if (
      this.denied.has(name) ||
      !this.allowed.has(name)
    ) {
      throw new AgnoToolPolicyError(
        "TOOL_NOT_ALLOWED",
        `Tool is not allowed by profile ${this.profile}: ${name}`,
        403
      );
    }

    return AGNO_TOOL_METADATA[name];
  }

  // ponytail: this.allowed is a Set for O(1) membership checks in
  // assertAllowed(); allowedToolNames() re-derives an ordered Array view
  // on demand for callers (catalog/status endpoints) that need .includes()
  // / .length rather than Set semantics.
  allowedToolNames() {
    return Array.from(this.allowed).filter(
      (name) => !this.denied.has(name)
    );
  }
}
