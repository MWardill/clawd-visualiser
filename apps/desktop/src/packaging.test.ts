import { DEFAULT_PORT } from "@clawd/agent";
import { DEFAULT_AGENT_URL } from "@clawd/core";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("electron-builder.yml", () => {
  it("keeps the fuse every installed hook depends on, and turns off the two doors the app never uses", async () => {
    const yml = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
    const fuse = (name: string): string | undefined => new RegExp(`^\\s+${name}:\\s*(true|false)\\s*$`, "m").exec(yml)?.[1];
    expect(fuse("runAsNode")).toBe("true");
    expect(fuse("onlyLoadAppFromAsar")).toBe("true");
    expect(fuse("enableNodeOptionsEnvironmentVariable")).toBe("false");
    expect(fuse("enableNodeCliInspectArguments")).toBe("false");
  });
});

describe("the agent's port", () => {
  it("is the same in the export's built-in agent URL and the agent's default, the two places it is written", () => {
    // No stage lets the port vary, so the page's URL is fixed at build time. If either default moves, both must.
    expect(DEFAULT_AGENT_URL).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
  });
});
