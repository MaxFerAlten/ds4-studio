export function registerOpenWikiControlRoutes(app, {
  asyncHandler,
  sessionKeyForRequest,
  getGenerationService,
  getAgentSession,
  openWikiCommand,
  getConfig,
  loadGatewayConfig,
  getSetupConfig,
  provisionRelease,
  validateWorkspacePath,
  configureRuntime,
  resetRuntimeConfig,
  getDefaultRequest,
  getEngine,
  timeoutSignal = (milliseconds) => AbortSignal.timeout(milliseconds),
}) {
  let setupInFlight = false;
  app.get("/api/openwiki/status", asyncHandler(async (req, res) => {
    const sessionKey = sessionKeyForRequest(req);
    return res.json({ status: getGenerationService()?.status(sessionKey) ?? {
      state: "stopped", enabled: false, workspaceId: null, root: null, admin: "stopped", activeRun: null, generation: null, lastError: null,
    } });
  }));

  app.get("/api/openwiki/config", asyncHandler(async (_req, res) => {
    return res.json(await getSetupConfig());
  }));

  app.put("/api/openwiki/config", asyncHandler(async (req, res) => {
    const sourcePath = req.body?.sourcePath;
    const workspacePath = req.body?.workspacePath;
    if (typeof sourcePath !== "string" || !sourcePath.startsWith("/") || sourcePath.includes("\0") ||
        typeof workspacePath !== "string" || !workspacePath.startsWith("/") || workspacePath.includes("\0")) {
      return res.status(400).json({ code: "OPENWIKI_PATH_INVALID", message: "Inserisci i path assoluti della sorgente OpenWiki e del repository workspace." });
    }
    const service = getGenerationService();
    if (service?.hasActiveSessions()) {
      return res.status(409).json({ code: "OPENWIKI_SESSION_ACTIVE", message: "Ferma OpenWiki nelle sessioni attive prima di riconfigurarlo." });
    }
    if (setupInFlight) {
      return res.status(409).json({ code: "OPENWIKI_SETUP_IN_PROGRESS", message: "La preparazione della release OpenWiki è già in corso." });
    }
    setupInFlight = true;
    try {
      await validateWorkspacePath?.(workspacePath);
      const release = await provisionRelease({ sourcePath });
      const configured = await configureRuntime({ sourcePath, workspacePath, releaseDir: release.releaseDir });
      await resetRuntimeConfig?.();
      return res.json({ ...configured, commit: release.commit });
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "OPENWIKI_SETUP_FAILED";
      const message = code === "OPENWIKI_SOURCE_PIN_MISMATCH"
        ? "La sorgente OpenWiki non è al commit selezionato nel piano."
        : code === "OPENWIKI_PATH_INVALID"
          ? "Inserisci path assoluti validi per sorgente e workspace."
          : code === "OPENWIKI_WORKSPACE_INVALID"
            ? "Il workspace deve essere una directory esistente e accessibile al servizio DS4."
          : code === "OPENWIKI_PROVISION_TIMEOUT"
            ? "La preparazione della release OpenWiki ha superato il limite di 20 minuti."
            : "Impossibile preparare una release OpenWiki compatibile. Verifica il commit, le dipendenze e i log DS4.";
      return res.status(code === "OPENWIKI_SOURCE_PIN_MISMATCH" || code === "OPENWIKI_PATH_INVALID" || code === "OPENWIKI_WORKSPACE_INVALID" ? 400 : 503).json({ code, message });
    } finally {
      setupInFlight = false;
    }
  }));

  app.post("/api/openwiki/control", asyncHandler(async (req, res) => {
    const action = req.body?.action;
    if (!new Set(["start", "init", "update", "stop"]).has(action)) {
      return res.status(400).json({ code: "OPENWIKI_USAGE_INVALID", message: "Azione OpenWiki non valida." });
    }
    let message = `/openwiki ${action}`;
    if (action === "init" || action === "update") {
      const { configPath, workspaceId } = getConfig();
      try {
        if (!configPath || !workspaceId) throw new Error("missing config");
        const gatewayConfig = loadGatewayConfig(configPath);
        const workspace = gatewayConfig.workspaces[workspaceId];
        if (!workspace || Object.keys(gatewayConfig.workspaces).length !== 1) throw new Error("invalid workspace");
        message = `/openwiki ${workspace.root} ${action}`;
      } catch {
        return res.status(503).json({ code: "OPENWIKI_NOT_CONFIGURED", message: "Configura un solo workspace valido nella pagina OpenWiki." });
      }
    }
    const sessionKey = sessionKeyForRequest(req);
    const result = await openWikiCommand({
      message,
      session: getAgentSession(sessionKey),
      sessionKey,
      request: req.body?.request && typeof req.body.request === "object" ? req.body.request : getDefaultRequest(),
      engine: getEngine(),
      signal: timeoutSignal(30 * 60 * 1000),
    });
    return res.status(result.status).json(result.payload);
  }));
}

export function openWikiEnabledForAgentRequest(requested, sessionKey, generationService) {
  return requested === true && generationService?.status(sessionKey).enabled === true;
}
