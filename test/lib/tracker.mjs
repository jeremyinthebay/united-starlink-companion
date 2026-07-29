// tracker.mjs — polite client + parsers for the Starlink tracker APIs.
//
// The parsers here MIRROR the extension's own (extension/bg.js): parseFlights,
// parsePredict, mapItineraries, parseCheck. That is deliberate — the harness
// must decode a response into exactly what the extension would show, so a
// harness "pass" means "the extension would display this", not "the raw JSON
// looked fine". If bg.js changes a regex, this file must change with it; the
// parity check in phase1 flags drift by comparing endpoints against each other.
//
// Politeness: single-flight throttle, honest identifying User-Agent, no proxy,
// no concurrency. This is @martinamps' tracker; we are a guest on it.

const BASES = {
  UA: "https://unitedstarlinktracker.com",
  AS: "https://alaskastarlinktracker.com",
};
const UA_STRING =
  "wifiodds-test-harness/1.0 (+https://wifiodds.com; extension display + data audit; throttled, no proxy)";

// One global gate so nothing here ever fires two requests at once, whatever the
// caller does. THROTTLE_MS is the floor between the END of one request and the
// START of the next.
let THROTTLE_MS = 1200;
let lastEnd = 0;
export function setThrottle(ms) { THROTTLE_MS = ms; }
async function gate() {
  const wait = lastEnd + THROTTLE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function apiBase(airline) { return BASES[airline] || BASES.UA; }

// A single GET with timeout + one polite retry on network/5xx. Returns
// { ok, status, json, text, err }.
export async function apiGet(airline, path, { timeoutMs = 12000, retries = 1 } = {}) {
  const url = apiBase(airline) + path;
  for (let attempt = 0; ; attempt++) {
    await gate();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA_STRING, Accept: "application/json" },
        signal: ctrl.signal,
      });
      const text = await res.text();
      lastEnd = Date.now();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* not json */ }
      if (!res.ok && res.status >= 500 && attempt < retries) { await sleep(2000); continue; }
      return { ok: res.ok, status: res.status, json, text, url };
    } catch (e) {
      lastEnd = Date.now();
      if (attempt < retries) { await sleep(2000); continue; }
      return { ok: false, status: 0, json: null, text: "", err: String(e && e.message || e), url };
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function mcpCall(airline, name, args, { timeoutMs = 15000, retries = 1 } = {}) {
  const url = apiBase(airline) + "/mcp";
  for (let attempt = 0; ; attempt++) {
    await gate();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": UA_STRING,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      lastEnd = Date.now();
      if (!res.ok && res.status >= 500 && attempt < retries) { await sleep(2000); continue; }
      return { ok: res.ok, status: res.status, text: extractMcpText(raw), raw, url };
    } catch (e) {
      lastEnd = Date.now();
      if (attempt < retries) { await sleep(2000); continue; }
      return { ok: false, status: 0, text: null, raw: "", err: String(e && e.message || e), url };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── parsers, mirrored from extension/bg.js ─────────────────────────────────
export function extractMcpText(rawBody) {
  let j = null;
  try { j = JSON.parse(rawBody); }
  catch (e) {
    const m = rawBody.match(/data: (.*)/);
    if (m) { try { j = JSON.parse(m[1]); } catch (e2) { j = null; } }
  }
  if (!j) return null;
  try { return j.result.content[0].text || null; } catch (e) { return null; }
}

// predict_route_starlink prose → per-flight rows (bg.js parseFlights).
export function parseFlights(text) {
  if (!text) return [];
  const re = /^\s*([A-Z]{2}\d+)\s+\[(\w+)\]\s+\(([A-Z]{3})-([A-Z]{3})\)\s+(\d+)%\s+\((\d+) obs · (\w+) confidence\)/gm;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ fn: m[1], fleet: m[2], o: m[3], d: m[4], prob: parseInt(m[5], 10), obs: parseInt(m[6], 10), conf: m[7] });
  }
  return out;
}

// /api/predict-flight JSON → the extension's per-flight badge value, or null
// when the tracker has no probability (the "n/a" display), or undefined on
// error. Mirrors bg.js predictFlights mapping.
export function parsePredict(json) {
  if (json && typeof json.probability === "number") {
    return { prob: Math.round(json.probability * 100), obs: json.n_observations || 0, conf: json.confidence || "low",
             rawProb: json.probability, method: json.method || null };
  }
  return null;
}

// /api/plan-route JSON → itineraries (bg.js mapItineraries), keeping leg probs.
export function mapItineraries(json) {
  if (!json || !Array.isArray(json.itineraries)) return [];
  return json.itineraries.slice(0, 6).map((it) => ({
    via: it.via || [],
    joint: Math.round((it.joint_probability || 0) * 100),
    any: Math.round((it.at_least_one_probability || 0) * 100),
    coverage: it.coverage,
    hours: Math.round((it.total_flight_hours || 0) * 10) / 10,
    legs: (it.legs || []).map((leg) => ({ fn: leg.flight_number, route: leg.route,
      p: leg.probability, pct: Math.round((leg.probability || 0) * 100), obs: leg.n_observations, confirmed: !!leg.confirmed })),
  }));
}

// MCP check_flight prose → status object (bg.js parseCheck, UA branch).
export function parseCheck(text) {
  if (!text) return { status: "unknown" };
  if (/is (?:scheduled on a verified|assigned to a) Starlink aircraft/.test(text)) {
    const tail = (text.match(/tail (N[A-Z0-9]+)/) || [])[1];
    const rt = text.match(/\(([A-Z]{3})→([A-Z]{3})\)/);
    const dep = (text.match(/Departs ([0-9T:.\-]+Z)/) || [])[1];
    return { status: "yes", tail, route: rt ? rt[1] + "-" + rt[2] : null, departs: dep || null };
  }
  const no = text.match(/❌ No Starlink:[\s\S]*?assigned to tail (N[A-Z0-9]+) \(([^)]+)\)/);
  if (no) return { status: "no", tail: no[1], equip: no[2] };
  if (/assignment not yet published|no assignment data/i.test(text)) {
    const p = (text.match(/~?(\d+)% Starlink probability/) || [])[1];
    return { status: "early", prob: p ? parseInt(p, 10) : null };
  }
  if (/doesn't exist|outside the (?:UA|AS)/.test(text)) return { status: "invalid" };
  return { status: "unknown" };
}

// What the extension's united.com PANEL would render for a route, mirroring
// content.js renderPanel() EXACTLY. The subtlety that matters:
//   · the body's first block is the direct-flight list, OR — when that list is
//     empty — the literal string "No Starlink history on this route yet."
//   · the connection row is a SEPARATE block appended below, shown whenever
//     plan-route yields an itinerary with via.length && coverage === "full".
// So when a route has no direct history but DOES have a full-coverage
// connection, the panel shows the "no history" line AND the connection line
// together — the two can contradict each other. That coexistence is modelled
// here, not smoothed over, because it is the display bug we are hunting.
export function panelForRoute({ routeText, itins }) {
  const flights = parseFlights(routeText).slice().sort((a, b) => b.prob - a.prob);
  const connRow = (itins || []).find((it) => it.via && it.via.length && it.coverage === "full") || null;
  const empty = flights.length === 0;
  return {
    flights,
    empty,
    emptyText: "No Starlink history on this route yet.",
    // The connection row the panel actually appends (coverage==="full" only).
    connectionRow: connRow ? { via: connRow.via, joint: connRow.joint, coverage: connRow.coverage } : null,
    // TRUE when the panel would print the empty-state copy directly above a
    // real connection — the contradiction.
    contradiction: empty && !!connRow,
    // Connections the API knows but the panel never shows (coverage != full).
    droppedConnections: (itins || []).filter((it) => it.via && it.via.length && it.coverage !== "full")
      .map((c) => ({ via: c.via, joint: c.joint, coverage: c.coverage })),
  };
}
