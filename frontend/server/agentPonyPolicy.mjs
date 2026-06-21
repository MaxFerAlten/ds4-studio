const PONY_MODES = new Set(["off", "lite", "full", "ultra"]);

export function normalizePonyMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "start") return "full";
  if (mode === "stop") return "off";
  return PONY_MODES.has(mode) ? mode : null;
}

export function ponyModeLabel(mode) {
  return normalizePonyMode(mode) || "off";
}

const MODE_LINES = {
  lite: "Prefer the smaller safe option and mention if a larger design is being skipped.",
  full: "Use the smallest safe diff that satisfies the explicit request.",
  ultra: "Challenge speculative work, delete or inline before adding abstractions, and still keep every safety check."
};

export function buildPonyPolicy(mode) {
  const normalized = normalizePonyMode(mode);
  if (!normalized || normalized === "off") return "";
  return [
    `DS4 Lean Agent Policy — mode: ${normalized}`,
    "",
    "This policy applies only to coding-agent work inside DS4 Studio.",
    MODE_LINES[normalized],
    "",
    "Before adding code, choose the first safe option that satisfies the request:",
    "1. Avoid the change if it is not needed.",
    "2. Reuse existing DS4 code before creating new code.",
    "3. Prefer standard library and native platform features.",
    "4. Prefer already-installed dependencies over new dependencies.",
    "5. Prefer the smallest safe diff and the fewest touched files.",
    "6. Add only the minimum code that satisfies the explicit request.",
    "",
    "Never simplify away GitNexus impact/detect_changes workflow, trust-boundary validation, security checks, data-loss prevention, accessibility basics, explicit user requirements, or one minimal runnable check for non-trivial logic.",
    "If an intentional shortcut has a known ceiling, mark it with `ds4-pony:` and name the upgrade trigger."
  ].join("\n");
}

export function appendPonyPolicy(basePrompt, mode) {
  const policy = buildPonyPolicy(mode);
  return policy ? `${basePrompt}\n\n${policy}` : basePrompt;
}

export function ponyCommandMessage(mode) {
  const normalized = normalizePonyMode(mode);
  if (!normalized) return null;
  if (normalized === "off") return "Pony mode disabled. Agent session reset so the next turn uses the normal policy.";
  return `Pony mode enabled: ${normalized}. Applies only to Agent Mode; agent session reset so the policy applies on the next turn.`;
}
