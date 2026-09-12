// Command-hook body for the spike: posts the hook's stdin payload, its process ancestry (walked
// through Win32_Process on Windows) and the CLAUDE_* environment to the listener. Used for the
// SessionStart and Stop command hooks and as the status line command, labelled by its argument.
const http = require("http");
const { execFileSync } = require("child_process");
let stdin = "";
process.stdin.on("data", (c) => (stdin += c));
process.stdin.on("end", () => {
  let payload = null; try { payload = JSON.parse(stdin); } catch { payload = { raw: stdin }; }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^CLAUDE/i.test(k) && !/TOKEN|SOCKET/i.test(k)));
  const chain = [];
  if (process.platform === "win32" && process.argv[2] !== "statusline") {
    try {
      let pid = process.pid;
      for (let i = 0; i < 6 && pid; i++) {
        const out = execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`], { encoding: "utf8", timeout: 8000 }).trim();
        if (!out) break;
        const p = JSON.parse(out); chain.push({ pid: p.ProcessId, parent: p.ParentProcessId, name: p.Name }); pid = p.ParentProcessId;
      }
    } catch (e) { chain.push({ error: String(e).slice(0, 200) }); }
  }
  const body = JSON.stringify({ kind: "command-hook", label: process.argv[2], pid: process.pid, ppid: process.ppid, chain, env, payload });
  const req = http.request({ host: "127.0.0.1", port: 4747, path: "/command-hook/" + (process.argv[2] || "x"), method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => { res.resume(); res.on("end", () => process.exit(0)); });
  req.on("error", () => process.exit(0));
  req.end(body);
});
