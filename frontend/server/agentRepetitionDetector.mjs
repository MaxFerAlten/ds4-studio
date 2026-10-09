// Degenerate-repetition detector, port of the C agent_repetition_detector
// (studio/ds4_agent.c).  A model can collapse into repeating the same few
// lines inside ONE generation without ever calling a tool: the round guards
// run between rounds and never fire, and the stream only stops at max_tokens.
// Every completed non-blank line (whitespace ignored) is hashed into a small
// ring; the tail is flagged when it is a cycle of period <= REP_MAX_PERIOD
// repeated >= REP_MIN_CYCLES times.  Constants match the C.

export const REP_WINDOW = 32;
export const REP_MAX_PERIOD = 4;
export const REP_MIN_CYCLES = 5;
export const REP_WARN_CYCLES = 3;
export const REP_MIN_LINE_LEN = 4;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;
const SPACE = /\s/;

export function createRepetitionDetector() {
  const hashes = new Array(REP_WINDOW).fill(0n);
  let count = 0;
  let cur = FNV_OFFSET;
  let curSig = 0;
  const encoder = new TextEncoder();

  const back = (n) => hashes[(count - 1 - n) % REP_WINDOW];

  // How many times the trailing cycle repeats consecutively; 1 = none.
  function cycles() {
    const avail = Math.min(count, REP_WINDOW);
    let best = 1;
    for (let period = 1; period <= REP_MAX_PERIOD; period++) {
      if (avail < 2 * period) continue;
      const limit = avail - period;
      let m = 0;
      while (m < limit && back(m) === back(m + period)) m++;
      const reps = Math.floor(m / period) + 1;
      if (reps > best) best = reps;
    }
    return best;
  }

  // Feed streamed text; returns the highest trailing cycle count on the lines
  // this call completed (0 when it completed none).
  function feed(text) {
    let worst = 0;
    for (const ch of String(text || "")) {
      if (ch === "\n") {
        if (curSig >= REP_MIN_LINE_LEN) {
          hashes[count % REP_WINDOW] = cur;
          count++;
          const c = cycles();
          if (c > worst) worst = c;
        }
        cur = FNV_OFFSET;
        curSig = 0;
      } else if (!SPACE.test(ch)) {
        for (const byte of encoder.encode(ch)) {
          cur = ((cur ^ BigInt(byte)) * FNV_PRIME) & MASK64;
          curSig++;
        }
      }
    }
    return worst;
  }

  return { feed };
}
