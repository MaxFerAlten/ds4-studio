const VERIFICATION_TOOLS = new Set(["sage", "lean_check"]);
const SKILLS = new Set(["sage", "lean"]);
const ACTIONS = new Set(["start", "stop", "status"]);

export const AGENT_INTENT_SYSTEM_PROMPT = [
  "You are the intent router for a mathematical assistant. Interpret the user's meaning; do not use exact keyword matching.",
  "Choose only among the SageMath tool (sage), the Lean 4 tool (lean_check), or both when the request requires both.",
  "Tool names in a request are cumulative: when the user asks to use or verify with SageMath and Lean 4, select both in required_tools and tool_selection unless the user explicitly says to choose one.",
  "A Sage skill action changes Sage instructions/policy state; it does not run a Sage computation.",
  "A Lean skill action changes Lean instructions/policy state; it does not run a Lean proof.",
  "If the user asks to start, stop, or inspect a skill, put that operation in skill_actions.",
  "If a mathematical claim should be checked by tools, set verification_requested=true and select every requested verifier in required_tools.",
  "If the user asks you to evaluate, compare or choose which tool or method suits the task, set tool_evaluation_requested=true. Set verification_requested=true as well only if the user also asks to run the verification: the goal a tool would serve (which tool to use to prove this) is part of what to evaluate, not a request to run it.",
  "When the user asks you to choose among tools and then verify, the choice is yours: select only the verifier(s) that can settle this task at the lowest cost, and both only when neither alone can.",
  "A short consent to continue (for example go ahead) right after the assistant evaluated tools or offered a verification is a request to run that verification: set verification_requested=true and select the verifier(s) that answer recommended or offered.",
  "When verification is requested without naming a verifier, choose the appropriate verifier(s) from the task: SageMath for computation, Lean 4 for formal proof, both only when useful or requested.",
  "For ordinary tasks with no math tool or skill action, return empty arrays and verification_requested=false.",
  "Return exactly one JSON object with this schema:",
  '{"verification_requested":boolean,"tool_evaluation_requested":boolean,"required_tools":["sage"|"lean_check"],"tool_selection":["sage"|"lean_check"],"skill_actions":[{"skill":"sage"|"lean","action":"start"|"stop"|"status"}]}',
  "required_tools is the set of verifiers whose result is required before a verification answer; tool_selection may also name tools for a non-verification computation.",
  "Do not include explanations or Markdown."
].join("\n");

export const TOOL_EVALUATION_INSTRUCTION = [
  "TOOL_EVALUATION_REQUESTED: open the final answer with the tool or method you recommend for this task, then,",
  "for each candidate tool, say what it can establish here and at what cost, and say plainly when no tool can settle the point (for example a choice of convention, which must be stated first).",
  "Run a tool only if the user also asked to run it, and attribute to a tool only results whose call completed in this turn.",
  "Write the answer directly in the language of the user's question, starting with the answer: do not narrate your plan or restate these instructions."
].join(" ");

function uniqueAllowed(values, allowed) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => allowed.has(value)))];
}

/** Parse and validate the model's structured intent. Invalid output fails closed. */
export function parseAgentRequestIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.verification_requested !== "boolean") {
    throw new TypeError("AGENT_INTENT_INVALID_SCHEMA");
  }
  const requiredTools = uniqueAllowed(value.required_tools, VERIFICATION_TOOLS);
  const toolSelection = uniqueAllowed(value.tool_selection, VERIFICATION_TOOLS);
  const skillActions = [];
  if (value.skill_actions !== undefined && !Array.isArray(value.skill_actions)) {
    throw new TypeError("AGENT_INTENT_INVALID_SKILL_ACTIONS");
  }
  for (const item of value.skill_actions || []) {
    if (!item || !SKILLS.has(item.skill) || !ACTIONS.has(item.action)) {
      throw new TypeError("AGENT_INTENT_INVALID_SKILL_ACTION");
    }
    if (!skillActions.some((action) => action.skill === item.skill && action.action === item.action)) {
      skillActions.push({ skill: item.skill, action: item.action });
    }
  }
  if (value.tool_evaluation_requested !== undefined && typeof value.tool_evaluation_requested !== "boolean") {
    throw new TypeError("AGENT_INTENT_INVALID_SCHEMA");
  }
  if (value.verification_requested && requiredTools.length === 0) {
    throw new TypeError("AGENT_INTENT_VERIFIERS_REQUIRED");
  }
  if (requiredTools.some((name) => !toolSelection.includes(name))) {
    toolSelection.push(...requiredTools.filter((name) => !toolSelection.includes(name)));
  }
  return {
    verificationRequested: value.verification_requested,
    toolEvaluationRequested: value.tool_evaluation_requested === true,
    requiredTools: orderTools(requiredTools),
    toolSelection: orderTools(toolSelection),
    skillActions
  };
}

function orderTools(values) {
  return ["sage", "lean_check"].filter((name) => values.includes(name));
}

export function parseAgentIntentContent(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("AGENT_INTENT_INVALID_JSON");
  }
  return parseAgentRequestIntent(value);
}

// A long answer states its result first and offers the next step last: keep both.
function clipMiddle(text, max) {
  if (text.length <= max) return text;
  const half = Math.floor((max - 5) / 2);
  return `${text.slice(0, half)} […] ${text.slice(-half)}`;
}

export function agentIntentContext(messages = [], currentMessage = "") {
  const recent = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-6)
    .map((message) => `${message.role}: ${clipMiddle(String(message.content || ""), 1800)}`);
  if (currentMessage) recent.push(`current user request: ${String(currentMessage).slice(0, 4000)}`);
  return recent.join("\n\n");
}
