#!/usr/bin/env node
// Fake Lean executable for testing — simulates various exit behaviors.
// Usage: fake-lean <mode>

const mode = process.argv[2];

switch (mode) {
  case "success":
    process.stdout.write("Lean elaboration completed.\n");
    process.exit(0);
    break;

  // Real Lean reports elaboration diagnostics on stdout, not stderr. The
  // fixture must do the same or it hides parser bugs.
  case "syntax-error":
    process.stdout.write("/work/Main.lean:3:17: error: expected '('\n");
    process.exit(1);
    break;

  case "type-error":
    process.stdout.write(
      "/work/Main.lean:5:12: error: type mismatch\n" +
        "  expected: Nat\n" +
        "  actual: String\n"
    );
    process.exit(1);
    break;

  case "spam-stdout":
    for (let i = 0; i < 10000; i++) {
      process.stdout.write("x".repeat(80) + "\n");
    }
    process.exit(0);
    break;

  case "spam-stderr":
    for (let i = 0; i < 20000; i++) {
      process.stderr.write("y".repeat(128) + "\n");
    }
    process.exit(1);
    break;

  case "sleep":
    setTimeout(() => {
      process.stdout.write("woke up\n");
      process.exit(0);
    }, 60000);
    break;

  case "spawn-child": {
    const { spawn } = await import("node:child_process");
    const child = spawn("bash", ["-c", "echo child ran"], {
      stdio: "inherit",
    });
    child.on("exit", () => process.exit(0));
    break;
  }

  // Multibyte output that must round-trip byte-exactly through the bounded
  // runner (Greek, CJK, combining marks, astral-plane math alphanumerics).
  case "unicode": {
    const text = "λ ∀ 定理 Mathlib — 你好 𝔸\ud83d\ude00\n";
    process.stdout.write(text);
    process.stderr.write(text);
    process.exit(0);
    break;
  }

  // Multibyte output large enough to overflow a small byte limit, so the
  // truncation lands on a codepoint boundary mid-sequence.
  case "unicode-spam": {
    const line = "λ".repeat(2048) + "\n"; // 4096 bytes per line
    for (let i = 0; i < 5000; i++) process.stdout.write(line);
    process.exit(0);
    break;
  }

  // Ignore SIGTERM so the runner must escalate to SIGKILL.
  case "stubborn-sigterm":
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    break;

  // Stay alive while a grandchild (in this process group, so not detached)
  // tries to write <argv[3]> after a delay. The runner must reap the whole
  // group on timeout, or the marker file appears.
  case "descendant": {
    const { spawn } = await import("node:child_process");
    const marker = process.argv[3];
    spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'ALIVE'), 30000)", marker], {
      stdio: "ignore",
    }).unref();
    setInterval(() => {}, 1000);
    break;
  }

  case "echo-env":
    process.stdout.write(`PATH=${process.env.PATH || ""}\n`);
    process.stdout.write(`HOME=${process.env.HOME || ""}\n`);
    process.exit(0);
    break;

  default:
    process.stderr.write(`Unknown mode: ${mode}\n`);
    process.exit(2);
}
