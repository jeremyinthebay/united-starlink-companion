// phase2-e2e.mjs — real-browser end-to-end for the extension's DISPLAY.
//
// Loads extension/ UNPACKED into Chrome for Testing via a Playwright persistent
// context, then drives the united.com content script and reads the panel/badges
// it actually renders — the display half of the harness, against the same live
// tracker Phase 1 audited.
//
// POLITENESS + SAFETY, by construction:
//   · united.com is never really contacted. context.route() FULFILLS the
//     document request with a tiny local fixture, so united's servers and their
//     bot-detection see zero traffic and the DOM is deterministic. Only the
//     extension's own service worker reaches out — to the tracker, exactly as it
//     would in production — and that is a handful of throttled requests.
//   · Playwright resolves from ~/.wo-respo/node_modules (the machine's only
//     Playwright install); nothing is added to this repo's deps.
//
// What it asserts:
//   1. LAX→EWR (a transcon with no direct Starlink history) — the panel renders
//      the "No Starlink history on this route yet." empty state AND a real
//      Starlink connection row beneath it. This is the Phase-1 DISPLAY-
//      CONTRADICTION finding, confirmed in a real browser on real tracker data.
//   2. SFO→DEN (a narrowbody hub route) — the panel renders a ranked direct
//      list and the page's "United 1596" text gets a live odds badge. Positive
//      control that the normal path still displays correctly.
//
// Output: test/out/phase2-report.md + screenshots in test/out/shots/.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire("/Users/jeremysmith/.wo-respo/");
const { chromium } = require("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..", "extension");
const OUT = join(HERE, "out");
const SHOTS = join(OUT, "shots");

// A future date keeps the panel in "odds" mode (no firm-tail ✓ that needs a
// near date) and never goes stale. ~30 days out.
function farDate() {
  const d = new Date(Date.now() + 30 * 864e5);
  return d.toISOString().slice(0, 10);
}

// Minimal united.com results fixture. Only the URL query params drive the
// route context; `rows` inject "United ####" flight-number text (with a clock
// time so findRow() accepts the row) for the badge path.
function fixture({ o, d, rows = [] }) {
  const rowHtml = rows.map((r) =>
    `<div class="res-row" style="padding:12px;border-bottom:1px solid #ccc">
       <span class="fn">United ${r.num}</span> ·
       <span class="tm">${r.time}</span> — ${o} to ${d}
     </div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>United — choose flights</title></head>
    <body style="font-family:sans-serif;padding:24px">
    <h1>Choose your flight</h1><p>DEPART ON: ${o} to ${d}</p>
    <div id="results">${rowHtml || "<p>Flight results</p>"}</div>
    </body></html>`;
}

const CASES = [
  {
    name: "LAX-EWR-contradiction",
    o: "LAX", d: "EWR", rows: [],
    // The panel should show the empty state AND a connection row.
    expect: (txt) => ({
      hasEmptyState: /No Starlink history on this route yet\./.test(txt),
      hasConnection: /\(connection\)/.test(txt),
      connectionPct: (txt.match(/\(connection\)\s*(\d+)%/) || [])[1] || null,
    }),
  },
  {
    name: "SFO-DEN-positive",
    o: "SFO", d: "DEN",
    rows: [{ num: 1596, time: "8:30 a.m." }, { num: 1214, time: "11:05 a.m." }],
    expect: (txt) => ({
      listsUA1596: /UA1596/.test(txt),
      notEmpty: !/No Starlink history on this route yet\./.test(txt),
    }),
  },
];

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const userDataDir = join(tmpdir(), "usl-e2e-" + Date.now());
  const results = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });

    // Confirm the extension's service worker actually registered (MV3).
    let sw = context.serviceWorkers()[0];
    if (!sw) { try { sw = await context.waitForEvent("serviceworker", { timeout: 8000 }); } catch (e) {} }
    const swUrl = sw ? sw.url() : null;

    // Fulfill EVERY united.com request with our fixture; never hit the real site.
    // The tracker host is untouched here, so the extension's SW reaches it live.
    let currentFixture = "";
    await context.route(/https:\/\/(www\.)?united\.com\/.*/, (route) => {
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: currentFixture });
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    for (const c of CASES) {
      currentFixture = fixture({ o: c.o, d: c.d, rows: c.rows });
      const url = `https://www.united.com/en/us/fsr/choose-flights?f=${c.o}&t=${c.d}&d=${farDate()}&tt=1`;
      await page.goto(url, { waitUntil: "domcontentloaded" });

      // Panel appears only after the SW returns route data from the tracker.
      let panelText = "", appeared = false;
      try {
        await page.waitForSelector(".usl-panel", { timeout: 30000 });
        appeared = true;
        // Give renderPanel a beat to fold in the connection row / list update.
        await page.waitForTimeout(2500);
        panelText = await page.$eval(".usl-panel", (el) => el.innerText);
      } catch (e) { panelText = "(panel never rendered: " + String(e.message || e) + ")"; }

      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      const shot = join(SHOTS, c.name + ".png");
      try { await page.screenshot({ path: shot, fullPage: true }); } catch (e) {}

      const checks = c.expect(panelText);
      results.push({ name: c.name, route: `${c.o}→${c.d}`, appeared, panelText, badges, checks, shot });
      process.stderr.write(`  ${c.name}: panel ${appeared ? "rendered" : "MISSING"} · ${JSON.stringify(checks)}\n`);
    }

    writeReport({ swUrl, consoleErrors, results });
  } finally {
    if (context) await context.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

function writeReport({ swUrl, consoleErrors, results }) {
  const L = [];
  L.push(`# Phase 2 — browser E2E (extension loaded, real tracker, fixtured united.com)`);
  L.push("");
  L.push(`Run: ${new Date().toISOString()}`);
  L.push(`Service worker: ${swUrl || "NOT DETECTED"}`);
  L.push(`Console errors during run: ${consoleErrors.length ? consoleErrors.length : "none"}`);
  if (consoleErrors.length) for (const e of consoleErrors.slice(0, 10)) L.push(`- \`${e}\``);
  L.push("");
  for (const r of results) {
    L.push(`## ${r.route} — ${r.name}`);
    L.push(`Panel rendered: **${r.appeared ? "yes" : "NO"}** · badges on page: ${r.badges.length ? r.badges.map((b) => "`" + b + "`").join(" ") : "none"}`);
    L.push("");
    L.push("Checks: `" + JSON.stringify(r.checks) + "`");
    L.push("");
    L.push("Panel text as rendered:");
    L.push("```");
    L.push(r.panelText);
    L.push("```");
    L.push(`Screenshot: \`${r.shot.replace(HERE + "/", "")}\``);
    L.push("");
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "phase2-report.md"), L.join("\n"));
  process.stderr.write(`\nwrote test/out/phase2-report.md\n`);
}

run().catch((e) => { console.error("FATAL", e); process.exit(1); });
