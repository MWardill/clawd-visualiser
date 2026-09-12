import { describe, expect, it } from "vitest";
import { checkOrigin, hostAllowed, tokenMatches } from "./guards";

describe("guards", () => {
  it("accepts only loopback host names on the agent's port", () => {
    expect(hostAllowed("127.0.0.1:4750", 4750)).toBe(true);
    expect(hostAllowed("localhost:4750", 4750)).toBe(true);
    expect(hostAllowed("LOCALHOST:4750", 4750)).toBe(true);
    expect(hostAllowed("127.0.0.1:4751", 4750)).toBe(false);
    expect(hostAllowed("evil.example:4750", 4750)).toBe(false);
    expect(hostAllowed("127.0.0.1", 4750)).toBe(false);
    expect(hostAllowed(undefined, 4750)).toBe(false);
  });

  it("sorts origins into none, allowed and denied", () => {
    const allowed = ["http://localhost:3000"];
    expect(checkOrigin(undefined, allowed)).toEqual({ kind: "none" });
    expect(checkOrigin("http://localhost:3000", allowed)).toEqual({ kind: "allowed", origin: "http://localhost:3000" });
    expect(checkOrigin("https://evil.example", allowed)).toEqual({ kind: "denied" });
    expect(checkOrigin("null", allowed)).toEqual({ kind: "denied" });
  });

  it("matches the token exactly", () => {
    const token = "a".repeat(64);
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches("a".repeat(63), token)).toBe(false);
    expect(tokenMatches(`${"a".repeat(63)}b`, token)).toBe(false);
    expect(tokenMatches([token], token)).toBe(false);
    expect(tokenMatches(undefined, token)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});
