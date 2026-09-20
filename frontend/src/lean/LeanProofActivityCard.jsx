import { memo } from "react";
import { leanProofActivityProps } from "./leanProofActivityState.mjs";

export const LeanProofActivityCard = memo(function LeanProofActivityCard({ activity }) {
  const props = leanProofActivityProps(activity);
  if (!props) return null;

  return (
    <div
      className={`lean-proof-activity ${props.tone}`}
      role="status"
      aria-live="polite"
      data-agent-id="lean-proof-activity-card"
    >
      <div className="lean-proof-header">
        <span className="lean-proof-title">Lean 4</span>
        <span className="lean-proof-state">{props.label}</span>
        {props.badge ? (
          <span className={`lean-proof-badge ${props.badge === "VERIFIED" ? "ok" : "bad"}`}>
            {props.badge}
          </span>
        ) : null}
      </div>
      {props.detail ? <div className="lean-proof-detail">{props.detail}</div> : null}
      {props.summary ? <div className="lean-proof-summary">{props.summary}</div> : null}
      {props.terminalReason ? (
        <div className="lean-proof-reason">causa: {props.terminalReason}</div>
      ) : null}
      {props.attempts.length > 1 ? (
        <ul className="lean-proof-attempts">
          {props.attempts.map((step) => (
            <li key={step.id} className={`lean-proof-attempt ${step.state}`}>
              <span className="lean-attempt-index">#{step.attempt}</span>
              <span className="lean-attempt-label">{step.label}</span>
              {step.detail ? <span className="lean-attempt-detail">{step.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
