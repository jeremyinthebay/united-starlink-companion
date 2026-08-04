// bg.js — MV3 service worker. Proxies the Starlink tracker data for
// content.js / popup.js, with a 6h chrome.storage.local cache.

/* ── per-airline API routing (1.6) ─────────────────────────────────────────
 * Same developer, same API shape, two hosts. Everything below routes by a
 * two-letter airline code that defaults to "UA", so every pre-1.6 call site
 * keeps its exact behavior (same URLs, same cache keys) when it passes nothing.
 * ─────────────────────────────────────────────────────────────────────────── */
const API_BASES = {
  UA: "https://unitedstarlinktracker.com",
  AS: "https://alaskastarlinktracker.com",
};
// Operating-carrier prefixes that belong to a tracker (OO/QX fly Alaska regional).
const AIRLINE_BY_PREFIX = { UA: "UA", AS: "AS", OO: "AS", QX: "AS" };
// Note: alaskastarlinktracker.com is NOT in host_permissions and does not need
// to be — it answers with `access-control-allow-origin: *` on both /api/* and
// /mcp (preflight included), so the worker's fetch succeeds under plain CORS.
// If that ever tightens, add the host to manifest host_permissions.
//
/* ── HAWAIIAN (HA): deliberately absent from API_BASES ─────────────────────
 * Probed airlinestarlinktracker.com on 2026-07-24 (same developer, same MCP
 * shape, `access-control-allow-origin: *`). It IS a third tracker and it DOES
 * know HA — `{"error":"Airline not tracked. Tracked: UA, HA, AS"}` for DL1 —
 * but it publishes no per-flight signal for Hawaiian:
 *   GET /api/predict-flight?flight_number=HA1  → 200, {"confidence":"type",
 *       "message":"…determined by aircraft type…"} and NO `probability` field
 *       (adding &date=… changes nothing). UA1/AS1 on the same host DO return
 *       `probability`, so this is HA-specific, not a host-wide gap.
 *   GET /api/check-flight?flight_number=HA11&date=…
 *                                           → 200, {"hasStarlink":null,
 *       "airline":"Hawaiian Airlines","flights":[]}
 *   POST /mcp tools/call check_flight HA11   → "no assignment data" + the same
 *       aircraft-type sentence. No tail, ever.
 *   GET /api/plan-route?origin=HNL&…         → 404 (not implemented here).
 * Wiring HA into API_BASES would therefore add a cache namespace and a dropdown
 * option that can only ever render "n/a". HA stays COARSE: ConnectScore 69 from
 * airlines.js (42/61 × starlink × free), shown in the popup and on the Google
 * Flights chips. Re-probe before promoting it — the fix is upstream, not here.
 * ─────────────────────────────────────────────────────────────────────────── */

function normAirline(a) {
  const k = String(a || "").toUpperCase();
  return API_BASES[k] ? k : "UA";
}
// "AS1234" → "AS"; anything unrecognized → "UA" (the pre-1.6 default).
function airlineOf(fn) {
  const m = String(fn || "").toUpperCase().match(/^([A-Z]{2})\d{1,4}$/);
  return (m && AIRLINE_BY_PREFIX[m[1]]) || "UA";
}
function apiBase(airline) {
  return API_BASES[normAirline(airline)];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 9000;

// Message-safe ATTEMPTED-failure sentinel for per-flight predictions. Chrome's
// runtime messaging serializes with structured clone, which DROPS any property
// whose value is `undefined`; a failed flight encoded as undefined therefore
// arrives with its key ABSENT, and content.js reads an absent key as "beyond the
// 25-flight cap, not attempted" and retries forever with no penalty (audit: one
// HTTP-500 flight requested 18× in 15s, never settling). A plain string survives
// serialization and is distinct from null (genuine n/a) and from a numeric-odds
// object. content.js's requestPredictions matches this EXACT value — keep both
// files in sync.
const PREDICT_ERR = "error";

// United keeps the original "usl:SFO-SEA" shape so existing cached entries stay
// valid; every other airline is namespaced so routes can never collide.
function cacheKey(o, d, airline) {
  const a = normAirline(airline);
  return a === "UA" ? "usl:" + o + "-" + d : "usl:" + a + ":" + o + "-" + d;
}
function predictCacheKey(fn, airline) {
  const a = normAirline(airline);
  return a === "UA" ? "uslpf:" + fn : "uslpf:" + a + ":" + fn;
}

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Extract the MCP tool-call text payload from either a plain JSON response
// or an SSE-framed one ("data: {...}" lines).
function extractMcpText(rawBody) {
  let j = null;
  try {
    j = JSON.parse(rawBody);
  } catch (e) {
    const m = rawBody.match(/data: (.*)/);
    if (m) {
      try {
        j = JSON.parse(m[1]);
      } catch (e2) {
        j = null;
      }
    }
  }
  if (!j) return null;
  try {
    return j.result.content[0].text || null;
  } catch (e) {
    return null;
  }
}

function parseFlights(text) {
  if (!text) return [];
  // Two-letter operating carrier, not just UA: Alaska's tracker returns AS/OO/QX.
  const re = /^\s*([A-Z]{2}\d+)\s+\[(\w+)\]\s+\(([A-Z]{3})-([A-Z]{3})\)\s+(\d+)%\s+\((\d+) obs · (\w+) confidence\)/gm;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      fn: m[1],
      prob: parseInt(m[5], 10),
      obs: parseInt(m[6], 10),
      conf: m[7],
    });
  }
  return out;
}

function parseDeps(text) {
  if (!text) return [];
  const re = /^([A-Z]{2}\d+)\s+([A-Z]{3})→([A-Z]{3})\s+dep\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})Z\s+\(tail\s+(N[A-Z0-9]+)\)/gm;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      fn: m[1],
      date: m[4],
      time: m[5],
      tail: m[6],
    });
  }
  return out;
}

function mapItineraries(json) {
  if (!json || !Array.isArray(json.itineraries)) return [];
  return json.itineraries.slice(0, 6).map((it) => ({
    via: it.via || [],
    joint: Math.round((it.joint_probability || 0) * 100),
    any: Math.round((it.at_least_one_probability || 0) * 100),
    coverage: it.coverage,
    hours: Math.round((it.total_flight_hours || 0) * 10) / 10,
    legs: (it.legs || []).map((leg) => ({
      fn: leg.flight_number,
      route: leg.route,
      p: leg.probability,
      obs: leg.n_observations,
    })),
  }));
}

async function fetchPlanRoute(o, d, airline) {
  const url = `${apiBase(airline)}/api/plan-route?origin=${o}&destination=${d}`;
  const res = await fetchWithTimeout(url, { method: "GET" });
  if (!res.ok) throw new Error("plan-route http " + res.status);
  const json = await res.json();
  return mapItineraries(json);
}

async function mcpCall(toolName, args, airline) {
  const res = await fetchWithTimeout(`${apiBase(airline)}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(toolName + " http " + res.status);
  const rawBody = await res.text();
  return extractMcpText(rawBody);
}

/* Alaska's predict_route_starlink answers with a one-line prose summary instead
 * of a per-flight table (its odds are equipment-type-derived, not per flight
 * number). Keep it as a display-only note: strip markdown, drop the trailing
 * "use check_flight…" instruction aimed at chat assistants, and cap the length.
 * It is rendered escaped, and nothing in it ever steers control flow. */
function summarizeRouteText(text) {
  if (!text) return null;
  let s = String(text).replace(/[*_`#>]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*(For a specific flight|For dates beyond|Use |Call )[^.]*\.?\s*$/i, "").trim();
  if (s.length > 200) s = s.slice(0, 197).trim() + "…";
  return s.length >= 8 ? s : null;
}

async function fetchFlights(o, d, airline) {
  const text = await mcpCall(
    "predict_route_starlink",
    { origin: o, destination: d, limit: 30 },
    airline
  );
  // A 200 whose body doesn't parse into an MCP text payload is a FAILURE, not an
  // empty route. Throwing here makes getRouteData see it as directOk=false
  // ("history unavailable") instead of a false "no direct history" claim.
  if (text == null) throw new Error("predict_route_starlink: unparseable 200");
  const flights = parseFlights(text);
  // Shape gate: an empty flight list only counts as a GENUINE empty route if the
  // body looks like a real tracker answer (mentions Starlink, or carries the
  // known no-direct / table markers). Generic error/gateway prose or schema
  // drift parses to zero rows too — treat that as a failure, not an absence.
  if (!flights.length && !/starlink|present_verbatim|no direct/i.test(text)) {
    throw new Error("predict_route_starlink: unrecognized response shape");
  }
  // Only surface the note when there is no table to show, and never for United —
  // its UI is byte-for-byte unchanged by this release.
  const useNote = !flights.length && normAirline(airline) !== "UA";
  return { flights, note: useNote ? summarizeRouteText(text) : null };
}

async function fetchDeps(o, d, airline) {
  const text = await mcpCall(
    "search_starlink_flights",
    { origin: o, destination: d, limit: 12 },
    airline
  );
  return parseDeps(text);
}

async function getRouteData(o, d, force, airline) {
  const a = normAirline(airline);
  const key = cacheKey(o, d, a);
  const cached = await chrome.storage.local.get(key);
  const entry = cached[key];
  if (!force && entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      airline: a,
      flights: entry.flights,
      deps: entry.deps,
      itins: entry.itins,
      note: entry.note || null,
      // Whether the direct-history call SUCCEEDED (vs failed) when this entry was
      // built. Default true for pre-2.2 cache entries. This is the flag that lets
      // the panel tell "no direct history" apart from "history unavailable".
      directOk: entry.directOk !== false,
      ts: entry.ts,
      cached: true,
    };
  }

  const [itinsRes, flightsRes, depsRes] = await Promise.allSettled([
    fetchPlanRoute(o, d, a),
    fetchFlights(o, d, a),
    fetchDeps(o, d, a),
  ]);

  const itins = itinsRes.status === "fulfilled" ? itinsRes.value : [];
  const fr = flightsRes.status === "fulfilled" ? flightsRes.value : { flights: [], note: null };
  let flights = fr.flights || [];
  const note = fr.note || null;
  const deps = depsRes.status === "fulfilled" ? depsRes.value : [];
  // directOk: the direct-history (predict_route_starlink) call resolved. A
  // rejection here (network/timeout/5xx) means an EMPTY direct list is "unknown",
  // not a proven "no history" — the distinction the panel copy now depends on.
  const directOk = flightsRes.status === "fulfilled";

  flights = flights.slice().sort((a2, b) => b.prob - a2.prob);

  const ts = Date.now();
  // United's success test is untouched. Airlines whose route tool returns prose
  // (Alaska) count confirmed departures or the summary line as a usable answer.
  const ok = flights.length > 0 || itins.length > 0 ||
    (a !== "UA" && (deps.length > 0 || !!note));

  if (ok) {
    await chrome.storage.local.set({
      [key]: { ts, flights, deps, itins, note, directOk },
    });
  }

  return { ok, airline: a, flights, deps, itins, note, directOk, ts, cached: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "getSelectors") {
    getStoredSelectors().then((cfg) => sendResponse({ ok: true, cfg: cfg || null }));
    return true;
  }
  if (msg.type === "tripAdd") {
    (async () => {
      const trips = await getTrips();
      const fn = String(msg.fn || "").toUpperCase();
      const date = String(msg.date || "");
      let added = false;
      // Duplicate registration is a silent no-op (content.js re-sends on star
      // click); only brand-new trips are validated.
      if (!trips.some((t) => t.fn === fn && t.date === date)) {
        if (!/^(?:UA|AS)\d{1,4}$/.test(fn) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          sendResponse({ ok: false, error: "Enter a flight like UA1812 or AS1 and a date.", trips });
          return;
        }
        if (daysUntil(date) < 0) {
          sendResponse({ ok: false, error: "Date has passed.", trips });
          return;
        }
        if (trips.length >= MAX_TRIPS) {
          sendResponse({ ok: false, error: "Max " + MAX_TRIPS + " guarded trips — remove one first.", trips });
          return;
        }
        // Route-back source comes from the sender. The content script may also
        // supply the visible Guard-time alternatives; newTrip validates,
        // bounds and freezes that snapshot before storage.
        const senderUrl = (sender && (sender.url || (sender.tab && sender.tab.url))) || null;
        trips.push(newTrip(fn, date, msg.route || null, {
          source: msg.source || null,
          sourceUrl: (typeof senderUrl === "string" && /^https:\/\//.test(senderUrl)) ? senderUrl : null,
          shortlist: msg.shortlist,
          guardPrediction: msg.guardPrediction,
        }));
        added = true;
        await setTrips(trips);
      }
      const updated = await runTripChecks(true);
      // Popup-added trips have no page snapshot. Preserve the first grounded
      // result returned by the immediate Guard check; later swaps must not
      // rewrite what the product predicted when the user guarded the flight.
      if (added) {
        const trip = updated.find((t) => t.fn === fn && t.date === date);
        if (trip && !trip.guardPrediction) {
          trip.guardPrediction = normalizeGuardPrediction({
            status: trip.lastStatus || "unknown",
            probability: trip.prob,
            tier: "REPORTED",
            source: airlineOf(fn) === "AS" ? "alaskastarlinktracker.com" : "unitedstarlinktracker.com",
            sourceDate: null,
          });
          await setTrips(updated);
        }
      }
      sendResponse({ ok: true, trips: updated });
    })();
    return true;
  }
  if (msg.type === "tripRemove") {
    (async () => {
      const trips = (await getTrips()).filter((t) => !(t.fn === msg.fn && t.date === msg.date));
      await setTrips(trips);
      sendResponse({ ok: true, trips });
    })();
    return true;
  }
  if (msg.type === "tripOutcome") {
    recordTripOutcome(msg.fn, msg.date, msg.outcome).then((result) => sendResponse(result));
    return true;
  }
  if (msg.type === "tripList") {
    getTrips().then((trips) => sendResponse({ ok: true, trips }));
    return true;
  }
  if (msg.type === "tripCheckNow") {
    runTripChecks(true).then((trips) => sendResponse({ ok: true, trips }));
    return true;
  }
  if (msg.type === "predictFlights") {
    (async () => {
      const out = {};
      const fns = (msg.fns || []).slice(0, 25);
      // Each flight number carries its own airline; msg.airline is only a hint
      // for callers that pass bare numbers. Default stays United.
      const hint = normAirline(msg.airline);
      for (const fn of fns) {
        if (!/^(?:UA|AS)\d{1,4}$/.test(fn)) continue;
        const a = /^(?:UA|AS)/.test(fn) ? airlineOf(fn) : hint;
        const key = predictCacheKey(fn, a);
        const cached = await chrome.storage.local.get(key);
        if (cached[key] && Date.now() - cached[key].ts < CACHE_TTL_MS) { out[fn] = cached[key].v; continue; }
        try {
          const r = await fetchWithTimeout(apiBase(a) + "/api/predict-flight?flight_number=" + fn);
          // A non-2xx (429/500/…) must NOT be cached as a genuine "no data" —
          // that would show a false "n/a" for six hours. Encode it as the
          // message-safe attempted-error sentinel (survives Chrome messaging,
          // unlike undefined) and leave the cache empty so a later scan retries.
          if (!r.ok) { out[fn] = PREDICT_ERR; }
          else {
            const j = await r.json();
            if (j && typeof j.probability === "number") {
              // Real per-flight odds.
              // A missing confidence stays MISSING (null), never coerced to
              // "low": the tracker didn't supply a calibrated label, and R23
              // forbids inventing one. Both are winner-ineligible either way;
              // this keeps the DISPLAY from claiming "Low confidence" unsourced.
              const v = { prob: Math.round(j.probability * 100), obs: j.n_observations || 0, conf: j.confidence || null };
              out[fn] = v;
              await chrome.storage.local.set({ [key]: { ts: Date.now(), v } });
            } else if (j && typeof j === "object" && !Array.isArray(j) && !j.error &&
                       ("flight_number" in j || "confidence" in j || "message" in j)) {
              // RECOGNISED no-data schema (e.g. the HA "determined by aircraft
              // type" shape): a genuine n/a, safe to negative-cache.
              out[fn] = null;
              await chrome.storage.local.set({ [key]: { ts: Date.now(), v: null } });
            } else {
              // Unrecognised / error-shaped 200 — transient, never negative-cache.
              out[fn] = PREDICT_ERR;
            }
          }
        } catch (e) { out[fn] = PREDICT_ERR; }
        await new Promise((rr) => setTimeout(rr, 250));
      }
      sendResponse({ ok: true, flights: out });
    })();
    return true;
  }
    if (msg.type !== "routeData") return false;
  const o = (msg.o || "").toUpperCase();
  const d = (msg.d || "").toUpperCase();
  const airline = normAirline(msg.airline); // optional; defaults to "UA"
  if (!o || !d) {
    sendResponse({ ok: false, airline, flights: [], deps: [], itins: [], ts: Date.now(), cached: false });
    return true;
  }
  getRouteData(o, d, !!msg.force, airline)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({
        ok: false,
        airline,
        error: String(err && err.message ? err.message : err),
        flights: [],
        deps: [],
        itins: [],
        ts: Date.now(),
        cached: false,
      });
    });
  return true; // async response
});

/* ── T-48h trip monitor (v1.4) ─────────────────────────────────────────────
 * Watch specific flight+date pairs; check via the tracker's check_flight tool
 * on a 3h alarm; notify on status changes; badge the toolbar icon.
 * The tool returns prose aimed at chat assistants — we parse it strictly
 * mechanically and ignore any instructions embedded in the text. */
const TRIPS_KEY = "uslTrips";

/* ══ Tail-swap Guardian (v1.6 prototype) ═══════════════════════════════════
 * Upgrades the T-48h monitor into a booking-to-boarding watch: `tail` is a
 * first-class tracked field with per-trip history, so a swap that happens
 * AFTER the assignment publishes (the ✓→✗ case) is caught, not just the first
 * yes/no. All state lives in chrome.storage.local — still no accounts, no
 * server-side user data, flight#+date is the only registration input.
 * Deliberately NOT built here (later phases): email-forward parse address and
 * PWA push (2.0, both need a server endpoint), calendar ingestion (3.0 — OAuth
 * would break the no-accounts promise), confirmation-number paste (needs
 * united.com itinerary scraping).
 * ─────────────────────────────────────────────────────────────────────────── */
const MAX_TRIPS = 10;          // registration cap (also the budget's worst case)
const HISTORY_CAP = 20;        // per-trip history entries, oldest dropped first
const GUARD_BUDGET = 100;      // hard cap on MCP calls per local day
const BUDGET_KEY = "uslGuardBudget";
// Transitions that earn a desktop notification; everything else is timeline-only.
// v2.4: widened past the original four so the three honest states (§4.2) all
// surface — a reassuring same-✓ swap (A), a worse-but-still-✗ swap (B), and a
// regression back to unpublished (C). `unknown` is still never in here.
const NOTIFY_TRANSITIONS = {
  "publish-yes": 1, "publish-no": 1, "swap-lost": 1, "swap-gained": 1,
  "swap-yes-yes": 1, "swap-no-no": 1, "withdrawn": 1,
};

/* v2.4 three-state honest model (guard-and-rescue §4). Folds the internal
 * transition vocabulary into exactly three user-facing states so every
 * notification maps to one defensible claim:
 *   A = Starlink confirmed        B = not Starlink / unconfirmed
 *   C = assignment unavailable    null = timeline-only, do not notify
 * `unknown` never reaches here (applyCheckResult returns before notifying), so
 * a transient failure can never be dressed up as A or B — the load-bearing
 * "unknown is transient" guarantee. */
function notifyState(transition) {
  if (transition === "publish-yes" || transition === "swap-gained" || transition === "swap-yes-yes") return "A";
  if (transition === "publish-no" || transition === "swap-lost" || transition === "swap-no-no") return "B";
  if (transition === "withdrawn") return "C";
  return null; // first-early, none, invalid, unknown → timeline only
}

// Newest history entry that recorded a published tail state, used to tell an
// A→C regression (was ✓, now unpublished) from a B→C one (was ✗, now unpublished).
function lastPublishedStatus(trip) {
  const h = (trip && trip.history) || [];
  for (let i = h.length - 1; i >= 0; i--)
    if (h[i].status === "yes" || h[i].status === "no") return h[i].status;
  return null;
}

/* The "worsened" predicate that earns a rescue line. Per Codex Round 23 P1-02:
 * state B (any concrete non-Starlink assignment) is worsened, AND an A→C
 * `withdrawn` (was confirmed Starlink, tail pulled back to unpublished) is ALSO
 * worsened. A B→C withdrawal, first/continuing early, transient, budget and
 * invalid states are NOT worsened. The rescue is still only shown when
 * capturedAlternative() returns the one genuinely grounded Guard-time option
 * — a worsened state never invents one. */
function worsened(transition, trip) {
  if (notifyState(transition) === "B") return true;
  if (transition === "withdrawn" && lastPublishedStatus(trip) === "yes") return true;
  return false;
}

function newTrip(fn, date, route, opts) {
  opts = opts || {};
  const added = Date.now();
  const trip = {
    fn, date, route: normalizedTripRoute(route), added,
    history: [], asOf: null, lastError: null, lastNotifKey: null,
    invalidCount: 0, departs: null,
    // The shortlist is the bounded, local snapshot visible at Guard time.
    // source/sourceUrl carry the route-back; assignedAt stays null until the
    // @martinamps feed lands — never the departure time.
    source: opts.source || null,
    sourceUrl: opts.sourceUrl || null,
    shortlist: [],
    assignedAt: null,
    guardPrediction: normalizeGuardPrediction(opts.guardPrediction),
    outcome: null,
    outcomePrompted: false,
  };
  trip.shortlist = normalizeShortlist(opts.shortlist, trip, added);
  return trip;
}

const GUARD_SHORTLIST_CAP = 5;
function normalizedTripRoute(value) {
  const m = String(value || "").toUpperCase().match(/^([A-Z]{3})-([A-Z]{3})$/);
  return m && m[1] !== m[2] ? m[1] + "-" + m[2] : null;
}
function trackerSourceFor(fn) {
  return airlineOf(fn) === "AS" ? "alaskastarlinktracker.com" : "unitedstarlinktracker.com";
}
function normalizeShortlist(value, trip, capturedAt) {
  const route = normalizedTripRoute(trip && trip.route);
  const guardedFn = String(trip && trip.fn || "").toUpperCase();
  const date = String(trip && trip.date || "");
  if (!route || !Array.isArray(value) || !Number.isFinite(capturedAt)) return [];
  const frozenAt = capturedAt;
  const unique = new Map();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const fn = String(raw.fn || "").toUpperCase();
    if (!/^(?:UA|AS)\d{1,4}$/.test(fn) || fn === guardedFn || unique.has(fn)) continue;
    if (airlineOf(fn) !== airlineOf(guardedFn)) continue;
    const probability = Number(raw.probability);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) continue;
    unique.set(fn, {
      fn, route, date, probability: Math.round(probability),
      observations: Number.isInteger(raw.observations) && raw.observations >= 0 ? raw.observations : null,
      confidence: ["high", "medium", "low", "type"].includes(raw.confidence) ? raw.confidence : null,
      tier: "REPORTED", source: trackerSourceFor(fn), sourceDate: null,
      capturedAt: frozenAt, decisionEligible: raw.decisionEligible === true,
    });
  }
  const result = [...unique.values()].sort((a, b) =>
    b.probability - a.probability ||
    (b.observations == null ? -1 : b.observations) - (a.observations == null ? -1 : a.observations) ||
    a.fn.localeCompare(b.fn)).slice(0, GUARD_SHORTLIST_CAP);
  if (result.filter((x) => x.decisionEligible).length > 1) {
    for (const item of result) item.decisionEligible = false;
  }
  return result;
}

function normalizeGuardPrediction(value) {
  if (!value || typeof value !== "object") return null;
  const status = ["yes", "no", "early", "unconfirmed", "unknown"].includes(value.status)
    ? value.status : "unknown";
  const probability = typeof value.probability === "number" && value.probability >= 0 && value.probability <= 100
    ? value.probability : null;
  const source = value.source === "alaskastarlinktracker.com"
    ? value.source : "unitedstarlinktracker.com";
  return {
    status,
    probability,
    tier: "REPORTED",
    source,
    sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(value.sourceDate || "") ? value.sourceDate : null,
  };
}

// Default the 1.6 fields onto trips stored by 1.4/1.5. Returns true when
// anything changed so the caller can persist once, lazily.
function migrateTrips(trips) {
  let changed = false;
  for (const t of trips) {
    if (!Array.isArray(t.history)) { t.history = []; changed = true; }
    if (t.asOf === undefined) { t.asOf = t.lastChecked || null; changed = true; }
    if (t.lastError === undefined) { t.lastError = null; changed = true; }
    if (t.lastNotifKey === undefined) { t.lastNotifKey = null; changed = true; }
    if (t.invalidCount === undefined) { t.invalidCount = 0; changed = true; }
    if (t.departs === undefined) { t.departs = null; changed = true; }
    // v2.4 fields on trips saved by 1.4–2.2. Empty/null defaults preserve the
    // exact pre-2.4 behaviour (no shortlist, route-back falls back to carrier).
    if (t.source === undefined) { t.source = null; changed = true; }
    if (t.sourceUrl === undefined) { t.sourceUrl = null; changed = true; }
    const hadShortlistArray = Array.isArray(t.shortlist);
    const shortlist = normalizeShortlist(hadShortlistArray ? t.shortlist : [], t, t.added);
    if (!hadShortlistArray || JSON.stringify(shortlist) !== JSON.stringify(t.shortlist)) {
      t.shortlist = shortlist;
      changed = true;
    }
    if (t.assignedAt === undefined) { t.assignedAt = null; changed = true; }
    if (t.guardPrediction === undefined) { t.guardPrediction = null; changed = true; }
    if (t.outcome === undefined) { t.outcome = null; changed = true; }
    if (t.outcomePrompted === undefined) { t.outcomePrompted = false; changed = true; }
    // Seed one history entry from the pre-1.6 state so the timeline isn't blank.
    if (!t.history.length && t.lastStatus) {
      t.history.push({
        ts: t.lastChecked || Date.now(),
        status: t.lastStatus,
        tail: t.tail || null,
        prob: t.prob != null ? t.prob : null,
      });
      changed = true;
    }
  }
  return changed;
}

async function getTrips() {
  const v = await chrome.storage.local.get(TRIPS_KEY);
  const trips = v[TRIPS_KEY] || [];
  if (migrateTrips(trips)) {
    try { await chrome.storage.local.set({ [TRIPS_KEY]: trips }); } catch (e) {}
  }
  return trips;
}
async function setTrips(trips) {
  await chrome.storage.local.set({ [TRIPS_KEY]: trips });
  await updateBadge(trips);
}
function daysUntil(dateStr) {
  return Math.round((Date.parse(dateStr + "T12:00:00") - Date.now()) / 864e5);
}

/* Wording differs per tracker for the same three states — United says
 * "scheduled on a verified Starlink aircraft" / "assignment not yet published",
 * Alaska says "assigned to a Starlink aircraft" / "no assignment data". Both
 * shapes are matched; the extracted fields (tail, route, Departs …Z) are
 * identical. Everything here is mechanical — embedded prose is never obeyed. */
function parseCheck(text) {
  if (!text) return { status: "unknown" };
  if (/is (?:scheduled on a verified|assigned to a) Starlink aircraft/.test(text)) {
    const tail = (text.match(/tail (N[A-Z0-9]+)/) || [])[1];
    const rt = text.match(/\(([A-Z]{3})→([A-Z]{3})\)/);
    const dep = (text.match(/Departs ([0-9T:.\-]+Z)/) || [])[1];
    return { status: "yes", tail, route: rt ? rt[1] + "-" + rt[2] : null, departs: dep || null };
  }
  const no = text.match(/❌ No Starlink:[\s\S]*?assigned to tail (N[A-Z0-9]+) \(([^)]+)\)/);
  if (no) {
    const alts = [];
    const re = /\|\s*([A-Z]{3})→([A-Z]{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*\d+\s*\|\s*(\d+)%/g;
    let m;
    while ((m = re.exec(text))) alts.push({ route: m[1] + "-" + m[2], flights: m[3], via: m[4], pct: parseInt(m[5], 10) });
    alts.sort((a, b) => b.pct - a.pct);
    return { status: "no", tail: no[1], equip: no[2], alts };
  }
  // R23 P1-01: a response that names an assigned tail WITHOUT determining
  // Starlink either way is a REAL answer — "known aircraft, Starlink
  // unconfirmed" — not a transient failure and never a confirmed no. It maps to
  // its own status so no surface can collapse it into "No Starlink".
  const amb = text.match(/assigned to tail (N[A-Z0-9]+)/);
  if (amb) return { status: "unconfirmed", tail: amb[1] };
  if (/assignment not yet published|no assignment data/i.test(text)) {
    const p = (text.match(/~?(\d+)% Starlink probability/) || [])[1];
    const typed = /Starlink status is set by the operating subfleet|aircraft equipped\)/.test(text);
    return { status: "early", prob: p ? parseInt(p, 10) : null, typeDerived: typed };
  }
  if (/doesn't exist|outside the (?:UA|AS)/.test(text)) return { status: "invalid" };
  return { status: "unknown" };
}

/* ── Guardian state machine ────────────────────────────────────────────────
 * Pure: given the stored trip, a parseCheck() result and a timestamp, return
 * the next trip object plus what (if anything) to notify. No I/O, so it can be
 * exercised straight from the service-worker console or a node harness.
 * States: unchecked → early | yes | no | invalid. "unknown" (MCP outage or
 * unparseable prose) is transient: never stored as lastStatus, never a
 * transition — it only sets lastError and leaves asOf stale.
 * ─────────────────────────────────────────────────────────────────────────── */
function applyCheckResult(trip, res, now) {
  const t = Object.assign({}, trip);
  t.history = Array.isArray(trip.history) ? trip.history.slice() : [];
  t.lastChecked = now;

  if (!res || res.status === "unknown") {
    t.lastError = (res && res.err) || "no usable response";
    return { trip: t, transition: "unknown", shouldNotify: false, notifKey: null };
  }

  const prevRaw = trip.lastStatus;
  // A previous "invalid" is treated like "unchecked": a later publish is still
  // the first real observation of this trip.
  const prev = prevRaw === "yes" || prevRaw === "no" || prevRaw === "early" || prevRaw === "unconfirmed" ? prevRaw : "unchecked";
  const next = res.status;
  const prevTail = trip.tail || null;
  const nextTail = res.tail || null;
  const tailChanged = prevTail !== nextTail;

  let transition;
  if (next === "invalid") transition = "invalid";
  // "unconfirmed" is timeline-only in either direction: ambiguity is never a
  // notification-worthy fact and never dressed up as a publish or a loss.
  else if (next === "unconfirmed") transition = "unconfirmed";
  else if ((prev === "unchecked" || prev === "early" || prev === "unconfirmed") && next === "yes") transition = "publish-yes";
  else if ((prev === "unchecked" || prev === "early" || prev === "unconfirmed") && next === "no") transition = "publish-no";
  else if (prev === "yes" && next === "no") transition = "swap-lost";
  else if (prev === "no" && next === "yes") transition = "swap-gained";
  else if (prev === "yes" && next === "yes") transition = tailChanged ? "swap-yes-yes" : "none";
  else if (prev === "no" && next === "no") transition = tailChanged ? "swap-no-no" : "none";
  else if ((prev === "yes" || prev === "no") && next === "early") transition = "withdrawn";
  else if (prev === "unchecked" && next === "early") transition = "first-early";
  else transition = "none"; // early → early

  t.lastStatus = next;
  t.tail = nextTail;
  if (res.prob != null) t.prob = res.prob;
  t.typeDerived = !!res.typeDerived; // Alaska: odds come from the aircraft type
  t.equip = res.equip || null;
  t.alts = res.alts || null;
  t.routeSeen = res.route || t.routeSeen || null;
  if (res.departs) t.departs = res.departs;
  t.asOf = now;
  t.lastError = null;
  t.invalidCount = next === "invalid" ? (trip.invalidCount || 0) + 1 : 0;

  // History: append only when status OR tail differs from the newest entry, so
  // a re-publish of the same assignment is a no-op.
  const last = t.history[t.history.length - 1];
  if (!last || last.status !== next || (last.tail || null) !== nextTail) {
    t.history.push({ ts: now, status: next, tail: nextTail, prob: res.prob != null ? res.prob : null });
    if (t.history.length > HISTORY_CAP) t.history = t.history.slice(t.history.length - HISTORY_CAP);
  }

  const notifKey = transition + "|" + (nextTail || "");
  let shouldNotify = !!NOTIFY_TRANSITIONS[transition];
  if (shouldNotify && trip.lastNotifKey === notifKey) shouldNotify = false; // exact repeat
  if (shouldNotify) t.lastNotifKey = notifKey;

  return { trip: t, transition, shouldNotify, notifKey };
}

/* ── politeness budget ─────────────────────────────────────────────────────
 * Hard cap of GUARD_BUDGET MCP calls per LOCAL day. When exhausted we simply
 * skip checks: trips go stale (popup shows "as of …") with no state loss. */
function localDay(now) {
  const d = new Date(now == null ? Date.now() : now);
  const p = (n) => (n < 10 ? "0" + n : String(n));
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

async function budgetTake(n) {
  try {
    const day = localDay();
    const v = await chrome.storage.local.get(BUDGET_KEY);
    let b = v[BUDGET_KEY];
    if (!b || b.day !== day) b = { day, n: 0 }; // rolls over at local midnight
    if (b.n + n > GUARD_BUDGET) {
      await chrome.storage.local.set({ [BUDGET_KEY]: b });
      return false;
    }
    b.n += n;
    await chrome.storage.local.set({ [BUDGET_KEY]: b });
    return true;
  } catch (e) {
    return true; // a storage hiccup must not silently stop guarding
  }
}

async function checkTrip(trip) {
  try {
    // Route by the trip's own flight-number prefix: AS trips hit Alaska's MCP.
    const text = await mcpCall(
      "check_flight",
      { flight_number: trip.fn, date: trip.date },
      airlineOf(trip.fn)
    );
    return parseCheck(text);
  } catch (e) {
    return { status: "unknown", err: String(e && e.message ? e.message : e) };
  }
}

async function updateBadge(trips) {
  if (!trips) trips = await getTrips();
  const active = trips.filter((t) => daysUntil(t.date) >= -1);
  const no = active.filter((t) => t.lastStatus === "no").length;
  const yes = active.filter((t) => t.lastStatus === "yes").length;
  let text = "", color = "#0033A0";
  if (no) { text = "✗" + (no > 1 ? no : ""); color = "#d0342c"; }
  else if (yes) { text = "✓" + (yes > 1 ? yes : ""); color = "#0a8a4d"; }
  else if (active.length) { text = String(active.length); }
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (e) {}
}

// Tail carried by the entry *before* the newest one — i.e. what we're swapping
// away from. Used for the "was ✓ N127UA" half of the swap copy.
function priorTail(trip) {
  const h = trip.history || [];
  for (let i = h.length - 2; i >= 0; i--) if (h[i].tail) return h[i].tail;
  return null;
}

/* A rescue line may use only the bounded shortlist captured when Guard was
 * activated. It never re-queries the tracker, fares or the booking page. */
function capturedAlternative(trip, facts) {
  const route = trip && (trip.routeSeen || trip.route);
  const list = Array.isArray(trip && trip.shortlist) ? trip.shortlist : [];
  const eligible = list.filter((x) => x && x.decisionEligible === true &&
    x.fn !== trip.fn && x.route === route && x.date === trip.date &&
    typeof x.probability === "number" && x.probability >= 0 && x.probability <= 100 &&
    x.tier === "REPORTED" && x.source === trackerSourceFor(x.fn) && Number.isFinite(x.capturedAt));
  if (eligible.length !== 1) return null;
  const candidate = eligible[0];
  const contradicted = (facts || []).some((t) => t && t.fn === candidate.fn &&
    t.date === trip.date && t.lastStatus === "no");
  return contradicted ? null : candidate;
}

function fmtCaptureDate(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "at guard time";
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return mon + " " + d.getDate();
}

function formatCapturedAlternative(candidate) {
  if (!candidate) return "";
  const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate.sourceDate || "")
    ? "source date " + candidate.sourceDate : "source date not provided";
  return "Better option you saw: " + candidate.fn + " · " + candidate.probability +
    "% historical next-gen odds (REPORTED · " + candidate.source + " · " + sourceDate +
    "; captured " + fmtCaptureDate(candidate.capturedAt) + ").";
}

// "2026-07-25" → "Jul 25" for the terse notification head. Falls back to the
// raw string if it doesn't parse — never invent a date.
function fmtTripDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return String(dateStr || "");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m[2],10)-1];
  return mon ? mon + " " + parseInt(m[3], 10) : String(dateStr);
}

/* v2.4 notification copy — exactly the three honest states (§7.2). Every state
 * carries the trip identity and a route-back cue ("Open booking ↗"); only a
 * WORSENED state (B) carries a rescue line, and that line is passed in as
 * altText so the immutable Guard-time snapshot stays out of the pure formatter.
 * Titles use "· <date> —" per the design; bodies stay plain for the prose
 * ratchet. null means timeline-only (no toast). */
function buildGuardNotification(trip, transition, res, altText) {
  const state = notifyState(transition);
  if (!state) return null;
  const head = trip.fn + " · " + fmtTripDate(trip.date) + " — ";
  const tail = (res && res.tail) || trip.tail || "?";
  const equip = (res && res.equip) || "Viasat";
  const back = " Open booking ↗";
  const rescue = altText ? " " + altText : "";

  if (state === "A") {
    // Reassuring same-✓ swap reads differently from a first confirmation.
    if (transition === "swap-yes-yes")
      return { title: "🛰️ " + head + "tail changed, still Starlink",
        message: "New tail " + tail + " also has Starlink. No action needed." + back, priority: 2 };
    if (transition === "swap-gained")
      return { title: "🛰️ " + head + "now Starlink",
        message: "New tail " + tail + " has Starlink. You're set." + back, priority: 2 };
    return { title: "🛰️ " + head + "Starlink confirmed",
      message: "Tail " + tail + " has Starlink. You're set." + back, priority: 2 };
  }
  if (state === "B")
    return { title: "✗ " + head + "no Starlink",
      message: "Assigned tail " + tail + " (" + equip + ")." + rescue + back, priority: 2 };
  // state === "C" (withdrawn back to unpublished). Per Codex R23 P1-02, an A→C
  // regression may carry a grounded rescue (passed in as altText only when
  // worsened); a B→C one carries none. Copy stays "no assignment yet" because
  // withdrawn is genuinely early/unpublished — never an outage (that is
  // `unknown`, which never reaches here).
  return { title: "⏳ " + head + "no assignment yet",
    message: "Aircraft not assigned yet (tails publish ~48h out). We'll keep watching." + rescue + back, priority: 2 };
}

function guardNotificationForTrip(t, transition, res, facts) {
  let altText = "";
  if (worsened(transition, t)) {
    altText = formatCapturedAlternative(capturedAlternative(t, facts));
  }
  return buildGuardNotification(t, transition, res, altText);
}

async function notifyTrip(t, transition, res, facts) {
  try {
    const n = guardNotificationForTrip(t, transition, res, facts);
    if (!n) return;
    // Stable id encodes fn+date so the onClicked handler can route back, and a
    // re-fire replaces the old toast instead of stacking.
    chrome.notifications.create("usl-" + t.fn + "-" + t.date, {
      type: "basic", iconUrl: "icons/icon128.png",
      title: n.title, message: n.message, priority: n.priority,
    });
  } catch (e) {}
}

function outcomeNotificationId(fn, date) {
  return "usl-outcome-" + fn + "-" + date;
}

function departurePassed(t, now) {
  const exact = t && t.departs ? Date.parse(t.departs) : NaN;
  if (!isNaN(exact)) return exact < now;
  const dayEnd = Date.parse(String(t && t.date || "") + "T23:59:59");
  return !isNaN(dayEnd) && dayEnd < now;
}
function clearDepartedShortlist(t, now) {
  if (!departurePassed(t, now) || !Array.isArray(t.shortlist) || !t.shortlist.length) return false;
  t.shortlist = [];
  return true;
}

async function promptForOutcome(t) {
  if (!t || t.lastStatus === "invalid" || t.outcome || t.outcomePrompted || !departurePassed(t, Date.now())) return false;
  chrome.notifications.create(outcomeNotificationId(t.fn, t.date), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "How was the WiFi on " + t.fn + "?",
    message: "Your answer stays on this device and can be cleared with the guarded trip.",
    priority: 1,
    buttons: [{ title: "Worked" }, { title: "Didn't work" }],
  });
  t.outcomePrompted = true;
  return true;
}

async function recordTripOutcome(fn, date, outcome) {
  const value = outcome === "worked" || outcome === "didnt_work" || outcome === "didnt_fly" ? outcome : null;
  if (!value) return { ok: false, error: "Unknown outcome." };
  const trips = await getTrips();
  const trip = trips.find((t) => t.fn === String(fn || "").toUpperCase() && t.date === String(date || ""));
  if (!trip) return { ok: false, error: "Guarded trip not found.", trips };
  trip.outcome = value;
  trip.outcomePrompted = true;
  await setTrips(trips);
  try { chrome.notifications.clear(outcomeNotificationId(trip.fn, trip.date)); } catch (e) {}
  return { ok: true, trips };
}

async function recordOutcomeFromNotification(notifId, buttonIndex) {
  const m = /^usl-outcome-((?:UA|AS)\d{1,4})-(\d{4}-\d{2}-\d{2})$/.exec(notifId || "");
  if (!m || (buttonIndex !== 0 && buttonIndex !== 1)) return { ok: false };
  return recordTripOutcome(m[1], m[2], buttonIndex === 0 ? "worked" : "didnt_work");
}

/* Route back to where the guard was created. Uses the captured results URL when
 * we have one; otherwise the carrier's own site for the flight's airline. Never
 * fabricates a booking-confirmation deep link (guard-and-rescue §5). */
function routeBackUrl(trip) {
  if (trip && typeof trip.sourceUrl === "string" && /^https:\/\//.test(trip.sourceUrl)) return trip.sourceUrl;
  return airlineOf(trip && trip.fn) === "AS" ? "https://www.alaskaair.com/" : "https://www.united.com/";
}

// Notification click → focus/open the route-back tab. Fail-silent like every
// other bg.js entry point; parses the trip identity out of the stable id.
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notifId) => {
    (async () => {
      try {
        const m = /^usl-((?:UA|AS)\d{1,4})-(\d{4}-\d{2}-\d{2})$/.exec(notifId || "");
        if (!m) return;
        const trips = await getTrips();
        const trip = trips.find((t) => t.fn === m[1] && t.date === m[2]);
        const url = routeBackUrl(trip || { fn: m[1] });
        await chrome.tabs.create({ url });
        try { chrome.notifications.clear(notifId); } catch (e) {}
      } catch (e) {}
    })();
  });
}

if (chrome.notifications && chrome.notifications.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
    recordOutcomeFromNotification(notifId, buttonIndex).catch(() => {});
  });
}

// A trip stops earning calls once its tail is published and it has departed.
function isTerminal(t, now) {
  if (t.lastStatus !== "yes" && t.lastStatus !== "no") return false;
  if (!t.departs) return false;
  const dep = Date.parse(t.departs);
  return !isNaN(dep) && dep < now;
}

let tripChecksInFlight = false;

async function runTripChecks(force) {
  // One pass at a time: the 3h alarm and the popup's "check now" must not
  // interleave (double calls, double notifications, lost writes).
  if (tripChecksInFlight) return await getTrips();
  tripChecksInFlight = true;
  try {
    return await runTripChecksInner(force);
  } finally {
    tripChecksInFlight = false;
  }
}

async function runTripChecksInner(force) {
  let trips = await getTrips();
  const now = Date.now();
  for (const t of trips) {
    const d = daysUntil(t.date);
    // Answered trips are the user's local flight history and remain until the
    // user removes them. Unanswered prompts get a 30-day grace period.
    if (d < -30 && !t.outcome) { t.expired = true; continue; }
    await promptForOutcome(t);
    clearDepartedShortlist(t, now);
    if ((t.invalidCount || 0) >= 2) continue;          // bad flight number: halt
    if (isTerminal(t, now)) continue;                  // published + already departed
    // near departure (<=4 days): check every run; farther out: at most daily
    if (!force && t.lastChecked && d > 4 && now - t.lastChecked < 24 * 36e5) continue;
    // Manual "check now" bypasses the cadence, never the budget. When the
    // budget is exhausted the CURRENT check could not run, so mark the trip:
    // the popup must label the current check unavailable rather than let a
    // stale "Awaiting assignment" (or any prior fact, undated) stand as
    // current (R23 P1-01: exhausted budget never reads as awaiting). The last
    // successful fact stays, dated by its own asOf.
    if (!(await budgetTake(1))) { t.lastError = "check budget exhausted"; continue; }
    const res = await checkTrip(t);
    const out = applyCheckResult(t, res, Date.now());
    Object.assign(t, out.trip);
    if (out.shouldNotify) await notifyTrip(t, out.transition, res, trips);
    await new Promise((r) => setTimeout(r, 400));
  }
  trips = trips.filter((t) => !t.expired);
  await setTrips(trips);
  return trips;
}

chrome.alarms.create("uslTripCheck", { periodInMinutes: 180, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "uslTripCheck") runTripChecks(false); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => runTripChecks(false));

/* ══ 1.6 bridge groundwork ══════════════════════════════════════════════════
 * Two additive capabilities, both fail-silent by design:
 *   (a) a remotely-hosted selector manifest, so site-markup breakage can be
 *       fixed without shipping a new extension build;
 *   (b) dynamic content-script registration for OPTIONAL host permissions,
 *       so a user can opt in to extra carrier sites at runtime.
 * Nothing above this line is modified, and nothing here may ever throw in the
 * service worker — every entry point is wrapped in try/catch.
 * ─────────────────────────────────────────────────────────────────────────── */

/* ── (a) remote selector manifest ────────────────────────────────────────── */
const SELECTORS_URL = "https://wifiodds.com/assets/selectors.json";
const SEL_CFG_KEY = "uslSelCfg";
const SEL_ALARM = "uslSelectorsRefresh";

// Shape check: { version: <number>, selectors: { ...string|number } }.
// Anything else is treated as corrupt and discarded — we never partially apply.
function isValidSelectorCfg(json) {
  return !!json
    && typeof json === "object"
    && !Array.isArray(json)
    && typeof json.version === "number"
    && !!json.selectors
    && typeof json.selectors === "object"
    && !Array.isArray(json.selectors);
}

async function getStoredSelectors() {
  try {
    const v = await chrome.storage.local.get(SEL_CFG_KEY);
    const entry = v[SEL_CFG_KEY];
    return entry && entry.cfg ? entry.cfg : null;
  } catch (e) {
    return null;
  }
}

// The remote file may legitimately 404 until it is deployed. That must be a
// no-op: we keep whatever is already cached (or nothing) and stay quiet.
async function refreshSelectors() {
  try {
    const res = await fetchWithTimeout(SELECTORS_URL, { method: "GET" });
    if (!res || !res.ok) return;
    const json = await res.json();
    if (!isValidSelectorCfg(json)) return;
    await chrome.storage.local.set({ [SEL_CFG_KEY]: { ts: Date.now(), cfg: json } });
  } catch (e) {
    /* silent: offline, 404, bad JSON, timeout — all harmless */
  }
}

/* ── (b) dynamic content scripts for optional hosts ──────────────────────── */
const DYN_ALASKA_ID = "usl-dyn-alaska";
const ALASKA_MATCHES = ["https://www.alaskaair.com/*", "https://alaskaair.com/*"];

/* Google Flights (2.0). The optional PERMISSION has to be the whole origin —
 * Chrome grants per-origin, not per-path — but the injection MATCH is narrowed
 * to /travel/*, so the content script is never even parsed on search, Gmail,
 * Docs or anything else on www.google.com. content.js then narrows again to
 * /travel/flights and refuses any checkout/payment-looking path. */
const DYN_GFLIGHTS_ID = "usl-dyn-gflights";
const GFLIGHTS_ORIGINS = ["https://www.google.com/*"];
const GFLIGHTS_MATCHES = ["https://www.google.com/travel/*"];

// Script order matches the static manifest: airlines.js defines the fleet
// model, evidence.js defines the local disclosure contract, and content.js
// consumes both in the same isolated world.
const DYN_JS = ["airlines.js", "evidence.js", "content.js"];
const DYN_CSS = ["content.css"];

const DYN_SCRIPTS = [
  { id: DYN_ALASKA_ID, origins: ALASKA_MATCHES, matches: ALASKA_MATCHES },
  { id: DYN_GFLIGHTS_ID, origins: GFLIGHTS_ORIGINS, matches: GFLIGHTS_MATCHES },
];

// True when a live registration already matches what we would register now.
// Without this, an install upgraded from 1.6 (js: ["content.js"]) would keep its
// old single-file registration forever, because the old code returned early on
// "already registered" and never noticed the js list had changed.
function dynRegistrationCurrent(reg, spec) {
  if (!reg) return false;
  const js = Array.isArray(reg.js) ? reg.js : [];
  const matches = Array.isArray(reg.matches) ? reg.matches : [];
  return js.join(",") === DYN_JS.join(",") &&
    matches.slice().sort().join(",") === spec.matches.slice().sort().join(",");
}

// Register content.js/content.css on an optional host only while the user has
// actually granted its permission; unregister the moment they revoke it.
// Static united.com/navan registration is untouched.
async function syncDynamicScripts() {
  for (const spec of DYN_SCRIPTS) {
    try {
      const granted = await chrome.permissions.contains({ origins: spec.origins });
      let existing = [];
      try {
        existing = await chrome.scripting.getRegisteredContentScripts({ ids: [spec.id] });
      } catch (e) {
        existing = [];
      }
      const reg = Array.isArray(existing) && existing.length ? existing[0] : null;

      if (granted) {
        if (dynRegistrationCurrent(reg, spec)) continue; // already correct
        if (reg) {
          // Stale shape (pre-2.0 js list): replace it rather than leave it.
          try { await chrome.scripting.unregisterContentScripts({ ids: [spec.id] }); } catch (e) {}
        }
        await chrome.scripting.registerContentScripts([
          {
            id: spec.id,
            matches: spec.matches,
            js: DYN_JS,
            css: DYN_CSS,
            runAt: "document_idle",
            persistAcrossSessions: true,
          },
        ]);
      } else if (reg) {
        await chrome.scripting.unregisterContentScripts({ ids: [spec.id] });
      }
    } catch (e) {
      /* silent, per host: never let permission/registration churn kill the
       * worker, and never let one host's failure skip the others */
    }
  }
}

/* ── first-run coverage setup ──────────────────────────────────────────────
 * Opening an internal extension tab needs no new permission. Keep the reason
 * gate exact: an update must never reopen onboarding for an existing user. */
function openFirstRunCoverage(details, createTab) {
  if (!details || details.reason !== "install") return false;
  const open = createTab || ((props) => chrome.tabs.create(props));
  open({ url: chrome.runtime.getURL("coverage.html") });
  return true;
}

try { chrome.runtime.onInstalled.addListener(openFirstRunCoverage); } catch (e) {}

/* ── wiring ──────────────────────────────────────────────────────────────── */
try {
  chrome.alarms.create(SEL_ALARM, { periodInMinutes: 1440, delayInMinutes: 2 });
  chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === SEL_ALARM) refreshSelectors(); });
  if (chrome.permissions && chrome.permissions.onAdded)
    chrome.permissions.onAdded.addListener(() => syncDynamicScripts());
  if (chrome.permissions && chrome.permissions.onRemoved)
    chrome.permissions.onRemoved.addListener(() => syncDynamicScripts());
  // once per service-worker startup
  refreshSelectors();
  syncDynamicScripts();
} catch (e) {}
