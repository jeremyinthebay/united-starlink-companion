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
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, existsSync, statSync } from "node:fs";
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
/* ── R23 mutation controls ───────────────────────────────────────────────────
 * Each named mutation reintroduces ONE regression into the temp COPY of the
 * extension (never the tracked source). The registry proves two things per
 * mutation: (1) the anchor still exists, so the mutation LANDS (a silently
 * unapplied mutation is a false pass — auditor evidence bar); (2) the gate
 * exits nonzero with the EXPECTED check named (asserted by mutation-matrix.mjs).
 * E2E_MUT=<name> applies one; E2E_NEG=1 is the legacy alias for bug3-loading. */
const MUTATIONS = {
  "bug3-loading": {
    file: "content.js",
    from: "pendingPredict.size > 0 || navanHasUnresolved()",
    to: "scanScheduled",
    expect: "navan-loading-then-terminal",
    note: "audited Bug-3: loading keyed on the ~always-true scan flag, never settles",
  },
  "missing-conf-eligible": {
    file: "content.js",
    from: 'if (conf !== "high" && conf !== "medium") return null;',
    to: "if (false) return null;",
    expect: "united-strip-lowgrade",
    note: "low/missing/unknown confidence becomes winner-eligible",
  },
  "false-confirm-token": {
    file: "content.js",
    from: "`<p class=\"usl-decision__confirm\">✓ Confirmed for ${esc(dep.date)}</p>` : \"\";",
    to: "`<p class=\"usl-decision__confirm\">✓ Confirmed for ${esc(dep.date)}</p>` : `<p class=\"usl-decision__confirm\">✓ Confirmed</p>`;",
    expect: "SFO-DEN-positive",
    note: "confirmation token rendered with NO confirmed-departure fact",
  },
  "b-unconfirmed-collapse": {
    file: "popup.js",
    from: 'label: "Cannot confirm Starlink"',
    to: 'label: "No Starlink ✗"',
    expect: "guard-popup-state-matrix",
    note: "B-unconfirmed collapsed into a confirmed negative",
  },
  "c-outage-collapse": {
    file: "popup.js",
    from: 'label: stale ? "Update unavailable" : "Awaiting assignment"',
    to: 'label: "Awaiting assignment"',
    expect: "guard-popup-state-matrix",
    note: "C-outage collapsed into awaiting-assignment",
  },
  "leak-best-ring": {
    file: "content.js",
    from: "function winnerFnOf(flights) { const w = eligibleWinner(flights); return w ? w.best.fn : null; }",
    to: "function winnerFnOf(flights) { const s = (flights || []).filter((f) => typeof f.prob === \"number\"); return s.length ? s[0].fn : null; }",
    expect: "united-decision-strip-close",
    note: "best ring/star binds to the bare max, not winner eligibility",
  },
  "rescue-suppress": {
    file: "bg.js",
    from: 'if (transition === "withdrawn" && lastPublishedStatus(trip) === "yes") return true;',
    to: "if (false) return true;",
    expect: "guard-pure-precedence",
    note: "A→C withdrawn no longer worsened; rescue suppressed",
  },
  "updated-today": {
    file: "content.js",
    from: 'evBits.push("Historical tracker odds");',
    to: 'evBits.push("Updated today");',
    expect: "SFO-DEN-positive",
    note: "freshness claim fabricated from nothing (R23 amendment forbids)",
  },
  "low-contrast": {
    file: "content.css",
    append: "\n.usl-panel .usl-decision__evidence{color:#232838 !important}\n",
    expect: "visual-contrast-geometry",
    note: "near-invisible evidence ink; the composited probe must catch it",
  },
  /* ── Codex round 26 mutation controls ─────────────────────────────────── */
  "mixed-auto-sort": {
    file: "content.js",
    from: 'sortMixed = v.uslSortMixed === "prioritize" ? "prioritize" : "preserve";',
    to: 'sortMixed = "prioritize";',
    expect: "navan-preserves-host-order",
    note: "mixed-carrier silently defaults to reordering — the rejected behaviour",
  },
  "settings-off-still-sorts": {
    file: "content.js",
    from: "if (!settingsReady || !SINGLE_HOST || !sortSingle) return;",
    to: "if (!settingsReady || !SINGLE_HOST) return;",
    expect: "united-autosort-off-respected",
    note: "single-carrier sort ignores a stored OFF and reranks anyway",
  },
  "unlabelled-badge": {
    file: "content.js",
    from: 'lab.textContent = def.label;',
    to: 'lab.textContent = "";',
    expect: "row-metrics-labelled",
    note: "the NEXT-GEN label is emptied — a bare percentage returns",
  },
  /* NOT IN THE MATRIX RUN, deliberately, and this is a COVERAGE GAP worth
   * stating rather than hiding. `fleet` / `announced` / `notinfleet` /
   * `nofleet` are four of the seven row states, and none of them can render on
   * any host the extension currently supports: united.com and Navan rows are
   * matched by a United-only flight regex, alaskaair.com by an Alaska-only one,
   * and both carriers are instrumented — so every row that gets a group takes
   * the per-flight path. Google Flights uses its own compact chip, not this
   * group. The states exist because Codex round 26 specified them and because a
   * third instrumented carrier would need them, but they are UNEXERCISED, and a
   * mutation that cannot be caught is a broken instrument, not a passing one. */
  "fleet-as-probability": {
    file: "content.js",
    from: 'if (entry.nextGenScore > 0) return { k: "fleet", value: share === 0 ? "<1%" : share + "%" };',
    to: 'if (entry.nextGenScore > 0) return { k: "prob", value: share + "%", hit: { prob: share } };',
    expect: "row-metrics-fleet-context",
    note: "airline fleet share impersonates a per-flight probability (UNREACHABLE state — see comment)",
  },
  "zero-for-unknown": {
    file: "content.js",
    from: 'if (instrumented) return { k: "nohistory" };',
    to: 'if (instrumented) return { k: "prob", value: "0%", hit: { prob: 0 } };',
    expect: "row-metrics-no-history",
    note: "an absence of history renders as a 0% probability",
  },
  "resolved-only-denominator": {
    file: "airlines.js",
    from: "const known = knownAircraft(entry);",
    to: "const known = knownAircraft(entry) - unresolvedAircraft(entry);",
    expect: "airline-data-parity",
    note: "the stale resolved-only denominator returns; airBaltic reads 100 not 51",
  },
};
const MUT = process.env.E2E_MUT || (process.env.E2E_NEG ? "bug3-loading" : "");
const NEG = !!MUT;
if (MUT) {
  const m = MUTATIONS[MUT];
  if (!m) throw new Error("E2E_MUT: unknown mutation " + MUT);
  const cf = join(EXT, m.file);
  let src = readFileSync(cf, "utf8");
  if (m.append) {
    src += m.append;
  } else {
    if (!src.includes(m.from)) {
      throw new Error("E2E_MUT " + MUT + ": anchor not found — harness and " + m.file + " are out of sync");
    }
    src = src.replace(m.from, m.to);
  }
  writeFileSync(cf, src);
  process.stderr.write("MUTATION LANDED " + MUT + " (" + m.note + ")\n");
}
// Optional case filter (used by mutation-matrix.mjs to keep each mutation run
// focused on the checks that must catch it; the clean run always runs ALL).
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;

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
  // Read the HOST's text only. The extension's own row label "NEXT-GEN 68%"
  // matches GEN as carrier "GEN" flight "68", so a probe reading textContent
  // reports GEN68 instead of UA1596 — the probe would then disagree with the
  // page for reasons that have nothing to do with the page.
  const HT = (el) => {
    let out = "";
    (function w(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) {
          let ours = false;
          if (c.classList) for (const k of c.classList) if (k.lastIndexOf("usl-", 0) === 0) { ours = true; break; }
          if (!ours) w(c);
        } else if (c.nodeType === 3) out += c.nodeValue;
      }
    })(el);
    return out;
  };
  const badge = document.querySelector(".usl-badge, .usl-metrics");
  let best = null, bestScore = 0, e = badge ? badge.parentElement : null;
  for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
    const fns = [...e.children].map((k) => (HT(k).match(FN_RE) || [])[1]).filter(Boolean);
    const dd = new Set(fns).size;
    if (dd > bestScore) { bestScore = dd; best = e; }
  }
  if (!best) return { order: [], found: false };
  const order = [...best.children].map((k) => {
    const t = HT(k);
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
  const HT = (el) => {
    let out = "";
    (function w(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) {
          let ours = false;
          if (c.classList) for (const k of c.classList) if (k.lastIndexOf("usl-", 0) === 0) { ours = true; break; }
          if (!ours) w(c);
        } else if (c.nodeType === 3) out += c.nodeValue;
      }
    })(el);
    return out;
  };
  const isFlightUnit = (el) => { const t = HT(el); return TIME.test(t) && GEN.test(t); };
  const badge = document.querySelector(".usl-badge, .usl-metrics");
  if (!badge) return { order: [], found: false };
  let best = null, bestScore = 0, e = badge.parentElement;
  for (let i = 0; i < 20 && e && e !== document.body; i++, e = e.parentElement) {
    const flights = [...e.children].filter(isFlightUnit).length;
    if (flights > bestScore) { bestScore = flights; best = e; }
  }
  if (!best || bestScore < 2) return { order: [], found: false };
  const order = [...best.children].map((k) => {
    const t = HT(k);
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

/* ── structured-strip probe (runs in-page for every standard case) ──────────
 * Reads the ONE decision component's semantic state, a11y attributes, CTA
 * presence, the on-page best ring, boundary count and the three-layer badge
 * groups — so every expect() can assert STRUCTURE, not only copy. */
function stripProbe() {
  const s = document.querySelector(".usl-decision");
  const grps = [...document.querySelectorAll(".usl-badge-grp")].map((g) => ({
    pill: (g.querySelector(".usl-badge") || {}).textContent || "",
    ev: (g.querySelector(".usl-ev") || {}).textContent || "",
    confirm: !!g.querySelector(".usl-confirm"),
    confirmLabel: (g.querySelector(".usl-confirm") ? g.querySelector(".usl-confirm").getAttribute("aria-label") : "") || "",
    aria: g.getAttribute("aria-label") || "",
  }));
  return {
    state: s ? (s.dataset.uslState || null) : null,
    busy: s ? s.getAttribute("aria-busy") : null,
    live: s ? s.getAttribute("aria-live") : null,
    label: s ? (s.getAttribute("aria-label") || "") : "",
    cta: !!(s && s.querySelector(".usl-decision__cta")),
    confirmInStrip: !!(s && s.querySelector(".usl-decision__confirm")),
    ring: !!document.querySelector(".usl-badge.usl-best"),
    boundaryCount: document.querySelectorAll(".usl-boundary").length,
    prioritizeBtn: !!document.querySelector(".usl-prioritize"),
    sects: [...document.querySelectorAll(".usl-sect")].map((e) => e.textContent || ""),
    grps,
    // v3.0 dual-metric row groups: the VISIBLE text (so an emptied label is
    // caught), the resolved state key, and the accessible sentence.
    metrics: [...document.querySelectorAll(".usl-metrics")].map((m) => ({
      text: (m.innerText || m.textContent || "").replace(/\s+/g, " ").trim(),
      state: m.dataset.ngState || null,
      aria: m.getAttribute("aria-label") || "",
      confirm: !!m.querySelector(".usl-confirm"),
      rampOnValue: !!m.querySelector(".usl-ng__value.usl-badge"),
    })),
  };
}

/* ── composited contrast probes (R23 P2-01) ─────────────────────────────────
 * pixelContrast screenshots the RENDERED element (opacity, gradients and
 * compositing included), decodes the pixels in-page via canvas, and returns
 * the WCAG ratio between the luminance extremes (p3 vs p97 — ink vs ground on
 * a text element). No token-table arithmetic anywhere. frameContrast compares
 * the element's outer border frame against its interior ground the same way. */
async function lumsOf(page, buf) {
  return await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const out = [];
    for (let i = 0; i < d.length; i += 4)
      out.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
    out.sort((a, b) => a - b);
    return { w: c.width, h: c.height, lums: out };
  }, buf.toString("base64"));
}
const pct = (arr, q) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(q * arr.length)))];
const ratio = (hi, lo) => (hi + 0.05) / (lo + 0.05);
async function pixelContrast(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  let buf;
  try { buf = await el.screenshot(); } catch (e) { return null; }
  const { lums } = await lumsOf(page, buf);
  if (!lums.length) return null;
  return ratio(pct(lums, 0.97), pct(lums, 0.03));
}
async function frameContrast(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  let buf;
  try { buf = await el.screenshot(); } catch (e) { return null; }
  return await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (x, y) => { const i = (y * c.width + x) * 4; return 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); };
    const frame = [], inner = [];
    const dpr = Math.max(1, Math.round(c.width / (img.naturalWidth / (window.devicePixelRatio || 1)))) || 1;
    for (let y = 0; y < c.height; y++) for (const x of [0, c.width - 1]) frame.push(lum(x, y));
    for (let x = 0; x < c.width; x++) for (const y of [0, c.height - 1]) frame.push(lum(x, y));
    const inset = 6 * dpr;
    for (let y = inset; y < c.height - inset; y += 2) for (const x of [inset, c.width - 1 - inset]) inner.push(lum(x, y));
    frame.sort((a, b) => a - b); inner.sort((a, b) => a - b);
    // The outer frame mixes pure-border pixels with rounded-corner and
    // subpixel antialias blends toward the darker grounds, so the MEDIAN
    // understates a light border. p85 sits inside the pure-border run (all
    // meaningful borders here are lighter than their card ground); the
    // interior stays a median. A low-contrast border mutation still fails:
    // its p85 cannot exceed the true border luminance.
    const f = frame[Math.floor(frame.length * 0.85)];
    const n = inner[Math.floor(inner.length / 2)];
    return (Math.max(f, n) + 0.05) / (Math.min(f, n) + 0.05);
  }, buf.toString("base64"));
}
// Focus-ring probe: focus the control, capture a clip EXPANDED past the border
// box (the ring sits at offset 2px outside), and compare the brightest ring
// band against the darkest surroundings.
async function focusRingContrast(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  await el.focus();
  const box = await el.boundingBox();
  if (!box) return null;
  const clip = { x: Math.max(0, box.x - 7), y: Math.max(0, box.y - 7), width: box.width + 14, height: box.height + 14 };
  const buf = await page.screenshot({ clip });
  const { lums } = await lumsOf(page, buf);
  if (!lums.length) return null;
  return ratio(pct(lums, 0.99), pct(lums, 0.02));
}

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
    expect: (txt, badges, strip) => ({
      newEmptyCopy: /No direct-flight Starlink history yet\. Connection estimate below\./.test(txt),
      oldContradictionGone: !/No Starlink history on this route yet\./.test(txt),
      connectionLabelled: /all-legs estimate/.test(txt),
      connectionPctShown: /all-legs estimate\s*\d+%/.test(txt),
      // R23 fixture matrix: genuine no-data is a STRUCTURED strip state,
      // distinct from unavailable, not busy, and carries no CTA.
      structuredNoData: !!strip && strip.state === "no-data",
      noDataKicker: /no comparison available/i.test(txt),
      notBusy: !!strip && strip.busy !== "true",
      noCtaInRefusal: !!strip && strip.cta === false,
      distinctFromUnavailable: !/comparison unavailable|couldn't refresh/i.test(txt),
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
    expect: (txt, badges, strip) => ({
      listsUA1596: /UA1596/.test(txt),
      ua1596RanksFirst: /⭐\s*UA1596/.test(txt),
      noEmptyCopy: !/No direct-flight Starlink history/.test(txt),
      // v3.0 winner state: exact leader, runner-up, gap, observations, tracker
      // confidence, permanently-historical evidence, ONE CTA, matching ring.
      stripIsWinnerState: !!strip && strip.state === "winner",
      stripCrownsWinner: /best wifi choice/i.test(txt) && /UA1596/.test(txt),
      stripExactGap: /38 points higher historical odds than UA1214/.test(txt),
      stripEvidence: /50 tracked departures · High confidence · Historical tracker odds/.test(txt),
      accessibleSentenceHistorical: !!strip && /historical Starlink odds/.test(strip.label),
      oneCta: !!strip && strip.cta === true,
      ringMatchesWinner: !!strip && strip.ring === true,
      // R23 freshness amendment: NO freshness claim anywhere in the panel, and
      // no confirmation token without a confirmed-departure fact (far date).
      noFreshnessClaim: !/Updated|updated|fresh|Fresh|recent|Recent|today|Today/.test(txt),
      noFalseConfirmToken: !!strip && strip.confirmInStrip === false,
      // Product rules (Jeremy, 31 Jul): the carrier-framed button never renders
      // on united.com, and the panel is next-gen FIRST with the streaming-class
      // ConnectScore section labelled below it.
      noCarrierButtonOnUnited: !!strip && strip.prioritizeBtn === false,
      nextGenSectionLabelled: /next-gen odds/i.test(txt),
      nextGenFirstThenStreaming: (() => {
        const t = txt.toLowerCase();
        const a = t.indexOf("next-gen odds"), b = t.indexOf("streaming-class");
        return a >= 0 && b > a;
      })(),
      streamingShowsConnectScore: /connectscore/i.test(txt),
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
    awaitBadge: /68%/,
    expect: (txt, badges, strip) => {
      // v3.0 labelled dual-metric group (Codex round 26 replaced the unlabelled
      // three-layer badge): the odds VALUE is labelled NEXT-GEN, the evidence
      // count sits outside it, and a confirmed tail is a SEPARATE dated token —
      // never a sample count or a ✓ folded into the coloured value.
      const g = ((strip && strip.metrics) || []).find((x) => /68%/.test(x.text)) || {};
      return {
        valueLabelledNextGen: /NEXT-GEN 68%/.test(g.text || ""),
        evidenceOutsideValue: /68% 51 tracked/.test(g.text || ""),
        streamingSecondary: /STREAMING 42 ConnectScore/.test(g.text || ""),
        rampOnRealProbability: g.rampOnValue === true,
        confirmTokenSeparate: g.confirm === true,
        fullAccessibleSentence: /68% historical per-flight next-gen odds from 51 tracked departures\. High confidence\. Streaming-class ConnectScore 42/.test(g.aria || ""),
        accessibleCarriesExactDate: /Confirmed Starlink tail N127UA for \d{4}-\d{2}-\d{2}/.test(g.aria || ""),
        panelRowShowsSampleSize: /51 flights/.test(txt),
        stripConfirmSeparateFact: /✓ Confirmed for \d{4}-\d{2}-\d{2}/.test(txt),
        confirmNeverFreshness: !/Updated|updated|fresh|today/.test(txt),
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
    awaitBadge: /41%/,
    expect: (txt, badges, strip) => ({
      stripIsCloseState: !!strip && strip.state === "close",
      saysClose: /no clear winner/i.test(txt),
      explainsWhy: /Top two are 5 points apart/.test(txt),
      bothValuesVisible: /UA700 41% · UA701 36%/.test(txt),
      noWinnerCrowned: !/best wifi choice/i.test(txt),
      // Refusal states carry NO CTA node at all (absent, not hidden) and no
      // best marker anywhere — the leaked-ring mutation lands exactly here.
      noCtaInRefusal: !!strip && strip.cta === false,
      noStarInRefusal: !/⭐/.test(txt),
      noRingInRefusal: !!strip && strip.ring === false,
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
    awaitBadge: /55%/,
    expect: (txt, badges, strip) => ({
      stripIsSingleState: !!strip && strip.state === "single",
      saysOnlyOne: /Only UA800 has a score/.test(txt),
      kicker: /not enough to compare/i.test(txt),
      evidenceHistorical: /55% · 42 tracked departures · Historical tracker odds/.test(txt),
      noWinnerCrowned: !/best wifi choice/i.test(txt),
      noFalseCloseCopy: !/no clear winner/i.test(txt),
      noCta: !!strip && strip.cta === false,
      noStar: !/⭐/.test(txt),
    }),
  },
  {
    // v2.2 per-flight fallback on an EMPTY route: odds come from predict-flight,
    // keyed on the flight number, not the route table. Deterministic 16% / 68%.
    name: "united-fallback-real-odds",
    o: "SFO", d: "SIN",
    rows: [{ num: 2402, time: "2:15 p.m." }, { num: 1596, time: "10:30 a.m." }],
    mock: { o: "SFO", d: "SIN", route: [], predict: { "UA2402": 0.16, "UA1596": 0.68 }, itins: [] },
    awaitBadge: /\d+%/,
    awaitPanel: /UA(2402|1596)/,
    expect: (txt, badges, strip) => {
      const M = (strip && strip.metrics) || [];
      const all = M.map((m) => m.text).join(" | ");
      return {
        ua2402RealOdds: /NEXT-GEN 16%/.test(all),
        ua1596RealOdds: /NEXT-GEN 68%/.test(all),
        bothLabelled: M.length >= 2 && M.every((m) => /NEXT-GEN/.test(m.text)),
        panelListsFlights: /UA(2402|1596)/.test(txt),
        noEmptyStateContradiction: !/No direct-flight Starlink history for this route yet\./.test(txt),
        // The retired bare pills must not come back anywhere on the page.
        noBareSatellitePill: !badges.some((b) => /^🛰️\s*(n\/a|—|\d+%)$/.test(b.trim())),
      };
    },
  },
  {
    // A full tracker outage must say "unavailable", never a false absence.
    // v3.0: unavailable is a STRUCTURED strip state with a coral MEANINGFUL
    // border (frameProbe asserts ≥3:1, composited) and no CTA.
    name: "united-outage-unavailable",
    o: "DEN", d: "SFO", rows: [{ num: 1812, time: "9:00 a.m." }],
    trackerFail: true,
    awaitPanel: /Comparison unavailable/i,
    frameProbe: ".usl-decision--unavailable",
    expect: (txt, badges, strip) => ({
      structuredUnavailable: !!strip && strip.state === "unavailable",
      saysUnavailable: /We couldn't refresh flight odds\./.test(txt),
      pageOrderNote: /Page order is unchanged/.test(txt),
      notFalseAbsence: !/No direct-flight Starlink history/.test(txt),
      noCta: !!strip && strip.cta === false,
      notBusy: !!strip && strip.busy !== "true",
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
      // R23: the mixed-carrier coverage boundary appears exactly ONCE, states
      // the honest Navan coverage (United only is scored there), and no
      // unsupported-carrier row carries a badge.
      const boundaryCount = await page.evaluate(() => document.querySelectorAll(".usl-boundary").length);
      const unsupportedBadged = await page.evaluate(() => {
        const FN = /\b(?:UA|United)\s?\d{2,4}\b/;
        // Read the HOST's text: our own injected label contains digits, and a
        // naive textContent read would misclassify which card is which.
        const HT = (el) => { let o = ""; (function w(n) { for (const c of n.childNodes) {
          if (c.nodeType === 1) { let ours = false; if (c.classList) for (const k of c.classList)
            if (k.lastIndexOf("usl-", 0) === 0) { ours = true; break; } if (!ours) w(c); }
          else if (c.nodeType === 3) o += c.nodeValue; } })(el); return o; };
        return [...document.querySelectorAll(".flight-card")].some((r) =>
          !FN.test(HT(r)) && !!r.querySelector(".usl-metrics, .usl-badge"));
      });
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
        boundaryAppearsOnce: boundaryCount === 1,
        boundaryHonestCoverage: /Coverage: United\. Other airlines stay unscored and keep the booking site's order\./.test(panelText),
        unsupportedCarriersUnbadged: unsupportedBadged === false,
        // Next-gen first, streaming-class ConnectScore second (Jeremy, 31 Jul).
        nextGenFirstThenStreaming: (() => {
          const t = panelText.toLowerCase();
          const a = t.indexOf("next-gen odds"), b = t.indexOf("streaming-class");
          return a >= 0 && b > a;
        })(),
        streamingShowsConnectScore: /connectscore/i.test(panelText),
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
      // Phase 1 — STRUCTURED loading state: aria-busy=true, announced once
      // (aria-live=polite on first render), and NEVER coexisting with any
      // terminal claim (R23 a11y + fixture-matrix additions).
      let sawLoading = false, loadingProbe = null;
      try {
        await page.waitForFunction(() =>
          !!document.querySelector(".usl-decision--loading"), null, { timeout: 12000 });
        sawLoading = true;
        loadingProbe = await page.evaluate(() => {
          const s = document.querySelector(".usl-decision--loading");
          const t = (document.querySelector(".usl-panel") || {}).innerText || "";
          return {
            busy: s.getAttribute("aria-busy"),
            live: s.getAttribute("aria-live"),
            state: s.dataset.uslState || null,
            copy: /Comparing WiFi history/.test(t),
            noTerminalCoexist: !/No direct-flight Starlink history|Comparison unavailable/.test(t),
            noCta: !s.querySelector(".usl-decision__cta"),
          };
        });
      } catch (e) {}
      // Phase 2 — the truthful terminal no-data state, structured.
      let reachedTerminal = false;
      try {
        await page.waitForFunction(() => {
          const s = document.querySelector(".usl-decision--no-data");
          return !!s && /No direct-flight Starlink history for this route yet\./.test(s.textContent || "");
        }, null, { timeout: 20000 });
        reachedTerminal = true;
      } catch (e) {}
      const terminalProbe = await page.evaluate(() => {
        const s = document.querySelector(".usl-decision");
        return s ? { busy: s.getAttribute("aria-busy"), state: s.dataset.uslState || null,
          noCta: !s.querySelector(".usl-decision__cta") } : null;
      });
      // Phase 3 — announce-once: mark the terminal node; the 2s refresh ticks
      // must NOT rebuild it while the semantic state is unchanged.
      await page.evaluate(() => { const s = document.querySelector(".usl-decision"); if (s) s.dataset.probeMark = "1"; });
      await page.waitForTimeout(3200);
      const stillMarked = await page.evaluate(() => {
        const s = document.querySelector(".usl-decision");
        return !!(s && s.dataset.probeMark === "1");
      });
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "(no panel)");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return {
        appeared: true, panelText, badges, probe: { loadingProbe, terminalProbe },
        checks: {
          sawLoadingWhilePending: sawLoading,
          loadingAriaBusy: !!loadingProbe && loadingProbe.busy === "true",
          loadingAnnounced: !!loadingProbe && loadingProbe.live === "polite",
          loadingCopy: !!loadingProbe && loadingProbe.copy === true,
          loadingNeverCoexistsWithTerminal: !!loadingProbe && loadingProbe.noTerminalCoexist === true,
          loadingHasNoCta: !!loadingProbe && loadingProbe.noCta === true,
          reachedTerminalEmpty: reachedTerminal,
          terminalNotBusy: !!terminalProbe && terminalProbe.busy !== "true",
          terminalStateNoData: !!terminalProbe && terminalProbe.state === "no-data",
          terminalHasNoCta: !!terminalProbe && terminalProbe.noCta === true,
          noRerenderInSameState: stillMarked === true,
          notStuckLoading: !/Comparing WiFi history/.test(panelText),
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
          const s = document.querySelector(".usl-decision--unavailable");
          return !!s && /We couldn't refresh flight odds\./.test(s.textContent || "");
        }, null, { timeout: 60000 });
        reachedTerminal = true;
      } catch (e) {}
      const at2777 = PREDICT_HITS["UA2777"] || 0;
      // Prove no request fires after the terminal state: sample, wait, resample.
      await page.waitForTimeout(5000);
      const after2777 = PREDICT_HITS["UA2777"] || 0;
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "(no panel)");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      const stripState = await page.evaluate(() => {
        const s = document.querySelector(".usl-decision");
        return s ? s.dataset.uslState || null : null;
      });
      return {
        appeared: true, panelText, badges,
        probe: { ua2777Requests: at2777, ua2777AfterTerminal: after2777, ua1596Requests: PREDICT_HITS["UA1596"] || 0 },
        checks: {
          reachedTerminalUnavailable: reachedTerminal,
          structuredUnavailable: stripState === "unavailable",
          notFalseAbsence: !/No direct-flight Starlink history/.test(panelText),
          ua2777Attempted: at2777 >= 1,
          ua2777AtMost4Attempts: at2777 <= 4,
          noRequestAfterTerminal: after2777 === at2777,
          noDataFlightSettlesNa: /No flight history/.test(panelText) ||
            (await page.evaluate(() => [...document.querySelectorAll(".usl-metrics")]
              .some((m) => m.dataset.ngState === "nohistory"))),
          notStuckLoading: !/Comparing WiFi history/.test(panelText),
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
    // Product rule (Jeremy, 31 Jul): the carrier-framed "Prioritize United
    // flights" action NEVER renders on united.com — everything there is United,
    // so the promise is meaningless. Route ghost UA1596 gives the panel a
    // single-scored list (refusal state, so no winner CTA either): the panel is
    // read-only and the page order stays untouched. (The zero-scored
    // truthfulness contract lives on in the Navan cases and the winner CTA's
    // own sortPage guard.)
    name: "united-no-carrier-button",
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
      await page.waitForTimeout(4000);
      const pre = await page.evaluate(flightOrderProbe);
      const probeOut = await page.evaluate(() => ({
        carrierBtn: !!document.querySelector(".usl-prioritize"),
        winnerCta: !!document.querySelector(".usl-decision__cta"),
        stripState: (document.querySelector(".usl-decision") || { dataset: {} }).dataset.uslState || null,
      }));
      await page.waitForTimeout(1500);
      const post = await page.evaluate(flightOrderProbe);
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return {
        appeared: true, panelText, badges, probe: probeOut,
        checks: {
          noCarrierButtonOnUnited: probeOut.carrierBtn === false,
          noWinnerCtaInRefusal: probeOut.winnerCta === false,
          singleScoredRefusal: probeOut.stripState === "single",
          pageOrderUntouched: eq(pre.order, post.order),
        },
      };
    },
  },
  {
    // R23 fixture matrix — LOW-GRADE leader. Gap is decisive (40 pts) but the
    // leader's tracker confidence is `low`, so the strip must refuse, and no
    // ring/star may leak (the missing-conf-eligible mutation lands here).
    name: "united-strip-lowgrade",
    o: "SFO", d: "SEA",
    rows: [{ num: 900, time: "8:30 a.m." }, { num: 901, time: "11:05 a.m." }],
    mock: {
      o: "SFO", d: "SEA",
      route: [
        { fn: "UA900", prob: 60, obs: 12, conf: "low" },
        { fn: "UA901", prob: 20, obs: 30, conf: "high" },
      ],
      predict: {}, itins: [],
    },
    awaitBadge: /60%/,
    expect: (txt, badges, strip) => ({
      stripIsCloseState: !!strip && strip.state === "close",
      refusalReason: /The leader is based on limited history/.test(txt),
      refusalDetail: /UA900 leads, but its odds are not decision-grade\./.test(txt),
      noWinnerCrowned: !/best wifi choice/i.test(txt),
      noCta: !!strip && strip.cta === false,
      noStar: !/⭐/.test(txt),
      noRing: !!strip && strip.ring === false,
    }),
  },
  {
    // R23 fixture matrix — MISSING confidence. The tracker returns odds with NO
    // confidence field at all: the winner is ineligible AND no confidence label
    // may be invented anywhere (bg.js must not coerce missing → "low").
    name: "navan-strip-missing-conf",
    navan: true, o: "DEN", d: "PHX",
    rows: [{ label: "United 910", time: "8:30 a.m." }, { label: "United 911", time: "9:15 a.m." }],
    mock: { o: "DEN", d: "PHX", predict: { "UA910": { p: 0.66, conf: null }, "UA911": { p: 0.22 } } },
    awaitBadge: /66%/,
    expect: (txt, badges, strip) => ({
      stripIsCloseState: !!strip && strip.state === "close",
      refusalReason: /The leader is based on limited history/.test(txt),
      noWinnerCrowned: !/best wifi choice/i.test(txt),
      noInventedConfidenceLabel: !/Low confidence|Medium confidence|High confidence/.test(txt),
      noStar: !/⭐/.test(txt),
      boundaryPresent: !!strip && strip.boundaryCount === 1,
    }),
  },
  {
    // R23 cross-model contradiction — Guard B-confirmed-no on the EXACT
    // flight/date the strip would otherwise crown. UA1596 keeps its historical
    // 68% in the rows, but takes NO winner treatment, NO star/ring, and NO
    // confirmation token (the deps feed still lists it — the newer Guard fact
    // outranks the stale feed). The refusal names the fact instead.
    name: "united-guard-b-disqualifies",
    o: "SFO", d: "DEN", dateOffsetDays: 1,
    rows: [{ num: 1596, time: "8:30 a.m." }, { num: 1214, time: "11:05 a.m." }],
    seedTrips: [{
      fn: "UA1596", date: isoDaysFromNow(1), route: "SFO-DEN", added: Date.now(),
      history: [{ ts: Date.now(), status: "no", tail: "N999XX", prob: null }],
      asOf: Date.now(), lastError: null, lastStatus: "no", tail: "N999XX", equip: "Viasat",
    }],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 51, conf: "high" },
        { fn: "UA1214", prob: 30, obs: 40, conf: "medium" },
      ],
      predict: {},
      deps: [{ fn: "UA1596", o: "SFO", d: "DEN", date: isoDaysFromNow(1), time: "09:00", tail: "N127UA" }],
      itins: [],
    },
    awaitBadge: /68%/,
    expect: (txt, badges, strip) => {
      const g = ((strip && strip.metrics) || []).find((x) => /68%/.test(x.text)) || { confirm: true };
      return {
        historicalOddsStillVisible: /68%/.test(txt),
        disqualifiedFromWinner: !/best wifi choice/i.test(txt),
        reasonNamesGuardFact: /UA1596 is confirmed non-Starlink for this date/.test(txt),
        noStarOnDisqualified: !/⭐/.test(txt),
        noRing: !!strip && strip.ring === false,
        noConfirmTokenAfterB: !!strip && strip.confirmInStrip === false,
        noBadgeConfirmAfterB: g.confirm === false,
        noConfirmedTailsFooter: !/Confirmed tails/.test(txt),
      };
    },
  },
  {
    // R23 P2-01/P2-02 — the composited-contrast + named-width visual case.
    // Winner fixture with every ramp band on screen (68 hi / 40 mid / 25 low /
    // 10 no / n-a), a confirmed tail, and the CTA. Contrast is measured from
    // RENDERED pixels at 1280×800 and 390×844; named fail-closed screenshots at
    // 1280×800, 390×844, 340×800; 600/601 DOM geometry for the evidence /
    // confirmation breakpoint; CTA keyboard activation stays truthful.
    name: "visual-contrast-geometry",
    o: "SFO", d: "DEN", dateOffsetDays: 1,
    rows: [
      { num: 1214, time: "11:05 a.m." }, { num: 1596, time: "8:30 a.m." },
      { num: 2402, time: "2:15 p.m." }, { num: 2777, time: "9:15 a.m." },
      { num: 3999, time: "7:45 a.m." },
    ],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 51, conf: "high" },
        { fn: "UA1214", prob: 40, obs: 40, conf: "medium" },
        { fn: "UA2402", prob: 25, obs: 30, conf: "medium" },
        { fn: "UA2777", prob: 10, obs: 20, conf: "medium" },
      ],
      predict: { "UA3999": null },
      deps: [{ fn: "UA1596", o: "SFO", d: "DEN", date: isoDaysFromNow(1), time: "09:00", tail: "N127UA" }],
      itins: [],
    },
    driver: async ({ page, url }) => {
      const checks = {};
      const contrast = {};
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-decision--winner", { timeout: 30000 });
      await page.waitForFunction(() => {
        const t = (document.querySelector(".usl-panel") || {}).innerText || "";
        return /68%/.test(t) && /40%/.test(t) && /25%/.test(t) && /10%/.test(t);
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".usl-badge")].some((b) => /n\/a/.test(b.textContent || "")),
        null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);

      const T = 4.5, B = 3.0;
      const targets = [
        ["winKicker", ".usl-decision--winner .usl-decision__kicker", T],
        ["winTitle", ".usl-decision--winner .usl-decision__title", T],
        ["winComparison", ".usl-decision--winner .usl-decision__comparison", T],
        ["winEvidence", ".usl-decision--winner .usl-decision__evidence", T],
        ["winConfirm", ".usl-decision--winner .usl-decision__confirm", T],
        ["winCta", ".usl-decision--winner .usl-decision__cta", T],
        ["panelBadgeHi", ".usl-panel .usl-jump .usl-badge.usl-hi", T],
        ["panelBadgeMid", ".usl-panel .usl-jump .usl-badge.usl-mid", T],
        ["panelBadgeLow", ".usl-panel .usl-jump .usl-badge.usl-low", T],
        ["panelBadgeNo", ".usl-panel .usl-jump .usl-badge.usl-no", T],
        ["streamingScorePill", ".usl-panel .usl-stream .usl-badge.usl-cs", T],
        ["sectionLabel", ".usl-panel .usl-sect", T],
        ["sortedStateLabel", ".usl-panel .usl-sorted__t", T],
        ["undoButton", ".usl-panel .usl-undo", T],
        // v3.0 row group, on the WHITE host row.
        ["rowNextGenLabel", ".usl-metrics .usl-ng__label", T],
        ["rowNextGenValue", ".usl-metrics .usl-ng__value", T],
        ["rowEvidence", ".usl-metrics .usl-ng__sub", T],
        ["rowStreamLabel", ".usl-metrics .usl-stream__label", T],
        ["rowStreamValue", ".usl-metrics .usl-stream__value", T],
        ["pageConfirm", ".usl-confirm", T],
      ];
      for (const [k, sel, min] of targets) {
        const v = await pixelContrast(page, sel);
        contrast[k + "_1280"] = v;
        checks["contrast_" + k + "_1280"] = v !== null && v >= min;
      }
      const winFrame = await frameContrast(page, ".usl-decision--winner");
      contrast.winnerBorder = winFrame;
      checks.winnerBorderMeaningful = winFrame !== null && winFrame >= B;
      const ringR = await focusRingContrast(page, ".usl-decision__cta");
      contrast.ctaFocusRing = ringR;
      checks.ctaFocusRingVisible = ringR !== null && ringR >= B;

      // Named baseline 1280×800 + desktop geometry (spec §6: 356px panel).
      const s1280 = join(SHOTS, "strip-winner-1280x800.png");
      await (await page.$(".usl-panel")).screenshot({ path: s1280 });
      checks.shot1280Written = existsSync(s1280) && statSync(s1280).size > 1500;
      const pw = await page.evaluate(() => document.querySelector(".usl-panel").getBoundingClientRect().width);
      checks.panel356Desktop = pw >= 356 && pw <= 360;

      // CTA keyboard activation truthfulness (runs the audited sortPage
      // directly on united.com — no carrier-framed button exists there).
      await page.focus(".usl-decision__cta");
      const focusedOk = await page.evaluate(() => document.activeElement === document.querySelector(".usl-decision__cta"));
      const preFirst = await page.evaluate(() => {
        const r = [...document.querySelectorAll(".res-row")][0];
        return r ? (r.textContent.match(/United\s?(\d{2,4})/) || [])[1] || null : null;
      });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      const ctaState = await page.evaluate(() => {
        const c = document.querySelector(".usl-decision__cta");
        const first = [...document.querySelectorAll(".res-row")][0];
        return { pressed: c ? c.getAttribute("aria-pressed") : null, txt: c ? c.textContent.trim() : "",
          firstFn: first ? (first.textContent.match(/United\s?(\d{2,4})/) || [])[1] || null : null,
          noCarrierBtn: !document.querySelector(".usl-prioritize"),
          focusStill: !!c && document.activeElement === c };
      });
      checks.ctaKeyboardFocusable = focusedOk === true;
      checks.ctaTruthfulAfterActivate = ctaState.pressed === "true" && /✓ UA1596 prioritized/.test(ctaState.txt);
      // Single-carrier auto-sort is ON by default (Codex round 26), so the page
      // is ALREADY ordered by odds before the CTA is touched: the fixture lists
      // UA1214 first and UA1596 (68%) must have been floated above it on load.
      // Pressing the CTA then keeps that order and claims it truthfully.
      checks.autoSortPlacedWinnerFirst = preFirst === "1596";
      checks.ctaKeepsSortedOrder = ctaState.firstFn === "1596";
      checks.noCarrierButtonOnUnited = ctaState.noCarrierBtn === true;
      checks.focusRemainsOnCta = ctaState.focusStill === true;
      await page.keyboard.press("Enter"); // toggle back off for the shots
      await page.waitForTimeout(400);

      // 390×844 — gutters, CTA size, no horizontal scroll, key contrasts again.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      const s390 = join(SHOTS, "strip-winner-390x844.png");
      await (await page.$(".usl-panel")).screenshot({ path: s390 });
      checks.shot390Written = existsSync(s390) && statSync(s390).size > 1500;
      const g390 = await page.evaluate(() => {
        const p = document.querySelector(".usl-panel").getBoundingClientRect();
        const cta = document.querySelector(".usl-decision__cta").getBoundingClientRect();
        return { pl: p.left, pr: innerWidth - p.right, ctaH: cta.height,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      checks.gutters390 = Math.round(g390.pl) === 12 && Math.round(g390.pr) === 12;
      checks.noHorizontalScroll390 = g390.overflow === false;
      checks.cta44at390 = g390.ctaH >= 44;
      for (const [k, sel, min] of targets.slice(0, 6)) {
        const v = await pixelContrast(page, sel);
        contrast[k + "_390"] = v;
        checks["contrast_" + k + "_390"] = v !== null && v >= min;
      }

      // 340×800 — narrow edge: text floor 11px, CTA ≥44px, still no overflow.
      await page.setViewportSize({ width: 340, height: 800 });
      await page.waitForTimeout(400);
      const s340 = join(SHOTS, "strip-winner-340x800.png");
      await (await page.$(".usl-panel")).screenshot({ path: s340 });
      checks.shot340Written = existsSync(s340) && statSync(s340).size > 1500;
      const g340 = await page.evaluate(() => {
        const els = [...document.querySelectorAll(".usl-decision p, .usl-decision h2, .usl-decision button")];
        const minFs = Math.min(...els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
        const cta = document.querySelector(".usl-decision__cta").getBoundingClientRect();
        return { minFs, ctaH: cta.height, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      checks.minTextFloor340 = g340.minFs >= 11;
      checks.cta44at340 = g340.ctaH >= 44;
      checks.noHorizontalScroll340 = g340.overflow === false;

      // 601 vs 600 — the evidence/confirmation breakpoint, both sides.
      await page.setViewportSize({ width: 601, height: 800 });
      await page.waitForTimeout(300);
      const probe601 = () => page.evaluate(() => {
        const g = document.querySelector(".usl-metrics");
        return {
          ev: getComputedStyle(g.querySelector(".usl-ng__sub")).display,
          cw: getComputedStyle(document.querySelector(".usl-confirm-w")).display,
          ngLabel: getComputedStyle(g.querySelector(".usl-ng__label")).display,
          stLabel: getComputedStyle(g.querySelector(".usl-stream__label")).display,
          stWord: getComputedStyle(g.querySelector(".usl-stream__word")).display,
          aria: g.getAttribute("aria-label") || "",
        };
      });
      const at601 = await probe601();
      const s601 = join(SHOTS, "row-metrics-601.png");
      await (await page.$(".usl-metrics")).screenshot({ path: s601 });
      await page.setViewportSize({ width: 600, height: 800 });
      await page.waitForTimeout(300);
      const at600 = await probe601();
      const s600 = join(SHOTS, "row-metrics-600.png");
      await (await page.$(".usl-metrics")).screenshot({ path: s600 });
      checks.evidenceVisible601 = at601.ev !== "none";
      checks.confirmWordVisible601 = at601.cw !== "none";
      checks.evidenceHidden600 = at600.ev === "none";
      checks.confirmShortened600 = at600.cw === "none";
      // METRIC IDENTITY IS NEVER HIDDEN at any width — that is the whole point
      // of the labelled group, so both labels must survive the breakpoint.
      checks.labelsSurvive601 = at601.ngLabel !== "none" && at601.stLabel !== "none";
      checks.labelsSurvive600 = at600.ngLabel !== "none" && at600.stLabel !== "none";
      checks.connectScoreWordHidden600 = at600.stWord === "none";
      checks.fullAccessibleNameSurvives600 =
        /51 tracked departures/.test(at600.aria) && /Confirmed Starlink tail N127UA/.test(at600.aria);
      checks.breakpointShotsWritten = existsSync(s600) && statSync(s600).size > 200 &&
        existsSync(s601) && statSync(s601).size > 200;

      await page.setViewportSize({ width: 1280, height: 800 });
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = await page.$$eval(".usl-badge", (els) => els.map((e) => e.textContent.trim()));
      return { appeared: true, panelText, badges, probe: { contrast }, checks };
    },
  },
  {
    // R23 P1-01 — the Guard state/reason fixture matrix, rendered by the REAL
    // popup against seeded trips. Every A/B/C reason pair asserts its required
    // copy AND the forbidden collapse: unconfirmed is never "No Starlink"; an
    // outage or exhausted budget is never "Awaiting assignment"; invalid input
    // is its own reason. Chip inks are contrast-probed composited.
    name: "guard-popup-state-matrix",
    o: "SFO", d: "DEN", rows: [], mock: {},
    driver: async ({ page, sw, extId }) => {
      if (!sw || !extId) return { appeared: false, panelText: "(no service worker)", badges: [], checks: { swPresent: false } };
      const now = Date.now();
      const day = (n) => new Date(now + n * 864e5).toISOString().slice(0, 10);
      const trips = [
        { fn: "UA100", date: day(5), route: "SFO-DEN", added: now, history: [], asOf: now, lastError: null, lastStatus: "yes", tail: "N101UA" },
        { fn: "UA200", date: day(6), route: "SFO-DEN", added: now, history: [], asOf: now, lastError: null, lastStatus: "no", tail: "N202UA", equip: "Viasat" },
        { fn: "UA300", date: day(7), route: "SFO-DEN", added: now, history: [], asOf: now, lastError: null, lastStatus: "unconfirmed", tail: "N303UA" },
        { fn: "UA400", date: day(8), route: "SFO-DEN", added: now, history: [], asOf: now, lastError: null, lastStatus: "early", prob: 55 },
        { fn: "UA500", date: day(9), route: "SFO-DEN", added: now, history: [], asOf: now - 3 * 36e5, lastError: "check budget exhausted", lastStatus: "early", prob: 41 },
        { fn: "UA600", date: day(10), route: "SFO-DEN", added: now, history: [], asOf: null, lastError: null, lastStatus: "invalid", invalidCount: 1 },
      ];
      await sw.evaluate((t) => chrome.storage.local.set({ uslTrips: t }), trips);
      await page.goto("chrome-extension://" + extId + "/popup.html", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll(".usl-trip-row").length >= 6, null, { timeout: 15000 }).catch(() => {});
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll(".usl-trip-row")].map((r) => ({
          txt: r.innerText,
          chip: (r.querySelector(".usl-chip") || {}).textContent || "",
        })));
      const row = (fn) => rows.find((r) => r.txt.indexOf(fn) === 0 || r.txt.includes(fn + " ·")) || { txt: "", chip: "" };
      const chipA = await pixelContrast(page, ".usl-chip-a");
      const chipB = await pixelContrast(page, ".usl-chip-b");
      const chipC = await pixelContrast(page, ".usl-chip-c");
      const panelText = rows.map((r) => r.txt).join("\n---\n");
      return {
        appeared: rows.length >= 6, panelText, badges: [],
        probe: { chipA, chipB, chipC },
        checks: {
          aChipConfirmed: row("UA100").chip === "Starlink ✓",
          bChipConfirmedNo: row("UA200").chip === "No Starlink ✗",
          bUnconfirmedSaysCannotConfirm: row("UA300").chip === "Cannot confirm Starlink",
          bUnconfirmedNeverNegative: !/No Starlink|✗/.test(row("UA300").txt),
          cAwaitingIsAwaiting: row("UA400").chip === "Awaiting assignment",
          cBudgetOutageIsUnavailable: row("UA500").chip === "Update unavailable",
          cOutageNeverAwaiting: !/Awaiting assignment/.test(row("UA500").txt),
          cOutageCarriesDatedFact: /as of /.test(row("UA500").txt),
          cInvalidIsItsOwnReason: row("UA600").chip === "Flight not found",
          cInvalidNeverAwaiting: !/Awaiting assignment/.test(row("UA600").txt),
          chipContrastA: chipA !== null && chipA >= 4.5,
          chipContrastB: chipB !== null && chipB >= 4.5,
          chipContrastC: chipC !== null && chipC >= 4.5,
        },
      };
    },
  },
  {
    // R26 assertion 1+2 — single-carrier auto-sort default ON. A FRESH profile
    // (storage cleared before every case) must sort on first paint, show the
    // metric-naming sorted state, and expose a real Undo. Codex approved
    // default-ON here only because every row is the same carrier.
    name: "united-autosort-default-on",
    o: "SFO", d: "DEN",
    rows: [{ num: 1214, time: "11:05 a.m." }, { num: 1596, time: "8:30 a.m." }, { num: 2402, time: "2:15 p.m." }],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 51, conf: "high" },
        { fn: "UA1214", prob: 40, obs: 40, conf: "medium" },
        { fn: "UA2402", prob: 12, obs: 30, conf: "medium" },
      ],
      predict: {}, itins: [],
    },
    driver: async ({ page, url, sw }) => {
      const first = () => page.evaluate(() =>
        [...document.querySelectorAll(".res-row")].map((r) => (r.textContent.match(/United\s?(\d{2,4})/) || [])[1]));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForFunction(() => {
        const t = (document.querySelector(".usl-panel") || {}).innerText || "";
        return /68%/.test(t) && /40%/.test(t) && /12%/.test(t);
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForFunction(() =>
        !!document.querySelector(".usl-sorted"), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(900);
      const sorted = await first();
      const state = await page.evaluate(() => {
        const s = document.querySelector(".usl-sorted");
        const u = document.querySelector(".usl-undo");
        return { label: s ? s.innerText : "", hasUndo: !!u,
          undoIsButton: !!u && u.tagName === "BUTTON",
          undoName: u ? u.getAttribute("aria-label") : "" };
      });
      // Undo by KEYBOARD, then confirm the host's original order is restored
      // and that the setting was persisted OFF (not merely stopped).
      await page.focus(".usl-undo");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(900);
      const restored = await first();
      // Storage lives in the extension, not the page's main world (page.evaluate
      // runs OUTSIDE the content script's isolated world), so read it through
      // the service worker.
      const persisted = sw
        ? await sw.evaluate(() => new Promise((res) =>
            chrome.storage.local.get("uslSortSingle", (v) => res(v.uslSortSingle)))).catch(() => "sw-error")
        : "no-sw";
      await page.waitForTimeout(2500);   // prove it stays put after later ticks
      const stillRestored = await first();
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      const badges = [];
      return {
        appeared: true, panelText, badges, probe: { sorted, restored, stillRestored, persisted },
        checks: {
          autoSortedOnFirstPaint: eq(sorted, ["1596", "1214", "2402"]),
          sortedStateNamesMetric: /Sorted by historical next-gen odds/.test(state.label),
          noVagueSortLabel: !/\bBest\b|Smart sort|WiFi order/.test(state.label),
          undoIsRealButton: state.hasUndo && state.undoIsButton,
          undoAccessibleName: /booking site/i.test(state.undoName || ""),
          undoRestoresHostOrder: eq(restored, ["1214", "1596", "2402"]),
          undoPersistsOff: persisted === false,
          staysRestoredAfterLaterTicks: eq(stillRestored, ["1214", "1596", "2402"]),
        },
      };
    },
  },
  {
    // R26 assertion 2 — a stored OFF must be honoured on first paint, through
    // reload and later score settlement. The mutation "settings-off-still-sorts"
    // lands here.
    name: "united-autosort-off-respected",
    o: "SFO", d: "DEN",
    seedStorage: { uslSortSingle: false },
    rows: [{ num: 1214, time: "11:05 a.m." }, { num: 1596, time: "8:30 a.m." }, { num: 2402, time: "2:15 p.m." }],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 51, conf: "high" },
        { fn: "UA1214", prob: 40, obs: 40, conf: "medium" },
        { fn: "UA2402", prob: 12, obs: 30, conf: "medium" },
      ],
      predict: {}, itins: [],
    },
    driver: async ({ page, url }) => {
      const first = () => page.evaluate(() =>
        [...document.querySelectorAll(".res-row")].map((r) => (r.textContent.match(/United\s?(\d{2,4})/) || [])[1]));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForFunction(() => {
        const t = (document.querySelector(".usl-panel") || {}).innerText || "";
        return /68%/.test(t) && /40%/.test(t);
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const afterScores = await first();
      // reload: the stored OFF must survive it
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForTimeout(3500);
      const afterReload = await first();
      const noSortedState = await page.evaluate(() => !document.querySelector(".usl-sorted"));
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      return {
        appeared: true, panelText, badges: [], probe: { afterScores, afterReload },
        checks: {
          hostOrderKeptOnFirstPaint: eq(afterScores, ["1214", "1596", "2402"]),
          hostOrderKeptAfterReload: eq(afterReload, ["1214", "1596", "2402"]),
          noSortedStateClaimed: noSortedState === true,
        },
      };
    },
  },
  {
    // R26 — mixed-carrier PRESERVE is the default (Codex rejected default-ON).
    // Nothing may move on first paint or as late scores settle. The
    // "mixed-auto-sort" mutation lands here.
    name: "navan-preserves-host-order",
    navan: true, o: "DEN", d: "SFO",
    rows: [
      { label: "Frontier 1229", time: "8:59 a.m." },
      { label: "United 1596", time: "8:30 a.m." },
      { label: "Frontier 3435", time: "6:55 a.m." },
      { label: "United 2402", time: "2:15 p.m." },
    ],
    mock: { o: "DEN", d: "SFO", predict: { "UA1596": 0.68, "UA2402": 0.16 } },
    driver: async ({ page, url }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".usl-panel", { timeout: 30000 });
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll(".usl-badge, .usl-ng__value")].map((x) => x.textContent || "");
        return b.some((t) => /68%/.test(t)) && b.some((t) => /16%/.test(t));
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(3500);
      const order = await page.evaluate(flightOrderProbe);
      const st = await page.evaluate(() => ({
        sortedClaim: !!document.querySelector(".usl-sorted"),
        explicitAction: !!document.querySelector(".usl-prioritize"),
        boundary: (document.querySelector(".usl-boundary") || {}).textContent || "",
      }));
      const panelText = await page.$eval(".usl-panel", (e) => e.innerText).catch(() => "");
      return {
        appeared: true, panelText, badges: [], probe: order,
        checks: {
          hostOrderUntouched: eq(order.order, ["FRONTIER1229", "UA1596", "FRONTIER3435", "UA2402"]),
          noSortedStateClaimed: st.sortedClaim === false,
          explicitActionOffered: st.explicitAction === true,
          boundaryNamesScorableCarrier: /Coverage: United\./.test(st.boundary),
          boundaryDoesNotClaimAlaska: !/Alaska/.test(st.boundary),
          unscoredNotCalledWorse: /not lower|stay unscored/i.test(panelText),
        },
      };
    },
  },
  {
    // R26 question 2 — the labelled dual-metric row. Every visible metric names
    // itself; a bare percentage is the defect this replaced. "unlabelled-badge"
    // lands here.
    name: "row-metrics-labelled",
    o: "SFO", d: "DEN", dateOffsetDays: 1,
    rows: [{ num: 1596, time: "8:30 a.m." }, { num: 1214, time: "11:05 a.m." }],
    mock: {
      o: "SFO", d: "DEN",
      route: [
        { fn: "UA1596", prob: 68, obs: 51, conf: "high" },
        { fn: "UA1214", prob: 30, obs: 40, conf: "medium" },
      ],
      predict: {},
      deps: [{ fn: "UA1596", o: "SFO", d: "DEN", date: isoDaysFromNow(1), time: "09:00", tail: "N127UA" }],
      itins: [],
    },
    awaitPanel: /68%/,
    expect: (txt, badges, strip) => {
      const g = ((strip && strip.metrics) || []).find((m) => /68%/.test(m.text)) || {};
      return {
        groupRendered: !!g.text,
        nextGenLabelled: /NEXT-GEN/.test(g.text || ""),
        streamingLabelled: /STREAMING/.test(g.text || ""),
        nextGenBeforeStreaming: (g.text || "").indexOf("NEXT-GEN") >= 0 &&
          (g.text || "").indexOf("NEXT-GEN") < (g.text || "").indexOf("STREAMING"),
        noBareSatellitePill: !((g.text || "").trim().match(/^🛰️\s*\d+%$/)),
        stateIsProbability: g.state === "prob",
        evidenceShown: /51 tracked/.test(g.text || ""),
        connectScoreWordShown: /ConnectScore/.test(g.text || ""),
        accessibleSaysPerFlight: /historical per-flight next-gen odds/.test(g.aria || ""),
        accessibleSaysStreaming: /Streaming-class ConnectScore/.test(g.aria || ""),
        confirmStillSeparate: g.confirm === true,
      };
    },
  },
  {
    // R26 — an instrumented flight the tracker has NO history for. Must read
    // "No flight history", never 0% and never "No Starlink". "zero-for-unknown"
    // lands here.
    name: "row-metrics-no-history",
    o: "SFO", d: "PDX",
    rows: [{ num: 800, time: "8:30 a.m." }, { num: 801, time: "11:05 a.m." }],
    mock: { o: "SFO", d: "PDX", route: [{ fn: "UA800", prob: 55, obs: 42, conf: "high" }],
      predict: { "UA801": null }, itins: [] },
    awaitPanel: /55%/,
    expect: (txt, badges, strip) => {
      const all = (strip && strip.metrics) || [];
      const none = all.find((m) => m.state === "nohistory") || {};
      return {
        noHistoryStateRendered: !!none.text,
        saysNoFlightHistory: /No flight history/.test(none.text || ""),
        stillLabelled: /NEXT-GEN/.test(none.text || ""),
        neverZeroPercent: !all.some((m) => /\b0%/.test(m.text || "")),
        neverSaysNoStarlink: !/No Starlink/.test(txt) && !all.some((m) => /No Starlink/.test(m.text || "")),
        accessibleNamesAbsence: /no per-flight next-gen history/.test(none.aria || ""),
        streamingStillShown: /STREAMING/.test(none.text || ""),
      };
    },
  },
  {
    // R26 — a NON-instrumented carrier row (Google Flights matches many
    // airlines). Fleet share is context, never a per-flight probability: it
    // must be labelled FLEET and must not take the odds ramp.
    // "fleet-as-probability" lands here.
    name: "row-metrics-fleet-context",
    o: "SFO", d: "DEN", rows: [], mock: {},
    driver: async ({ page, extId }) => {
      if (!extId) return { appeared: false, panelText: "(no extension id)", badges: [], checks: { extIdPresent: false } };
      // airlines.js loads as a classic script in popup.html, so its top-level
      // consts ARE the popup page's main world — reachable by page.evaluate.
      // (A content-page evaluate would not see them: content scripts run in an
      // isolated world that Playwright's evaluate does not enter.)
      await page.goto("chrome-extension://" + extId + "/popup.html", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof scoreAirline === "function", null, { timeout: 15000 });
      const out = await page.evaluate(() => {
        const mk = (k) => { try { return scoreAirline(k); } catch (e) { return null; } };
        const delta = mk("delta"), ab = mk("airbaltic"), sas = mk("sas");
        return {
          deltaNextGen: delta ? delta.nextGenScore : null,
          deltaFuture: delta ? !!delta.future : null,
          abNextGen: ab ? Math.round(ab.nextGenScore) : null,
          abScore: ab ? ab.score : null,
          sasPublished: sas ? sas.nextGenPublished : null,
        };
      });
      return {
        appeared: true, panelText: JSON.stringify(out), badges: [], probe: out,
        checks: {
          // The airline model itself must be the whole-fleet one. airBaltic at
          // 100 is the stale resolved-only denominator (Codex round 26 P1).
          airBalticIsWholeFleetFloor: out.abNextGen === 51,
          airBalticScoreMatches: out.abScore === 51,
          deltaHasNoCurrentNextGen: out.deltaNextGen === 0,
          deltaHasAnnouncedFuture: out.deltaFuture === true,
        },
      };
    },
  },
  {
    // R26 P1 — airline-data parity, asserted from INSIDE the loaded extension.
    // "resolved-only-denominator" lands here.
    name: "airline-data-parity",
    o: "SFO", d: "DEN", rows: [], mock: {},
    driver: async ({ page, extId }) => {
      if (!extId) return { appeared: false, panelText: "(no extension id)", badges: [], checks: { extIdPresent: false } };
      await page.goto("chrome-extension://" + extId + "/popup.html", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof scoreAirline === "function", null, { timeout: 15000 });
      const out = await page.evaluate(() => {
        const keys = Object.keys(WIFI_AIRLINES);
        const v = {};
        for (const k of ["united", "airbaltic", "qatar", "westjet", "emirates"]) {
          const s = scoreAirline(k);
          v[k] = s ? [Math.round(s.nextGenScore), s.score] : null;
        }
        return { n: keys.length, v, positive: keys.filter((k) => scoreAirline(k).nextGenScore > 0).length };
      });
      return {
        appeared: true, panelText: JSON.stringify(out, null, 1), badges: [], probe: out,
        checks: {
          eighteenAirlines: out.n === 18,
          unitedWholeFleet: eq(out.v.united, [27, 42]),
          airBalticWholeFleet: eq(out.v.airbaltic, [51, 51]),
          qatarWholeFleet: eq(out.v.qatar, [50, 53]),
          westjetWholeFleet: eq(out.v.westjet, [52, 52]),
          positiveNextGenCount: out.positive === 12,
        },
      };
    },
  },
  {
    // R23 Answer-3 + P1-02 — the Guard's pure precedence functions exercised in
    // the REAL service worker: state folding, the worsened() rescue predicate
    // (A→C withdrawn carries rescue; B→C and first-early do not), notification
    // copy per state, the unconfirmed parse branch, and the state machine's
    // withdrawn/unconfirmed transitions.
    name: "guard-pure-precedence",
    o: "SFO", d: "DEN", rows: [], mock: {},
    driver: async ({ sw }) => {
      if (!sw) return { appeared: false, panelText: "(no service worker)", badges: [], checks: { swPresent: false } };
      const res = await sw.evaluate(() => {
        const now = Date.now();
        const tripYes = { lastStatus: "yes", history: [{ ts: now, status: "yes", tail: "N1", prob: null }] };
        const tripNo = { lastStatus: "no", history: [{ ts: now, status: "no", tail: "N2", prob: null }] };
        const nW = buildGuardNotification({ fn: "UA1596", date: "2026-08-05", tail: "N1" }, "withdrawn",
          { status: "early" }, "UA1214 +25min has a ✓ tail (N2)");
        const nA = buildGuardNotification({ fn: "UA1596", date: "2026-08-05", tail: "N1" }, "publish-yes",
          { status: "yes", tail: "N1" }, "SHOULD NOT APPEAR");
        return {
          states: ["publish-yes", "swap-gained", "swap-yes-yes", "publish-no", "swap-lost", "swap-no-no",
            "withdrawn", "first-early", "invalid", "unknown"].map(notifyState),
          wYes: worsened("withdrawn", tripYes),
          wNo: worsened("withdrawn", tripNo),
          wPublishNo: worsened("publish-no", tripYes),
          wFirstEarly: worsened("first-early", tripYes),
          withdrawnTitle: nW ? nW.title : "",
          withdrawnMsg: nW ? nW.message : "",
          aMsg: nA ? nA.message : "",
          pUnc: parseCheck("UA1596 on 2026-08-05: aircraft assigned to tail N77777 (equipment record unavailable)"),
          pNo: parseCheck("❌ No Starlink: UA1596 assigned to tail N88888 (Viasat)").status,
          acWithdraw: applyCheckResult({ lastStatus: "yes", tail: "N1", history: [{ ts: now, status: "yes", tail: "N1" }] },
            { status: "early" }, now).transition,
          acUnc: (() => { const r = applyCheckResult({ lastStatus: "early", history: [] },
            { status: "unconfirmed", tail: "N3" }, now); return { t: r.transition, n: r.shouldNotify }; })(),
        };
      });
      const checks = {
        stateFoldingExact: eq(res.states, ["A", "A", "A", "B", "B", "B", "C", null, null, null]),
        withdrawnAfterYesWorsened: res.wYes === true,
        withdrawnAfterNoNotWorsened: res.wNo === false,
        publishNoWorsened: res.wPublishNo === true,
        firstEarlyNotWorsened: res.wFirstEarly === false,
        cCopyIsAwaitingOnlyForWithdrawn: /no assignment yet/.test(res.withdrawnTitle),
        aToCRescueCarried: /Better option you saw:/.test(res.withdrawnMsg),
        routeBackCuePresent: /Open booking ↗/.test(res.withdrawnMsg),
        aStateNeverCarriesRescue: !/Better option/.test(res.aMsg),
        parseUnconfirmedBranch: !!res.pUnc && res.pUnc.status === "unconfirmed" && res.pUnc.tail === "N77777",
        parseConfirmedNoIntact: res.pNo === "no",
        withdrawnTransition: res.acWithdraw === "withdrawn",
        unconfirmedTimelineOnly: res.acUnc.t === "unconfirmed" && res.acUnc.n === false,
      };
      return { appeared: true, panelText: JSON.stringify(res, null, 1), badges: [], probe: null, checks };
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
      // {p, conf, obs} → full control of the response's calibrated-confidence
      // field. conf:null OMITS the field entirely (the missing-confidence
      // fixture: the display must stay unlabeled and the winner ineligible).
      if (v && typeof v === "object" && typeof v.p === "number") {
        const body = { probability: v.p, n_observations: v.obs == null ? 50 : v.obs };
        if (v.conf !== null) body.confidence = v.conf || "high";
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
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
    const extId = swUrl ? swUrl.replace("chrome-extension://", "").split("/")[0] : null;

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
      if (ONLY && !ONLY.test(c.name)) continue;
      currentFixture = c.navan
        ? navanFixture({ o: c.o, d: c.d, rows: c.rows, topHtml: c.topHtml })
        : fixture({ o: c.o, d: c.d, rows: c.rows });
      trackerFail = !!c.trackerFail;
      MOCK = c.mock || {};
      PREDICT_HITS = {};   // reset the per-flight attempt tally for this case
      // Deterministic viewport per case (visual case changes it mid-drive).
      try { await page.setViewportSize({ width: 1280, height: 800 }); } catch (e) {}
      // The persistent context shares chrome.storage.local across cases, so a
      // prior case's uslPrioritize/uslCollapsed would leak into the next. Reset
      // it before every case so each starts from the shipped defaults (nothing
      // reorders cross-carrier by default).
      if (sw) { try { await sw.evaluate(() => chrome.storage.local.clear()); } catch (e) {} }
      // Cross-model cases seed Guard trips BEFORE the page loads, so the
      // content script's tripList read sees them (same store the popup renders).
      if (c.seedTrips && sw) {
        try { await sw.evaluate((t) => chrome.storage.local.set({ uslTrips: t }), c.seedTrips); } catch (e) {}
      }
      // Seed arbitrary settings BEFORE the page loads, so a stored value is in
      // place at first paint — that is the only way to test that a stored OFF
      // is honoured on the very first render rather than after a tick.
      if (c.seedStorage && sw) {
        try { await sw.evaluate((o) => chrome.storage.local.set(o), c.seedStorage); } catch (e) {}
      }
      // Most cases search a far date (stable, no firm-tail ✓). A case may opt
      // into a near date (dateOffsetDays) to exercise the confirmed-tail path.
      const searchDate = c.dateOffsetDays != null ? isoDaysFromNow(c.dateOffsetDays) : farDate();
      const url = c.navan
        ? `https://app.navan.com/app/user2/search/flights-ngs/${c.o}-${c.d}-${searchDate}`
        : `https://www.united.com/en/us/fsr/choose-flights?f=${c.o}&t=${c.d}&d=${searchDate}&tt=1`;

      // Multi-step cases drive themselves.
      if (c.driver) {
        let r;
        try { r = await c.driver({ page, url, context, sw, extId }); }
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
      // Structured probe for every standard case: strip state/a11y attributes,
      // CTA/token presence, ring, boundary count and badge groups.
      const probe = await page.evaluate(stripProbe).catch(() => null);
      const shot = join(SHOTS, c.name + ".png");
      try { await page.screenshot({ path: shot, fullPage: true }); } catch (e) {}

      const checks = c.expectNoPanel ? { panelSuppressed: !appeared } : c.expect(panelText, badges, probe);
      // Composited border probe for cases that declare a meaningful border.
      if (c.frameProbe && !c.expectNoPanel) {
        const fr = await frameContrast(page, c.frameProbe);
        if (probe) probe.frameContrast = fr;
        process.stderr.write(`  frameContrast(${c.frameProbe}) = ${fr}\n`);
        checks.meaningfulBorderContrast = fr !== null && fr >= 3.0;
      }
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
    for (const r of failedChecks) {
      const bad = Object.entries(r.checks).filter(([, v]) => v !== true).map(([k]) => k);
      reasons.push(`${r.name} ${r.appeared ? "FAILED: " + bad.join(",") : "panel MISSING"}`);
    }
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
