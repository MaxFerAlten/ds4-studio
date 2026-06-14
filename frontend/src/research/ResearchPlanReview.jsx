export function ResearchPlanReview({ plan, onAccept, onRegenerate }) {
  return (
    <div className="research-plan">
      <h3>Proposed plan</h3>
      <p className="research-plan-objective">{plan.objective}</p>
      <ol>
        {(plan.steps || []).map((step) => (
          <li key={step.id}>
            <strong>{step.question}</strong>
            <span className="research-plan-method"> [{step.method}]</span>
          </li>
        ))}
      </ol>
      <div className="research-actions">
        <button type="button" onClick={onAccept}>Accept plan</button>
        <button type="button" onClick={onRegenerate}>Regenerate</button>
      </div>
    </div>
  );
}
