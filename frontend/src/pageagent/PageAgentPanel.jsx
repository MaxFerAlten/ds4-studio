/**
 * Minimal PageAgent status panel for DS4 Studio UI.
 * Shows current agent status, task, and a stop button.
 */
import { useState, useEffect } from "react";
import { PAGEAGENT_EVENTS } from "./pageAgentEvents.mjs";

export function PageAgentPanel({ config }) {
  const [status, setStatus] = useState("not_initialized");
  const [task, setTask] = useState("");
  const [activity, setActivity] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail || {};
      if (event.type === PAGEAGENT_EVENTS.STATUS_CHANGE) {
        setStatus(detail.status || "unknown");
      }
      if (event.type === PAGEAGENT_EVENTS.ACTIVITY) {
        setActivity(detail.message || "");
      }
      if (event.type === PAGEAGENT_EVENTS.RESULT) {
        setResult(detail.message || "");
      }
    };
    document.addEventListener(PAGEAGENT_EVENTS.STATUS_CHANGE, handler);
    document.addEventListener(PAGEAGENT_EVENTS.ACTIVITY, handler);
    document.addEventListener(PAGEAGENT_EVENTS.RESULT, handler);
    return () => {
      document.removeEventListener(PAGEAGENT_EVENTS.STATUS_CHANGE, handler);
      document.removeEventListener(PAGEAGENT_EVENTS.ACTIVITY, handler);
      document.removeEventListener(PAGEAGENT_EVENTS.RESULT, handler);
    };
  }, []);

  const enabled = Boolean(config?.pageAgent?.enabled);

  if (!enabled) {
    return (
      <div className="pageagent-panel">
        <div className="status-pill warn">PageAgent disabled (pageAgent.enabled)</div>
      </div>
    );
  }

  const statusClass = status === "running" ? "ok" : status === "error" ? "bad" : status === "stopped" ? "warn" : "";

  return (
    <div className="pageagent-panel">
      <div className={`status-pill ${statusClass}`}>
        {status === "not_initialized" ? "Not initialized" : status}
      </div>
      {task ? <div className="pageagent-task">Task: {task}</div> : null}
      {activity ? <div className="pageagent-activity">{activity}</div> : null}
      {result ? <div className="pageagent-result">{result}</div> : null}
      {status === "running" ? (
        <button
          type="button"
          className="pageagent-stop"
          onClick={async () => {
            const { stopUiTask } = await import("./pageAgentClient.mjs");
            await stopUiTask();
          }}
        >
          Stop
        </button>
      ) : null}
    </div>
  );
}
