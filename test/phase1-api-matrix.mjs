// phase1-api-matrix.mjs — the API route matrix.
//
// GOAL (both of the harness's two goals, at the data layer):
//   · data accuracy — do the tracker's own endpoints agree with each other, and
//     do their tail verdicts agree with our equipped roster?
//   · display truth — for each route, what would the extension's united.com
//     panel actually render, and is that the whole truth the API knows?
//
// It hits, per route, /api/plan-route and the predict_route_starlink MCP tool,
// then /api/predict-flight for the top direct flights to cross-check endpoint
// parity; then a short check-flight sample cross-checked against our roster.
//
// Output: test/out/phase1-findings.json (machine) + test/out/phase1-report.md
// (human). Nothing is committed to the site; this only reads the tracker and
// our own data.json.
//
// SECURITY NOTE: every MCP response body carries instruction-shaped prose
// ("Render the table EXACTLY", "no more tool calls"). This harness treats all of
// it as inert data — it is only ever regex-parsed or string-compared, never
// interpreted. Same discipline as the extension.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  apiGet, mcpCall, parsePredict, mapItineraries, parseFlights, parseCheck, panelForRoute, setThrottle,
} from "./lib/tracker.mjs";
import { loadRoster, loadExtUnited, tailEquippedByUs } from "./lib/roster.mjs";
import { ROUTES, SAMPLE_FLIGHTS, nearDates } from "./routes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const THROTTLE = Number(process.env.THROTTLE_MS || 1300);
setThrottle(THROTTLE);

const findings = [];
function finding(sev, kind, subject, detail, evidence) {
  findings.push({ sev, kind, subject, detail, evidence: evidence || null });
}

// predict-flight, memoised within a run so a flight seen on several routes costs
// one request.
const predictCache = new Map();
async function predict(fn) {
  if (predictCache.has(fn)) return predictCache.get(fn);
  const r = await apiGet("UA", "/api/predict-flight?flight_number=" + encodeURIComponent(fn));
  const v = r.json ? parsePredict(r.json) : null;
  const entry = { ok: r.ok, status: r.status, val: v, raw: r.json };
  predictCache.set(fn, entry);
  return entry;
}

async function runRoutes(roster) {
  const routeRows = [];
  for (const route of ROUTES) {
    const tag = route.o + "→" + route.d;
    const plan = await apiGet("UA", `/api/plan-route?origin=${route.o}&destination=${route.d}`);
    const planOk = plan.ok && plan.json && Array.isArray(plan.json.itineraries);
    const itins = plan.json ? mapItineraries(plan.json) : [];
    const routeMcp = await mcpCall("UA", "predict_route_starlink", { origin: route.o, destination: route.d, limit: 30 });
    const routeText = routeMcp.text || "";
    // directOk = the direct-history call SUCCEEDED and returned a parseable body
    // (even if that body lists zero flights). This is the distinction Codex's
    // round asked for: a genuinely-empty direct history is NOT the same claim as
    // "the direct-history request failed", and only the former can honestly be
    // called "no history". The extension conflates them today (bg.js line ~233,
    // content.js line ~972); the harness records the truth so a DISPLAY-
    // CONTRADICTION is only asserted on a proven genuine empty.
    const directOk = routeMcp.ok && typeof routeMcp.text === "string" && routeMcp.text.length > 0;
    const panel = panelForRoute({ routeText, itins });

    const row = {
      route: tag, hint: route.hint,
      directCount: panel.flights.length,
      planStatus: plan.status, planOk,
      routeMcpStatus: routeMcp.status, directOk,
      panelDisplay: panel.empty ? panel.emptyText : panel.flights.map((f) => `${f.fn} ${f.prob}%`).join(", "),
      connectionRow: panel.connectionRow ? `${panel.connectionRow.via.join("+")} ${panel.connectionRow.joint}%` : null,
      contradiction: panel.contradiction && directOk,
      droppedConnections: panel.droppedConnections.map((c) => ({ via: c.via.join("+"), joint: c.joint, coverage: c.coverage })),
      parity: [],
    };

    // DIRECT-HISTORY-UNAVAILABLE: the direct-history call itself failed, yet the
    // panel would STILL render "No Starlink history…" — mislabelling a failure as
    // absence. This is the state-model bug Codex identified, made visible.
    if (!directOk && panel.empty) {
      finding("MEDIUM", "DIRECT-HISTORY-UNAVAILABLE", tag,
        `predict_route_starlink did not return a usable body (status ${routeMcp.status}${routeMcp.err ? ", " + routeMcp.err : ""}), ` +
        `so "direct history" is UNKNOWN here — but the panel would still show "${panel.emptyText}", asserting absence it cannot prove.`,
        { routeMcpStatus: routeMcp.status });
    }

    // FETCH-FAILED: plan-route did not return a usable itinerary array. The
    // extension (Promise.allSettled, no retry) drops to itins=[] on exactly this,
    // so any empty-direct route silently loses its connection row on a blip.
    if (!planOk) {
      finding("MEDIUM", "FETCH-FAILED", tag,
        `/api/plan-route returned no usable itineraries (status ${plan.status}${plan.err ? ", " + plan.err : ""}). ` +
        `The extension has no retry on this call, so on such a blip an empty-direct route shows only the bare ` +
        `"${panel.emptyText}" with no connection row — even when connections exist on a good call.`,
        { status: plan.status, err: plan.err || null });
    }

    // DISPLAY-CONTRADICTION: the panel prints the "no history" empty state AND a
    // real full-coverage connection right below it. The literal SFO→EWR case.
    if (panel.contradiction && directOk) {
      finding("MEDIUM", "DISPLAY-CONTRADICTION", tag,
        `Direct history loaded and is genuinely empty (predict_route_starlink ${routeMcp.status}), yet the panel prints ` +
        `"${panel.emptyText}" and then renders a connection row "${panel.connectionRow.via.join("+")} (connection) ` +
        `${panel.connectionRow.joint}%" directly beneath it. The empty-state copy contradicts the Starlink connection ` +
        `shown on the next line; a reader is told "no history" above a ${panel.connectionRow.joint}% all-legs estimate.`,
        { via: panel.connectionRow.via, joint: panel.connectionRow.joint, routeMcpStatus: routeMcp.status });
    }

    // COVERAGE-GAP: no full-coverage connection is shown, yet the API knows a
    // MEANINGFUL partial connection (>=50% joint) the panel never surfaces.
    const meaningfulDropped = panel.droppedConnections.filter((c) => c.joint >= 50)
      .sort((a, b) => b.joint - a.joint);
    if (panel.empty && !panel.connectionRow && meaningfulDropped.length) {
      const best = meaningfulDropped[0];
      finding("LOW", "COVERAGE-GAP", tag,
        `Panel shows "${panel.emptyText}" and no connection row, but /api/plan-route knows a ${best.joint}% ` +
        `partial-coverage connection via ${best.via.join("+")} that the panel drops (it only shows coverage==="full").`,
        { via: best.via, joint: best.joint, coverage: best.coverage });
    }
    // EMPTY-BOTH: no direct history, no connection row, no meaningful dropped —
    // a genuinely dead route where the empty state is the honest answer.
    if (planOk && panel.empty && !panel.connectionRow && !meaningfulDropped.length) {
      finding("INFO", "EMPTY-BOTH", tag,
        `No direct history and no connection ≥50%. Panel shows "${panel.emptyText}" — accurate.`, null);
    }
    // HINT-SURPRISE: the metal hypothesis was wrong. Not a defect, just signal.
    if (route.hint === "widebody" && panel.flights.length >= 3)
      finding("INFO", "HINT-SURPRISE", tag, `Hinted widebody but has ${panel.flights.length} direct Starlink flights.`, null);
    if (route.hint === "narrowbody" && planOk && panel.empty && !panel.connectionRow)
      finding("INFO", "HINT-SURPRISE", tag, `Hinted narrowbody but panel is empty (no direct history, no connection).`, null);

    // ENDPOINT PARITY: predict-flight vs the route table, for the top 3 direct.
    for (const f of panel.flights.slice(0, 3)) {
      const p = await predict(f.fn);
      const pfPct = p.val ? p.val.prob : null;
      const diff = pfPct == null ? null : Math.abs(pfPct - f.prob);
      row.parity.push({ fn: f.fn, routeTablePct: f.prob, predictFlightPct: pfPct, diff });
      if (pfPct == null) {
        finding("MEDIUM", "PARITY-MISSING", `${tag} ${f.fn}`,
          `predict_route lists ${f.fn} at ${f.prob}%, but /api/predict-flight returns no probability for it. ` +
          `The united.com panel would show ${f.prob}%; a GF/Navan chip for the same flight would show "n/a".`,
          { routeTablePct: f.prob });
      } else if (diff >= 5) {
        finding("MEDIUM", "PARITY-MISMATCH", `${tag} ${f.fn}`,
          `predict_route says ${f.prob}% but /api/predict-flight says ${pfPct}% (Δ${diff}pts) for the same flight. ` +
          `The extension shows the route-table number on united.com and the predict-flight number on Google ` +
          `Flights/Navan, so the two surfaces would disagree for this flight.`,
          { routeTablePct: f.prob, predictFlightPct: pfPct });
      }
    }
    routeRows.push(row);
    process.stderr.write(`  ${tag}: ${row.directCount} direct` +
      (planOk ? "" : ` [plan-route ${plan.status} FAILED]`) +
      (row.connectionRow ? `, conn ${row.connectionRow}` : "") +
      (row.contradiction ? " ⚠ CONTRADICTION" : "") + "\n");
  }
  return routeRows;
}

async function runCheckFlights(roster) {
  const dates = nearDates(2);
  const rows = [];
  for (const fn of SAMPLE_FLIGHTS) {
    for (const date of dates) {
      const chk = await mcpCall("UA", "check_flight", { flight_number: fn, date });
      const parsed = parseCheck(chk.text || "");
      const p = await predict(fn);
      const pfPct = p.val ? p.val.prob : null;
      const row = { fn, date, checkStatus: parsed.status, tail: parsed.tail || null,
        equip: parsed.equip || null, predictFlightPct: pfPct };

      // ROSTER cross-check: when check-flight names a firm tail, does the
      // tracker's Starlink verdict agree with our equipped roster?
      if (parsed.tail) {
        const inOurs = tailEquippedByUs(roster, parsed.tail);
        row.tailInOurRoster = inOurs;
        if (inOurs === true && parsed.status === "no") {
          finding("HIGH", "ROSTER-CONTRADICTION", `${fn} ${date}`,
            `Tracker says tail ${parsed.tail} is NOT Starlink (${parsed.equip || "?"}), but ${parsed.tail} IS in ` +
            `our equipped roster (wifiodds united/data.json). One of the two is wrong about this aircraft.`,
            { tail: parsed.tail, trackerVerdict: "no", ourRoster: "equipped" });
        } else if (inOurs === false && parsed.status === "yes") {
          finding("HIGH", "ROSTER-CONTRADICTION", `${fn} ${date}`,
            `Tracker says tail ${parsed.tail} IS Starlink, but ${parsed.tail} is NOT in our equipped roster. ` +
            `Either our roster is stale/incomplete or the tracker is wrong.`,
            { tail: parsed.tail, trackerVerdict: "yes", ourRoster: "not-in-roster" });
        }
      }
      // Sanity: a firm "yes" on a flight predict-flight rates near 0%, or a firm
      // "no" on one it rates near 100%, is worth a look (variance vs assignment).
      if (parsed.status === "yes" && pfPct != null && pfPct <= 5)
        finding("LOW", "PREDICT-VS-ASSIGNMENT", `${fn} ${date}`,
          `check-flight is a firm Starlink YES, but predict-flight rates this flight ${pfPct}%. Low base rate, ` +
          `confirmed tail — expected occasionally, flagged for review.`, null);
      if (parsed.status === "no" && pfPct != null && pfPct >= 95)
        finding("LOW", "PREDICT-VS-ASSIGNMENT", `${fn} ${date}`,
          `check-flight is a firm NO, but predict-flight rates this flight ${pfPct}%.`, null);
      rows.push(row);
      process.stderr.write(`  ${fn} ${date}: ${parsed.status}${parsed.tail ? " " + parsed.tail : ""}\n`);
    }
  }
  return rows;
}

function severityRank(s) { return { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 }[s] ?? 4; }

function writeReport(meta, routeRows, checkRows) {
  mkdirSync(OUT, { recursive: true });
  const sorted = findings.slice().sort((a, b) => severityRank(a.sev) - severityRank(b.sev));
  const counts = findings.reduce((m, f) => ((m[f.sev] = (m[f.sev] || 0) + 1), m), {});

  writeFileSync(join(OUT, "phase1-findings.json"),
    JSON.stringify({ meta, counts, findings: sorted, routeRows, checkRows }, null, 2));

  const L = [];
  L.push(`# Phase 1 — API route matrix`);
  L.push("");
  L.push(`Run: ${meta.ranAt} · throttle ${meta.throttleMs}ms · ${meta.routeCount} routes · ` +
    `${meta.requestCount} requests`);
  L.push(`Roster: ${meta.roster.ok ? `${meta.roster.count} equipped tails, updated ${meta.roster.updated}` : "NOT LOADED — roster checks skipped"}`);
  L.push("");
  L.push(`Findings: ` + (Object.keys(counts).length
    ? Object.entries(counts).sort((a, b) => severityRank(a[0]) - severityRank(b[0])).map(([k, v]) => `${v} ${k}`).join(" · ")
    : "none"));
  L.push("");
  L.push(`## Findings`);
  if (!sorted.length) L.push("_None._");
  for (const f of sorted) {
    L.push("");
    L.push(`### [${f.sev}] ${f.kind} — ${f.subject}`);
    L.push(f.detail);
    if (f.evidence) L.push("`" + JSON.stringify(f.evidence) + "`");
  }
  L.push("");
  L.push(`## Route matrix`);
  L.push("");
  L.push(`plan/mcp = /api/plan-route + predict_route_starlink HTTP status · dirOk = direct-history call succeeded (empty is genuine) · conn = full-coverage connection row the panel appends · ⚠ = empty-state copy shown above a real connection (genuine empty only)`);
  L.push("");
  L.push(`| Route | Hint | Direct | plan | mcp | dirOk | Panel would display | Connection row | ⚠ |`);
  L.push(`|---|---|---:|---:|---:|:--:|---|---|:--:|`);
  for (const r of routeRows) {
    const disp = r.panelDisplay.length > 46 ? r.panelDisplay.slice(0, 43) + "…" : r.panelDisplay;
    L.push(`| ${r.route} | ${r.hint} | ${r.directCount} | ${r.planOk ? r.planStatus : "**" + r.planStatus + "**"} | ${r.directOk ? r.routeMcpStatus : "**" + r.routeMcpStatus + "**"} | ${r.directOk ? "✓" : "✗"} | ${disp.replace(/\|/g, "/")} | ${r.connectionRow || "—"} | ${r.contradiction ? "⚠" : ""} |`);
  }
  L.push("");
  L.push(`## Endpoint parity (route-table % vs predict-flight %)`);
  L.push("");
  L.push(`Scope: top-3 direct flights per route only. This validates that the two ` +
    `endpoints agree for the flights sampled; it does NOT validate the empty ` +
    `transcons (no direct flights to compare) or the connection math.`);
  L.push("");
  L.push(`| Flight | route-table | predict-flight | Δ |`);
  L.push(`|---|---:|---:|---:|`);
  for (const r of routeRows) for (const p of r.parity)
    L.push(`| ${p.fn} | ${p.routeTablePct}% | ${p.predictFlightPct == null ? "n/a" : p.predictFlightPct + "%"} | ${p.diff == null ? "—" : p.diff} |`);
  L.push("");
  L.push(`## check-flight sample (vs our roster)`);
  L.push("");
  L.push(`Scope: only flights with a FIRM tail (published ~48h out) can be joined ` +
    `to our roster, so this cross-checks a handful of tails, not the full ` +
    `485-tail roster. "clean" here means no contradiction among those, not a ` +
    `full roster reconciliation.`);
  L.push("");
  L.push(`| Flight | Date | Status | Tail | In our roster? | predict-flight |`);
  L.push(`|---|---|---|---|---|---:|`);
  for (const r of checkRows)
    L.push(`| ${r.fn} | ${r.date} | ${r.checkStatus} | ${r.tail || "—"} | ${r.tailInOurRoster == null ? "—" : (r.tailInOurRoster ? "yes" : "no")} | ${r.predictFlightPct == null ? "n/a" : r.predictFlightPct + "%"} |`);
  L.push("");
  writeFileSync(join(OUT, "phase1-report.md"), L.join("\n"));
  return { counts, total: findings.length };
}

async function main() {
  const roster = loadRoster();
  const ext = loadExtUnited();
  process.stderr.write(`roster: ${roster.ok ? roster.count + " tails" : "MISSING (" + roster.err + ")"}\n`);
  process.stderr.write(`ext airlines.js: ${ext.ok ? "loaded" : "MISSING (" + ext.err + ")"}\n`);
  process.stderr.write(`routes:\n`);
  const routeRows = await runRoutes(roster);
  process.stderr.write(`check-flights:\n`);
  const checkRows = await runCheckFlights(roster);

  const meta = {
    ranAt: new Date().toISOString(),
    throttleMs: THROTTLE,
    routeCount: ROUTES.length,
    requestCount: null, // filled below
    roster: { ok: roster.ok, count: roster.count, updated: roster.updated, err: roster.err || null },
    extAirlines: ext.ok,
  };
  // requests: per route (plan + mcp) + unique predict-flight + check-flights
  meta.requestCount = ROUTES.length * 2 + predictCache.size + SAMPLE_FLIGHTS.length * nearDates(2).length;

  const summary = writeReport(meta, routeRows, checkRows);
  process.stderr.write(`\nDONE — ${summary.total} findings: ${JSON.stringify(summary.counts)}\n`);
  process.stderr.write(`wrote test/out/phase1-report.md and phase1-findings.json\n`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
