import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { AGENT_VERSION } from "./version";

describe("AGENT_VERSION", () => {
  it("matches package.json", () => {
    expect(AGENT_VERSION).toBe(pkg.version);
  });
});
