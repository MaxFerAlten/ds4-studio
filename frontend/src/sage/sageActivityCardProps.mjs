import { visibleSageSteps } from "./sageActivityState.mjs";

const STATUS_ICON = {
  pending: "\u25CB",
  running: "\u25B8",
  done: "\u2713",
  error: "\u2717"
};

const STATE_LABEL = {
  idle: "",
  preparing: "Preparazione\u2026",
  computing: "Calcolo\u2026",
  validating: "Validazione\u2026",
  plotting: "Grafici\u2026",
  repairing: "Correzione\u2026",
  composing: "Composizione\u2026",
  completed: "Completato",
  failed: "Arrestato"
};

export function sageActivityCardProps(activity) {
  if (!activity) return null;

  const steps = visibleSageSteps(activity);
  const summary = STATE_LABEL[activity.state] || activity.state;
  const runs = activity.attempts || 0;
  const repairs = activity.repairCount || 0;
  const artCount = activity.artifacts?.length || 0;
  const artText = artCount ? `${artCount} ${artCount === 1 ? "artefatto" : "artefatti"}` : null;
  const footerLine = [
    runs ? `${runs} ${runs === 1 ? "esecuzione" : "esecuzioni"}` : null,
    repairs ? `${repairs} ${repairs === 1 ? "correzione" : "correzioni"}` : null,
    artText
  ].filter(Boolean).join(" \u00B7 ");

  return {
    className: "sage-activity",
    role: "status",
    ariaLive: "polite",
    title: "SageMath",
    summary,
    steps: steps.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status,
      icon: STATUS_ICON[step.status] || "\u25CB",
      detail: step.detail || ""
    })),
    footerLine,
    artifacts: (activity.artifacts || []).map((art) => ({
      name: art.name,
      url: art.url
    })),
    error: activity.error || null,
    debug: activity
  };
}
