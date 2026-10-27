import { hashLeanTargetStatement } from "./leanTaskSpec.mjs";

// Refusals decided on the statement itself (semantic review, definitional
// probe). A typecheck
// failure can depend on imports, so it never marks a statement as rejected.
const SEMANTIC_REFUSALS = new Set(["LEAN_GOAL_SCOPE_MISMATCH", "LEAN_GOAL_NOT_DISCRIMINATING", "LEAN_GOAL_DEFINITIONAL"]);

function statementKey(args) {
  const hashed = hashLeanTargetStatement(args?.target_statement, args?.target_declaration);
  return hashed.ok ? hashed.value.statementSha256 : String(args?.target_statement ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Per-turn memory of the Lean goals the semantic review refused. A statement
 * refused once is refused again without spending Lean or the reviewer, and
 * after `maxRejections` refusals (repeats included) Lean ends NOT_VERIFIED.
 */
export class LeanGoalRejections {
  constructor({ maxRejections = 3 } = {}) {
    this.maxRejections = Math.max(1, Number(maxRejections) || 3);
    this.rejected = new Map();
    this.count = 0;
  }

  get exhausted() {
    return this.count >= this.maxRejections;
  }

  #terminal() {
    return {
      content: `LEAN_GOAL_REJECTED_REPEATEDLY: the semantic review refused ${this.count} proposed targets in this turn; ` +
        "Lean is NOT_VERIFIED for this question. Do not call lean_prepare again; report what the refusals showed.",
      code: "LEAN_GOAL_REJECTED_REPEATEDLY"
    };
  }

  /** Refusal to return instead of dispatching, or undefined when the call may run. */
  check(args) {
    if (this.exhausted) return this.#terminal();
    const previous = this.rejected.get(statementKey(args));
    if (!previous) return undefined;
    this.count += 1;
    if (this.exhausted) return this.#terminal();
    return {
      content: `LEAN_GOAL_ALREADY_REJECTED: this exact statement was refused earlier in this turn (${previous.code}): ${previous.message} ` +
        `State a different target. Refusals left before Lean ends NOT_VERIFIED: ${this.maxRejections - this.count}.`,
      code: "LEAN_GOAL_ALREADY_REJECTED"
    };
  }

  /** Record a preparation result; returns the terminal refusal once the budget is spent. */
  record(args, result) {
    if (!SEMANTIC_REFUSALS.has(result?.code)) return undefined;
    this.rejected.set(statementKey(args), { code: result.code, message: String(result.message || "").slice(0, 600) });
    this.count += 1;
    return this.exhausted ? this.#terminal() : undefined;
  }
}
