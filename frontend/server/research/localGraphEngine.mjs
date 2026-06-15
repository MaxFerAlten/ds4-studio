import { runResearchGraph } from "./researchGraph.mjs";

// Engine wrapper over the existing local research graph. Behavior-preserving:
// the runtime keeps driving feedback (via #launch re-entry) and cancellation
// (via the abort signal) for the local path, so this engine only needs run().
export class LocalGraphEngine {
  run(ctx) {
    return runResearchGraph(ctx);
  }
}
