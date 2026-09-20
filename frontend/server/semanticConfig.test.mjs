import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SEMANTIC_ENV_BINDINGS,
  LEGACY_SEMANTIC_ENV_KEYS,
  parseBooleanText,
  normalizeLegacySemanticEnv,
  buildDs4SemanticEnv,
  buildDs4EpistemicEnv,
} from "./semanticConfig.mjs";

function resolved(overrides = {}) {
  return {
    lean: {
      policyAuto: true,
      orchestration: { enabled: true, prompt: false },
      ...(overrides.lean || {}),
    },
    sage: {
      policyAuto: true,
      orchestration: { enabled: true, prompt: false },
      ...(overrides.sage || {}),
    },
  };
}

test("every binding produces its canonical env key", () => {
  const env = buildDs4SemanticEnv(resolved());
  assert.deepEqual(Object.keys(env).sort(), SEMANTIC_ENV_BINDINGS.map((b) => b.env).sort());
  assert.deepEqual(env, {
    DS4_LEAN_POLICY_AUTO: "1",
    DS4_SAGE_POLICY_AUTO: "1",
    DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "1",
    DS4_LEAN_AUTONOMOUS_PROMPT: "0",
    DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "1",
    DS4_SAGE_AUTONOMOUS_PROMPT: "0",
  });
});

test("true becomes \"1\" and false becomes \"0\"", () => {
  const env = buildDs4SemanticEnv(
    resolved({
      lean: { policyAuto: false, orchestration: { enabled: false, prompt: true } },
    })
  );
  assert.equal(env.DS4_LEAN_POLICY_AUTO, "0");
  assert.equal(env.DS4_LEAN_AUTONOMOUS_ORCHESTRATION, "0");
  assert.equal(env.DS4_LEAN_AUTONOMOUS_PROMPT, "1");
});

test("buildDs4SemanticEnv refuses an unresolved value instead of defaulting", () => {
  const broken = resolved();
  delete broken.sage.orchestration.prompt;
  assert.throws(() => buildDs4SemanticEnv(broken), /sage\.orchestration\.prompt/);
});

test("buildDs4SemanticEnv never reads process.env", () => {
  process.env.DS4_LEAN_POLICY_AUTO = "0";
  try {
    assert.equal(buildDs4SemanticEnv(resolved()).DS4_LEAN_POLICY_AUTO, "1");
  } finally {
    delete process.env.DS4_LEAN_POLICY_AUTO;
  }
});

test("normalizeLegacySemanticEnv does not mutate its input", () => {
  const input = { server: { env: { DS4_LEAN_POLICY_AUTO: "0" } } };
  const snapshot = JSON.parse(JSON.stringify(input));
  normalizeLegacySemanticEnv(input);
  assert.deepEqual(input, snapshot);
});

test("a legacy server.env switch moves onto its typed path", () => {
  const out = normalizeLegacySemanticEnv({
    server: { env: { DS4_LEAN_POLICY_AUTO: "0", DS4_SAGE_AUTONOMOUS_PROMPT: "yes" } },
  });
  assert.equal(out.lean.policyAuto, false);
  assert.equal(out.sage.orchestration.prompt, true);
  assert.deepEqual(out.server.env, {});
});

test("an explicit typed field wins over server.env", () => {
  const out = normalizeLegacySemanticEnv({
    lean: { policyAuto: true },
    server: { env: { DS4_LEAN_POLICY_AUTO: "0" } },
  });
  assert.equal(out.lean.policyAuto, true);
  assert.equal("DS4_LEAN_POLICY_AUTO" in out.server.env, false);
});

test("the canonical key wins over its alias", () => {
  const out = normalizeLegacySemanticEnv({
    server: { env: { DS4_SAGE_POLICY_AUTO: "1", DS4_SAGE_SKILL_AUTO: "0" } },
  });
  assert.equal(out.sage.policyAuto, true);
  assert.deepEqual(out.server.env, {});
});

test("DS4_SAGE_SKILL_AUTO alone is migrated", () => {
  const out = normalizeLegacySemanticEnv({ server: { env: { DS4_SAGE_SKILL_AUTO: "0" } } });
  assert.equal(out.sage.policyAuto, false);
  assert.deepEqual(out.server.env, {});
});

test("DS4_SAGE_V2 alone is migrated", () => {
  const out = normalizeLegacySemanticEnv({ server: { env: { DS4_SAGE_V2: "0" } } });
  assert.equal(out.sage.orchestration.enabled, false);
  assert.deepEqual(out.server.env, {});
});

test("an unparseable value stays visible to validateConfig", () => {
  const out = normalizeLegacySemanticEnv({
    server: { env: { DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "maybe" } },
  });
  assert.equal(out.server.env.DS4_LEAN_AUTONOMOUS_ORCHESTRATION, "maybe");
  assert.equal(out.lean, undefined);
});

test("DS4_SKILL_AUTO stays in server.env", () => {
  const out = normalizeLegacySemanticEnv({ server: { env: { DS4_SKILL_AUTO: "1" } } });
  assert.equal(out.server.env.DS4_SKILL_AUTO, "1");
  assert.equal(LEGACY_SEMANTIC_ENV_KEYS.has("DS4_SKILL_AUTO"), false);
});

test("parseBooleanText is tri-state and case-insensitive", () => {
  for (const truthy of ["1", "true", "TRUE", "yes", "On"]) {
    assert.equal(parseBooleanText(truthy), true, truthy);
  }
  for (const falsy of ["0", "false", "No", "OFF"]) {
    assert.equal(parseBooleanText(falsy), false, falsy);
  }
  for (const invalid of ["", "  ", "maybe", undefined, null]) {
    assert.equal(parseBooleanText(invalid), null, String(invalid));
  }
});

test("epistemic enabled shadow maps to native shadow", () => {
  const env = buildDs4EpistemicEnv({
    agent: {
      epistemic: {
        enabled: true,
        mode: "shadow",
        maxRepairRounds: 2
      }
    }
  });

  assert.equal(env.DS4_EPISTEMIC_MODE, "shadow");
  assert.equal(env.DS4_EPISTEMIC_MAX_REPAIR_ROUNDS, "2");
});

test("epistemic enabled block maps to native block", () => {
  const env = buildDs4EpistemicEnv({
    agent: {
      epistemic: {
        enabled: true,
        mode: "block",
        maxRepairRounds: 0
      }
    }
  });

  assert.equal(env.DS4_EPISTEMIC_MODE, "block");
  assert.equal(env.DS4_EPISTEMIC_MAX_REPAIR_ROUNDS, "0");
});

test("disabled epistemic config forces native off", () => {
  const env = buildDs4EpistemicEnv({
    agent: {
      epistemic: {
        enabled: false,
        mode: "shadow",
        maxRepairRounds: 8
      }
    }
  });

  assert.equal(env.DS4_EPISTEMIC_MODE, "off");
  assert.equal(env.DS4_EPISTEMIC_MAX_REPAIR_ROUNDS, "8");
});

test("invalid epistemic mode is rejected", () => {
  assert.throws(
    () => buildDs4EpistemicEnv({
      agent: {
        epistemic: {
          enabled: true,
          mode: "SHADOW",
          maxRepairRounds: 2
        }
      }
    }),
    /invalid mode/
  );
});

test("buildDs4EpistemicEnv refuses a missing epistemic block", () => {
  assert.throws(() => buildDs4EpistemicEnv({ agent: {} }), /epistemic/);
  assert.throws(() => buildDs4EpistemicEnv({}), /epistemic/);
});

test("buildDs4EpistemicEnv refuses a non-boolean enabled", () => {
  assert.throws(
    () => buildDs4EpistemicEnv({
      agent: { epistemic: { enabled: "yes", mode: "shadow", maxRepairRounds: 2 } }
    }),
    /enabled must be boolean/
  );
});

test("buildDs4EpistemicEnv refuses an unresolved repair budget", () => {
  for (const maxRepairRounds of [undefined, -1, 9, 1.5, "2"]) {
    assert.throws(
      () => buildDs4EpistemicEnv({
        agent: { epistemic: { enabled: true, mode: "block", maxRepairRounds } }
      }),
      /maxRepairRounds/
    );
  }
});

test("typed epistemic config wins over a stale server.env mode at runtime", async () => {
  const { mergeConfig } = await import("./config.mjs");
  const cfg = mergeConfig({
    agent: {
      epistemic: {
        enabled: true,
        mode: "shadow",
        maxRepairRounds: 3
      }
    },
    server: {
      env: {
        DS4_EPISTEMIC_MODE: "block"
      }
    }
  });

  assert.equal(cfg.server.env.DS4_EPISTEMIC_MODE, "block");
  const semanticEnv = {
    ...buildDs4SemanticEnv(cfg),
    ...buildDs4EpistemicEnv(cfg)
  };
  const childEnv = {
    ...cfg.server.env,
    ...semanticEnv
  };
  assert.equal(childEnv.DS4_EPISTEMIC_MODE, "shadow");
  assert.equal(childEnv.DS4_EPISTEMIC_MAX_REPAIR_ROUNDS, "3");
});
