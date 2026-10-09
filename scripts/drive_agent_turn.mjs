// Drive one turn of the DS4 Studio JS agent loop over its HTTP API, so an
// outer supervisor (human or agent) can send a prompt, wait, and read the
// result without the browser UI.
//
// usage: node scripts/drive_agent_turn.mjs <prompt-file> <out-dir> [turn-label]
//
// Writes <out-dir>/<label>.events.jsonl (every SSE event) and
// <out-dir>/<label>.reply.md (concatenated agent_text + warnings/errors).
// Starts agent mode for the session key if it is not active yet.
//
// env: DS4_UI_BASE (default http://127.0.0.1:5173), DRIVER_KEY (session key,
// default "claude-driver"; a new key = a fresh session with empty context).
// The session is separate from the UI tab's: do not use both at once on a
// single-slot backend.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { request as httpRequest } from "node:http";

const BASE = process.env.DS4_UI_BASE || "http://127.0.0.1:5173";
const KEY = process.env.DRIVER_KEY || "claude-driver";
const [promptFile, outDir, label = `turn-${Date.now()}`] = process.argv.slice(2);
const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": KEY };
mkdirSync(outDir, { recursive: true });
const evPath = `${outDir}/${label}.events.jsonl`;
const replyPath = `${outDir}/${label}.reply.md`;
writeFileSync(evPath, "");

const status = await (await fetch(`${BASE}/api/agent/status`, { headers })).json();
if (!status.active) {
  const r = await fetch(`${BASE}/api/agent/start`, { method: "POST", headers, body: "{}" });
  console.log("start:", r.status, (await r.text()).slice(0, 200));
}

const message = readFileSync(promptFile, "utf8");
// node:http instead of fetch: undici's fetch drops a response after 300 s
// without a byte (UND_ERR_BODY_TIMEOUT), and a withheld round (evidence or
// epistemic block) streams nothing for longer than that.  The server then
// sees the client leave and cancels the round.
const res = await new Promise((resolve, reject) => {
  const req = httpRequest(`${BASE}/api/agent/chat`, { method: "POST", headers }, resolve);
  req.on("error", reject);
  req.end(JSON.stringify({ message, sessionKey: KEY }));
});
if (res.statusCode !== 200) {
  let b = ""; for await (const c of res) b += c;
  console.error("chat HTTP", res.statusCode, b); process.exit(2);
}

let text = "", notes = [], done = null, buf = "", event = "message";
const decoder = new TextDecoder();
for await (const chunk of res) {
  buf += decoder.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
    if (line.startsWith("event:")) { event = line.slice(6).trim(); continue; }
    if (!line.startsWith("data:")) { if (!line) event = "message"; continue; }
    let data; try { data = JSON.parse(line.slice(5)); } catch { continue; }
    appendFileSync(evPath, JSON.stringify({ t: new Date().toISOString(), event, data }) + "\n");
    if (event === "agent_text") text += data.content || "";
    else if (event === "agent_warning") notes.push(`WARNING ${data.type || ""}: ${data.warning || ""}`);
    else if (event === "agent_error") notes.push(`ERROR: ${data.error || JSON.stringify(data)}`);
    else if (event === "agent_tool_call") process.stdout.write(`.`);
    else if (event === "agent_done") done = data;
  }
}
const summary = `${text}\n\n---\n${notes.join("\n")}\nDONE: ${JSON.stringify(done)}\n`;
writeFileSync(replyPath, summary);
console.log(`\nfinished: ${done ? done.finish_reason : "stream ended without agent_done"} iterations=${done?.iterations}`);
