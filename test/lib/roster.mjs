// roster.mjs — load "our" ground truth for cross-checking the tracker.
//
// Two sources, both read-only:
//   1. wifiodds united/data.json — the equipped-tail roster (knownTails/roster).
//      This is the join key the harness has against the tracker: check-flight
//      returns a specific TAIL for a date, and we can ask "is that tail in our
//      Starlink roster, and does the tracker's yes/no agree with us?".
//   2. the extension's own airlines.js — WIFI_AIRLINES United entry, for the
//      fleet/equipped counts the extension itself would show.
//
// Paths are resolved from home so the harness runs from either repo. If a source
// is missing the harness still runs; it just skips the checks that need it and
// says so, rather than inventing a baseline.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const WIFIODDS_DATA = join(homedir(), "Projects", "wifiodds", "united", "data.json");
const EXT_AIRLINES = join(homedir(), "Projects", "united-starlink-companion", "extension", "airlines.js");

export function loadRoster() {
  let data = null, err = null;
  try { data = JSON.parse(readFileSync(WIFIODDS_DATA, "utf8")); }
  catch (e) { err = String(e && e.message || e); }
  if (!data) return { ok: false, err, tails: new Set(), byTail: new Map() };

  const tails = new Set((data.knownTails || []).map((t) => String(t).toUpperCase()));
  const byTail = new Map();
  for (const r of data.roster || []) {
    if (r && r.tail) byTail.set(String(r.tail).toUpperCase(), r);
  }
  return {
    ok: true,
    updated: data.updated || null,
    source: data.source || null,
    fleet: data.fleet || null,
    tails,
    byTail,
    count: tails.size,
  };
}

// True/false/null — is this tail in our equipped roster? null when we simply
// have no roster loaded (never conflate "unknown to us" with "not equipped").
export function tailEquippedByUs(roster, tail) {
  if (!roster || !roster.ok || !tail) return null;
  return roster.tails.has(String(tail).toUpperCase());
}

// United's fleet/equipped as the EXTENSION would report it (airlines.js).
export function loadExtUnited() {
  try {
    // airlines.js is a plain script assigning top-level consts; evaluate it in a
    // throwaway sandbox and read WIFI_AIRLINES.united. It has no imports.
    const src = readFileSync(EXT_AIRLINES, "utf8");
    const req = createRequire(import.meta.url);
    const vm = req("node:vm");
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src + "\n;globalThis.__WA = (typeof WIFI_AIRLINES!=='undefined')?WIFI_AIRLINES:null;", sandbox);
    const wa = sandbox.__WA || (sandbox.globalThis && sandbox.globalThis.__WA);
    const u = wa && wa.united ? wa.united : null;
    return u ? { ok: true, united: u } : { ok: false, err: "WIFI_AIRLINES.united not found" };
  } catch (e) {
    return { ok: false, err: String(e && e.message || e) };
  }
}
