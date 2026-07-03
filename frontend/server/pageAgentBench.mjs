import { toolPageSnapshot, toolPageAction } from "./pageAgentTool.mjs";
import { toolPageTask } from "./pageAgentTask.mjs";

function now() {
  const t = process.hrtime.bigint();
  return Number(t / 1000000n);
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function report(label, times) {
  if (!times.length) return;
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = (sum / sorted.length).toFixed(2);
  const min = sorted[0].toFixed(2);
  const max = sorted[sorted.length - 1].toFixed(2);
  const p50 = percentile(sorted, 50).toFixed(2);
  const p99 = percentile(sorted, 99).toFixed(2);
  console.log(
    `${label.padEnd(40)} calls=${String(sorted.length).padStart(3)}  ` +
    `avg=${avg}ms  min=${min}ms  max=${max}ms  p50=${p50}ms  p99=${p99}ms`
  );
}

async function benchSnapshot() {
  const times = [];
  for (let i = 0; i < 50; i++) {
    const start = now();
    await toolPageSnapshot({ includeControls: true }, { uiState: {} });
    times.push(now() - start);
  }
  report("page_snapshot (includeControls)", times);
}

async function benchSnapshotNoControls() {
  const times = [];
  for (let i = 0; i < 50; i++) {
    const start = now();
    await toolPageSnapshot({}, { uiState: {} });
    times.push(now() - start);
  }
  report("page_snapshot (no controls)", times);
}

async function benchActionClick() {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = now();
    await toolPageAction({ action: "click", target: "chat-send-button" }, {});
    times.push(now() - start);
  }
  report("page_action click", times);
}

async function benchActionInput() {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = now();
    await toolPageAction({ action: "input", target: "chat-input", value: "hello" }, {});
    times.push(now() - start);
  }
  report("page_action input", times);
}

async function benchActionBlocked() {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = now();
    await toolPageAction({ action: "click", target: "delete-all-button" }, {});
    times.push(now() - start);
  }
  report("page_action blocked", times);
}

async function benchTask() {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = now();
    await toolPageTask({ task: "Click the send button" }, { uiState: {} });
    times.push(now() - start);
  }
  report("page_task click", times);
}

async function benchTaskInput() {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = now();
    await toolPageTask({ task: "Type hello in the chat input" }, { uiState: {} });
    times.push(now() - start);
  }
  report("page_task input", times);
}

async function main() {
  console.log("PageAgent benchmark (server-side, no browser)\n");
  console.log(`${"Benchmark".padEnd(40)}  ${"calls".padStart(3)}  ${"avg".padStart(8)}  ${"min".padStart(8)}  ${"max".padStart(8)}  ${"p50".padStart(8)}  ${"p99".padStart(8)}`);
  console.log("-".repeat(100));

  await benchSnapshot();
  await benchSnapshotNoControls();
  await benchActionClick();
  await benchActionInput();
  await benchActionBlocked();
  await benchTask();
  await benchTaskInput();

  console.log("\nDone.");
}

main().catch(console.error);
