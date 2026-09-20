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

// \u00A717.2: what the user reads is the orchestration decision in plain Italian \u2014
// never stdout, a traceback or a local path. A repairable failure has to look
// like work in progress, because that is what it is.
const PHASE_LABEL = {
  compute: "calcolo",
  validate: "validazione",
  repair: "correzione",
  plot: "grafici",
  publish: "pubblicazione"
};

function orchestrationSummary(activity) {
  const revision = activity.candidateRevision || 0;
  if (activity.state === "repairing") return "Correzione matematica autonoma in corso";
  if (activity.state === "validating" && revision > 1) {
    return `Nuova validazione della revisione ${revision}`;
  }
  if (activity.state === "plotting" && activity.missingArtifactKinds?.length) {
    return "Generazione artefatto mancante";
  }
  return STATE_LABEL[activity.state] || activity.state;
}

export function sageActivityCardProps(activity) {
  if (!activity) return null;

  const steps = visibleSageSteps(activity);
  const summary = orchestrationSummary(activity);
  const runs = activity.attempts || 0;
  const repairs = activity.repairCount || 0;
  const validations = activity.validationCount || 0;
  const plots = activity.plotCount || 0;
  const revision = activity.candidateRevision || 0;
  const nextPhase = activity.requiredNextPhase;
  const artCount = activity.artifacts?.length || 0;
  const artText = artCount ? `${artCount} ${artCount === 1 ? "artefatto" : "artefatti"}` : null;
  const footerLine = [
    revision ? `revisione ${revision}` : null,
    runs ? `${runs} ${runs === 1 ? "esecuzione" : "esecuzioni"}` : null,
    repairs ? `${repairs} ${repairs === 1 ? "correzione" : "correzioni"}` : null,
    validations ? `${validations} ${validations === 1 ? "validazione" : "validazioni"}` : null,
    plots ? `${plots} ${plots === 1 ? "grafico" : "grafici"}` : null,
    artText,
    nextPhase && nextPhase !== "publish" ? `prossima fase: ${PHASE_LABEL[nextPhase] || nextPhase}` : null,
    activity.strategyChangeRequired ? "cambio di strategia richiesto" : null,
    activity.failureClass && activity.state === "failed" ? `causa: ${activity.failureClass}` : null
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
