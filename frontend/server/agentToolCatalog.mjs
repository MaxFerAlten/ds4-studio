/**
 * Canonical agent tool catalog.
 *
 * Defines the base set of tools available to the agent, plus utility functions
 * for querying and extending the catalog with optional tools.
 */

import { CONTEXT_SEARCH_TOOL } from "./contextSearchTool.mjs";

const BASE_AGENT_TOOLS = [
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
          timeout_sec: { type: "number", description: "Timeout in seconds. Default 60. Increase for large computations." },
          task_type: {
            type: "string",
            enum: [
              "auto", "evaluate", "simplify", "factor", "solve", "system",
              "calculus", "limit", "series", "function_study", "linear_algebra",
              "number_theory", "combinatorics", "probability", "geometry",
              "plot", "validation", "mixed"
            ],
            description: "Optional classification used only to organize Sage execution and presentation."
          },
          phase: {
            type: "string",
            enum: ["prepare", "compute", "validate", "plot", "repair"],
            description: "Optional phase of the current Sage workflow."
          },
          output_mode: {
            type: "string",
            enum: ["auto", "structured", "legacy"],
            description: "Output contract. Default auto."
          }
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
 * Deep freeze an object and all nested objects recursively.
 */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * The canonical, immutable catalog of agent tools.
 */
export const AGENT_TOOLS = deepFreeze(BASE_AGENT_TOOLS);

/**
 * Ordered list of tool names in the catalog.
 */
export const AGENT_TOOL_NAMES = Object.freeze(
  AGENT_TOOLS.map((item) => item.function.name)
);

/**
 * Map of tool name to tool definition for quick lookup.
 */
export const AGENT_TOOL_BY_NAME = new Map(
  AGENT_TOOLS.map((item) => [
    item.function.name,
    item
  ])
);

/**
 * Retrieve a tool definition by name.
 */
export function getAgentToolDefinition(name) {
  return AGENT_TOOL_BY_NAME.get(String(name)) || null;
}

/**
 * Get a defensive copy of the tool catalog.
 * Use this when passing tools to external APIs that might mutate them.
 */
export function listAgentTools() {
  return AGENT_TOOLS.map((item) =>
    structuredClone(item)
  );
}

/**
 * Return the effective set of tools, optionally including context_search.
 * ponytail: conditional tool addition; will be wired by caller in later phases.
 */
export function effectiveAgentTools({
  contextSearchEnabled = false
} = {}) {
  const tools = listAgentTools();

  if (contextSearchEnabled) {
    tools.push(structuredClone(CONTEXT_SEARCH_TOOL));
  }

  return tools;
}

/**
 * Combine base tools with optional tools into a single list.
 * ponytail: utility for tool merging; will be wired by caller when needed.
 */
export function appendOptionalTools(baseTools, optionalTools = []) {
  return [
    ...baseTools.map(structuredClone),
    ...optionalTools.map(structuredClone)
  ];
}
