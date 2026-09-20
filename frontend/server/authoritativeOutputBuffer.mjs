/** Buffer stream chunks until an authoritative finalization decision exists. */
export class AuthoritativeOutputBuffer {
  constructor() {
    this.chunks = [];
  }

  append(delta) {
    if (delta !== undefined && delta !== null && delta !== "") {
      this.chunks.push(delta);
    }
  }

  discard() {
    this.chunks.length = 0;
  }

  flush(writeSse) {
    if (typeof writeSse !== "function") {
      throw new TypeError("AuthoritativeOutputBuffer.flush requires a writer");
    }
    const pending = this.chunks.splice(0);
    for (const delta of pending) writeSse(delta);
    return pending.length;
  }

  get size() {
    return this.chunks.length;
  }
}
