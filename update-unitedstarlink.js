#!/usr/bin/env node
/**
 * update-unitedstarlink.js — daily data refresh for smithfamai.com/unitedstarlink/
 *
 * Deterministic: all fetching/parsing/writing happens here so the scheduled agent
 * only has to run it, sanity-check the summary, verify the live site, and commit.
 *
 * Sources (all unitedstarlinktracker.com — credit where due):
 *   /                      fleet headline (equipped/total/last30, mainline, express)
 *   /fleet                 per-type counts + mainline install pace
 *   /routes                top-60 routes by scheduled Starlink departures (48h)
 *   /api/predict-flight    per-flight probability (JSON)
 *   /api/plan-route        ranked itineraries per route (JSON)
 *   /mcp                   predict_route_starlink → per-route flight ranking (text, parsed)
 *
 * Writes: public/unitedstarlink/data.json  (schema unchanged + leaderboard/routeCache)
 * Prints: one summary line per section; exits 1 on any hard failure.
 *
 * Usage: node scripts/update-unitedstarlink.js [--max-cache-routes N]
 */

const fs = require("fs");
const path = require("path");

const BASE = "https://unitedstarlinktracker.com";
const FILE = "/Users/jeremysmith/websites/public/unitedstarlink/data.json";
const MAX_CACHE_ROUTES = Number(process.argv[process.argv.indexOf("--max-cache-routes") + 1]) || 40;
const HUB_PAIRS = ["DEN-SFO","SFO-DEN","ORD-DEN","DEN-ORD","EWR-ORD","ORD-EWR","IAH-DEN","DEN-IAH",
  "EWR-SFO","SFO-EWR","ORD-SFO","SFO-ORD","IAH-ORD","ORD-IAH","EWR-IAD","IAD-EWR","DEN-LAX","LAX-DEN",
  "SFO-LAX","LAX-SFO","EWR-LAX","LAX-EWR","ORD-LAX","LAX-ORD","IAD-DEN","DEN-IAD","EWR-DEN","DEN-EWR"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, asJson) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url + (url.includes("?") ? "&" : "?") + "cb=" + Math.random().toString(36).slice(2), {
        headers: { "User-Agent": "smithfamai-unitedstarlink-companion/1.0 (+https://smithfamai.com/unitedstarlink/)" },
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asJson ? await r.json() : await r.text();
    } catch (e) {
      if (attempt === 2) throw new Error(url + " → " + e.message);
      await sleep(1500 * (attempt + 1));
    }
  }
}

async function mcpPredictRoute(origin, destination) {
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "User-Agent": "smithfamai-unitedstarlink-companion/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "predict_route_starlink", arguments: { origin, destination, limit: 30 } } }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { const m = t.match(/data: (.*)/); j = m ? JSON.parse(m[1]) : null; }
  const text = j?.result?.content?.[0]?.text || "";
  const flights = [];
  const re = /^\s*(UA\d+)\s+\[(\w+)\]\s+\(([A-Z]{3})-([A-Z]{3})\)\s+(\d+)%\s+\((\d+) obs · (\w+) confidence\)/gm;
  let m2;
  while ((m2 = re.exec(text))) flights.push({ fn: m2[1], seg: m2[2], prob: +m2[5], obs: +m2[6], conf: m2[7] });
  return flights;
}

function strip(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }

(async () => {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const summary = [];

  // ── 1. fleet headline ───────────────────────────────
  const home = strip(await get(BASE + "/"));
  const mHead = home.match(/([\d,]+) of ([\d,]+) United Airlines aircraft \(\s*(\d+(?:\.\d+)?)\s*%\s*\) have Starlink WiFi installed\s*(?:,\s*including ([\d,]+) in the last 30 days)?/);
  if (!mHead) throw new Error("fleet headline not found on homepage");
  const num = (s) => +String(s).replace(/,/g, "");
  data.fleet.equipped = num(mHead[1]); data.fleet.total = num(mHead[2]);
  if (mHead[4]) data.fleet.last30 = num(mHead[4]);
  const mMain = home.match(/Mainline\s+\d+\s*%\s+(\d+)\s*\/\s*(\d+)/);
  const mExp = home.match(/Express\s+\d+\s*%\s+(\d+)\s*\/\s*(\d+)/);
  if (mMain) data.fleet.mainline = { equipped: +mMain[1], total: +mMain[2] };
  if (mExp) data.fleet.express = { equipped: +mExp[1], total: +mExp[2] };
  summary.push(`fleet: ${data.fleet.equipped}/${data.fleet.total}`);

  // ── 2. fleet page: pace + types ─────────────────────
  const fleet = strip(await get(BASE + "/fleet"));
  const mPace = fleet.match(/recent mainline pace of\s*~?\s*([\d.]+)\s*\/\s*week/);
  if (mPace) data.fleet.mainlinePacePerWeek = +mPace[1];
  const typePatterns = [
    ["CRJ-550", /CRJ-550[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)\s*(\d+)\s*%/], ["E175", /E175[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)\s*(\d+)\s*%/],
    ["737-800", /B737-800[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)\s*(\d+)\s*%/], ["A321neo", /\bA321\b[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)\s*(\d+)\s*%/],
    ["737-900", /B737-900[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)\s*(\d+)\s*%/], ["777", /\bB777\b[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)\s*(\d+)\s*%/],
  ];
  for (const t of data.fleet.types) {
    const pat = typePatterns.find(([name]) => name === t.type);
    if (!pat) continue;
    const m = fleet.match(pat[1]);
    if (m && +m[2] > 10) { t.equipped = +m[1]; t.total = +m[2]; }
  }
  summary.push(`pace: ~${data.fleet.mainlinePacePerWeek}/wk`);

  // ── 3. /routes → leaderboard ────────────────────────
  const routesHtml = strip(await get(BASE + "/routes"));
  const lb = [];
  const reLb = /([A-Z]{3})\s*–\s*([A-Z]{3})\s+(\d+)(?:\s*on\s*\d+\s*flight\s*s?)?\s*in\s*(\d+)\s*([hm])/g;
  let mlb;
  while ((mlb = reLb.exec(routesHtml)) && lb.length < 60)
    lb.push({ route: mlb[1] + "-" + mlb[2], departures: +mlb[3], next: mlb[4] + mlb[5] });
  if (lb.length >= 10) data.leaderboard = lb;
  summary.push(`leaderboard: ${lb.length} routes`);

  // ── 4. refresh curated flights (predict-flight JSON) ─
  let refreshed = 0, moved = [];
  for (const key of Object.keys(data.routes)) {
    for (const f of data.routes[key].flights) {
      try {
        const j = await get(BASE + "/api/predict-flight?flight_number=" + f.fn, true);
        if (j && typeof j.probability === "number") {
          const p = Math.round(j.probability * 100);
          if (Math.abs(p - f.prob) >= 5) moved.push(`${f.fn} ${f.prob}%→${p}%`);
          f.prob = p; f.obs = j.n_observations ?? f.obs; f.conf = j.confidence ?? f.conf;
          refreshed++;
        }
      } catch {}
      await sleep(150);
    }
    // recompute verdicts
    const fl = data.routes[key].flights;
    const maxP = Math.max(...fl.map((f) => f.prob));
    for (const f of fl) {
      const zeroFleet = /MAX|A319|A320(?!.*neo)|757/i.test(f.aircraft);
      f.verdict = f.prob === maxP && f.prob >= 30 ? "best"
        : f.prob >= 35 ? "good"
        : f.prob >= 20 ? (zeroFleet ? "risky" : "ok")
        : "avoid";
    }
  }
  summary.push(`curated flights refreshed: ${refreshed}${moved.length ? " (moved: " + moved.join(", ") + ")" : ""}`);

  // ── 5. routeCache: plan-route + per-route flight ranking ─
  const cacheTargets = [...new Set([...HUB_PAIRS, ...(data.leaderboard || []).map((r) => r.route)])].slice(0, MAX_CACHE_ROUTES);
  data.routeCache = data.routeCache || {};
  let cached = 0;
  for (const key of cacheTargets) {
    const [o, d] = key.split("-");
    try {
      const plan = await get(`${BASE}/api/plan-route?origin=${o}&destination=${d}`, true);
      await sleep(150);
      const flights = await mcpPredictRoute(o, d);
      data.routeCache[key] = {
        ts: new Date().toISOString(),
        flights,
        itineraries: (plan.itineraries || []).slice(0, 6).map((it) => ({
          via: it.via || [], joint: +(it.joint_probability * 100).toFixed(1),
          any: +(it.at_least_one_probability * 100).toFixed(1),
          coverage: it.coverage, hours: +(+it.total_flight_hours).toFixed(1),
          legs: (it.legs || []).map((l) => ({ fn: l.flight_number, route: l.route,
            p: Math.round(l.probability * 100), obs: l.n_observations, conf: l.confidence })),
        })),
      };
      cached++;
    } catch (e) { summary.push(`routeCache SKIP ${key}: ${e.message.slice(0, 80)}`); }
    await sleep(200);
  }
  // drop cache entries older than 7 days
  for (const [k, v] of Object.entries(data.routeCache))
    if (Date.now() - Date.parse(v.ts) > 7 * 864e5) delete data.routeCache[k];
  summary.push(`routeCache: ${cached}/${cacheTargets.length} routes refreshed`);

  // ── 6. history + stamp ──────────────────────────────
  if (!data.history.some((h) => h.date === today))
    data.history.push({ date: today, equipped: data.fleet.equipped, total: data.fleet.total,
      mainline: data.fleet.mainline.equipped, express: data.fleet.express.equipped });
  data.updated = today;

  // ── 7. atomic write + self-check ────────────────────
  const out = JSON.stringify(data, null, 1);
  JSON.parse(out); // throws if broken
  fs.writeFileSync(FILE + ".tmp", out);
  fs.renameSync(FILE + ".tmp", FILE);
  summary.push(`wrote ${FILE} (${(out.length / 1024).toFixed(0)} KB, updated=${today}, history=${data.history.length} days)`);

  console.log(summary.join("\n"));
})().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
