import assert from "node:assert/strict";
import { test } from "node:test";

async function claimGuard() {
  return import("./claimGuard.mjs");
}

test("blocks verified claim without evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  const block = checkVerifiedClaim("Tutti i bug sono stati fixati e make cpu passa.", "");

  assert.equal(block?.type, "STOP_UNSUPPORTED_VERIFIED_CLAIM");
  assert.equal(block?.block, true);
});

test("allows verified claim with direct evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  const block = checkVerifiedClaim(
    "make cpu passa.",
    "command: make cpu\nexit code 0\npassed"
  );

  assert.equal(block, undefined);
});

test("allows explicitly documented claim without build evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  const block = checkVerifiedClaim(
    "Il documento dichiara che i bug sono stati fixati.",
    ""
  );

  assert.equal(block, undefined);
});
