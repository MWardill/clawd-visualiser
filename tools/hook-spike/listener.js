// Hook spike listener: records every hook POST (arrival time, path, headers, body) to
// spike-events.jsonl next to this file. Exits on its own after six minutes.
//
//   node tools/hook-spike/listener.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "spike-events.jsonl");
const started = Date.now();
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = null; try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
    fs.appendFileSync(out, JSON.stringify({ t: Date.now() - started, method: req.method, url: req.url, headers: req.headers, body: parsed }) + "\n");
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
function tryListen(attempt) {
  server.once("error", (e) => { if (e.code === "EADDRINUSE" && attempt < 60) setTimeout(() => tryListen(attempt + 1), 2000); else { console.error("listen failed", e.code); process.exit(1); } });
  server.listen(4747, "127.0.0.1", () => { fs.writeFileSync(path.join(__dirname, "listener.pid"), String(process.pid)); console.log("listening on 127.0.0.1:4747, pid", process.pid, "-> " + out); });
}
tryListen(0);
setTimeout(() => { console.log("listener timeout, exiting"); process.exit(0); }, 6 * 60 * 1000);
