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

async function getRouteData(o, d) {
  const key = cacheKey(o, d);
  const cached = await chrome.storage.local.get(key);
  const entry = cached[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
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
  if (!msg || msg.type !== "routeData") return false;
  const o = (msg.o || "").toUpperCase();
  const d = (msg.d || "").toUpperCase();
  if (!o || !d) {
    sendResponse({ ok: false, flights: [], deps: [], itins: [], ts: Date.now(), cached: false });
    return true;
  }
  getRouteData(o, d)
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
