import { memo } from "react";
import { sageActivityCardProps } from "./sageActivityCardProps.mjs";

export const SageActivityCard = memo(function SageActivityCard({ activity, debugEnabled = false }) {
  const props = sageActivityCardProps(activity);
  if (!props) return null;

  return (
    <div className={props.className} role={props.role} aria-live={props.ariaLive} data-agent-id="sage-activity-card">
      <div className="sage-activity-header">
        <span className="sage-activity-title">{props.title}</span>
        <span className="sage-activity-state">{props.summary}</span>
      </div>
      <ul className="sage-activity-steps">
        {props.steps.map((step) => (
          <li key={step.id} className={`sage-activity-step ${step.status}`}>
            <span className="sage-step-icon">{step.icon}</span>
            <span className="sage-step-label">{step.label}</span>
            {step.detail ? <span className="sage-step-detail">{step.detail}</span> : null}
          </li>
        ))}
      </ul>
      {props.footerLine ? <div className="sage-activity-footer">{props.footerLine}</div> : null}
      {props.artifacts.length ? (
        <ul className="sage-artifact-list">
          {props.artifacts.map((art) => (
            <li key={art.url || art.name}>
              <a href={art.url} target="_blank" rel="noopener noreferrer">{art.name}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {props.error ? (
        <div className="sage-activity-error">{props.error}</div>
      ) : null}
      {debugEnabled ? (
        <details className="sage-debug">
          <summary>Debug</summary>
          <pre>{JSON.stringify(props.debug, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
});
