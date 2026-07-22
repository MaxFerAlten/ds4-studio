export function initialEvolutionView() {
  return Object.freeze({ run: null, revision: null, lastSequence: 0, connection: "closed", gap: false });
}

export function applyEvolutionEvent(view, event) {
  if (!Number.isSafeInteger(event?.sequence) || event.sequence <= view.lastSequence) return view;
  if (view.lastSequence > 0 && event.sequence !== view.lastSequence + 1) {
    return Object.freeze({ ...view, connection: "stale", gap: true });
  }
  const run = view.run ? { ...view.run } : null;
  if (run && event.type === "STATE_TRANSITION") run.state = event.payload?.to ?? run.state;
  if (run) {
    run.sequence = event.sequence;
    run.revision = Math.max(run.revision ?? 0, event.revision ?? 0);
  }
  return Object.freeze({ ...view, run, lastSequence: event.sequence, gap: false });
}

export function replaceEvolutionRun(view, run) {
  return Object.freeze({ ...view, run, lastSequence: run?.sequence ?? 0, gap: false });
}
