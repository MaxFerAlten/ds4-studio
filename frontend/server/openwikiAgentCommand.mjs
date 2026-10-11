import { parseOpenWikiCommandArg } from './agentSlashCommands.mjs';
import { validateWorkspaceRoot } from '../../integrations/openwiki-gateway/src/config.mjs';

const ERROR_STATUS = Object.freeze({
  AGENT_MODE_REQUIRED: 409,
  OPENWIKI_NOT_CONFIGURED: 503,
  OPENWIKI_NOT_STARTED: 409,
  WORKSPACE_ROOT_MISMATCH: 409,
  WORKSPACE_SELECTION_INVALID: 409,
  WORKSPACE_BOUND: 409,
  RUNTIME_BUSY: 409,
  RUNTIME_NOT_STARTED: 409,
  SANDBOX_UNUSABLE: 503,
  ADMIN_STARTUP_TIMEOUT: 503,
  MODEL_TOOL_CALL_UNSUPPORTED: 409,
  MODEL_OUTPUT_TRUNCATED: 409,
  MODEL_REQUEST_FAILED: 502,
  OPENWIKI_DIR_EXISTS: 409,
  OPENWIKI_DIR_MISSING: 409,
  INVALID_PLAN: 409,
});

function outcome(ok, status, code, message, active = true, detail = null) {
  return Object.freeze({
    ok,
    status,
    payload: Object.freeze({ ok, command: 'openwiki', ...(code ? { code } : {}), message, active,
      ...(detail ? { openwiki: detail } : {}) }),
  });
}

function safeFailure(error, root = '<path_assoluto>') {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'OPENWIKI_FAILED';
  const status = ERROR_STATUS[code] ?? (code.endsWith('_INVALID') ? 400 : 500);
  const messages = {
    OPENWIKI_NOT_CONFIGURED: 'OpenWiki non è configurato nel servizio DS4 Studio.',
    OPENWIKI_NOT_STARTED: 'Usa prima /openwiki start.',
    WORKSPACE_ROOT_MISMATCH: 'Il path non coincide con il workspace configurato nella pagina OpenWiki.',
    WORKSPACE_SELECTION_INVALID: 'La configurazione OpenWiki deve indicare un solo workspace valido.',
    MODEL_TOOL_CALL_UNSUPPORTED: 'Il modello DS4 selezionato non ha restituito una function call o un oggetto JSON valido per OpenWiki.',
    MODEL_OUTPUT_TRUNCATED: 'Il modello DS4 ha esaurito il limite di token prima di completare la risposta strutturata OpenWiki.',
    RUNTIME_BUSY: 'È già attiva una generazione OpenWiki per questo servizio.',
    SANDBOX_UNUSABLE: 'La sandbox OpenWiki non è disponibile; non è stata avviata alcuna generazione.',
    OPENWIKI_DIR_EXISTS: `La directory openwiki esiste già. Usa /openwiki ${root} update per aggiornare la wiki.`,
    OPENWIKI_DIR_MISSING: `La directory openwiki non esiste. Usa /openwiki ${root} init per creare la wiki.`,
    INVALID_PLAN: 'Il modello ha proposto un piano wiki non valido. Nessuna pagina è stata scritta; riprova il comando.',
  };
  const tool = typeof error?.openwikiTool === 'string' &&
    /^openwiki_(?:begin|submit_plan|next_page|submit_page|finish)$/u.test(error.openwikiTool)
    ? error.openwikiTool : null;
  const upstreamCode = typeof error?.cause?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.cause.code)
    ? error.cause.code : null;
  const detail = upstreamCode === 'OPENWIKI_INVALID_INPUT' && typeof error?.cause?.message === 'string'
    ? error.cause.message.replace(/[^A-Za-z0-9 _.,:;()\[\]-]/gu, '').trim().slice(0, 140) : '';
  const diagnostic = tool ? ` [${tool}${upstreamCode ? `: ${upstreamCode}` : ''}${detail ? ` — ${detail}` : ''}]` : '';
  return outcome(false, status, code, `${messages[code] ?? `Comando OpenWiki non riuscito (${code}).`}${diagnostic}`);
}

/** Run /openwiki commands outside the model's ordinary tool loop. */
export function createOpenWikiAgentCommandHandler({ service, validateRoot = validateWorkspaceRoot, getDefaultRequest = () => ({}) } = {}) {
  if (!service || typeof service.start !== 'function' || typeof service.run !== 'function' ||
      typeof service.stop !== 'function' || typeof service.status !== 'function') {
    throw new TypeError('OpenWiki generation service is required');
  }
  if (typeof validateRoot !== 'function') throw new TypeError('validateRoot must be a function');
  if (typeof getDefaultRequest !== 'function') throw new TypeError('getDefaultRequest must be a function');

  return async function handleOpenWikiCommand({
    message,
    session,
    sessionKey,
    request = {},
    engine = 'js',
    signal,
  } = {}) {
    if (!session?.active) return outcome(false, 409, 'AGENT_MODE_REQUIRED', 'Il comando /openwiki richiede Agent Mode.', false);
    let command;
    let workspaceRoot;
    try {
      const parsed = typeof message === 'string' ? message.trim().replace(/^\/openwiki\s*/u, '') : '';
      command = parseOpenWikiCommandArg(parsed);
    } catch {
      return outcome(false, 400, 'OPENWIKI_USAGE_INVALID', 'Uso: /openwiki start|stop|status oppure /openwiki <path_assoluto> init|update.');
    }

    try {
      if (command.action === 'start') {
        const status = await service.start(sessionKey);
        const workspace = validateRoot(status.root);
        session.setOpenWikiWorkspace(workspace);
        return outcome(true, 200, null, `OpenWiki avviato per ${workspace.root}. Per creare la wiki usa /openwiki ${workspace.root} init; se esiste già, usa /openwiki ${workspace.root} update.`, true,
          { state: status.state, workspaceId: status.workspaceId, root: workspace.root, admin: status.admin });
      }
      if (command.action === 'stop') {
        const status = await service.stop(sessionKey);
        return outcome(true, 200, null, 'OpenWiki fermato per questa sessione.', true,
          { state: status.state, workspaceId: status.workspaceId ?? null, root: status.root ?? null, admin: status.admin ?? 'stopped' });
      }
      if (command.action === 'status') {
        const status = service.status(sessionKey);
        return outcome(true, 200, null, `OpenWiki ${status.enabled ? 'ON' : 'OFF'}; stato ${status.state}; workspace ${status.workspaceId ?? 'non configurato'}.`, true,
          { state: status.state, enabled: status.enabled, workspaceId: status.workspaceId, root: status.root, admin: status.admin,
            activeRun: status.activeRun ? { kind: status.activeRun.kind, aborted: status.activeRun.aborted } : null,
            generation: status.generation ? { state: status.generation.state, pageCount: status.generation.pageCount } : null,
            lastError: status.lastError });
      }

      let validated;
      try {
        // Accept a directory path with a trailing slash at the command boundary.
        // Config/runtime validation still receives the canonical directory root.
        validated = validateRoot(command.path.replace(/\/+$/u, '') || '/');
      } catch {
        return outcome(false, 400, 'OPENWIKI_PATH_INVALID', 'Il path deve indicare una directory assoluta accessibile.');
      }
      workspaceRoot = validated.root;
      const status = service.status(sessionKey);
      if (!status.enabled) return outcome(false, 409, 'OPENWIKI_NOT_STARTED', 'Usa prima /openwiki start.');
      if (validated.root !== status.root) return outcome(false, 409, 'WORKSPACE_ROOT_MISMATCH', 'Il path non coincide con il workspace configurato nella pagina OpenWiki.');
      session.setOpenWikiWorkspace(validated);
      // UI slash commands carry only the command text. Read the selected
      // profile defaults now, so they use the active model after any switch.
      const modelRequest = { ...getDefaultRequest(), ...request };
      const result = await service.run({ sessionKey, kind: command.action, root: validated.root, request: modelRequest, engine,
        modelContext: { request: modelRequest }, signal });
      const messageText = result.noop
        ? `OpenWiki update completato: nessuna pagina da aggiornare per ${validated.root}.`
        : `OpenWiki ${command.action} completato per ${validated.root}: ${result.pageCount} pagine, ${result.totalTextBytes} byte.`;
      return outcome(true, 200, null, messageText, true, { state: 'completed', runId: result.runId, pageCount: result.pageCount,
        totalTextBytes: result.totalTextBytes, noop: result.noop === true,
        workspaceChanges: result.workspaceChanges ?? null });
    } catch (error) {
      if (error?.code === 'OPENWIKI_WORKSPACE_BOUND') return outcome(false, 409, error.code, 'Il workspace OpenWiki della sessione non può essere cambiato senza riavviarla.');
      if (error?.code === 'INVALID_ROOT') return outcome(false, 400, 'OPENWIKI_PATH_INVALID', 'Il path deve indicare una directory assoluta accessibile.');
      return safeFailure(error, workspaceRoot);
    }
  };
}

export default createOpenWikiAgentCommandHandler;
