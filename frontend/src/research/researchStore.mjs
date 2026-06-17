export const NODE_TITLES = Object.freeze({
  coordinator: "Coordinator",
  rewrite_multi_query: "Query Rewriter",
  background_investigator: "Source Gathering",
  planner: "Planner",
  parallel_executor: "Researchers",
  research_team: "Synthesis",
  reporter: "Reporter"
});

export function initialResearchView() {
  return {
    sessionId: null,
    status: "idle",
    lastSeq: 0,
    nodes: [],
    plan: null,
    planIterations: 0,
    sources: [],
    report: "",
    error: null,
    artifacts: [],
    artDownloadUrl: "",
    ...{}
  };
}

export function researchViewFromState(state) {
  const base = initialResearchView();
  const nodes = Object.entries(state?.nodes || {}).map(([name, result]) => ({
    name,
    title: NODE_TITLES[name] || name,
    status: "done",
    result
  }));
  const artifacts = Array.isArray(state?.artifacts) ? state.artifacts : [];
  const primaryArtifact = artifacts.find((artifact) => /\.tex$/i.test(artifact?.filePath)) || artifacts[0];
  return {
    sessionId: state?.sessionId || null,
    status: typeof state?.status === "string" ? state.status : base.status,
    lastSeq: Number.isFinite(state?.seq) ? state.seq : 0,
    nodes,
    plan: state?.currentPlan || null,
    planIterations: Number.isFinite(state?.planIterations) ? state.planIterations : 0,
    sources: Array.isArray(state?.sources) ? state.sources : [],
    report: typeof state?.finalReport === "string" ? state.finalReport : "",
    error: state?.error || null,
    artifacts,
    artDownloadUrl: typeof primaryArtifact?.filePath === "string" ? primaryArtifact.filePath : ""
  };
}

function upsertNode(nodes, name, patch) {
  if (!name) return nodes;
  const idx = nodes.findIndex((n) => n.name === name);
  if (idx === -1) {
    return [...nodes, { name, title: NODE_TITLES[name] || name, status: "running", result: null, ...patch }];
  }
  const copy = [...nodes];
  copy[idx] = { ...copy[idx], ...patch };
  return copy;
}

export function applyResearchEvent(view, event) {
  if (!event || typeof event.seq !== "number" || event.seq <= view.lastSeq) return view;
  const next = { ...view, lastSeq: event.seq, sessionId: event.sessionId || view.sessionId };
  switch (event.type) {
    case "research_started":
      next.status = "running";
      break;
    case "node_started":
      next.nodes = upsertNode(next.nodes, event.nodeName, { status: "running" });
      break;
    case "node_completed":
      next.nodes = upsertNode(next.nodes, event.nodeName, {
        status: "done",
        result: event.content?.result ?? null
      });
      break;
    case "plan_generated":
      next.plan = event.content?.plan || null;
      next.planIterations = event.content?.planIterations || 0;
      break;
    case "feedback_required":
      next.status = "waiting_feedback";
      break;
    case "feedback_received":
      next.status = "running";
      if (event.content?.action === "regenerate") next.plan = null;
      break;
    case "source_found": {
      const source = event.content?.source;
      if (source && !view.sources.some((s) => s.id === source.id)) {
        next.sources = [...view.sources, source];
      }
      break;
    }
    case "report_delta":
      next.report = view.report + (event.content?.content || "");
      break;
    case "report_completed":
      if (typeof event.content?.report === "string") next.report = event.content.report;
      break;
    case "authors_verified":
      if (Array.isArray(event.content?.sources)) next.sources = event.content.sources;
      break;
    case "research_completed":
      next.status = "completed";
      break;
    case "research_error":
      next.status = "failed";
      next.error = event.content?.error || "unknown error";
      break;
    case "research_cancelled":
      next.status = "cancelled";
      break;
    default:
      break;
  }
  return next;
}

export function formatNodeResult(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && Object.keys(value).length === 0) return "";
  if (Array.isArray(value) && value.length === 0) return "";
  return JSON.stringify(value, null, 2);
}
