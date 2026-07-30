// phase2-e2e.mjs — real-browser end-to-end for the extension's DISPLAY.
//
// Loads extension/ UNPACKED into Chrome for Testing via a Playwright persistent
// context, then drives the united.com / Navan content script and reads the
// panel/badges it actually renders.
//
// DETERMINISM (Round-18 P2): the Starlink tracker is no longer contacted live.
// Every tracker endpoint (/mcp, /api/predict-flight, /api/plan-route) is
// FULFILLED from a fixed per-case fixture, so odds are constant run-to-run and
// the gate no longer breaks when a live percentage drifts (68% vs 71%). United
// and Navan document requests are fulfilled locally too, so neither real site is
// ever hit. A negative-control mutation (E2E_NEG=1) reintroduces a known
// regression into a temp COPY of the extension and must make the gate exit 1.
//
// POLITENESS + SAFETY, by construction:
//   · united.com / app.navan.com are never really contacted (context.route
//     FULFILLS with a local fixture) and neither is the tracker.
//   · Playwright resolves from ~/.wo-respo/node_modules; nothing is added here.
//
// Output: test/out/phase2-report.md + screenshots in test/out/shots/.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire("/Users/jeremysmith/.wo-respo/");
const { chromium } = require("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_SRC = join(HERE, "..", "extension");
const OUT = join(HERE, "out");
const SHOTS = join(OUT, "shots");

// Load the extension from a temp COPY so the negative-control mutation can
// reintroduce a known regression WITHOUT ever touching the tracked source.
const EXT = join(tmpdir(), "usl-ext-" + Date.now());
cpSync(EXT_SRC, EXT, { recursive: true });
const NEG = !!process.env.E2E_NEG;
if (NEG) {
  const cf = join(EXT, "content.js");
  let src = readFileSync(cf, "utf8");
  // Reintroduce EXACTLY the audited Bug-3 defect: key "still loading" on the
  // periodic/DOM scan flag (~always true) instead of a genuine settlement
  // signal. This makes the Navan loading→terminal case never reach terminal.
  const anchor = "pendingPredict.size > 0 || navanHasUnresolved()";
  if (!src.includes(anchor)) {
    throw new Error("E2E_NEG: mutation anchor not found — harness and content.js are out of sync");
  }
  src = src.replace(anchor, "scanScheduled");
  writeFileSync(cf, src);
  process.stderr.write("E2E_NEG: injected Bug-3 regression (navanLoading keyed on scanScheduled)\n");
}

// A future date keeps the panel in "odds" mode (no firm-tail ✓ that needs a
// near date) and never goes stale. ~30 days out.
function farDate() {
  const d = new Date(Date.now() + 30 * 864e5);
  return d.toISOString().slice(0, 10);
}
// A near date so confirmed-tail ✓s (which only publish ~48h out and only show
// when the searched date is within ~3 days) are RELEVANT — used by the
// sample-size + confirmed-tail case.
function isoDaysFromNow(n) {
  return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
}

// Minimal united.com results fixture. Only the URL query params drive the route
// context; `rows` inject "United ####" text (with a clock time) for the badges.
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
// United rows match FN_RE. `topHtml` injects a NON-result structural sibling
// (a result-tools/notice block, no clock time) as the container's first child,
// to prove the reorder never moves it. Route context comes from the DOM.
function navanFixture({ o, d, rows = [], topHtml = "" }) {
  const rowHtml = rows.map((r) =>
    `<div class="flight-card" style="padding:12px;border-bottom:1px solid #ccc">
       <span class="flight-card-info__airline__number">${r.label}</span> ·
       <span class="tm">${r.time}</span> — ${o} to ${d}
     </div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Navan — Departure Flights</title></head>
    <body style="font-family:sans-serif;padding:24px">
    <div class="flight-header__route">${o} → ${d}</div>
    <p>Depart from ${o}</p>
    <div id="results">${topHtml}${rowHtml || "<p>No flights</p>"}</div>
    </body></html>`;
}

// Page-evaluated probe: the results container's child order, each child labelled
// "UA####" (a United row), "OTHER"/"FRONTIER1229"… (an unscored flight), or
// "STRUCT" (a non-flight sibling — no clock time). Mirrors content.js's
// findContainer + isFlightUnit so the harness reads what the user would see.
function orderProbe() {
  const FN_RE = /\b(?:UA|United)\s?(\d{2,4})\b/;
  const GEN = /\b(?:[A-Z]{2,3}|[A-Z][a-zA-Z]{3,})\s?\d{2,4}\b/;
  const TIME = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/i;
  const badge = document.querySelector(".usl-badge");
  let best = null, bestScore = 0, e = badge ? badge.parentElement : null;
  for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
    const fns = [...e.children].map((k) => ((k.textContent || "").match(FN_RE) || [])[1]).filter(Boolean);
    const dd = new Set(fns).size;
    if (dd > bestScore) { bestScore = dd; best = e; }
  }
  if (!best) return { order: [], found: false };
  const order = [...best.children].map((k) => {
    const t = k.textContent || "";
    if (!(TIME.test(t) && GEN.test(t))) return "STRUCT";
    const m = t.match(FN_RE);
    if (m) return "UA" + m[1];
    const g = t.match(GEN);
    return g ? g[0].replace(/\s+/g, "").toUpperCase() : "OTHER";
  });
  return { order, found: true };
}

// Flight-row order probe that mirrors content.js's ROUND-19 findContainer:
// score each ancestor by how many validated flight-result rows (any carrier) it
// holds, pick the richest, require ≥2. Unlike orderProbe (which scores by
// distinct UNITED rows) this resolves the container even with a single United
// row among other-carrier rows — the case the Round-19 fix is about.
function flightOrderProbe() {
  const FN_RE = /\b(?:UA|United)\s?(\d{2,4})\b/;
  const GEN = /\b(?:[A-Z]{2,3}|[A-Z][a-zA-Z]{3,})\s?\d{2,4}\b/;
  const TIME = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/i;
  const isFlightUnit = (el) => { const t = el.textContent || ""; return TIME.test(t) && GEN.test(t); };
  const badge = document.querySelector(".usl-badge");
  if (!badge) return { order: [], found: false };
  let best = null, bestScore = 0, e = badge.parentElement;
  for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
    const flights = [...e.children].filter(isFlightUnit).length;
    if (flights > bestScore) { bestScore = flights; best = e; }
  }
  if (!best || bestScore < 2) return { order: [], found: false };
  const order = [...best.children].map((k) => {
    const t = k.textContent || "";
    if (!isFlightUnit(k)) return "STRUCT";
    const m = t.match(FN_RE);
    if (m) return "UA" + m[1];
    const g = t.match(GEN);
    return g ? g[0].replace(/\s+/g, "").toUpperCase() : "OTHER";
  });
  return { order, found: true };
}

// Late-batch fixture: 26 United rows so the 26th (UA6026, the highest score)
// resolves in a SECOND worker call, beyond the 25-per-call cap. Everything else
// is a low 10%.
const LATE_ROWS = [];
const LATE_PREDICT = {};
for (let i = 1; i <= 26; i++) {
  const n = 6000 + i;
  LATE_ROWS.push({ label: "United " + n, time: "8:" + ("0" + i).slice(-2) + " a.m." });
  LATE_PREDICT["UA" + n] = i === 26 ? 0.90 : 0.10;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CASES = [
  {
    // LAX→EWR: a transcon with no DIRECT Starlink history but a real connection.
    name: "LAX-EWR-empty-with-connection",
    o: "LAX", d: "EWR", rows: [],
    mock: {
      o: "LAX", d: "EWR", route: [], predict: {},
      itins: [{
        via: ["DEN"], joint: 0.55, any: 0.80, coverage: "full", hours: 5.5,
        legs: [
          { flight_number: "UA111", route: "LAX-DEN", probability: 0.70, n_observations: 20 },
          { flight_number: "UA222", route: "DEN-EWR", probability: 0.79, n_observations: 20 },
        ],
      }],
    },
    expect: (txt) => ({
      newEmptyCopy: /No direct-flight Starlink history yet\. Connection estimate below\./.test(txt),
      oldContradictionGone: !/No Starlink history on this route yet\./.test(txt),
      connectionLabelled: /all-legs estimate/.test(txt),
      connectionPctShown: /all-legs estimate\s*\d+%/.test(txt),
    }),
  },
  {
    // SFO→DEN: a narrowbody hub route. Positive control that the normal path
    // still displays a ranked direct list with the page's top flight first.
    name: "SFO-DEN-positive",
    o: "SFO", d: "DEN",
    rows: [{ num: 1596, time: "8:30 a.m." }, { num: 1214, time: "11:05 a.m." }],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 50, conf: "high" },
        { fn: "UA1214", prob: 30, obs: 40, conf: "medium" },
      ],
      predict: { "UA1596": 0.68, "UA1214": 0.30 }, itins: [],
    },
    expect: (txt) => ({
      listsUA1596: /UA1596/.test(txt),
      ua1596RanksFirst: /⭐\s*UA1596/.test(txt),
      noEmptyCopy: !/No direct-flight Starlink history/.test(txt),
      // v2.3 decision strip: two scored flights, a decisive 38-pt lead → crown
      // UA1596 and show its lead, the winner's observation count, and confidence.
      stripCrownsWinner: /Best WiFi:\s*UA1596/.test(txt),
      stripShowsLead: /leads by 38 pts/.test(txt),
      stripShowsWinnerObs: /50 departures observed/.test(txt),
      stripShowsConfidence: /high confidence/.test(txt),
    }),
  },
  {
    // v2.3 (a): CONFIDENCE ON THE BADGE. A near date (so confirmed tails are
    // relevant) plus a confirmed-departure fixture for UA1596. The badge must
    // carry the sample size the tracker returned (obs 51 → "· 51 flights") AND
    // the confirmed-tail ✓ together, and the panel row must echo the sample size.
    name: "united-confirmed-tail-sample-size",
    o: "SFO", d: "DEN", dateOffsetDays: 1,
    rows: [{ num: 1596, time: "8:30 a.m." }, { num: 1214, time: "11:05 a.m." }],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 51, conf: "high" },
        { fn: "UA1214", prob: 30, obs: 40, conf: "medium" },
      ],
      predict: { "UA1596": 0.68, "UA1214": 0.30 },
      deps: [{ fn: "UA1596", o: "SFO", d: "DEN", date: isoDaysFromNow(1), time: "09:00", tail: "N127UA" }],
      itins: [],
    },
    awaitBadge: /🛰️\s*68%.*✓/,
    expect: (txt, badges) => {
      const joined = badges.join(" ");
      return {
        badgeShowsSampleSize: /68%\s*·\s*51 flights/.test(joined),
        badgeShowsConfirmedTail: badges.some((b) => /68%.*✓/.test(b)),
        badgeSampleAndTailTogether: badges.some((b) => /68%\s*·\s*51 flights\s*✓/.test(b)),
        panelRowShowsSampleSize: /51 flights/.test(txt),
      };
    },
  },
  {
    // v2.3 (b) REFUSAL — gap too small. Two scored flights 41% vs 36% (5 pts,
    // under the 8-pt floor). The strip must NOT crown a winner; it must say the
    // top options are close, and never print "Best WiFi:".
    name: "united-decision-strip-close",
    o: "SFO", d: "LAS",
    rows: [{ num: 700, time: "8:30 a.m." }, { num: 701, time: "11:05 a.m." }],
    mock: {
      o: "SFO", d: "LAS",
      route: [
        { fn: "UA700", prob: 41, obs: 40, conf: "high" },
        { fn: "UA701", prob: 36, obs: 38, conf: "high" },
      ],
      predict: { "UA700": 0.41, "UA701": 0.36 }, itins: [],
    },
    awaitBadge: /🛰️\s*41%/,
    expect: (txt) => ({
      saysClose: /Top options are close — no clear WiFi winner/.test(txt),
      explainsWhy: /within 5 pts/.test(txt),
      noWinnerCrowned: !/Best WiFi:/.test(txt),
    }),
  },
  {
    // v2.3 (b) REFUSAL — only one scored flight. UA800 scored (55%); UA801 has
    // no tracker history (settles to n/a), so nothing to compare. The strip must
    // say "Only one scored flight" and never crown a winner.
    name: "united-decision-strip-one-scored",
    o: "SFO", d: "PDX",
    rows: [{ num: 800, time: "8:30 a.m." }, { num: 801, time: "11:05 a.m." }],
    mock: {
      o: "SFO", d: "PDX",
      route: [{ fn: "UA800", prob: 55, obs: 42, conf: "high" }],
      predict: { "UA800": 0.55, "UA801": null }, itins: [],
    },
    awaitBadge: /🛰️\s*55%/,
    expect: (txt) => ({
      saysOnlyOne: /Only one scored flight/.test(txt),
      noWinnerCrowned: !/Best WiFi:/.test(txt),
      noFalseCloseCopy: !/Top options are close/.test(txt),
    }),
  },
  {
    // v2.2 per-flight fallback on an EMPTY route: odds come from predict-flight,
    // keyed on the flight number, not the route table. Deterministic 16% / 68%.
    name: "united-fallback-real-odds",
    o: "SFO", d: "SIN",
    rows: [{ num: 2402, time: "2:15 p.m." }, { num: 1596, time: "10:30 a.m." }],
    mock: { o: "SFO", d: "SIN", route: [], predict: { "UA2402": 0.16, "UA1596": 0.68 }, itins: [] },
    awaitBadge: /🛰️\s*\d+%/,
    awaitPanel: /UA(2402|1596)/,
    expect: (txt, badges) => {
      const joined = badges.join(" ");
      return {
        ua2402RealOdds: /🛰️\s*16%/.test(joined),
        ua1596RealOdds: /🛰️\s*68%/.test(joined),
        panelListsFlights: /UA(2402|1596)/.test(txt),
        noEmptyStateContradiction: !/No direct-flight Starlink history for this route yet\./.test(txt),
        noBareNa: !badges.some((b) => /^🛰️ n\/a$/.test(b.trim())),
      };
    },
  },
  {
    // A full tracker outage must say "unavailable", never a false absence.
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
    // Bug 4 (explicit action). A mixed-carrier list WITH a non-result sibling,
    // scored United rows, an n/a United row, and unscored other-carrier rows.
    //  · BEFORE activation: the page's order is UNCHANGED (default no reorder).
    //  · AFTER activation (via KEYBOARD): only validated flight rows move —
    //    scored United descend by odds, all unscored flight rows keep their
    //    relative order, the structural sibling never moves, n/a is not "worse"
    //    than a scored flight (it just follows).
    //  · A Navan RERENDER that lifts a Frontier row above United is re-corrected.
    name: "navan-prioritize-explicit-action",
    navan: true, o: "DEN", d: "SFO",
    topHtml: `<div class="results-tools" style="padding:12px;border-bottom:1px solid #ccc">Sort &amp; filter results</div>`,
    rows: [
      { label: "Frontier 1229", time: "8:59 a.m." },
      { label: "United 1596", time: "8:30 a.m." },
      { label: "United 3999", time: "7:45 a.m." },
      { label: "Frontier 3435", time: "6:55 a.m." },
      { label: "United 2402", time: "2:15 p.m." },
    ],
    mock: { o: "DEN", d: "SFO", predict: { "UA1596": 0.68, "UA2402": 0.16, "UA3999": null } },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll(".usl-badge")].map((x) => x.textContent || "");
        return b.some((t) => /68%/.test(t)) && b.some((t) => /16%/.test(t)) && !!document.querySelector(".usl-prioritize");
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(700);
      const pre = await page.evaluate(orderProbe);
      // Activate via KEYBOARD to prove the action is keyboard-operable/focusable.
      await page.focus(".usl-prioritize");
      const focused = await page.evaluate(() =>
        !!(document.activeElement && document.activeElement.classList.contains("usl-prioritize")));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      const post = await page.evaluate(orderProbe);
      // Past the post-sort debounce window, simulate a Navan rerender: lift the
      // first Frontier row above United (United's own relative order preserved).
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        const FN_RE = /\b(?:UA|United)\s?(\d{2,4})\b/;
        let best = null, bestScore = 0, e = document.querySelector(".usl-badge");
        e = e ? e.parentElement : null;
        for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
          const f = [...e.children].map((k) => ((k.textContent || "").match(FN_RE) || [])[1]).filter(Boolean);
          const d = new Set(f).size;
          if (d > bestScore) { bestScore = d; best = e; }
        }
        if (!best) return;
        const kids = [...best.children];
        const front = kids.find((k) => /Frontier/i.test(k.textContent || ""));
        const firstFlight = kids.find((k) => FN_RE.test(k.textContent || ""));
        if (front && firstFlight && front !== firstFlight) best.insertBefore(front, firstFlight);
      });
      await page.waitForTimeout(2600);
      const corrected = await page.evaluate(orderProbe);
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      const P = pre.order, Q = post.order, C = corrected.order;
      const checks = {
        keyboardActivated: focused === true,
        preOrderUnchanged: eq(P, ["STRUCT", "FRONTIER1229", "UA1596", "UA3999", "FRONTIER3435", "UA2402"]),
        afterStructFirst: Q[0] === "STRUCT",
        afterScoredUnitedFirstTwo: Q[1] === "UA1596" && Q[2] === "UA2402",
        afterUnscoredKeepRelOrder: eq(Q.slice(3), ["FRONTIER1229", "UA3999", "FRONTIER3435"]),
        naFollowsScored: Q.indexOf("UA3999") > Q.indexOf("UA2402"),
        rerenderStructUnmoved: C[0] === "STRUCT",
        rerenderReCorrected: C[1] === "UA1596" && C[2] === "UA2402",
      };
      return { appeared: true, panelText, badges, probe: { pre: P, post: Q, corrected: C }, checks };
    },
  },
  {
    // Bug 4, batch beyond 25: 26 United rows; UA6026 (90%) resolves in a SECOND
    // worker call. While the action is active it must rerank and float UA6026 to
    // the top when its late score settles.
    name: "navan-prioritize-late-batch",
    navan: true, o: "DEN", d: "SFO",
    rows: LATE_ROWS,
    mock: { o: "DEN", d: "SFO", predict: LATE_PREDICT },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForFunction(() =>
        !!document.querySelector(".usl-prioritize") &&
        [...document.querySelectorAll(".usl-badge")].filter((b) => /\d+%/.test(b.textContent || "")).length >= 2,
        null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.click(".usl-prioritize");
      let floated = false;
      try {
        await page.waitForFunction(() => {
          const FN_RE = /\b(?:UA|United)\s?(\d{2,4})\b/;
          let best = null, bestScore = 0, e = document.querySelector(".usl-badge");
          e = e ? e.parentElement : null;
          for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
            const f = [...e.children].map((k) => ((k.textContent || "").match(FN_RE) || [])[1]).filter(Boolean);
            const d = new Set(f).size;
            if (d > bestScore) { bestScore = d; best = e; }
          }
          if (!best) return false;
          const first = [...best.children].find((k) =>
            /\d{1,2}:\d{2}\s?[ap]\.?m\.?/i.test(k.textContent || "") && FN_RE.test(k.textContent || ""));
          return !!first && /\b(?:UA|United)\s?6026\b/.test(first.textContent || "");
        }, null, { timeout: 35000 });
        floated = true;
      } catch (e) {}
      const probe = await page.evaluate(orderProbe);
      const firstFlight = (probe.order || []).filter((x) => x !== "STRUCT")[0];
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return {
        appeared: true, panelText, badges, probe,
        checks: { highScoreFloatedTopAfterLateBatch: floated, firstFlightIsUA6026: firstFlight === "UA6026" },
      };
    },
  },
  {
    // Bug 3: two United rows, deterministic DELAYED recognized-no-data (HTTP 200)
    // responses. The panel must SUPPRESS first, show loading ONLY while the
    // requests are actually pending, then reach the truthful terminal empty copy.
    // If loading persisted after pendingPredict drained (the audited bug), the
    // terminal wait times out and this case fails — which is exactly what the
    // E2E_NEG mutation demonstrates.
    name: "navan-loading-then-terminal",
    navan: true, o: "DEN", d: "SFO",
    rows: [{ label: "United 1596", time: "8:30 a.m." }, { label: "United 2777", time: "9:15 a.m." }],
    mock: { o: "DEN", d: "SFO", predict: { "UA1596": null, "UA2777": null }, predictDelayMs: 2600 },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      let sawLoading = false;
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector(".usl-panel");
          return !!el && /Checking this page's flights/.test(el.innerText);
        }, null, { timeout: 12000 });
        sawLoading = true;
      } catch (e) {}
      let reachedTerminal = false;
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector(".usl-panel");
          return !!el && /No direct-flight Starlink history for this route yet\./.test(el.innerText);
        }, null, { timeout: 20000 });
        reachedTerminal = true;
      } catch (e) {}
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "(no panel)");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return {
        appeared: true, panelText, badges, probe: null,
        checks: {
          sawLoadingWhilePending: sawLoading,
          reachedTerminalEmpty: reachedTerminal,
          notStuckLoading: !/Checking this page's flights/.test(panelText),
        },
      };
    },
  },
  {
    // Bug 3 negative: an all-other-carrier list (no United rows). The panel must
    // be SUPPRESSED entirely — never the "no history" copy when there are simply
    // no United flights to read.
    name: "navan-no-united-suppressed",
    navan: true, o: "DEN", d: "SFO", expectNoPanel: true,
    mock: { o: "DEN", d: "SFO", predict: {} },
    rows: [
      { label: "Frontier 1229", time: "8:59 a.m." },
      { label: "Frontier 3435", time: "6:55 a.m." },
      { label: "Southwest 4785", time: "7:20 a.m." },
    ],
    expect: () => ({}),
  },
  {
    // ROUND-19 FIX 1: per-flight HTTP failures must be BOUNDED by the 4-attempt
    // ledger, not retried forever. One genuine no-data United flight (200→null)
    // and one that always answers HTTP 500. The 500 flight must be requested AT
    // MOST 4 times (backoffs 3s/8s/20s), then go terminal, and the panel must
    // settle to "Direct-flight history unavailable right now." while the no-data
    // flight settles to n/a. The audited bug requested the 500 flight 18× in 15s
    // and never left "Checking this page's flights…" — content.js read the
    // dropped-`undefined` result as an un-attempted 25-cap miss.
    name: "navan-http-failure-bounded",
    navan: true, o: "DEN", d: "SFO",
    rows: [{ label: "United 1596", time: "8:30 a.m." }, { label: "United 2777", time: "9:15 a.m." }],
    mock: { o: "DEN", d: "SFO", predict: { "UA1596": null, "UA2777": { http: 500 } } },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      // Terminal only after the 4th (final) attempt exhausts the ledger; the
      // cumulative backoff is 3+8+20 ≈ 31s plus scan jitter, so allow 60s.
      let reachedTerminal = false;
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector(".usl-panel");
          return !!el && /Direct-flight history unavailable right now\./.test(el.innerText);
        }, null, { timeout: 60000 });
        reachedTerminal = true;
      } catch (e) {}
      const at2777 = PREDICT_HITS["UA2777"] || 0;
      // Prove no request fires after the terminal state: sample, wait, resample.
      await page.waitForTimeout(5000);
      const after2777 = PREDICT_HITS["UA2777"] || 0;
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "(no panel)");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return {
        appeared: true, panelText, badges,
        probe: { ua2777Requests: at2777, ua2777AfterTerminal: after2777, ua1596Requests: PREDICT_HITS["UA1596"] || 0 },
        checks: {
          reachedTerminalUnavailable: reachedTerminal,
          ua2777Attempted: at2777 >= 1,
          ua2777AtMost4Attempts: at2777 <= 4,
          noRequestAfterTerminal: after2777 === at2777,
          noDataFlightSettlesNa: badges.some((b) => /^🛰️ n\/a$/.test(b.trim())),
          notStuckLoading: !/Checking this page's flights/.test(panelText),
        },
      };
    },
  },
  {
    // ROUND-19 FIX 2 (case 1): ONE scored United row is enough for Prioritize.
    // Order [Frontier 1229, United 1596 (68%), Frontier 3435] → activating floats
    // United 1596 into the first flight slot; the two Frontier rows keep their
    // relative order. The old bug required ≥2 United rows in findContainer AND
    // ≥2 scored rows in sortPage, so this page reordered by zero bytes.
    name: "navan-prioritize-one-scored-united",
    navan: true, o: "DEN", d: "SFO",
    rows: [
      { label: "Frontier 1229", time: "8:59 a.m." },
      { label: "United 1596", time: "8:30 a.m." },
      { label: "Frontier 3435", time: "6:55 a.m." },
    ],
    mock: { o: "DEN", d: "SFO", predict: { "UA1596": 0.68 } },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll(".usl-badge")].map((x) => x.textContent || "");
        return b.some((t) => /68%/.test(t)) && !!document.querySelector(".usl-prioritize");
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(700);
      const pre = await page.evaluate(flightOrderProbe);
      await page.click(".usl-prioritize");
      await page.waitForTimeout(900);
      const post = await page.evaluate(flightOrderProbe);
      const pressed = await page.$eval(".usl-prioritize", (b) => b.getAttribute("aria-pressed"));
      const label = await page.$eval(".usl-prioritize", (b) => b.textContent.trim());
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      const P = pre.order, Q = post.order;
      return {
        appeared: true, panelText, badges, probe: { pre: P, post: Q },
        checks: {
          containerFoundWithOneUnited: pre.found === true,
          preOrderUnchanged: eq(P, ["FRONTIER1229", "UA1596", "FRONTIER3435"]),
          oneScoredUnitedFloatsFirst: Q[0] === "UA1596",
          frontiersKeepRelOrder: eq(Q.slice(1), ["FRONTIER1229", "FRONTIER3435"]),
          buttonClaimsActiveTruthfully: pressed === "true" && /Prioritizing United/.test(label),
        },
      };
    },
  },
  {
    // ROUND-19 FIX 2 (case 2, truthfulness): with ZERO scored United rows the
    // Prioritize button must NOT claim an active prioritization. Route history
    // offers a ghost UA1596 (so the panel renders the button), but the two
    // on-page United rows both answer HTTP 500 and settle to terminal
    // "unavailable" — nothing scored to float. Activating must leave the page
    // order byte-identical and the button truthful, never "✓ Prioritizing".
    name: "united-prioritize-no-scored-truthful",
    o: "DEN", d: "SFO",
    rows: [{ num: 2777, time: "9:15 a.m." }, { num: 3888, time: "7:40 a.m." }],
    mock: {
      o: "DEN", d: "SFO",
      route: [{ fn: "UA1596", prob: 68, obs: 50, conf: "high" }],
      predict: { "UA2777": { http: 500 }, "UA3888": { http: 500 } }, itins: [],
    },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      // The button surfaces only once the two on-page United rows exhaust their
      // ledgers and register as terminal "unavailable" rows (~31s of backoffs);
      // the panel HTML already carries the button (hidden) via the route ghost.
      await page.waitForFunction(() => {
        const b = document.querySelector(".usl-prioritize");
        return !!b && getComputedStyle(b).display !== "none";
      }, null, { timeout: 60000 }).catch(() => {});
      const visible = await page.evaluate(() => {
        const b = document.querySelector(".usl-prioritize");
        return !!b && getComputedStyle(b).display !== "none";
      });
      const pre = await page.evaluate(flightOrderProbe);
      await page.click(".usl-prioritize").catch(() => {});
      await page.waitForTimeout(900);
      const post = await page.evaluate(flightOrderProbe);
      const pressed = await page.$eval(".usl-prioritize", (b) => b.getAttribute("aria-pressed")).catch(() => null);
      const label = await page.$eval(".usl-prioritize", (b) => b.textContent.trim()).catch(() => "");
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return {
        appeared: true, panelText, badges, probe: { pre: pre.order, post: post.order },
        checks: {
          buttonVisibleWithNoScoredUnited: visible === true,
          orderUnchangedAfterClick: eq(pre.order, post.order),
          buttonDoesNotClaimActive: pressed === "false" && !/Prioritizing United/.test(label),
        },
      };
    },
  },
];

// ── deterministic tracker fixtures ─────────────────────────────────────────
// MOCK/trackerFail are swapped in per case; the route handlers below read them.
let MOCK = {};
let trackerFail = false;
// Per-flight predict-flight request tally (reset per case). Drivers read it to
// prove the 4-attempt ledger bounds a repeatedly-failing flight (Round-19 FIX 1).
let PREDICT_HITS = {};

function mcpBody(text) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
}
function routeTableText(mock) {
  const rows = mock.route || [];
  if (!rows.length) return "No direct Starlink flights on this route.";
  return rows.map((r) =>
    `${r.fn} [OK] (${mock.o}-${mock.d}) ${r.prob}% (${r.obs || 0} obs · ${r.conf || "low"} confidence)`).join("\n");
}
// Confirmed-departure lines in the exact shape bg.js parseDeps() expects, so a
// case can exercise the confirmed-tail ✓ deterministically. Empty by default.
function depsText(mock) {
  const deps = mock.deps || [];
  if (!deps.length) return ""; // no confirmed departures
  return deps.map((x) =>
    `${x.fn} ${x.o}→${x.d} dep ${x.date} ${x.time}Z (tail ${x.tail})`).join("\n");
}

async function fulfillTracker(route) {
  if (trackerFail) {
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"down"}' });
  }
  const req = route.request();
  let u;
  try { u = new URL(req.url()); } catch (e) { return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); }

  if (u.pathname === "/api/predict-flight") {
    const fn = (u.searchParams.get("flight_number") || "").toUpperCase();
    PREDICT_HITS[fn] = (PREDICT_HITS[fn] || 0) + 1;   // tally attempts per flight
    if (MOCK.predictDelayMs) await new Promise((r) => setTimeout(r, MOCK.predictDelayMs));
    const tbl = MOCK.predict || {};
    if (Object.prototype.hasOwnProperty.call(tbl, fn)) {
      const v = tbl[fn];
      // {http:<code>} → an HTTP error the worker must treat as an ATTEMPTED
      // transient failure (message-safe sentinel), NOT a genuine n/a. Used to
      // prove the 4-attempt ledger caps a repeatedly-500ing flight (FIX 1).
      if (v && typeof v === "object" && v.http) {
        return route.fulfill({ status: v.http, contentType: "application/json", body: '{"error":"server"}' });
      }
      if (v === null) {
        // Recognized no-data schema → a genuine, negative-cacheable n/a.
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ flight_number: fn, confidence: "type", message: "determined by aircraft type" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ probability: v, n_observations: 50, confidence: "high" }) });
    }
    // Unknown flight → recognized no-data (n/a) by default.
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ flight_number: fn, confidence: "type", message: "no data" }) });
  }

  if (u.pathname === "/api/plan-route") {
    const its = (MOCK.itins || []).map((it) => ({
      via: it.via, joint_probability: it.joint, at_least_one_probability: it.any,
      coverage: it.coverage, total_flight_hours: it.hours, legs: it.legs || [],
    }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ itineraries: its }) });
  }

  if (u.pathname === "/mcp") {
    let name = "";
    try { name = JSON.parse(req.postData() || "{}").params.name; } catch (e) {}
    let text = "";
    if (name === "predict_route_starlink") text = routeTableText(MOCK);
    else if (name === "search_starlink_flights") text = depsText(MOCK); // confirmed departures (per-case)
    else if (name === "check_flight") text = "assignment not yet published";
    return route.fulfill({ status: 200, contentType: "application/json", body: mcpBody(text) });
  }

  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
}

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const userDataDir = join(tmpdir(), "usl-e2e-" + Date.now());
  const results = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      // MV3 service workers load reliably in headed Chromium for Testing here;
      // the harness never shows a window long (each page is driven and closed).
      headless: false,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) { try { sw = await context.waitForEvent("serviceworker", { timeout: 8000 }); } catch (e) {} }
    const swUrl = sw ? sw.url() : null;

    // Fulfill EVERY united.com / Navan document request with our fixture.
    let currentFixture = "";
    await context.route(/https:\/\/(www\.)?united\.com\/.*/, (route) => {
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: currentFixture });
    });
    await context.route(/https:\/\/app\.navan\.com\/.*/, (route) => {
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: currentFixture });
    });
    // Tracker is fully mocked (deterministic) — never contacted live.
    await context.route(/https:\/\/unitedstarlinktracker\.com\/.*/, fulfillTracker);

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    for (const c of CASES) {
      currentFixture = c.navan
        ? navanFixture({ o: c.o, d: c.d, rows: c.rows, topHtml: c.topHtml })
        : fixture({ o: c.o, d: c.d, rows: c.rows });
      trackerFail = !!c.trackerFail;
      MOCK = c.mock || {};
      PREDICT_HITS = {};   // reset the per-flight attempt tally for this case
      // The persistent context shares chrome.storage.local across cases, so a
      // prior case's uslPrioritize/uslCollapsed would leak into the next. Reset
      // it before every case so each starts from the shipped defaults (nothing
      // reorders cross-carrier by default).
      if (sw) { try { await sw.evaluate(() => chrome.storage.local.clear()); } catch (e) {} }
      // Most cases search a far date (stable, no firm-tail ✓). A case may opt
      // into a near date (dateOffsetDays) to exercise the confirmed-tail path.
      const searchDate = c.dateOffsetDays != null ? isoDaysFromNow(c.dateOffsetDays) : farDate();
      const url = c.navan
        ? `https://app.navan.com/app/user2/search/flights-ngs/${c.o}-${c.d}-${searchDate}`
        : `https://www.united.com/en/us/fsr/choose-flights?f=${c.o}&t=${c.d}&d=${searchDate}&tt=1`;

      // Multi-step cases drive themselves.
      if (c.driver) {
        let r;
        try { r = await c.driver({ page, url }); }
        catch (e) { r = { appeared: false, panelText: "(driver error: " + String(e.message || e) + ")", badges: [], probe: null, checks: { driverThrew: false } }; }
        const shot = join(SHOTS, c.name + ".png");
        try { await page.screenshot({ path: shot, fullPage: true }); } catch (e) {}
        results.push({ name: c.name, route: `${c.o}→${c.d}`, appeared: r.appeared !== false, expectNoPanel: false, panelText: r.panelText || "", badges: r.badges || [], probe: r.probe || null, checks: r.checks, shot });
        process.stderr.write(`  ${c.name}: ${JSON.stringify(r.checks)}\n`);
        continue;
      }

      await page.goto(url, { waitUntil: "domcontentloaded" });

      let panelText = "", appeared = false;
      if (c.expectNoPanel) {
        await page.waitForTimeout(6000);
        const el = await page.$(".usl-panel");
        appeared = !!el;
        panelText = el ? await page.$eval(".usl-panel", (e) => e.innerText) : "(panel correctly suppressed)";
      } else
      try {
        await page.waitForSelector(".usl-panel", { timeout: 30000 });
        appeared = true;
        await page.waitForTimeout(2500);
        if (c.awaitBadge) {
          try {
            await page.waitForFunction((src) => {
              const re = new RegExp(src);
              return [...document.querySelectorAll(".usl-badge")].some((b) => re.test(b.textContent));
            }, c.awaitBadge.source, { timeout: 25000 });
          } catch (e) {}
        }
        if (c.awaitPanel) {
          try {
            await page.waitForFunction((src) => {
              const el = document.querySelector(".usl-panel");
              return el && new RegExp(src).test(el.innerText);
            }, c.awaitPanel.source, { timeout: 12000 });
          } catch (e) {}
        }
        panelText = await page.$eval(".usl-panel", (el) => el.innerText);
      } catch (e) { panelText = "(panel never rendered: " + String(e.message || e) + ")"; }

      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      const probe = c.probe ? await page.evaluate(c.probe).catch(() => null) : null;
      const shot = join(SHOTS, c.name + ".png");
      try { await page.screenshot({ path: shot, fullPage: true }); } catch (e) {}

      const checks = c.expectNoPanel ? { panelSuppressed: !appeared } : c.expect(panelText, badges, probe);
      results.push({ name: c.name, route: `${c.o}→${c.d}`, appeared, expectNoPanel: !!c.expectNoPanel, panelText, badges, probe, checks, shot });
      process.stderr.write(`  ${c.name}: panel ${appeared ? "rendered" : (c.expectNoPanel ? "suppressed (OK)" : "MISSING")} · ${JSON.stringify(checks)}\n`);
    }

    writeReport({ swUrl, consoleErrors, results });

    // RELEASE GATE: every check must be exactly boolean `true`.
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
    try { rmSync(EXT, { recursive: true, force: true }); } catch (e) {}
  }
}

function writeReport({ swUrl, consoleErrors, results }) {
  const L = [];
  L.push(`# Phase 2 — browser E2E (extension loaded, DETERMINISTIC tracker fixtures)`);
  L.push("");
  L.push(`Run: ${new Date().toISOString()}${NEG ? "  · NEGATIVE-CONTROL (E2E_NEG)" : ""}`);
  L.push(`Service worker: ${swUrl || "NOT DETECTED"}`);
  L.push(`Console errors during run: ${consoleErrors.length ? consoleErrors.length : "none"}`);
  if (consoleErrors.length) for (const e of consoleErrors.slice(0, 10)) L.push(`- \`${e}\``);
  L.push("");
  for (const r of results) {
    L.push(`## ${r.route} — ${r.name}`);
    L.push(`Panel rendered: **${r.appeared ? "yes" : "NO"}** · badges: ${r.badges.length ? r.badges.map((b) => "`" + b + "`").join(" ") : "none"}`);
    if (r.probe) L.push("Order probe: `" + JSON.stringify(r.probe) + "`");
    L.push("");
    L.push("Checks: `" + JSON.stringify(r.checks) + "`");
    L.push("");
    L.push("Panel text as rendered:");
    L.push("```");
    L.push(r.panelText);
    L.push("```");
    L.push(`Screenshot: \`${r.shot ? r.shot.replace(HERE + "/", "") : "(none)"}\``);
    L.push("");
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "phase2-report.md"), L.join("\n"));
  process.stderr.write(`\nwrote test/out/phase2-report.md\n`);
}

run().catch((e) => { console.error("FATAL", e); process.exit(1); });
