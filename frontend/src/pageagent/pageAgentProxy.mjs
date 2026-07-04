let pollInterval = null;
const POLL_MS = 300;
const PENDING_URL = "/api/pageagent/pending";
const RESOLVE_URL = "/api/pageagent/resolve";

export function startProxy() {
  if (pollInterval) return;
  pollInterval = setInterval(pollPending, POLL_MS);
}

export function stopProxy() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

export function isProxyActive() {
  return pollInterval !== null;
}

async function pollPending() {
  try {
    const res = await fetch(PENDING_URL);
    if (!res.ok) return;
    const { tools } = await res.json();
    if (!tools || tools.length === 0) return;

    for (const tool of tools) {
      const result = await executeToolLocally(tool.name, tool.args);
      await fetch(RESOLVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tool.id, result })
      });
    }
  } catch {
    // connection error, keep polling
  }
}

async function executeToolLocally(name, args) {
  switch (name) {
    case "page_snapshot":
      return localPageSnapshot(args);
    case "page_action":
      return localPageAction(args);
    case "page_task":
      return localPageTask(args);
    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}

function localPageSnapshot(args = {}) {
  const includeControls = Boolean(args?.includeControls);
  const parts = [];

  const url = window.location.href;
  const title = document.title;
  parts.push(`URL: ${url}`);
  if (title) parts.push(`Title: ${title}`);
  parts.push("");

  if (includeControls) {
    const tags = "button, input, select, textarea, a, [role=button], [role=tab], [data-agent-id]";
    const els = document.querySelectorAll(tags);
    const visible = Array.from(els).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (visible.length > 0) {
      parts.push("Visible controls:");
      visible.forEach((el, i) => {
        const agentId = el.getAttribute("data-agent-id") || "";
        const text = (el.textContent || "").trim().slice(0, 60);
        const tag = el.tagName.toLowerCase();
        const enabled = !el.disabled;
        parts.push(`[${i + 1}] ${tag} data-agent-id="${agentId}" text="${text}" enabled=${enabled}`);
      });
    } else {
      parts.push("(none)");
    }
    parts.push("");
  }

  const bodyText = document.body?.innerText?.slice(0, 2000) || "";
  if (bodyText) {
    parts.push("Visible text:");
    parts.push(bodyText);
  }

  return { content: parts.join("\n"), isError: false };
}

function localPageAction(args = {}) {
  const action = args?.action || "";
  const target = args?.target || "";
  const value = args?.value || "";

  const IT_EN_MAP = {
    "profilo": "profile", "richiesta": "request", "avvio": "startup",
    "strategia": "strategy", "cronologia": "history", "esporta": "export",
    "registri": "logs", "metriche": "metrics", "compressione": "compression",
    "pagina": "pageagent", "invia": "send", "nuova sessione": "new session",
    "ricerca approfondita": "deep research", "debug chiamate": "call debug",
  };

  function translateTarget(t) {
    const lower = t.toLowerCase();
    for (const [it, en] of Object.entries(IT_EN_MAP)) {
      if (lower === it || lower.includes(it)) {
        if (t.length < 15) return en;
        return t.replace(new RegExp(it, "gi"), en);
      }
    }
    return t;
  }

  function findElement(t) {
    const selectors = [
      `[data-agent-id="${t}"]`,
      `[data-agent-id*="${t}"]`,
      `#${t}`, `[name="${t}"]`, `[aria-label="${t}"]`
    ];
    for (const sel of selectors) {
      try { const el = document.querySelector(sel); if (el) return el; } catch {}
    }
    const all = document.querySelectorAll("button, a, [role=button], [role=tab]");
    const lowerT = t.toLowerCase();
    for (const btn of all) {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text === lowerT) return btn;
      if (btn.getAttribute("data-agent-id")?.toLowerCase().includes(lowerT)) return btn;
      if (text.includes(lowerT) || lowerT.includes(text)) return btn;
    }
    return null;
  }

  const translatedTarget = translateTarget(target);
  const el = findElement(translatedTarget);

  if (!el) {
    return { content: [
      `Action: ${action}`, `Target: ${translatedTarget}`,
      `Result: failed`, `Error: Target not found: ${translatedTarget}`,
    ].join("\n"), isError: true };
  }

  try {
    switch (action) {
      case "click":
        el.click();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        break;
      case "input": {
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
          )?.set;
          if (setter) setter.call(el, value || "");
          else el.value = value || "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          el.textContent = value || "";
        }
        break;
      }
      case "select":
        if (el.tagName === "SELECT") {
          el.value = value || "";
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        break;
      case "scroll":
        el.scrollIntoView({ behavior: "instant", block: "center" });
        break;
      case "wait":
        break;
    }
    return { content: `Action: ${action}\nTarget: ${translatedTarget}\nResult: ok`, isError: false };
  } catch (err) {
    return { content: `Action: ${action}\nTarget: ${translatedTarget}\nResult: failed\nError: ${err.message}`, isError: true };
  }
}

async function localPageTask(args = {}) {
  const task = args?.task || "";
  if (!task.trim()) return { content: "Tool error: page_task requires a task", isError: true };

  const beforeSnapshot = localPageSnapshot({ includeControls: true });

  const parseRes = await fetch("/api/pageagent/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task })
  });
  if (!parseRes.ok) return { content: "Could not parse task", isError: true };
  const { action, target } = await parseRes.json();

  const actionResult = localPageAction({ action, target });

  const afterSnapshot = localPageSnapshot({ includeControls: false });

  return {
    content: [
      `Task: ${task}`,
      "",
      "--- Initial UI State ---",
      beforeSnapshot.content,
      "",
      `Planned action: ${action} on "${target}"`,
      "",
      "--- Action Result ---",
      actionResult.content,
      "",
      "--- Final UI State ---",
      afterSnapshot.content,
    ].join("\n"),
    isError: false
  };
}
