import {
  runSageOrchestrator,
  sageV2Enabled
} from "./sageOrchestratorBridge.mjs";
import {
  authorizeSageCandidate,
  publicationFailureResult
} from "./sagePublicationGate.mjs";
import { envBooleanWithAliases } from "./envBoolean.mjs";
import { classifySageBridgeException } from "./sageErrorClassifier.mjs";

export function normalizeAuthoritativeSageResponse(value = {}) {
  const sageResult = value?.sageResult && typeof value.sageResult === "object"
    ? value.sageResult
    : null;
  const publication = sageResult?.publication ?? {};
  const validation = sageResult?.validation ?? {};
  const publishable = value?.publishable === true || publication.publishable === true;
  const finalMarkdown = publishable
    ? String(value?.finalMarkdown ?? publication.markdown ?? "")
    : "";
  return {
    ...value,
    content: String(value?.content ?? finalMarkdown ?? ""),
    isError: Boolean(value?.isError),
    displayContent: String(value?.displayContent ?? sageResult?.display?.summary ?? ""),
    contractVersion: String(value?.contractVersion ?? sageResult?.contractVersion ?? ""),
    publishable,
    authoritative: value?.authoritative === true || validation.authoritative === true,
    validationPassed: value?.validationPassed === true || validation.passed === true,
    reportReady: value?.reportReady === true || Boolean(sageResult?.normalizedReport),
    runId: value?.runId ?? sageResult?.runId ?? null,
    state: String(value?.state ?? sageResult?.state ?? "failed"),
    sageResult,
    artifacts: Array.isArray(value?.artifacts)
      ? value.artifacts
      : Array.isArray(sageResult?.artifacts)
        ? sageResult.artifacts
        : [],
    finalMarkdown
  };
}

export function sageAuthoritativeLoopEnabled(env = process.env) {
  return envBooleanWithAliases({
    env,
    key: "DS4_SAGE_AUTONOMOUS_ORCHESTRATION",
    defaultValue: true,
  });
}

export async function executeAuthoritativeSage(args, options = {}) {
  if (typeof options.rawExecutor !== "function") {
    throw new TypeError("rawExecutor is required");
  }

  const enabled = options.sageV2EnabledFn ?? sageV2Enabled;
  const authoritativeEnabled = options.authoritativeLoopEnabledFn ?? sageAuthoritativeLoopEnabled;
  const bridgeExecutor = options.bridgeExecutor ?? runSageOrchestrator;
  const authorizer = options.authorizer ?? authorizeSageCandidate;
  try {
    if (!authoritativeEnabled()) {
      const legacy = await options.rawExecutor(args, options);
      return legacy?.sageResult ? normalizeAuthoritativeSageResponse(legacy) : legacy;
    }
    const raw = enabled()
      ? await bridgeExecutor(args, options)
      : await options.rawExecutor(args, options);
    const authorized = await authorizer({
      args: structuredClone(args ?? {}),
      raw,
      sessionKey: options.sessionKey,
      runId: options.runId,
      phase: options.phase,
      attempt: options.sageAttempt,
      validator: options.validator,
      formatter: options.formatter,
      artifactValidator: options.artifactValidator
    });
    return normalizeAuthoritativeSageResponse(authorized);
  } catch (error) {
    const classified = classifySageBridgeException(error);
    const logger = options.logger ?? console;
    logger.error?.({
      event: "sage_authoritative_executor_error",
      code: classified.code,
      category: classified.category,
      message: classified.safeMessage,
    });
    const response = normalizeAuthoritativeSageResponse(publicationFailureResult({
      args,
      raw: { content: classified.safeMessage, isError: true },
      runId: options.runId,
      forceError: true
    }, [classified.code]));
    response.orchestration = classified;
    return response;
  }
}
