import { randomUUID } from "node:crypto";

import { formatSageReport } from "./sageReportFormatter.mjs";
import { runSageRuntimeValidator } from "./sageOrchestratorBridge.mjs";
import {
  SAGE_RESULT_CONTRACT_VERSION,
  normalizeSagePhase,
  normalizeSageTaskType,
  validateSageResult
} from "./sageResultContract.mjs";

const FUNCTION_STUDY_ARTIFACT_KINDS = new Set([
  "function_plot",
  "first_derivative_plot",
  "second_derivative_plot"
]);

function executionFromRaw(raw) {
  const source = raw?.sageResult?.execution;
  if (source && typeof source === "object") {
    return {
      ok: source.ok === true,
      exitCode: Number.isInteger(source.exitCode) ? source.exitCode : null,
      timedOut: source.timedOut === true
    };
  }
  return {
    ok: raw?.isError !== true && raw?.raw?.exit_code === 0,
    exitCode: Number.isInteger(raw?.raw?.exit_code) ? raw.raw.exit_code : null,
    timedOut: raw?.raw?.killed === true
  };
}

function defaultArtifactValidator({ taskType, artifacts, runId }) {
  if (taskType !== "function_study") return { passed: true, reasonCodes: [] };
  const normalized = (Array.isArray(artifacts) ? artifacts : []).map((artifact) => {
    let kind = "";
    if (artifact?.kind) kind = String(artifact.kind);
    const name = String(artifact?.name ?? "").toLowerCase();
    if (!kind && name.includes("first") && name.includes("derivative")) kind = "first_derivative_plot";
    if (!kind && name.includes("second") && name.includes("derivative")) kind = "second_derivative_plot";
    if (!kind && (name.includes("function") || name === "plot.png")) kind = "function_plot";
    return { artifact, kind };
  });
  const kinds = new Set(normalized.map(({ kind }) => kind).filter(Boolean));
  const missing = [...FUNCTION_STUDY_ARTIFACT_KINDS].filter((kind) => !kinds.has(kind));
  const reasonCodes = missing.map((kind) => `SAGE_ARTIFACT_MISSING:${kind}`);
  const expectedRunId = String(runId || "");
  for (const { artifact, kind } of normalized) {
    if (!FUNCTION_STUDY_ARTIFACT_KINDS.has(kind)) continue;
    if (!expectedRunId || artifact?.runId !== expectedRunId) {
      reasonCodes.push("SAGE_ARTIFACT_RUN_MISMATCH");
    }
    const sha256 = String(artifact?.sha256 || "");
    const artifactId = String(artifact?.artifactId || "");
    const expectedId = `sha256:${sha256}`;
    const expectedUrl = `/api/sage/artifacts/${encodeURIComponent(expectedRunId)}/${encodeURIComponent(expectedId)}`;
    if (!/^[a-f0-9]{64}$/.test(sha256) || artifactId !== expectedId ||
        Number(artifact?.sizeBytes) <= 0 || artifact?.url !== expectedUrl) {
      reasonCodes.push("SAGE_ARTIFACT_HASH_MISMATCH");
    }
  }
  return {
    passed: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)]
  };
}

function topLevelResult(sageResult, raw, { forceError = false } = {}) {
  const publication = sageResult.publication ?? {};
  const validation = sageResult.validation ?? {};
  const markdown = publication.publishable === true ? String(publication.markdown ?? "") : "";
  return {
    content: markdown || String(raw?.content ?? ""),
    isError: forceError || raw?.isError === true,
    displayContent: String(sageResult.display?.summary ?? "SageMath result not publishable."),
    contractVersion: sageResult.contractVersion,
    publishable: publication.publishable === true,
    authoritative: validation.authoritative === true,
    validationPassed: validation.passed === true,
    reportReady: Boolean(sageResult.normalizedReport),
    runId: sageResult.runId ?? null,
    state: sageResult.state ?? "failed",
    sageResult,
    artifacts: Array.isArray(sageResult.artifacts) ? sageResult.artifacts : [],
    finalMarkdown: markdown
  };
}

export function canPublishSageResult(result) {
  const checks = result?.validation?.checks;
  return result?.contractVersion === SAGE_RESULT_CONTRACT_VERSION &&
    result?.execution?.ok === true &&
    result?.validation?.authoritative === true &&
    result?.validation?.passed === true &&
    Array.isArray(checks) &&
    checks.length > 0 &&
    checks.every((check) => check?.passed === true) &&
    result?.publication?.publishable === true &&
    typeof result?.publication?.markdown === "string" &&
    result.publication.markdown.trim().length > 0 &&
    result.publication.artifactGatePassed !== false;
}

export function publicationFailureResult(input = {}, reasonCodes = []) {
  const raw = input.raw ?? {};
  const prior = raw.sageResult ?? {};
  const execution = executionFromRaw(raw);
  const taskType = normalizeSageTaskType(input.args?.task_type ?? prior.taskType);
  const phase = normalizeSagePhase(input.args?.phase ?? prior.phase);
  const codes = [...new Set(reasonCodes.map((code) => String(code)).filter(Boolean))];
  const sageResult = {
    contractVersion: SAGE_RESULT_CONTRACT_VERSION,
    tool: "sage",
    runId: String(input.runId ?? prior.runId ?? randomUUID()),
    taskType,
    phase,
    state: execution.ok ? "computed" : "failed",
    status: execution.timedOut ? "timeout" : execution.ok ? "ok" : "error",
    attempt: Math.max(1, Number(input.attempt ?? prior.attempt) || 1),
    display: {
      title: "SageMath",
      stage: String(prior.display?.stage ?? phase),
      summary: "Il risultato SageMath non è pubblicabile.",
      detailsAvailable: true
    },
    model: { content: String(raw.content ?? ""), latex: [], facts: [] },
    report: null,
    normalizedReport: null,
    artifacts: Array.isArray(raw.artifacts)
      ? raw.artifacts.map((artifact) => ({ ...artifact }))
      : Array.isArray(prior.artifacts)
        ? prior.artifacts.map((artifact) => ({ ...artifact }))
        : [],
    execution,
    validation: {
      authoritative: false,
      passed: false,
      checks: [],
      errors: codes.length ? codes : ["SAGE_RESULT_NOT_PUBLISHABLE"],
      warnings: []
    },
    publication: {
      publishable: false,
      markdown: "",
      reasonCodes: codes.length ? codes : ["SAGE_RESULT_NOT_PUBLISHABLE"],
      artifactGatePassed: false
    }
  };
  return topLevelResult(sageResult, raw, { forceError: input.forceError === true });
}

export async function authorizeSageCandidate(input = {}) {
  const raw = input.raw ?? {};
  const validator = input.validator === null
    ? null
    : typeof input.validator === "function"
      ? input.validator
      : runSageRuntimeValidator;
  if (typeof validator !== "function") {
    return publicationFailureResult(
      { ...input, forceError: true },
      ["VALIDATOR_UNAVAILABLE"]
    );
  }

  let runtimeValidation;
  try {
    runtimeValidation = await validator({
      taskType: normalizeSageTaskType(input.args?.task_type ?? raw.sageResult?.taskType),
      execution: executionFromRaw(raw),
      candidateReport: raw.sageResult?.candidateReport ?? raw.candidateReport ?? null,
      artifacts: raw.artifacts ?? raw.sageResult?.artifacts ?? [],
      code: String(input.args?.code ?? ""),
      validationEvidence: raw.validationEvidence ?? null
    });
  } catch {
    return publicationFailureResult(
      { ...input, forceError: true },
      ["VALIDATOR_UNAVAILABLE"]
    );
  }

  const checks = Array.isArray(runtimeValidation?.checks)
    ? runtimeValidation.checks.map((check) => ({ ...check, passed: check?.passed === true }))
    : [];
  const authoritative = runtimeValidation?.authoritative === true;
  const validationPassed = runtimeValidation?.passed === true &&
    checks.length > 0 && checks.every((check) => check.passed === true);
  const reasonCodes = [];
  if (!authoritative) reasonCodes.push("SAGE_VALIDATION_NOT_AUTHORITATIVE");
  if (!checks.length) reasonCodes.push("SAGE_VALIDATION_CHECKS_EMPTY");
  if (checks.some((check) => !check.passed)) reasonCodes.push("SAGE_VALIDATION_CHECK_FAILED");
  for (const error of Array.isArray(runtimeValidation?.errors) ? runtimeValidation.errors : []) {
    reasonCodes.push(String(error));
  }

  const phase = normalizeSagePhase(input.args?.phase ?? raw.sageResult?.phase);
  if (phase !== "validate") reasonCodes.push("SAGE_PUBLICATION_PHASE_INVALID");

  const taskType = normalizeSageTaskType(input.args?.task_type ?? raw.sageResult?.taskType);
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map((artifact) => ({ ...artifact }))
    : Array.isArray(raw.sageResult?.artifacts)
      ? raw.sageResult.artifacts.map((artifact) => ({ ...artifact }))
      : [];
  const artifactValidator = typeof input.artifactValidator === "function"
    ? input.artifactValidator
    : defaultArtifactValidator;
  const artifactGate = artifactValidator({ taskType, artifacts, runId: input.runId });
  if (artifactGate?.passed !== true) {
    reasonCodes.push(...(artifactGate?.reasonCodes ?? ["SAGE_ARTIFACT_MISSING"]));
  }

  const normalizedReport = runtimeValidation?.normalizedReport ?? null;
  const formatter = typeof input.formatter === "function" ? input.formatter : formatSageReport;
  let markdown = "";
  if (phase === "validate" && authoritative && validationPassed &&
      artifactGate?.passed === true && normalizedReport) {
    try {
      markdown = String(formatter(normalizedReport, { artifacts }) ?? "").trim();
    } catch {
      reasonCodes.push("SAGE_FORMATTER_FAILED");
    }
  }
  if (!markdown) reasonCodes.push("SAGE_FINAL_MARKDOWN_MISSING");

  const execution = executionFromRaw(raw);
  if (!execution.ok) reasonCodes.push("SAGE_EXECUTION_FAILED");
  const publishable = phase === "validate" && execution.ok && authoritative && validationPassed &&
    artifactGate?.passed === true && markdown.length > 0;
  const sageResult = {
    contractVersion: SAGE_RESULT_CONTRACT_VERSION,
    tool: "sage",
    runId: String(input.runId ?? raw.sageResult?.runId ?? randomUUID()),
    taskType,
    phase,
    state: publishable ? "ready" : execution.ok ? "validated" : "failed",
    status: execution.timedOut ? "timeout" : execution.ok ? "ok" : "error",
    attempt: Math.max(1, Number(input.attempt ?? raw.sageResult?.attempt) || 1),
    display: {
      title: "SageMath",
      stage: String(raw.sageResult?.display?.stage ?? phase),
      summary: publishable ? "Report SageMath validato." : "Validazione SageMath non superata.",
      detailsAvailable: true
    },
    model: { content: String(raw.content ?? ""), latex: [], facts: [] },
    report: null,
    normalizedReport,
    artifacts,
    execution,
    validation: {
      authoritative,
      passed: validationPassed,
      checks,
      errors: [...new Set(reasonCodes)],
      warnings: []
    },
    publication: {
      publishable,
      markdown: publishable ? markdown : "",
      reasonCodes: publishable ? [] : [...new Set(reasonCodes)],
      artifactGatePassed: artifactGate?.passed === true
    }
  };

  const contract = validateSageResult(sageResult);
  if (!contract.ok || !canPublishSageResult(sageResult)) {
    if (publishable) {
      return publicationFailureResult(
        { ...input, raw, runId: sageResult.runId, forceError: true },
        contract.errors.map((error) => error.code)
      );
    }
  }
  return topLevelResult(sageResult, raw);
}
