// bg.js — MV3 service worker. Proxies unitedstarlinktracker.com data for
// content.js / popup.js, with a 6h chrome.storage.local cache.

const API_BASE = "https://unitedstarlinktracker.com";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 9000;

function cacheKey(o, d) {
  return "usl:" + o + "-" + d;
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
  const re = /^\s*(UA\d+)\s+\[(\w+)\]\s+\(([A-Z]{3})-([A-Z]{3})\)\s+(\d+)%\s+\((\d+) obs · (\w+) confidence\)/gm;
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
  const re = /^(UA\d+)\s+([A-Z]{3})→([A-Z]{3})\s+dep\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})Z\s+\(tail\s+(N[A-Z0-9]+)\)/gm;
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

async function fetchPlanRoute(o, d) {
  const url = `${API_BASE}/api/plan-route?origin=${o}&destination=${d}`;
  const res = await fetchWithTimeout(url, { method: "GET" });
  if (!res.ok) throw new Error("plan-route http " + res.status);
  const json = await res.json();
  return mapItineraries(json);
}

async function mcpCall(toolName, args) {
  const res = await fetchWithTimeout(`${API_BASE}/mcp`, {
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

async function fetchFlights(o, d) {
  const text = await mcpCall("predict_route_starlink", {
    origin: o,
    destination: d,
    limit: 30,
  });
  return parseFlights(text);
}

async function fetchDeps(o, d) {
  const text = await mcpCall("search_starlink_flights", {
    origin: o,
    destination: d,
    limit: 12,
  });
  return parseDeps(text);
}

async function getRouteData(o, d, force) {
  const key = cacheKey(o, d);
  const cached = await chrome.storage.local.get(key);
  const entry = cached[key];
  if (!force && entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      flights: entry.flights,
      deps: entry.deps,
      itins: entry.itins,
      ts: entry.ts,
      cached: true,
    };
  }

  const [itinsRes, flightsRes, depsRes] = await Promise.allSettled([
    fetchPlanRoute(o, d),
    fetchFlights(o, d),
    fetchDeps(o, d),
  ]);

  const itins = itinsRes.status === "fulfilled" ? itinsRes.value : [];
  let flights = flightsRes.status === "fulfilled" ? flightsRes.value : [];
  const deps = depsRes.status === "fulfilled" ? depsRes.value : [];

  flights = flights.slice().sort((a, b) => b.prob - a.prob);

  const ts = Date.now();
  const ok = flights.length > 0 || itins.length > 0;

  if (ok) {
    await chrome.storage.local.set({
      [key]: { ts, flights, deps, itins },
    });
  }

  return { ok, flights, deps, itins, ts, cached: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "tripAdd") {
    (async () => {
      const trips = await getTrips();
      if (!trips.some((t) => t.fn === msg.fn && t.date === msg.date))
        trips.push({ fn: msg.fn, date: msg.date, route: msg.route || null, added: Date.now() });
      await setTrips(trips);
      const updated = await runTripChecks(true);
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
  if (msg.type === "tripList") {
    getTrips().then((trips) => sendResponse({ ok: true, trips }));
    return true;
  }
  if (msg.type === "tripCheckNow") {
    runTripChecks(true).then((trips) => sendResponse({ ok: true, trips }));
    return true;
  }
  if (msg.type !== "routeData") return false;
  const o = (msg.o || "").toUpperCase();
  const d = (msg.d || "").toUpperCase();
  if (!o || !d) {
    sendResponse({ ok: false, flights: [], deps: [], itins: [], ts: Date.now(), cached: false });
    return true;
  }
  getRouteData(o, d, !!msg.force)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({
        ok: false,
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

async function getTrips() {
  const v = await chrome.storage.local.get(TRIPS_KEY);
  return v[TRIPS_KEY] || [];
}
async function setTrips(trips) {
  await chrome.storage.local.set({ [TRIPS_KEY]: trips });
  await updateBadge(trips);
}
function daysUntil(dateStr) {
  return Math.round((Date.parse(dateStr + "T12:00:00") - Date.now()) / 864e5);
}

function parseCheck(text) {
  if (!text) return { status: "unknown" };
  if (/is scheduled on a verified Starlink aircraft/.test(text)) {
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
  if (/assignment not yet published/i.test(text)) {
    const p = (text.match(/~?(\d+)% Starlink probability/) || [])[1];
    return { status: "early", prob: p ? parseInt(p, 10) : null };
  }
  if (/doesn't exist|outside the UA/.test(text)) return { status: "invalid" };
  return { status: "unknown" };
}

async function checkTrip(trip) {
  try {
    const text = await mcpCall("check_flight", { flight_number: trip.fn, date: trip.date });
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

function notifyTrip(t, res) {
  try {
    const isYes = res.status === "yes";
    const title = isYes
      ? "🛰️ " + t.fn + " " + t.date + ": Starlink CONFIRMED"
      : "✗ " + t.fn + " " + t.date + ": no Starlink";
    const alt = res.alts && res.alts[0];
    const message = isYes
      ? "Tail " + (res.tail || "?") + " is Starlink-equipped. You're set."
      : "Assigned tail " + (res.tail || "?") + " (" + (res.equip || "non-Starlink") + "). " +
        (alt ? "Better: " + alt.flights + (alt.via && alt.via !== "direct" ? " via " + alt.via : "") +
          " (" + alt.pct + "%). Same-day switch is free with Gold+." : "Consider a same-day switch.");
    chrome.notifications.create("usl-" + t.fn + "-" + t.date, {
      type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2,
    });
  } catch (e) {}
}

async function runTripChecks(force) {
  let trips = await getTrips();
  const now = Date.now();
  for (const t of trips) {
    const d = daysUntil(t.date);
    if (d < -1) { t.expired = true; continue; }
    // near departure (<=4 days): check every run; farther out: at most daily
    if (!force && t.lastChecked && d > 4 && now - t.lastChecked < 24 * 36e5) continue;
    const res = await checkTrip(t);
    t.lastChecked = now;
    if (res.status === "unknown") continue;
    const prev = t.lastStatus;
    t.lastStatus = res.status;
    t.tail = res.tail || null;
    if (res.prob != null) t.prob = res.prob;
    t.equip = res.equip || null;
    t.alts = res.alts || null;
    t.routeSeen = res.route || t.routeSeen || null;
    if (prev !== res.status && (res.status === "yes" || res.status === "no")) notifyTrip(t, res);
    await new Promise((r) => setTimeout(r, 400));
  }
  trips = trips.filter((t) => !t.expired);
  await setTrips(trips);
  return trips;
}

chrome.alarms.create("uslTripCheck", { periodInMinutes: 180, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "uslTripCheck") runTripChecks(false); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => runTripChecks(false));
