// reload-server.mjs — development only, never published.
//
// Bridges "a shell wants the extension reloaded" to "the reloader extension
// does it". Deliberately dependency-free: node's own http module, no install,
// nothing to keep current.
//
//   node dev/reload-server.mjs            start it, leave it running
//   curl -s -X POST localhost:8391/reload ask for a reload, wait for the result
//   curl -s localhost:8391/status         who has checked in, and when
//
// The /wait endpoint is a LONG POLL: it does not answer for up to 25 seconds.
// That is what keeps the MV3 service worker on the other end alive, and it is
// why this looks like it has hung when you try it by hand.

import { createServer } from "node:http";

const PORT = 8391;
const HOLD_MS = 25000;

let waiters = [];          // pending /wait responses
let pendingReload = false; // a reload was asked for before anyone was listening
let lastCheckIn = null;    // when the reloader last polled
let lastResult = null;     // what the reloader reported last
let resultWaiters = [];    // pending /reload callers awaiting a report

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
};

function dispatchReload() {
  pendingReload = true;
  const now = waiters;
  waiters = [];
  for (const w of now) {
    clearTimeout(w.timer);
    pendingReload = false;
    json(w.res, 200, { action: "reload" });
  }
  return now.length;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  // The reloader extension parks here until there is work.
  if (url.pathname === "/wait") {
    lastCheckIn = new Date().toISOString();
    if (pendingReload) {
      pendingReload = false;
      return json(res, 200, { action: "reload" });
    }
    const w = { res, timer: null };
    w.timer = setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      json(res, 200, { action: "timeout" });
    }, HOLD_MS);
    waiters.push(w);
    req.on("close", () => {
      clearTimeout(w.timer);
      waiters = waiters.filter((x) => x !== w);
    });
    return;
  }

  // The reloader tells us how it went; unblocks whoever asked.
  if (url.pathname === "/report" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { lastResult = JSON.parse(body); } catch (e) { lastResult = { ok: false, reason: "bad report" }; }
      lastResult.at = new Date().toISOString();
      const now = resultWaiters; resultWaiters = [];
      for (const rw of now) { clearTimeout(rw.timer); json(rw.res, lastResult.ok ? 200 : 500, lastResult); }
      json(res, 200, { ok: true });
    });
    return;
  }

  // A shell asks for a reload and waits for the actual outcome, so a caller can
  // rely on the exit code rather than on a hopeful sleep.
  if (url.pathname === "/reload" && req.method === "POST") {
    const listeners = dispatchReload();
    if (!listeners && !lastCheckIn) {
      return json(res, 503, {
        ok: false,
        reason: "the reloader extension has never checked in. Load dev/reloader-extension as unpacked, and make sure this server was running first.",
      });
    }
    const rw = { res, timer: null };
    rw.timer = setTimeout(() => {
      resultWaiters = resultWaiters.filter((x) => x !== rw);
      json(res, 504, { ok: false, reason: "reloader did not report back within 15s", lastCheckIn });
    }, 15000);
    resultWaiters.push(rw);
    return;
  }

  if (url.pathname === "/status") {
    return json(res, 200, {
      ok: true, lastCheckIn, lastResult,
      reloaderConnected: waiters.length > 0,
      note: lastCheckIn ? undefined : "reloader extension has never polled; is it loaded?",
    });
  }

  json(res, 404, { ok: false, reason: "unknown endpoint" });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write("reload-server listening on http://127.0.0.1:" + PORT + "\n");
  process.stdout.write("  POST /reload   ask for a reload and wait for the result\n");
  process.stdout.write("  GET  /status   who has checked in\n");
});
