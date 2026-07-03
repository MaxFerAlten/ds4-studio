/**
 * Page Browser Bridge — provides a read-only snapshot of the DS4 Studio UI
 * state for the page_snapshot tool.
 *
 * In the MVP, this returns a structured description of the known UI state
 * without requiring a live browser session. Future versions will bridge to
 * a real browser tab via CDP or the PageAgent client-side instance.
 */

/**
 * Build a structured snapshot of the DS4 Studio UI from known state.
 * @param {object} options
 * @param {string} [options.url] - Optional URL override
 * @param {boolean} [options.includeControls] - Include visible controls list
 * @param {object} [options.uiState] - Known UI state from the server
 * @returns {object} snapshot object
 */
export function buildUiSnapshot({ url, includeControls, uiState = {} } = {}) {
  const snapshotUrl = url || "http://127.0.0.1:5173";
  const title = "DS4 Studio";

  const visibleText = [
    "DS4 Studio",
    "Chat",
    ...(uiState.activeTabs || []).map((t) => String(t).charAt(0).toUpperCase() + String(t).slice(1)),
    "Settings"
  ].join("\n");

  const controls = includeControls
    ? buildControlList(uiState)
    : [];

  return {
    url: snapshotUrl,
    title,
    visibleText,
    controls,
    forms: [],
    warnings: []
  };
}

/**
 * Build a list of visible controls from known UI state.
 * @param {object} uiState
 * @returns {Array<object>}
 */
function buildControlList(uiState = {}) {
  const controls = [];
  let index = 0;

  // Tab buttons in the right rail
  const knownTabs = [
    "request", "profile", "startup", "strategy", "history",
    "export", "logs", "metrics", "call-debug", "compression", "pageagent"
  ];
  for (const tab of knownTabs) {
    controls.push({
      index: ++index,
      role: "button",
      text: tab === "call-debug" ? "Call Debug" : tab === "pageagent" ? "PageAgent" : tab.charAt(0).toUpperCase() + tab.slice(1),
      agentId: `right-rail-${tab}-tab`,
      enabled: true
    });
  }

  // Chat controls
  controls.push({
    index: ++index,
    role: "textarea",
    text: "Message input",
    agentId: "chat-input",
    enabled: true
  });
  controls.push({
    index: ++index,
    role: "button",
    text: "Send",
    agentId: "chat-send-button",
    enabled: true
  });
  controls.push({
    index: ++index,
    role: "button",
    text: "New session",
    agentId: "chat-new-session-button",
    enabled: true
  });
  controls.push({
    index: ++index,
    role: "button",
    text: "Export MD",
    agentId: "chat-export-button",
    enabled: true
  });

  return controls;
}

/**
 * Format a snapshot as a compact Markdown string suitable for tool output.
 * @param {object} snapshot
 * @returns {string}
 */
export function formatSnapshot(snapshot) {
  const lines = [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    "",
    "Visible controls:"
  ];
  for (const ctrl of snapshot.controls) {
    const enabled = ctrl.enabled ? "enabled=true" : "enabled=false";
    lines.push(`[${ctrl.index}] ${ctrl.role} data-agent-id="${ctrl.agentId}" text="${ctrl.text}" ${enabled}`);
  }
  if (snapshot.controls.length === 0) {
    lines.push("(none requested)");
  }
  lines.push("");
  lines.push("Visible text:");
  lines.push(snapshot.visibleText);
  return lines.join("\n");
}
