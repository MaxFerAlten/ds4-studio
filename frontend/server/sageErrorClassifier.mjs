const CLASSIFICATIONS = Object.freeze({
  SAGE_BRIDGE_SPAWN_FAILED: ["transport", true, false],
  SAGE_BRIDGE_TIMEOUT: ["transport", true, false],
  SAGE_BRIDGE_INVALID_JSON: ["contract", false, true],
  SAGE_BRIDGE_CONTRACT_INVALID: ["contract", false, true],
  SAGE_VALIDATOR_UNAVAILABLE: ["infrastructure", false, true],
  SAGE_RUNTIME_UNAVAILABLE: ["infrastructure", false, true],
  SAGE_EXECUTION_FAILED: ["execution", false, true],
});

function errorCode(error) {
  const explicit = String(error?.sageCode ?? error?.code ?? "").toUpperCase();
  if (CLASSIFICATIONS[explicit]) return explicit;
  if (["ENOENT", "EACCES", "EPERM", "SPAWN_FAILED"].includes(explicit)) {
    return "SAGE_BRIDGE_SPAWN_FAILED";
  }
  if (["ETIMEDOUT", "ABORT_ERR", "TIMEOUT"].includes(explicit) || error?.name === "AbortError") {
    return "SAGE_BRIDGE_TIMEOUT";
  }
  if (error instanceof SyntaxError) return "SAGE_BRIDGE_INVALID_JSON";
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("invalid json") || message.includes("json parse")) {
    return "SAGE_BRIDGE_INVALID_JSON";
  }
  if (message.includes("contract")) return "SAGE_BRIDGE_CONTRACT_INVALID";
  if (message.includes("validator") && message.includes("unavailable")) {
    return "SAGE_VALIDATOR_UNAVAILABLE";
  }
  if (message.includes("runtime") && message.includes("unavailable")) {
    return "SAGE_RUNTIME_UNAVAILABLE";
  }
  return "SAGE_EXECUTION_FAILED";
}

export function classifySageBridgeException(error) {
  const code = errorCode(error);
  const [category, retryable, terminal] = CLASSIFICATIONS[code];
  return {
    code,
    category,
    retryable,
    terminal,
    safeMessage: `Sage authoritative execution failed (${code}).`,
  };
}
