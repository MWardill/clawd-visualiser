import { request, type IncomingHttpHeaders } from "node:http";

export type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

export function send(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, ...(opts.headers ? { headers: opts.headers } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export type OpenStream = {
  status: number;
  headers: IncomingHttpHeaders;
  text(): string;
  waitFor(pred: (text: string) => boolean, timeoutMs?: number): Promise<void>;
  close(): void;
};

export function openStream(port: number, path = "/api/stream", headers: Record<string, string> = {}): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
      });
      res.on("error", () => {});
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: () => text,
        waitFor: (pred, timeoutMs) => waitFor(() => pred(text), timeoutMs),
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.split("\n").some((line) => line.startsWith("data: ")))
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1] ?? "message",
      data: JSON.parse(
        block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("\n"),
      ) as unknown,
    }));
}
