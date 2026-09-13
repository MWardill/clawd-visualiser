import type { Readable } from "node:stream";

export type BodyResult = { ok: true; body: Buffer } | { ok: false; reason: "tooLarge" | "aborted" };

/**
 * Collect a request body up to `limit` bytes. Past the limit nothing more is kept, but the stream is
 * still read to its end so the client gets a response rather than a reset.
 */
export function readBody(stream: Readable, limit: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    let settled = false;
    const settle = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    stream.on("data", (chunk: Buffer | string) => {
      if (over) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => settle(over ? { ok: false, reason: "tooLarge" } : { ok: true, body: Buffer.concat(chunks) }));
    stream.on("error", () => settle({ ok: false, reason: "aborted" }));
    stream.on("close", () => settle({ ok: false, reason: "aborted" }));
  });
}
