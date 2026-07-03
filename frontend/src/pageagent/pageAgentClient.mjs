/**
 * PageAgent client-side wrapper for DS4 Studio UI automation.
 * Singleton pattern — one PageAgent instance per session.
 */

let singleton = null;

/**
 * Ensure a PageAgent singleton is initialized.
 * @param {object} config pageAgent config section
 * @param {object} callbacks event callbacks
 * @returns {Promise<object>} PageAgent instance
 */
export async function ensurePageAgent(config, callbacks = {}) {
  if (singleton) return singleton;

  const { PageAgent } = await import("page-agent");

  const agent = new PageAgent({
    model: config.model || "deepseek-v4-flash",
    baseURL: config.baseURL || "http://127.0.0.1:8080/v1",
    apiKey: config.apiKey || "not-needed",
    language: config.language || "it-IT",
    maxSteps: config.maxSteps || 20,
    experimentalScriptExecutionTool: false,

    onBeforeStep: callbacks.onBeforeStep,
    onAfterStep: callbacks.onAfterStep,
    onBeforeTask: callbacks.onBeforeTask,
    onAfterTask: callbacks.onAfterTask
  });

  if (callbacks.onStatusChange) {
    agent.addEventListener("statuschange", callbacks.onStatusChange);
  }
  if (callbacks.onActivity) {
    agent.addEventListener("activity", callbacks.onActivity);
  }
  if (callbacks.onHistoryChange) {
    agent.addEventListener("historychange", callbacks.onHistoryChange);
  }

  singleton = agent;
  return agent;
}

/**
 * Execute a UI task via the PageAgent singleton.
 * @param {string} task natural-language task description
 * @param {object} config pageAgent config section
 * @param {object} callbacks event callbacks
 * @returns {Promise<object>} execution result
 */
export async function executeUiTask(task, config, callbacks) {
  const agent = await ensurePageAgent(config, callbacks);
  return agent.execute(task);
}

/**
 * Stop the current PageAgent task.
 * @returns {Promise<void>}
 */
export async function stopUiTask() {
  if (singleton) await singleton.stop();
}

/**
 * Get current PageAgent status string.
 * @returns {string} status label
 */
export function getUiAgentStatus() {
  return singleton ? singleton.status : "not_initialized";
}

/**
 * Reset singleton for tests.
 */
export function resetUiAgentForTests() {
  singleton = null;
}
