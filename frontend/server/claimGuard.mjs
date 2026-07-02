const STRONG_CLAIM_RE =
  /\b(fixato|corretto|validato|compilato|verificato|tested|confirmed|fixed|validated|make cpu|certify_all|passa|passed)\b/i;

const DOCUMENTED_CLAIM_RE =
  /\b(il documento dichiara|il file dichiara|document states|according to the document|nel documento)\b/i;

const EVIDENCE_RE =
  /\b(make cpu|certify_all|node --test|gitnexus detect|detect_changes|diff --git|test result|exit code 0|passed)\b/i;

export function checkVerifiedClaim(text, evidenceText = "", { mode = "block" } = {}) {
  const content = String(text || "");
  if (!STRONG_CLAIM_RE.test(content)) return undefined;
  if (DOCUMENTED_CLAIM_RE.test(content)) return undefined;
  if (EVIDENCE_RE.test(String(evidenceText || ""))) return undefined;

  return {
    block: mode === "block",
    warn: mode === "warn",
    type: "STOP_UNSUPPORTED_VERIFIED_CLAIM",
    reason: "Assistant made a verified/fixed/compiled claim without direct evidence in this turn.",
    guidance: "Rewrite as documented claim: 'the document states...' unless build/test/source evidence was actually observed."
  };
}
