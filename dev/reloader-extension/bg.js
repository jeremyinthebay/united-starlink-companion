/* WiFi Odds dev reloader — development only, never published.
 *
 * Long-polls a local server and, when told to, reloads the unpacked WiFi Odds
 * extension by toggling it off and on. That is what makes Chrome re-read the
 * code from disk; a new tab does not, which is the trap this exists to remove.
 *
 * LONG POLL, not an interval. An MV3 service worker idles out after ~30s, so a
 * setInterval loop would simply stop between reloads and fail silently — the
 * worst failure mode, because the agent would believe it had fresh code. A
 * pending fetch keeps the worker alive, so the server holds each request open
 * for up to 25s and answers with either "reload" or "timeout". Either way we
 * immediately re-issue, so the worker never gets a chance to sleep.
 */

const SERVER = "http://127.0.0.1:8391";
const TARGET = "WiFi Odds for Flights";

/* Toggle every DEVELOPMENT-installed copy whose name matches. installType is
 * the load-bearing filter: a store-installed copy of the same name must never
 * be touched, both because toggling it proves nothing (its code cannot change)
 * and because silently disabling a real user's extension would be rude. */
async function reloadTarget() {
  const all = await chrome.management.getAll();
  /* THREE filters, and the third one was learned the hard way.
   *
   * installType: only a development-installed copy can have changed on disk, so
   * toggling a store copy proves nothing.
   *
   * id: never toggle ourselves.
   *
   * enabled: NEVER touch a copy the user has deliberately disabled. The first
   * version of this omitted that check, and its very first real run re-enabled
   * a disabled 2.2.0 copy sitting alongside the 3.0.0 one. That put two copies
   * of the extension into every page at once, which corrupts exactly the
   * captures this tool exists to take, and silently undid a choice the user had
   * made. A dev tool that changes state the user set is not a dev tool. */
  const targets = all.filter(
    (e) => e.name === TARGET && e.installType === "development" &&
           e.id !== chrome.runtime.id && e.enabled === true
  );
  const skipped = all.filter(
    (e) => e.name === TARGET && e.id !== chrome.runtime.id && e.enabled !== true
  ).map((e) => e.id + " (left disabled)");
  if (!targets.length) {
    return { ok: false, reason: "no ENABLED development-installed '" + TARGET + "' found", skipped };
  }

  const done = [];
  for (const t of targets) {
    try {
      await chrome.management.setEnabled(t.id, false);
      await new Promise((r) => setTimeout(r, 250));
      await chrome.management.setEnabled(t.id, true);
      done.push(t.id + " v" + t.version);
    } catch (e) {
      return { ok: false, reason: "toggle failed for " + t.id + ": " + String(e && e.message || e) };
    }
  }
  return { ok: true, reloaded: done, skipped };
}

async function report(body) {
  try {
    await fetch(SERVER + "/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) { /* server gone; the loop's own error handling covers it */ }
}

let running = false;

async function loop() {
  if (running) return;
  running = true;
  for (;;) {
    try {
      const res = await fetch(SERVER + "/wait", { cache: "no-store" });
      const j = await res.json();
      if (j && j.action === "reload") {
        const out = await reloadTarget();
        await report(out);
      }
      // "timeout" falls through and we simply poll again.
    } catch (e) {
      // Server not running, or it restarted. Back off briefly so a stopped
      // server does not spin the worker, then keep trying: the whole point is
      // that this survives the server coming and going.
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

chrome.runtime.onInstalled.addListener(() => loop());
chrome.runtime.onStartup.addListener(() => loop());
loop();
