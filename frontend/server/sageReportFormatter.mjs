export const FUNCTION_STUDY_SECTIONS = Object.freeze([
  "function",
  "domain",
  "continuity_regularity",
  "symmetry",
  "intersections",
  "sign",
  "limits",
  "asymptotes",
  "first_derivative",
  "first_derivative_sign_table",
  "monotonicity",
  "local_extrema",
  "absolute_extrema_boundedness",
  "range",
  "second_derivative",
  "second_derivative_sign_table",
  "concavity",
  "inflection_points",
  "plots",
  "summary",
  "runtime_note"
]);

const GENERIC_SECTION_ORDER = Object.freeze([
  "setup",
  "calculations",
  "result",
  "validation",
  "graphs",
  "conclusion"
]);

const CLASSIFICATION_LABELS = Object.freeze({
  local_maximum: "Massimo locale",
  local_minimum: "Minimo locale",
  stationary_non_extremum: "Punto stazionario non estremo"
});

function isRuntimeReport(report) {
  return report && typeof report === "object" &&
    report.authority === "runtime" &&
    report.validationPassed === true;
}

function safeText(value, { multiline = false } = {}) {
  let text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\/(?:home|mnt|tmp|var\/tmp)\/[^\s"'<>\])}]+/g, "[local-path]")
    .replace(/Traceback[\s\S]*/gi, "[diagnostic hidden]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (!multiline) text = text.replace(/\n+/g, " ");
  return text.trim();
}

function tableText(value) {
  return safeText(value).replace(/\|/g, "\\|");
}

function formulaBody(value) {
  let text = safeText(value);
  if (!text) return "";
  const wrappers = [
    ["$$", "$$"],
    ["$", "$"],
    ["\\(", "\\)"],
    ["\\[", "\\]"]
  ];
  for (const [start, end] of wrappers) {
    if (text.startsWith(start) && text.endsWith(end) &&
        text.length >= start.length + end.length) {
      text = text.slice(start.length, -end.length).trim();
      break;
    }
  }
  return text
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\$\$/g, "")
    .trim();
}

function blockFormula(value) {
  const body = formulaBody(value);
  return body ? "$$\n" + body + "\n$$" : "";
}

function inlineFormula(value) {
  const body = formulaBody(value);
  return body ? "$" + body + "$" : "";
}

function valueLatex(value) {
  const text = formulaBody(value);
  if (["inf", "+inf", "infinity", "+infinity", "oo", "+oo", "∞", "+∞"].includes(text.toLowerCase())) {
    return "\\infty";
  }
  if (["-inf", "-infinity", "-oo", "-∞", "−∞"].includes(text.toLowerCase())) {
    return "-\\infty";
  }
  return text;
}

function intervalLatex(interval) {
  if (!interval || typeof interval !== "object") return "";
  const left = valueLatex(interval.left);
  const right = valueLatex(interval.right);
  if (!left || !right) return "";
  const leftOpen = interval.left_open !== undefined
    ? Boolean(interval.left_open)
    : interval.leftClosed !== undefined
      ? !Boolean(interval.leftClosed)
      : true;
  const rightOpen = interval.right_open !== undefined
    ? Boolean(interval.right_open)
    : interval.rightClosed !== undefined
      ? !Boolean(interval.rightClosed)
      : true;
  const leftFence = leftOpen || left.includes("\\infty") ? "(" : "[";
  const rightFence = rightOpen || right.includes("\\infty") ? ")" : "]";
  return leftFence + left + ", " + right + rightFence;
}

function intervalUnion(intervals) {
  const values = (Array.isArray(intervals) ? intervals : [])
    .map(intervalLatex)
    .filter(Boolean);
  return values.length ? inlineFormula(values.join(" \\cup ")) : "";
}

function section(parts, title, lines = []) {
  parts.push("## " + title);
  const content = lines.filter((line) => typeof line === "string" && line.trim());
  parts.push(...(content.length ? content : ["Non disponibile nel report normalizzato."]));
}

function artifactIsImmutable(artifact) {
  const runId = String(artifact?.runId ?? "");
  const sha256 = String(artifact?.sha256 ?? "");
  const artifactId = String(artifact?.artifactId ?? "");
  if (!runId || !/^[a-f0-9]{64}$/.test(sha256) ||
      artifactId !== "sha256:" + sha256 ||
      Number(artifact?.sizeBytes) <= 0) {
    return false;
  }
  return artifact?.url ===
    "/api/sage/artifacts/" + encodeURIComponent(runId) + "/" + encodeURIComponent(artifactId);
}

function artifactLines(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter(artifactIsImmutable)
    .map((artifact) => {
      const label = safeText(artifact.name || artifact.kind || "Artefatto")
        .replace(/[\[\]]/g, "");
      return String(artifact.mediaType || "").startsWith("image/")
        ? "![" + label + "](" + artifact.url + ")"
        : "[" + label + "](" + artifact.url + ")";
    });
}

function rowLocation(row) {
  const interval = intervalLatex(row?.interval);
  if (interval) return interval;
  const sample = valueLatex(row?.sample_point);
  return sample ? "x=" + sample : "";
}

function signTable(rows) {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.length) return [];
  const lines = [
    "| Intervallo o campione | Segno | Valore runtime |",
    "|---|---:|---:|"
  ];
  for (const row of source) {
    lines.push(
      "| " + tableText(rowLocation(row)) + " | " + tableText(row?.sign) +
      " | " + tableText(row?.evaluated_value) + " |"
    );
  }
  return lines;
}

function trendLines(rows, positive, negative) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const sign = String(row?.sign ?? "");
    const label = sign === "+" || sign === "positive" || sign === "1"
      ? positive
      : sign === "-" || sign === "negative" || sign === "-1"
        ? negative
        : "andamento non classificato";
    const location = rowLocation(row);
    return "- " + (inlineFormula(location) || tableText(location)) + ": " + label + ".";
  });
}

export function formatSageReport(report, options = {}) {
  if (!isRuntimeReport(report)) return "";
  if (report.kind === "function_study_v1") return formatFunctionStudyReport(report, options);
  if (report.kind !== "math_report") return "";

  const sections = Array.isArray(report.sections) ? report.sections : [];
  const indexed = new Map();
  for (const item of sections) {
    if (GENERIC_SECTION_ORDER.includes(item?.id) && item?.title) indexed.set(item.id, item);
  }

  const parts = ["# " + (safeText(report.title) || "Risultato matematico")];
  for (const id of GENERIC_SECTION_ORDER) {
    const item = indexed.get(id);
    if (!item) continue;
    const lines = [];
    const markdown = safeText(item.markdown, { multiline: true });
    if (markdown) lines.push(markdown);
    for (const formula of Array.isArray(item.formulas) ? item.formulas : []) {
      const rendered = blockFormula(formula);
      if (rendered) lines.push(rendered);
    }
    section(parts, safeText(item.title), lines);
  }

  const artifacts = artifactLines(options.artifacts);
  if (artifacts.length) section(parts, "Grafici e artefatti", artifacts);
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatFunctionStudyReport(report, options = {}) {
  if (!isRuntimeReport(report) || report.kind !== "function_study_v1") return "";

  const domain = report.domain && typeof report.domain === "object" ? report.domain : {};
  const components = Array.isArray(domain.components) ? domain.components : [];
  const exclusions = Array.isArray(domain.excluded_points)
    ? domain.excluded_points
    : Array.isArray(domain.excluded)
      ? domain.excluded
      : [];
  const functionRows = Array.isArray(report.function_sign_rows)
    ? report.function_sign_rows
    : Array.isArray(report.signIntervals)
      ? report.signIntervals
      : [];
  const first = report.first_derivative ?? report.firstDerivative ?? {};
  const second = report.second_derivative ?? report.secondDerivative ?? {};
  const firstRows = Array.isArray(first.sign_rows)
    ? first.sign_rows
    : Array.isArray(first.monotonicityIntervals)
      ? first.monotonicityIntervals
      : [];
  const secondRows = Array.isArray(second.sign_rows)
    ? second.sign_rows
    : Array.isArray(second.concavityIntervals)
      ? second.concavityIntervals
      : [];
  const criticalPoints = Array.isArray(report.critical_points)
    ? report.critical_points
    : Array.isArray(first.criticalPoints)
      ? first.criticalPoints
      : [];
  const inflectionPoints = Array.isArray(report.inflection_points)
    ? report.inflection_points
    : Array.isArray(second.inflectionPoints)
      ? second.inflectionPoints
      : [];
  const parts = ["# Studio della funzione"];

  const expression = report.function?.latex ||
    (report.expression ? (report.variable || "x") + " \\mapsto " + report.expression : "");
  section(parts, "Funzione", [blockFormula(expression)]);

  const domainLines = [];
  const union = intervalUnion(components);
  if (union) domainLines.push(union);
  if (exclusions.length) {
    domainLines.push(
      "Punti esclusi: " + exclusions.map(inlineFormula).filter(Boolean).join(", ") + "."
    );
  }
  section(parts, "Dominio", domainLines);

  section(parts, "Continuità e regolarità", components.length
    ? ["Analisi runtime separata su " + components.length + " " +
      (components.length === 1 ? "componente connessa" : "componenti connesse") +
      " del dominio."]
    : []);

  const symmetry = String(report.symmetry?.kind ?? "");
  section(parts, "Simmetrie", symmetry
    ? ["Classificazione nel report validato: **" + safeText(symmetry) + "**."]
    : []);

  const intercepts = report.intercepts && typeof report.intercepts === "object"
    ? report.intercepts
    : {};
  const intersectionLines = [];
  if (Array.isArray(intercepts.x) && intercepts.x.length) {
    intersectionLines.push(
      "Asse x: " + intercepts.x.map(inlineFormula).filter(Boolean).join(", ") + "."
    );
  }
  if (intercepts.y !== null && intercepts.y !== undefined) {
    intersectionLines.push(
      "Asse y: " + inlineFormula("(0, " + valueLatex(intercepts.y) + ")") + "."
    );
  }
  section(parts, "Intersezioni", intersectionLines);

  section(parts, "Segno", signTable(functionRows));

  const limitLines = (Array.isArray(report.limits) ? report.limits : []).map((limit) => {
    if (limit?.latex) return "- " + inlineFormula(limit.latex);
    const description = safeText(limit?.description);
    const result = valueLatex(limit?.value ?? limit?.result);
    return description || result
      ? "- " + description + (description && result ? ": " : "") + inlineFormula(result)
      : "";
  });
  section(parts, "Limiti", limitLines);

  const asymptoteLines = (Array.isArray(report.asymptotes) ? report.asymptotes : [])
    .map((item) => {
      const kind = safeText(item?.kind ?? item?.label);
      const equation = inlineFormula(item?.equation);
      return kind || equation
        ? "- " + kind + (kind && equation ? ": " : "") + equation
        : "";
    });
  section(parts, "Asintoti", asymptoteLines);

  section(parts, "Derivata prima", [blockFormula(first.reported ?? first.latex)]);
  section(parts, "Tabella segni di f'", signTable(firstRows));
  section(parts, "Monotonia", trendLines(firstRows, "crescente", "decrescente"));

  const criticalLines = criticalPoints.map((point) => {
    if (!point || typeof point !== "object") return "";
    const classification = CLASSIFICATION_LABELS[point.classification] ||
      safeText(point.classification);
    const x = valueLatex(point.x);
    const value = valueLatex(point.value);
    return "- " + (classification || "Punto critico") + ": " + inlineFormula("x=" + x) +
      (value ? ", " + inlineFormula("f(x)=" + value) : "") + ".";
  });
  section(parts, "Estremi locali", criticalLines);

  const absolute = report.absolute_extrema && typeof report.absolute_extrema === "object"
    ? report.absolute_extrema
    : {};
  const absoluteLines = [];
  for (const [key, label] of [["minimum", "Minimo assoluto"], ["maximum", "Massimo assoluto"]]) {
    const value = absolute[key];
    if (value && typeof value === "object") {
      absoluteLines.push(
        "- " + label + ": " + inlineFormula("x=" + valueLatex(value.x)) + ", " +
        inlineFormula("f(x)=" + valueLatex(value.value)) + "."
      );
    }
  }
  if (!absoluteLines.length) {
    absoluteLines.push("Nessun estremo assoluto presente nel report validato.");
  }
  section(parts, "Estremi assoluti e limitatezza", absoluteLines);

  section(parts, "Immagine", [intervalUnion(report.range)]);

  section(parts, "Derivata seconda", [blockFormula(second.reported ?? second.latex)]);
  section(parts, "Tabella segni di f''", signTable(secondRows));
  section(parts, "Concavità", trendLines(secondRows, "convessa", "concava"));

  const inflectionLines = inflectionPoints.map((point) => {
    const x = valueLatex(typeof point === "object" ? point.x : point);
    const value = typeof point === "object" ? valueLatex(point.value) : "";
    return "- " + inlineFormula("x=" + x) +
      (value ? ", " + inlineFormula("f(x)=" + value) : "") + ".";
  });
  if (!inflectionLines.length) {
    inflectionLines.push("Nessun flesso presente nel report validato.");
  }
  section(parts, "Flessi", inflectionLines);

  section(parts, "Grafici", artifactLines(options.artifacts));

  section(parts, "Riepilogo", [
    "Componenti del dominio: **" + components.length + "**.",
    "Punti critici classificati: **" + criticalPoints.length + "**.",
    "Flessi nel report validato: **" + inflectionPoints.length + "**."
  ]);

  section(parts, "Nota runtime", [
    "Valori, formule, intervalli e classificazioni provengono dal report validato dal runtime SageMath."
  ]);

  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
