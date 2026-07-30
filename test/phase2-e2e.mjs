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

// Minimal Navan results fixture. Navan lists SEVERAL carriers, so rows carry a
// visible carrier + flight label ("United 1596", "Frontier 1229"); only the
// United rows match FN_RE and get odds. The route context comes from the DOM
// (Navan has no URL params) via ".flight-header__route" + "Depart from XXX".
// Each row is a direct child of #results with a clock time so findRow()/
// findContainer() accept it. This is the login-gated surface the Playwright
// harness could never reach in production — bugs 3 and 4 lived here.
function navanFixture({ o, d, rows = [] }) {
  const rowHtml = rows.map((r) =>
    `<div class="flight-card" style="padding:12px;border-bottom:1px solid #ccc">
       <span class="flight-card-info__airline__number">${r.label}</span> ·
       <span class="tm">${r.time}</span> — ${o} to ${d}
     </div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Navan — Departure Flights</title></head>
    <body style="font-family:sans-serif;padding:24px">
    <div class="flight-header__route">${o} → ${d}</div>
    <p>Depart from ${o}</p>
    <div id="results">${rowHtml || "<p>No flights</p>"}</div>
    </body></html>`;
}

const CASES = [
  {
    name: "LAX-EWR-empty-with-connection",
    o: "LAX", d: "EWR", rows: [],
    // v2.2: no-direct-history copy names "direct-flight", and the connection row
    // is labelled "all-legs estimate" — no more "no history" above a real option.
    expect: (txt) => ({
      newEmptyCopy: /No direct-flight Starlink history yet\. Connection estimate below\./.test(txt),
      oldContradictionGone: !/No Starlink history on this route yet\./.test(txt),
      connectionLabelled: /all-legs estimate/.test(txt),
      // Boolean, not a captured string — every gated check must be exactly true.
      connectionPctShown: /all-legs estimate\s*\d+%/.test(txt),
    }),
  },
  {
    name: "SFO-DEN-positive",
    o: "SFO", d: "DEN",
    rows: [{ num: 1596, time: "8:30 a.m." }, { num: 1214, time: "11:05 a.m." }],
    expect: (txt) => ({
      listsUA1596: /UA1596/.test(txt),
      // Codex P1-01: the page-visible top flight must rank FIRST in the panel
      // (⭐ prefix), even if the route table omitted it.
      ua1596RanksFirst: /⭐\s*UA1596/.test(txt),
      noEmptyCopy: !/No direct-flight Starlink history/.test(txt),
    }),
  },
  {
    // v2.2 per-flight fallback: UA2402 (~16%) and UA1596 (~68%) have real
    // predict-flight history but need not appear in this route's table, so
    // pre-2.2 they badged "n/a" (or nothing on an empty route). They should now
    // badge their real number. predict-flight is keyed on the flight number, so
    // the route used here is irrelevant to the odds.
    name: "united-fallback-real-odds",
    o: "SFO", d: "SIN",   // an empty route (SW returns ok:false) — the hard case
    rows: [{ num: 2402, time: "2:15 p.m." }, { num: 1596, time: "10:30 a.m." }],
    awaitBadge: /🛰️\s*\d+%/,        // wait until a real per-flight % badge appears
    awaitPanel: /UA(2402|1596)/,     // then wait for the panel to POPULATE from fallback
    expect: (txt, badges) => {
      const joined = badges.join(" ");
      return {
        ua2402RealOdds: /🛰️\s*16%/.test(joined),
        ua1596RealOdds: /🛰️\s*68%/.test(joined),
        // Codex #3: the panel must list the flights, not show the empty-state
        // contradiction above live badges.
        panelListsFlights: /UA(2402|1596)/.test(txt),
        noEmptyStateContradiction: !/No direct-flight Starlink history for this route yet\./.test(txt),
        noBareNa: !badges.some((b) => /^🛰️ n\/a$/.test(b.trim())),
      };
    },
  },
  {
    // Codex EXT P1-01: a full tracker outage must say "unavailable", never a
    // false absence. Every tracker request returns 500 for this case.
    name: "united-outage-unavailable",
    o: "DEN", d: "SFO", rows: [{ num: 1812, time: "9:00 a.m." }],
    trackerFail: true,
    awaitPanel: /unavailable/i,
    expect: (txt) => ({
      saysUnavailable: /Direct-flight history unavailable right now\./.test(txt),
      notFalseAbsence: !/No direct-flight Starlink history/.test(txt),
    }),
  },
  {
    // Navan Bug 4: a mixed-carrier list (Frontier + United). Auto-sort defaults
    // ON, so once United odds resolve the page must reorder — United-with-odds
    // floated to the TOP, the unscored Frontier rows sunk below in their
    // relative order ("sink unscored, keep carriers"). Pre-fix, sortPage only
    // reordered United rows and pinned Frontier on top, so the sort looked dead.
    // Also Bug 3 positive: the panel lists the flights, never the no-history copy.
    name: "navan-mixed-autosort",
    navan: true, o: "DEN", d: "SFO",
    rows: [
      { label: "Frontier 1229", time: "8:59 a.m." },
      { label: "United 1596", time: "8:30 a.m." },
      { label: "Frontier 3435", time: "6:55 a.m." },
      { label: "United 2402", time: "2:15 p.m." },
    ],
    awaitBadge: /🛰️\s*\d+%/,
    awaitPanel: /UA(1596|2402)/,
    // Read the results container's row order AFTER sort settles, using the same
    // findContainer heuristic the content script uses.
    probe: () => {
      const FN_RE = /\b(?:UA|United)\s?(\d{2,4})\b/;
      const badge = document.querySelector(".usl-badge");
      if (!badge) return { order: [], containerFound: false };
      let best = null, bestScore = 0, e = badge.parentElement;
      for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
        const fns = [...e.children].map((k) => ((k.textContent || "").match(FN_RE) || [])[1]).filter(Boolean);
        const d = new Set(fns).size;
        if (d > bestScore) { bestScore = d; best = e; }
      }
      if (!best) return { order: [], containerFound: false };
      // Each child is either a United row (matches FN_RE) or an "unscored" row
      // (any other carrier). Label United as "UA####", everything else "OTHER".
      const order = [...best.children].map((k) => {
        const m = (k.textContent || "").match(FN_RE);
        return m ? ("UA" + m[1]) : "OTHER";
      });
      return { order, containerFound: true };
    },
    expect: (txt, badges, probe) => {
      const order = (probe && probe.order) || [];
      const firstUA = order.findIndex((x) => x.startsWith("UA"));
      const firstOther = order.indexOf("OTHER");
      const i1596 = order.indexOf("UA1596");
      const i2402 = order.indexOf("UA2402");
      return {
        panelListsFlights: /UA(1596|2402)/.test(txt),
        noEmptyStateContradiction: !/No direct-flight Starlink history/.test(txt),
        // United floated above the unscored (other-carrier) rows, which sank.
        unitedAboveOther: firstUA >= 0 && firstOther >= 0 && firstUA < firstOther,
        // Higher odds (UA1596 ~68%) ranks above lower (UA2402 ~16%).
        higherOddsFirst: i1596 >= 0 && i2402 >= 0 && i1596 < i2402,
      };
    },
  },
  {
    // Navan Bug 3: an all-other-carrier list (no United rows at all). The panel
    // must be SUPPRESSED entirely — it must NEVER pop the "no history" copy when
    // there are simply no United flights to read. Pre-fix it rendered the empty
    // state immediately on first paint.
    name: "navan-no-united-suppressed",
    navan: true, o: "DEN", d: "SFO", expectNoPanel: true,
    rows: [
      { label: "Frontier 1229", time: "8:59 a.m." },
      { label: "Frontier 3435", time: "6:55 a.m." },
      { label: "Southwest 4785", time: "7:20 a.m." },
    ],
    expect: () => ({}),
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
    // Same for Navan — the login-gated surface. We never reach the real site;
    // the fixture is deterministic and the extension's SW still predicts live.
    await context.route(/https:\/\/app\.navan\.com\/.*/, (route) => {
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: currentFixture });
    });
    // Optional tracker-outage simulation: when trackerFail is set for a case,
    // every tracker request returns 500 so we can prove the panel says
    // "unavailable" (not a false absence). Otherwise the real tracker is used.
    let trackerFail = false;
    await context.route(/https:\/\/unitedstarlinktracker\.com\/.*/, (route) => {
      if (trackerFail) route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"down"}' });
      else route.continue();
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    for (const c of CASES) {
      currentFixture = c.navan
        ? navanFixture({ o: c.o, d: c.d, rows: c.rows })
        : fixture({ o: c.o, d: c.d, rows: c.rows });
      trackerFail = !!c.trackerFail;
      const url = c.navan
        ? `https://app.navan.com/app/user2/search/flights-ngs/${c.o}-${c.d}-${farDate()}`
        : `https://www.united.com/en/us/fsr/choose-flights?f=${c.o}&t=${c.d}&d=${farDate()}&tt=1`;
      await page.goto(url, { waitUntil: "domcontentloaded" });

      // Panel appears only after the SW returns route data from the tracker.
      let panelText = "", appeared = false;
      if (c.expectNoPanel) {
        // The panel must NOT appear. Give the content script ample time to scan
        // the page and (correctly) decide not to render, then assert it stayed
        // away — a false "no history" pop would create .usl-panel here.
        await page.waitForTimeout(6000);
        const el = await page.$(".usl-panel");
        appeared = !!el;
        panelText = el ? await page.$eval(".usl-panel", (e) => e.innerText) : "(panel correctly suppressed)";
      } else
      try {
        await page.waitForSelector(".usl-panel", { timeout: 30000 });
        appeared = true;
        // Give renderPanel a beat to fold in the connection row / list update.
        await page.waitForTimeout(2500);
        // For the fallback case, the per-flight badges arrive after a second
        // round trip (route data, then predict-flight) — wait for a real %.
        if (c.awaitBadge) {
          try {
            await page.waitForFunction((src) => {
              const re = new RegExp(src);
              return [...document.querySelectorAll(".usl-badge")].some((b) => re.test(b.textContent));
            }, c.awaitBadge.source, { timeout: 25000 });
          } catch (e) { /* asserted below via badges */ }
        }
        if (c.awaitPanel) {
          try {
            await page.waitForFunction((src) => {
              const el = document.querySelector(".usl-panel");
              return el && new RegExp(src).test(el.innerText);
            }, c.awaitPanel.source, { timeout: 10000 });
          } catch (e) { /* asserted below via panelText */ }
        }
        panelText = await page.$eval(".usl-panel", (el) => el.innerText);
      } catch (e) { panelText = "(panel never rendered: " + String(e.message || e) + ")"; }

      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      // Optional DOM probe (e.g. the sorted row order) evaluated in the page.
      const probe = c.probe ? await page.evaluate(c.probe).catch(() => null) : null;
      const shot = join(SHOTS, c.name + ".png");
      try { await page.screenshot({ path: shot, fullPage: true }); } catch (e) {}

      const checks = c.expectNoPanel
        ? { panelSuppressed: !appeared }
        : c.expect(panelText, badges, probe);
      results.push({ name: c.name, route: `${c.o}→${c.d}`, appeared, expectNoPanel: !!c.expectNoPanel, panelText, badges, probe, checks, shot });
      process.stderr.write(`  ${c.name}: panel ${appeared ? "rendered" : (c.expectNoPanel ? "suppressed (OK)" : "MISSING")} · ${JSON.stringify(checks)}\n`);
    }

    writeReport({ swUrl, consoleErrors, results });

    // RELEASE GATE (Codex #5 + #P1-03): a report is not a gate, and its truth
    // contract must be complete. EVERY check must be exactly boolean `true` — a
    // check that is false, null, undefined, a string, or anything else is a
    // failure, not a pass. (Captured values, if any, belong outside `checks`.)
    const failedChecks = results.filter((r) =>
      (r.expectNoPanel ? false : !r.appeared) || Object.values(r.checks).some((v) => v !== true));
    const reasons = [];
    if (!swUrl) reasons.push("service worker not detected");
    if (consoleErrors.length) reasons.push(consoleErrors.length + " console error(s)");
    for (const r of failedChecks)
      reasons.push(`${r.name} ${r.appeared ? "failed a check" : "panel MISSING"}`);
    if (reasons.length) {
      process.stderr.write("\nE2E GATE: FAIL — " + reasons.join("; ") + "\n");
      process.exitCode = 1;
    } else {
      process.stderr.write("\nE2E GATE: PASS — all cases, SW present, no console errors\n");
    }
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
