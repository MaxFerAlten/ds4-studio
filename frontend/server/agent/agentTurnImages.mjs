// Images attached to one agent turn (JS engine).
//
// The composer sends them as data URIs next to the text.  They ride only on
// the outbound model requests of that turn, as OpenAI image_url parts on the
// turn's user message: the session transcript, checkpoints and compaction
// stay text-only, so a 100 KB photo never inflates the saved context.  A later
// turn no longer carries the image (the model keeps what it said about it).
//
// ds4-server decodes PNG and JPEG only (ds4_image.c), so anything else is
// refused here instead of failing deep in the backend.

export const AGENT_TURN_MAX_IMAGES = 4;

const DATA_URI = /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=\s]+$/i;

// Returns { images } or { error } for body.images.
export function normalizeTurnImages(raw) {
  if (raw === undefined || raw === null) return { images: [] };
  if (!Array.isArray(raw)) return { error: "images must be an array of data URIs" };
  if (raw.length > AGENT_TURN_MAX_IMAGES) {
    return { error: `at most ${AGENT_TURN_MAX_IMAGES} images per agent turn` };
  }
  for (const url of raw) {
    if (typeof url !== "string" || !DATA_URI.test(url)) {
      return { error: "agent images must be PNG or JPEG data URIs" };
    }
  }
  return { images: raw.slice() };
}

// Copy of `payload` whose last user message with exactly `userText` gains the
// image parts.  The payload itself is never mutated (the session commits from
// it).  No matching message (e.g. a stateful delta without the user turn)
// leaves the payload as is.
export function withTurnImages(payload, userText, images) {
  if (!images?.length || !Array.isArray(payload?.messages)) return payload;
  const messages = payload.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user" || message.content !== userText) continue;
    const next = messages.slice();
    next[i] = {
      ...message,
      content: [
        { type: "text", text: userText },
        ...images.map((url) => ({ type: "image_url", image_url: { url } }))
      ]
    };
    return { ...payload, messages: next };
  }
  return payload;
}
