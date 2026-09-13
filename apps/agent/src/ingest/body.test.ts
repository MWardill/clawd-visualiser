import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readBody } from "./body";

describe("readBody", () => {
  it("collects a body under the limit", async () => {
    const result = await readBody(Readable.from([Buffer.from('{"a":'), Buffer.from("1}")]), 100);
    expect(result).toEqual({ ok: true, body: Buffer.from('{"a":1}') });
  });

  it("accepts a body of exactly the limit", async () => {
    expect(await readBody(Readable.from([Buffer.alloc(100)]), 100)).toMatchObject({ ok: true });
  });

  it("drops a body over the limit but still reads the stream to its end", async () => {
    const stream = Readable.from([Buffer.alloc(60), Buffer.alloc(60), Buffer.alloc(60)]);
    expect(await readBody(stream, 100)).toEqual({ ok: false, reason: "tooLarge" });
    expect(stream.readableEnded).toBe(true);
  });

  it("reports a stream that fails part way", async () => {
    const stream = new Readable({ read() {} });
    const pending = readBody(stream, 100);
    stream.push(Buffer.from("{"));
    stream.destroy(new Error("socket reset"));
    expect(await pending).toEqual({ ok: false, reason: "aborted" });
  });
});
