import { AgentAdmissionError } from "../agentAdmission.mjs";

export function createResearchCancelHandler({ identity, refuse, requireEnabled, runtime, admission }) {
  return async function researchCancel(req, res) {
    try {
      identity.requireOrigin(req);
    } catch (error) {
      if (error instanceof AgentAdmissionError) return refuse(res, error);
      throw error;
    }
    if (!requireEnabled(res)) return;
    const sessionId = req.body?.sessionId;
    const ownerId = identity.ownerOf(req, res);
    if (runtime.jobs?.get(sessionId)?.running) {
      const active = admission?.activeIdentity?.();
      if (!active || active.ownerId !== ownerId) {
        return refuse(res, new AgentAdmissionError("LEASE_NOT_OWNED", "the active research job belongs to another owner", 409));
      }
    }
    const state = await runtime.cancel(sessionId);
    res.json({ status: state?.status || "cancelled" });
  };
}
