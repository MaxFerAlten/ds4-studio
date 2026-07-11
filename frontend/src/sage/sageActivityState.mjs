const VALID_STATES = new Set([
  "idle",
  "preparing",
  "computing",
  "validating",
  "plotting",
  "repairing",
  "composing",
  "completed",
  "failed"
]);

const STATE_RANK = {
  idle: 0,
  preparing: 1,
  computing: 2,
  repairing: 2,
  validating: 3,
  plotting: 4,
  composing: 5,
  completed: 6,
  failed: 6
};

const ALLOWED_TRANSITIONS = new Set([
  "idle:preparing",
  "preparing:computing",
  "computing:validating",
  "computing:repairing",
  "repairing:computing",
  "validating:plotting",
  "validating:composing",
  "plotting:composing",
  "composing:completed"
]);

const GENERIC_STEPS = [
  ["prepare", "Preparazione"],
  ["compute", "Calcolo"],
  ["validate", "Validazione"],
  ["plot", "Grafici e artefatti"],
  ["compose", "Composizione finale"]
];

const FUNCTION_STUDY_STEPS = [
  ["definition", "Definizione e dominio"],
  ["analysis", "Zeri, segno, limiti e asintoti"],
  ["first_derivative", "Derivata prima, monotonia ed estremi"],
  ["second_derivative", "Derivata seconda, concavità e flessi"],
  ["validate", "Validazione incrociata"],
  ["plot", "Generazione grafici"],
  ["compose", "Composizione documento"]
];

function stepTemplates(taskType) {
  const source = taskType === "function_study" ? FUNCTION_STUDY_STEPS : GENERIC_STEPS;
  return source.map(([id, label]) => ({ id, label, status: "pending", detail: "" }));
}

function normalizedState(value, fallback = "idle") {
  return VALID_STATES.has(value) ? value : fallback;
}

function nextState(current, requested) {
  const target = normalizedState(requested, current);
  if (target === current || target === "failed") return target;
  if (ALLOWED_TRANSITIONS.has(`${current}:${target}`)) return target;
  if ((STATE_RANK[target] ?? -1) > (STATE_RANK[current] ?? -1)) return target;
  return current;
}

function phaseStepIds(taskType, phase, state) {
  if (state === "composing" || state === "completed") return ["compose"];
  if (phase === "validate") return ["validate"];
  if (phase === "plot") return ["plot"];
  if (taskType === "function_study") {
    if (phase === "prepare") return ["definition"];
    if (phase === "compute" || phase === "repair") {
      return ["definition", "analysis", "first_derivative", "second_derivative"];
    }
  }
  if (phase === "prepare") return ["prepare"];
  if (phase === "compute" || phase === "repair") return ["compute"];
  return [];
}

function eventStepStatus(event) {
  if (event.state === "failed" || event.status === "failed" || event.status === "error") {
    return "error";
  }
  if (event.state === "completed" || event.status === "completed" || event.status === "done") {
    return "done";
  }
  return "running";
}

function applyStepEvent(steps, ids, status, detail) {
  if (!ids.length) return steps.map((step) => ({ ...step }));
  const indexes = ids
    .map((id) => steps.findIndex((step) => step.id === id))
    .filter((index) => index >= 0);
  const furthest = indexes.length ? Math.max(...indexes) : -1;
  const lastTarget = indexes.length ? indexes[indexes.length - 1] : -1;

  return steps.map((step, index) => {
    if (index < furthest && (step.status === "pending" || step.status === "running")) {
      return { ...step, status: "done" };
    }
    if (!indexes.includes(index)) return { ...step };
    const targetStatus = status === "running" && index !== lastTarget ? "done" : status;
    return {
      ...step,
      status: targetStatus,
      detail: index === lastTarget && detail ? detail : step.detail
    };
  });
}

function upsertCorrection(corrections, event) {
  const key = event.callId || `attempt-${event.attempt || corrections.length + 1}`;
  const correction = {
    id: key,
    label: `Correzione ${Math.max(1, Number(event.repairCount) || corrections.length + 1)}`,
    status: eventStepStatus(event),
    detail: event.summary || ""
  };
  const index = corrections.findIndex((item) => item.id === key);
  if (index < 0) return [...corrections, correction];
  return corrections.map((item, itemIndex) => itemIndex === index ? correction : { ...item });
}

export function createSageActivity(input = {}) {
  const taskType = input.taskType || "auto";
  return {
    runId: input.runId || null,
    taskType,
    state: "idle",
    status: "idle",
    attempts: 0,
    repairCount: 0,
    validationPassed: null,
    steps: stepTemplates(taskType),
    corrections: [],
    artifacts: [],
    plotSeen: false,
    debugAvailable: false,
    error: null
  };
}

export function applySageStatus(activity, event = {}) {
  let current = activity
    ? {
        ...activity,
        steps: activity.steps.map((step) => ({ ...step })),
        corrections: (activity.corrections || []).map((item) => ({ ...item })),
        artifacts: (activity.artifacts || []).map((item) => ({ ...item }))
      }
    : createSageActivity(event);

  if (current.taskType === "auto" && event.taskType && event.taskType !== "auto") {
    current = {
      ...current,
      taskType: event.taskType,
      steps: stepTemplates(event.taskType)
    };
  }

  const requestedState = normalizedState(event.state, current.state);
  const state = nextState(current.state, requestedState);
  const stepStatus = eventStepStatus(event);
  const ids = phaseStepIds(current.taskType, event.phase, requestedState);
  let steps = applyStepEvent(current.steps, ids, stepStatus, event.summary);
  let corrections = current.corrections;

  if (event.phase === "repair") {
    corrections = upsertCorrection(corrections, event);
  }
  if (requestedState === "completed") {
    steps = applyStepEvent(steps, ["compose"], "done", event.summary);
    steps = steps.map((step) => step.status === "running" ? { ...step, status: "done" } : step);
  } else if (requestedState === "failed" && !ids.length) {
    const runningIndex = steps.findLastIndex((step) => step.status === "running");
    if (runningIndex >= 0) {
      steps = steps.map((step, index) => index === runningIndex
        ? { ...step, status: "error", detail: event.summary || step.detail }
        : step);
    }
  }

  return {
    ...current,
    runId: event.runId || current.runId,
    taskType: event.taskType || current.taskType,
    state,
    status: event.status || current.status,
    attempts: Math.max(current.attempts, Number(event.attempt) || 0),
    repairCount: Math.max(
      current.repairCount,
      corrections.length,
      Number(event.repairCount) || 0
    ),
    validationPassed: typeof event.validationPassed === "boolean"
      ? event.validationPassed
      : current.validationPassed,
    steps,
    corrections,
    plotSeen: current.plotSeen || event.phase === "plot" || requestedState === "plotting",
    debugAvailable: current.debugAvailable || Boolean(event.debugAvailable),
    error: stepStatus === "error" ? event.summary || event.code || "SageMath error" : current.error
  };
}

export function applySageArtifact(activity, event = {}) {
  const current = activity || createSageActivity(event);
  const artifact = event.artifact || event;
  if (!artifact || !artifact.name || !artifact.url) return current;
  const key = artifact.url || artifact.name;
  const artifacts = (current.artifacts || []).filter(
    (item) => (item.url || item.name) !== key
  );
  return {
    ...current,
    runId: event.runId || current.runId,
    artifacts: [...artifacts, { ...artifact }],
    plotSeen: true
  };
}

export function finalizeSageActivity(activity) {
  if (!activity) return null;
  if (activity.state === "failed" || activity.status === "failed") return activity;
  return applySageStatus(activity, {
    runId: activity.runId,
    taskType: activity.taskType,
    state: "completed",
    status: "completed",
    summary: "Completato."
  });
}

export function visibleSageSteps(activity) {
  if (!activity) return [];
  const base = activity.steps.filter((step) => (
    step.id !== "plot" || activity.plotSeen || activity.artifacts.length > 0 || step.status !== "pending"
  ));
  if (!activity.corrections?.length) return base;

  const insertAfter = activity.taskType === "function_study" ? "second_derivative" : "compute";
  const index = base.findIndex((step) => step.id === insertAfter);
  const correctionSteps = activity.corrections.map((correction) => ({ ...correction }));
  if (index < 0) return [...base, ...correctionSteps];
  return [...base.slice(0, index + 1), ...correctionSteps, ...base.slice(index + 1)];
}

export function shouldHideSageToolTrace(data, compactEnabled = true) {
  return compactEnabled && data?.name === "sage" && data.hiddenByDefault !== false;
}

export function toolResultMessages(data, compactEnabled = true) {
  if (shouldHideSageToolTrace(data, compactEnabled)) return [];
  return [
    {
      role: "tool",
      name: data?.name,
      content: data?.content || "",
      isError: Boolean(data?.isError),
      guarded: Boolean(data?.guarded)
    },
    { role: "assistant", content: "", reasoning: "", tool_calls: [] }
  ];
}
