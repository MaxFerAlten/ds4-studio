/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md section 10.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: EvolutionExecutor and content-addressed execution artifacts.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { hashJson } from "./evolutionIntegrity.mjs";

const RESULT_STATUSES = new Set(["passed", "failed", "error", "partial"]);
const DEFAULT_FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({ code: "APP_LISTEN_FORBIDDEN", pattern: "\\bapp\\.listen\\s*\\(" }),
  Object.freeze({ code: "CREATE_SERVER_FORBIDDEN", pattern: "\\bcreateServer\\s*\\(" })
]);

export class EvolutionEvaluatorError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionEvaluatorError";
    this.code = code;
    this.details = details;
  }
}

function normalizeMetricValue(value, name) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new EvolutionEvaluatorError("INVALID_METRIC_VALUE", name);
  }
  if (!["number", "boolean", "string"].includes(typeof value)) {
    throw new EvolutionEvaluatorError("INVALID_METRIC_VALUE", name);
  }
  return value;
}

function normalizeEvaluatorResult(raw, descriptor) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !RESULT_STATUSES.has(raw.status)) {
    throw new EvolutionEvaluatorError("INVALID_EVALUATOR_RESULT", descriptor.id);
  }
  const metrics = {};
  if (raw.metrics !== undefined && (!raw.metrics || typeof raw.metrics !== "object" || Array.isArray(raw.metrics))) {
    throw new EvolutionEvaluatorError("INVALID_EVALUATOR_RESULT", `${descriptor.id} metrics`);
  }
  for (const [name, value] of Object.entries(raw.metrics ?? {})) metrics[name] = normalizeMetricValue(value, name);
  const reproducibility = raw.reproducibility ?? {};
  return Object.freeze({
    id: descriptor.id,
    status: raw.status,
    required: descriptor.required,
    metrics: Object.freeze(metrics),
    violations: Object.freeze((raw.violations ?? []).map(String)),
    artifacts: Object.freeze([...(raw.artifacts ?? [])]),
    reproducibility: Object.freeze({
      commandHash: typeof reproducibility.commandHash === "string" ? reproducibility.commandHash : null,
      environmentHash: typeof reproducibility.environmentHash === "string" ? reproducibility.environmentHash : null,
      seed: reproducibility.seed ?? null
    })
  });
}

function parseCommandOutput(execution) {
  if (execution.status !== "success") {
    return {
      status: execution.status === "infrastructure_error" ? "error" : "failed",
      metrics: {},
      violations: execution.violations?.length ? execution.violations : ["EVALUATOR_COMMAND_FAILED"],
      artifacts: [execution.stdoutArtifact, execution.stderrArtifact].filter(Boolean),
      reproducibility: execution.reproducibility
    };
  }
  let value;
  try {
    value = JSON.parse(execution.stdoutPreview);
  } catch {
    return {
      status: "error",
      metrics: {},
      violations: ["EVALUATOR_OUTPUT_INVALID_JSON"],
      artifacts: [execution.stdoutArtifact, execution.stderrArtifact].filter(Boolean),
      reproducibility: execution.reproducibility
    };
  }
  return {
    status: value.status,
    metrics: value.metrics ?? {},
    violations: value.violations ?? [],
    artifacts: [execution.stdoutArtifact, execution.stderrArtifact, ...(value.artifacts ?? [])].filter(Boolean),
    reproducibility: { ...execution.reproducibility, seed: value.seed ?? null }
  };
}

export function createCommandEvaluator(executor) {
  if (!executor || typeof executor.execute !== "function") throw new TypeError("executor is required");
  return async function commandEvaluator(context) {
    const configuration = context.descriptor.configuration ?? {};
    if (typeof configuration.executable !== "string" || !Array.isArray(configuration.args)) {
      throw new EvolutionEvaluatorError("INVALID_EVALUATOR_CONFIGURATION", context.descriptor.id);
    }
    const execution = await executor.execute({
      runId: context.runId,
      revision: context.revision,
      workspaceRoot: context.candidateWorkspace,
      writableBindings: [],
      command: configuration.executable,
      args: configuration.args.map(String),
      environment: configuration.environment ?? {},
      limits: {
        ...(context.executionLimits ?? {}),
        timeoutMs: Math.min(
          configuration.timeoutMs ?? context.taskContract.budgets.maxWallTimeMsPerRevision,
          context.executionLimits?.timeoutMs ?? Number.POSITIVE_INFINITY,
          context.taskContract.budgets.maxWallTimeMsPerRevision
        )
      },
      signal: context.signal,
      secretValues: context.secretValues ?? []
    });
    return parseCommandOutput(execution);
  };
}

export async function diffComplexityEvaluator(context) {
  const audit = context.candidate?.audit;
  if (!audit) throw new EvolutionEvaluatorError("DIFF_AUDIT_MISSING", "candidate audit is required");
  const withinBudget = audit.filesChanged <= context.taskContract.budgets.maxFilesChanged &&
    audit.addedLines <= context.taskContract.budgets.maxAddedLines &&
    audit.deletedLines <= context.taskContract.budgets.maxDeletedLines;
  return {
    status: withinBudget ? "passed" : "failed",
    metrics: {
      files_changed: audit.filesChanged,
      added_lines: audit.addedLines,
      deleted_lines: audit.deletedLines
    },
    violations: withinBudget ? [] : ["DIFF_BUDGET_EXCEEDED"],
    artifacts: [],
    reproducibility: {
      commandHash: hashJson({ evaluator: "diff-complexity", version: 1 }),
      environmentHash: hashJson({}),
      seed: null
    }
  };
}

function policyPatterns(configuration) {
  const entries = configuration.forbiddenPatterns?.length ? configuration.forbiddenPatterns : DEFAULT_FORBIDDEN_PATTERNS;
  return entries.map((entry, index) => {
    const pattern = typeof entry === "string" ? entry : entry?.pattern;
    const code = typeof entry === "string" ? `SECURITY_POLICY_PATTERN_${index + 1}` : entry?.code;
    const flags = typeof entry === "string" ? "m" : (entry?.flags ?? "m");
    if (typeof pattern !== "string" || !pattern || typeof code !== "string" || !code) {
      throw new EvolutionEvaluatorError("INVALID_SECURITY_POLICY", `forbiddenPatterns[${index}]`);
    }
    try {
      return Object.freeze({ code, regex: new RegExp(pattern, flags) });
    } catch (error) {
      throw new EvolutionEvaluatorError("INVALID_SECURITY_POLICY", `${code}: ${error.message}`);
    }
  });
}

async function readPolicyFiles(context, configuration) {
  const changedFiles = context.candidate?.audit?.changes?.map((entry) => entry.path) ?? [];
  const files = [...new Set((configuration.files?.length ? configuration.files : changedFiles).map(String))].sort();
  const root = path.resolve(context.candidateWorkspace);
  const contents = [];
  for (const relative of files) {
    const absolute = path.resolve(root, relative);
    const fromRoot = path.relative(root, absolute);
    if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      throw new EvolutionEvaluatorError("INVALID_SECURITY_POLICY", `file escapes workspace: ${relative}`);
    }
    try {
      contents.push({ relative, text: await fs.readFile(absolute, "utf8") });
    } catch (error) {
      if (error.code === "ENOENT") throw new EvolutionEvaluatorError("SECURITY_POLICY_FILE_MISSING", relative);
      throw error;
    }
  }
  return contents;
}

export async function securityPolicyEvaluator(context) {
  const configuration = context.descriptor?.configuration ?? {};
  const patterns = policyPatterns(configuration);
  const files = await readPolicyFiles(context, configuration);
  const violations = [];
  for (const { relative, text } of files) {
    for (const { code, regex } of patterns) {
      regex.lastIndex = 0;
      if (regex.test(text)) violations.push(`${code}:${relative}`);
    }
  }
  const passed = violations.length === 0;
  return {
    status: passed ? "passed" : "failed",
    metrics: { security_passed: passed },
    violations,
    artifacts: [],
    reproducibility: {
      commandHash: hashJson({ evaluator: "security-policy", version: 2, configuration }),
      environmentHash: hashJson({ evaluator: "security-policy", version: 2, configuration }),
      seed: null
    }
  };
}

export class EvolutionEvaluatorRegistry {
  constructor({ executor = null, adapters = {} } = {}) {
    this.adapters = new Map();
    if (executor) {
      const command = createCommandEvaluator(executor);
      for (const type of ["node-test", "shell-command", "static-analysis", "benchmark", "json-scorer"]) {
        this.adapters.set(type, command);
      }
    }
    this.adapters.set("diff-complexity", diffComplexityEvaluator);
    this.adapters.set("security-policy", securityPolicyEvaluator);
    for (const [type, adapter] of Object.entries(adapters)) this.register(type, adapter);
  }

  register(type, adapter) {
    if (typeof type !== "string" || !type || typeof adapter !== "function") {
      throw new TypeError("evaluator type and adapter function are required");
    }
    this.adapters.set(type, adapter);
    return this;
  }

  async evaluateAll(context) {
    const results = [];
    const hardFailures = [];
    const aggregateMetrics = {};
    for (const descriptor of context.taskContract.evaluators) {
      const type = descriptor.configuration?.type ?? descriptor.id;
      const adapter = this.adapters.get(type);
      let result;
      if (!adapter) {
        result = normalizeEvaluatorResult({
          status: "error",
          metrics: {},
          violations: ["EVALUATOR_ADAPTER_UNAVAILABLE"],
          artifacts: [],
          reproducibility: {}
        }, descriptor);
      } else {
        try {
          result = normalizeEvaluatorResult(await adapter({ ...context, descriptor }), descriptor);
        } catch (error) {
          result = normalizeEvaluatorResult({
            status: "error",
            metrics: {},
            violations: [error.code ?? "EVALUATOR_INFRASTRUCTURE_ERROR"],
            artifacts: [],
            reproducibility: {}
          }, descriptor);
        }
      }
      results.push(result);
      if (descriptor.required && result.status !== "passed") {
        hardFailures.push(`REQUIRED_EVALUATOR_${result.status.toUpperCase()}:${descriptor.id}`);
      }
      if (descriptor.required && (!result.reproducibility.commandHash || !result.reproducibility.environmentHash)) {
        hardFailures.push(`REPRODUCIBILITY_METADATA_MISSING:${descriptor.id}`);
      }
      for (const [name, value] of Object.entries(result.metrics)) {
        if (Object.hasOwn(aggregateMetrics, name) && aggregateMetrics[name] !== value) {
          hardFailures.push(`METRIC_CONFLICT:${name}`);
        } else {
          aggregateMetrics[name] = value;
        }
      }
    }
    const required = results.filter((result) => result.required);
    const optionalFailed = results.some((result) => !result.required && result.status !== "passed");
    let status = "passed";
    if (required.some((result) => result.status === "error")) status = "error";
    else if (required.some((result) => result.status !== "passed")) status = "failed";
    else if (optionalFailed) status = "partial";
    return Object.freeze({
      evaluationVersion: "ds4_evolution_evaluation_v1",
      revision: context.revision,
      status,
      evaluators: Object.freeze(results),
      aggregateMetrics: Object.freeze(aggregateMetrics),
      hardFailures: Object.freeze([...new Set(hardFailures)])
    });
  }
}
