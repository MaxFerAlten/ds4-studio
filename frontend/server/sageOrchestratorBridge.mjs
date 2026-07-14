import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSagePolicy,
  SAGE_POLICY_PATH
} from "./sagePolicyLoader.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export { SAGE_POLICY_PATH };
const ORCHESTRATOR_PATH = path.join(PROJECT_ROOT, "src/agent/tools/sage/orchestrator.py");
const VALIDATOR_PATH = path.join(PROJECT_ROOT, "src/agent/tools/sage/runtime_validator.py");

function pythonCommand() {
  return process.env.DS4_PYTHON || "python3";
}

export function sageV2Enabled({ modulePath = ORCHESTRATOR_PATH } = {}) {
  return process.env.DS4_SAGE_ORCHESTRATION_V2 === "true" && existsSync(modulePath);
}

export function sagePolicyDescriptor({ policyPath = SAGE_POLICY_PATH } = {}) {
  const policy = loadSagePolicy({ policyPath });
  return { ready: policy.ready, path: policy.path, revision: policy.revision };
}

function runProcess(script, input, options = {}) {
  if (typeof options.bridgeRunner === "function") {
    return options.bridgeRunner({ script, input });
  }
  return new Promise((resolve) => {
    const child = spawn(options.pythonCommand || pythonCommand(), ["-c", script], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, HOME: process.env.HOME || "/tmp/ds4-sage-home" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = Math.max(100, Number(options.timeoutMs) || 65_000);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, timedOut: false, spawnError: true });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut: false });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function controlledBridgeFailure(code, debug = {}) {
  return {
    content: "SageMath orchestration did not produce a publishable result.",
    isError: true,
    candidateReport: null,
    execution: { ok: false, exitCode: debug.exitCode ?? null, timedOut: code === "SAGE_TIMEOUT" },
    validationEvidence: null,
    artifacts: [],
    debug: { bridgeError: code }
  };
}

export function normalizeSageOrchestratorPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return controlledBridgeFailure("SAGE_BRIDGE_INVALID_PAYLOAD");
  }
  const execution = value.execution && typeof value.execution === "object"
    ? {
        ok: value.execution.ok === true,
        exitCode: Number.isInteger(value.execution.exitCode) ? value.execution.exitCode : null,
        timedOut: value.execution.timedOut === true
      }
    : { ok: false, exitCode: null, timedOut: false };
  const evidence = value.validationEvidence && typeof value.validationEvidence === "object" &&
      value.validationEvidence.source === "sage_runtime_validator"
    ? {
        source: "sage_runtime_validator",
        authoritative: value.validationEvidence.authoritative === true,
        passed: value.validationEvidence.passed === true,
        checks: Array.isArray(value.validationEvidence.checks)
          ? value.validationEvidence.checks.map((check) => ({ ...check }))
          : [],
        errors: Array.isArray(value.validationEvidence.errors)
          ? [...value.validationEvidence.errors]
          : [],
        normalizedReport: value.validationEvidence.normalizedReport ?? null
      }
    : null;
  return {
    content: String(value.content ?? "SageMath orchestration completed."),
    isError: value.isError === true || !execution.ok,
    candidateReport: value.candidateReport && typeof value.candidateReport === "object"
      ? structuredClone(value.candidateReport)
      : null,
    execution,
    validationEvidence: evidence,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map((artifact) => ({ ...artifact }))
      : [],
    debug: value.debug && typeof value.debug === "object" ? { ...value.debug } : {}
  };
}

export async function sageV2Readiness(options = {}) {
  if (!sageV2Enabled(options)) {
    return { ready: false, code: "SAGE_ORCHESTRATOR_UNAVAILABLE" };
  }
  const policy = sagePolicyDescriptor(options);
  if (!policy.ready) return { ready: false, code: "SAGE_POLICY_UNAVAILABLE" };
  const result = await runProcess(
    "import src.agent.tools.sage.orchestrator; print('ready')",
    {},
    { ...options, timeoutMs: Math.min(Number(options.timeoutMs) || 5_000, 5_000) }
  );
  return result.exitCode === 0 && result.timedOut !== true
    ? { ready: true, code: null, policyPath: policy.path, policyRevision: policy.revision }
    : { ready: false, code: "SAGE_ORCHESTRATOR_UNAVAILABLE" };
}

export async function runSageOrchestrator(args, options = {}) {
  const policy = sagePolicyDescriptor(options);
  if (!policy.ready) return controlledBridgeFailure("SAGE_POLICY_UNAVAILABLE");
  if (options.policyRevision && options.policyRevision !== policy.revision) {
    return controlledBridgeFailure("SAGE_POLICY_REVISION_MISMATCH");
  }
  const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, ".")
from src.agent.tools.sage.orchestrator import SageOrchestrator

request = json.loads(sys.stdin.read())
orchestrator = SageOrchestrator(
    prompt_path=Path(${JSON.stringify(policy.path)}),
    runtime_base=Path(request.get("runtime_base") or "runtime/sage"),
)
response = orchestrator.run(request)
metadata = response.metadata if isinstance(response.metadata, dict) else {}
passed = bool(metadata.get("math_validated") and metadata.get("katex_validated") and metadata.get("plot_ok"))
checks = [
    {"code": "MATHEMATICAL_VALIDATION", "passed": bool(metadata.get("math_validated"))},
    {"code": "KATEX_VALIDATION", "passed": bool(metadata.get("katex_validated"))},
    {"code": "PLOT_VALIDATION", "passed": bool(metadata.get("plot_ok"))},
]
normalized = {
    "authority": "runtime",
    "validationPassed": passed,
    "kind": "math_report",
    "title": "Studio SageMath validato",
    "sections": [{"id": "result", "title": "Risultato", "markdown": response.document, "formulas": []}],
}
artifacts = []
if response.plot_path:
    artifacts.append({"kind": "function_plot", "name": Path(response.plot_path).name,
                      "physicalPath": response.plot_path, "mediaType": "image/png"})
print(json.dumps({
    "content": response.document,
    "isError": False,
    "candidateReport": normalized,
    "execution": {"ok": True, "exitCode": 0, "timedOut": False},
    "validationEvidence": {
        "source": "sage_runtime_validator",
        "authoritative": True,
        "passed": passed,
        "checks": checks,
        "errors": [] if passed else [c["code"] for c in checks if not c["passed"]],
        "normalizedReport": normalized if passed else None,
    },
    "artifacts": artifacts,
}))
`;
  const input = {
    code: String(args?.code ?? ""),
    task_type: String(args?.task_type ?? "auto"),
    phase: String(args?.phase ?? "compute"),
    output_mode: String(args?.output_mode ?? "auto"),
    timeout_sec: Number(args?.timeout_sec) || 60,
    runtime_base: options.sageWorkdir || undefined,
    policy_revision: policy.revision
  };
  const result = await runProcess(script, input, options);
  if (result.timedOut) return controlledBridgeFailure("SAGE_TIMEOUT");
  if (result.exitCode !== 0) {
    return controlledBridgeFailure("SAGE_EXECUTION_FAILED", { exitCode: result.exitCode });
  }
  try {
    return normalizeSageOrchestratorPayload(JSON.parse(String(result.stdout).trim()));
  } catch {
    return controlledBridgeFailure("SAGE_BRIDGE_INVALID_JSON");
  }
}

export async function runSageRuntimeValidator(payload, options = {}) {
  const evidence = payload?.validationEvidence;
  if (evidence?.source === "sage_runtime_validator" && evidence.authoritative === true) {
    return {
      authoritative: true,
      passed: evidence.passed === true,
      checks: Array.isArray(evidence.checks) ? evidence.checks.map((check) => ({ ...check })) : [],
      errors: Array.isArray(evidence.errors) ? [...evidence.errors] : [],
      normalizedReport: evidence.normalizedReport ?? null
    };
  }
  if (!existsSync(VALIDATOR_PATH)) {
    throw new Error("SAGE_VALIDATOR_UNAVAILABLE");
  }
  const script = `
import json, sys
sys.path.insert(0, ".")
from src.agent.tools.sage.runtime_validator import validate_payload
print(json.dumps(validate_payload(json.loads(sys.stdin.read())), allow_nan=False))
`;
  const result = await runProcess(script, payload, options);
  if (result.timedOut || result.exitCode !== 0) throw new Error("SAGE_VALIDATOR_UNAVAILABLE");
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout).trim());
  } catch {
    throw new Error("SAGE_VALIDATOR_INVALID_JSON");
  }
  return {
    authoritative: parsed.authoritative === true,
    passed: parsed.passed === true,
    checks: Array.isArray(parsed.checks) ? parsed.checks.map((check) => ({ ...check })) : [],
    errors: Array.isArray(parsed.errors) ? [...parsed.errors] : [],
    normalizedReport: parsed.normalized_report ?? parsed.normalizedReport ?? null
  };
}
