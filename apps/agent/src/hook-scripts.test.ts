import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { rawHook, rawStatus } from "./testing/raw";
import { useTempDirs } from "./testing/tmp";

const HOOKS = fileURLToPath(new URL("../hooks/", import.meta.url));
const SCRIPTS = ["clawd-lib.mjs", "clawd-hook.mjs", "clawd-statusline.mjs"];
const TOKEN = "c".repeat(64);
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

type Received = { path: string; token: string | undefined; body: string };

async function agentStub(respond = true) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ path: req.url ?? "", token: req.headers["x-clawd-token"] as string | undefined, body });
      if (!respond) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, received };
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function run(script: string, stdin: string): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}

const forward = (p: string): string => p.replace(/\\/g, "/");

describe("hook scripts", () => {
  const tempDir = useTempDirs();

  async function install(config: Record<string, unknown> | null): Promise<string> {
    const home = await tempDir();
    await mkdir(join(home, "bin"));
    for (const file of SCRIPTS) await copyFile(join(HOOKS, file), join(home, "bin", file));
    if (config !== null) await writeFile(join(home, "config.json"), JSON.stringify(config));
    return home;
  }
  const bin = (home: string, file: string): string => join(home, "bin", file);

  it("SessionStart hook: posts its stdin with the token and prints nothing", async () => {
    const agent = await agentStub();
    const home = await install({ port: agent.port, token: TOKEN });
    const payload = JSON.stringify(rawHook("SessionStart", "s1", { source: "startup" }));
    const result = await run(bin(home, "clawd-hook.mjs"), payload);
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(agent.received).toEqual([{ path: "/ingest/hook", token: TOKEN, body: payload }]);
  });

  it("SessionStart hook: exits 0 promptly when the agent is down or there is no config", async () => {
    const down = await run(bin(await install({ port: await closedPort(), token: TOKEN }), "clawd-hook.mjs"), "{}");
    expect(down).toMatchObject({ code: 0, stdout: "" });
    expect(down.ms).toBeLessThan(1_500);
    expect(await run(bin(await install(null), "clawd-hook.mjs"), "{}")).toMatchObject({ code: 0, stdout: "" });
  });

  it("SessionStart hook: gives up on an agent that never answers", async () => {
    const agent = await agentStub(false);
    const result = await run(bin(await install({ port: agent.port, token: TOKEN }), "clawd-hook.mjs"), "{}");
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(1_500);
  });

  it("status line: posts its stdin and prints the default line", async () => {
    const agent = await agentStub();
    const home = await install({ port: agent.port, token: TOKEN });
    const payload = JSON.stringify(rawStatus("s1"));
    const result = await run(bin(home, "clawd-statusline.mjs"), payload);
    expect(result).toMatchObject({ code: 0, stdout: "clawd · Opus 5 · ctx 42%\n" });
    expect(agent.received).toEqual([{ path: "/ingest/status", token: TOKEN, body: payload }]);
  });

  it("status line: leaves out what the payload lacks, and still prints with the agent down", async () => {
    const home = await install({ port: await closedPort(), token: TOKEN });
    expect((await run(bin(home, "clawd-statusline.mjs"), "{}")).stdout).toBe("clawd\n");
    expect((await run(bin(home, "clawd-statusline.mjs"), "not json")).stdout).toBe("clawd\n");
  });

  it("status line: prints the wrapped command's output, which reads the same stdin", async () => {
    const agent = await agentStub();
    const home = await install(null);
    const echo = join(home, "echo.mjs");
    await writeFile(echo, 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write("wrapped "+JSON.parse(s).model.display_name+"\\n"));');
    const command = `"${forward(process.execPath)}" "${forward(echo)}"`;
    await writeFile(join(home, "config.json"), JSON.stringify({ port: agent.port, token: TOKEN, wrappedStatusLine: { type: "command", command } }));
    const result = await run(bin(home, "clawd-statusline.mjs"), JSON.stringify(rawStatus("s1")));
    expect(result).toMatchObject({ code: 0, stdout: "wrapped Opus 5\n" });
    expect(agent.received).toHaveLength(1);
  });

  it("status line: falls back to the default line when the wrapped command fails", async () => {
    const home = await install(null);
    const command = `"${forward(process.execPath)}" -e "process.exit(3)"`;
    await writeFile(join(home, "config.json"), JSON.stringify({ port: await closedPort(), token: TOKEN, wrappedStatusLine: { command } }));
    expect((await run(bin(home, "clawd-statusline.mjs"), JSON.stringify(rawStatus("s1")))).stdout).toBe("clawd · Opus 5 · ctx 42%\n");
  });
});
