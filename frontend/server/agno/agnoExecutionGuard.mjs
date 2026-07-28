/**
 * Shared guard ensuring Agno model inference never runs while the native
 * DS4 agent is active, and that the wrapper is confirmed in server mode
 * before any call is forwarded to the backend.
 */

export class AgnoExecutionGuardError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "AgnoExecutionGuardError";
    this.code = code;
    this.status = status;
  }
}

export class AgnoExecutionGuard {
  constructor({
    controlBaseUrl,
    wrapperEnabled,
    modeSwitchTimeoutMs = 120_000,
    fetchImpl = fetch,
  }) {
    this.controlBaseUrl = String(controlBaseUrl).replace(/\/$/, "");
    this.wrapperEnabled = wrapperEnabled;
    this.modeSwitchTimeoutMs = modeSwitchTimeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async readWrapperStatus() {
    if (!this.wrapperEnabled()) {
      return {
        wrapperEnabled: false,
        state: "server",
        mode: "server",
        nativeAgentActive: false,
      };
    }

    let response;
    try {
      response = await this.fetchImpl(
        `${this.controlBaseUrl}/api/wrapper/status`,
        { signal: AbortSignal.timeout(2_000) }
      );
    } catch (error) {
      throw new AgnoExecutionGuardError(
        "WRAPPER_STATUS_UNAVAILABLE",
        `Unable to read wrapper status: ${error.message}`,
        503
      );
    }

    if (!response.ok) {
      throw new AgnoExecutionGuardError(
        "WRAPPER_STATUS_UNAVAILABLE",
        `Wrapper status returned HTTP ${response.status}`,
        503
      );
    }

    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AgnoExecutionGuardError(
        "WRAPPER_STATUS_INVALID",
        "Wrapper status payload is invalid",
        503
      );
    }

    const state = body.state || null;
    const activeMode = body.active_mode || body.mode || state || null;

    if (!state && !activeMode) {
      throw new AgnoExecutionGuardError(
        "WRAPPER_STATUS_INVALID",
        "Wrapper status does not expose state or mode",
        503
      );
    }

    return {
      wrapperEnabled: true,
      state,
      mode: activeMode,
      nativeAgentActive: activeMode === "agent",
    };
  }

  async ensureModelCallAllowed() {
    const before = await this.readWrapperStatus();

    if (before.nativeAgentActive) {
      throw new AgnoExecutionGuardError(
        "NATIVE_AGENT_ACTIVE",
        "The native DS4 agent is active",
        409
      );
    }

    if (!before.wrapperEnabled || before.mode === "server") {
      return before;
    }

    let response;
    try {
      response = await this.fetchImpl(
        `${this.controlBaseUrl}/api/wrapper/switch-mode`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "server" }),
          signal: AbortSignal.timeout(this.modeSwitchTimeoutMs),
        }
      );
    } catch (error) {
      throw new AgnoExecutionGuardError(
        "SERVER_MODE_SWITCH_FAILED",
        `Unable to switch wrapper to server mode: ${error.message}`,
        503
      );
    }

    if (!response.ok) {
      throw new AgnoExecutionGuardError(
        "SERVER_MODE_SWITCH_FAILED",
        `Mode switch returned HTTP ${response.status}`,
        503
      );
    }

    const after = await this.readWrapperStatus();

    if (after.nativeAgentActive || after.mode !== "server") {
      throw new AgnoExecutionGuardError(
        "SERVER_MODE_NOT_CONFIRMED",
        "Wrapper did not confirm server mode",
        503
      );
    }

    return after;
  }
}

export function sendAgnoGuardError(res, error) {
  if (!(error instanceof AgnoExecutionGuardError)) return false;
  res.status(error.status).json({
    error: error.code,
    message: error.message,
  });
  return true;
}
