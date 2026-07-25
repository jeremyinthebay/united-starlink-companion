/* airlines.js — static WiFi ConnectScore map (v2.0)
 * ═══════════════════════════════════════════════════════════════════════════
 * A plain classic script (loaded by popup.html BEFORE popup.js) that defines
 * one global const WIFI_AIRLINES plus pure scoring helpers. It makes NO network
 * calls and touches no chrome.* API — it is a frozen snapshot of what was true
 * in July 2026, so it can be unit-tested straight from node.
 *
 * ConnectScore (0–100) = P(connectivity) × systemQuality × freeFactor
 *
 *   P(connectivity)  share of the fleet actually carrying the system
 *   systemQuality    Starlink / Amazon Leo 1.0 · Viasat / 2Ku 0.6 · legacy GEO 0.3
 *   freeFactor       free-for-all or free-with-a-free-loyalty-program 1.0 ·
 *                    paid loyalty tier / partial / unconfirmed 0.85 · paid 0.7
 *
 * Mixed fleets blend: pct × 1.0 × starlinkFree + (1 − pct) × legacyQ × legacyFree.
 * No airline in the July 2026 set actually needs the blend (American, Delta and
 * jetBlue are pure-legacy today, with signed LEO deals that are NOT scored), but
 * the machinery is here and exercised by tests — American becomes the mixed case
 * the moment its Airbus Starlink installs start in 2027.
 *
 * DELIBERATE OMISSION — a Starlink carrier's score credits ONLY the Starlink
 * fleet. Legacy GEO wifi on the rest of those fleets is not modelled, because the
 * numbers for it are not in this data set and the score is meant to answer "what
 * are my odds of the good wifi", not "is there any wifi at all". That is why
 * Southwest (1 of 817 Starlink) scores near zero despite having fleetwide legacy
 * service. See SCORE_CAVEAT, which the popup shows as a tooltip.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WIFI_AIRLINES = {
  /* ── instrumented: the extension can show real per-flight odds for these ── */
  united: {
    name: "United", code: "UA", asOf: "2026-07",
    system: "starlink", equipped: 481, fleet: 1807, free: "loyalty-free",
    instrumented: true, tracker: "unitedstarlinktracker.com",
    note: "481 of 1,807 aircraft — free for MileagePlus members. Odds swing a lot by route and aircraft type.",
  },
  alaska: {
    name: "Alaska", code: "AS", asOf: "2026-07",
    system: "starlink", equipped: 99, fleet: 350, free: "free",
    instrumented: true, tracker: "alaskastarlinktracker.com",
    note: "99 of 350 mainline + regional and installing fast; the ex-Hawaiian widebodies are counted under Hawaiian.",
  },

  /* ── Starlink, no per-flight instrumentation ── */
  jsx: {
    name: "JSX", code: "XE", asOf: "2026-07",
    system: "starlink", equipped: 75, fleet: 75, free: "free",
    note: "Every aircraft in the fleet — the first airline anywhere to finish its Starlink rollout.",
  },
  airbaltic: {
    name: "airBaltic", code: "BT", asOf: "2026-07",
    system: "starlink", equipped: 55, fleet: 55, free: "free",
    note: "Entire A220 fleet equipped — the first European airline to complete a Starlink fit.",
  },
  zipair: {
    name: "ZIPAIR", code: "ZG", asOf: "2026-07",
    system: "starlink", equipped: 9, fleet: 9, free: "free",
    note: "All nine 787s equipped, free onboard.",
  },
  westjet: {
    name: "WestJet", code: "WS", asOf: "2026-07",
    system: "starlink", equipped: 151, fleet: 159, free: "free",
    note: "151 of 159 — fleetwide install all but finished.",
  },
  airfrance: {
    name: "Air France", code: "AF", asOf: "2026-07",
    system: "starlink", equipped: 172, fleet: 229, free: "free",
    note: "172 of 229 done and free for all Flying Blue members.",
  },
  hawaiian: {
    name: "Hawaiian", code: "HA", asOf: "2026-07",
    system: "starlink", equipped: 42, fleet: 61, free: "free",
    tracker: "airlinestarlinktracker.com",
    // Probed 2026-07-24: airlinestarlinktracker.com tracks HA but publishes NO
    // per-flight number for it — /api/predict-flight returns confidence:"type"
    // with no `probability`, /api/check-flight returns hasStarlink:null with an
    // empty flights[], and MCP check_flight answers "no assignment data". So HA
    // is coarse-only by upstream design, not by our choice. See bg.js API_BASES.
    typeDerivedOnly: true,
    note: "42 of 61 — best Starlink odds of any US carrier. Set by aircraft type, not flight number: A330/A321 done, B787 mid-install, B717 none. No per-flight odds published.",
  },
  qatar: {
    name: "Qatar Airways", code: "QR", asOf: "2026-07",
    system: "starlink", equipped: 140, fleet: 241, free: "unknown",
    note: "140 of 241 fitted with Starlink; free-for-everyone status is not confirmed in this data set.",
  },
  sas: {
    name: "SAS", code: "SK", asOf: "2026-07",
    system: "starlink", equipped: 60, fleet: 123, free: "unknown",
    note: "About half the fleet equipped and still installing.",
  },
  emirates: {
    name: "Emirates", code: "EK", asOf: "2026-07",
    system: "starlink", equipped: 36, fleet: 232, free: "free",
    note: "36 of 232 so far, free onboard — the widebody retrofit is early.",
  },
  virginatlantic: {
    name: "Virgin Atlantic", code: "VS", asOf: "2026-07",
    system: "starlink", equipped: 12, fleet: 43, free: "unknown",
    note: "12 of 43 aircraft; retrofit continues through 2026.",
  },
  aircanada: {
    name: "Air Canada", code: "AC", asOf: "2026-07",
    system: "starlink", equipped: 12, fleet: 216, free: "unknown",
    note: "Just started — 12 aircraft equipped out of 216.",
  },
  britishairways: {
    name: "British Airways", code: "BA", asOf: "2026-07",
    system: "starlink", equipped: 5, fleet: 261, free: "unknown",
    note: "Rollout paused summer 2026 — only 5 aircraft equipped.",
  },
  southwest: {
    name: "Southwest", code: "WN", asOf: "2026-07",
    system: "starlink", equipped: 1, fleet: 817, free: "loyalty-free",
    note: "1 of 817 and ramping; free for Rapid Rewards members. Legacy wifi on the rest of the fleet is not scored.",
  },

  /* ── legacy GEO today, LEO signed for later (future deals are NOT scored) ── */
  american: {
    name: "American", code: "AA", asOf: "2026-07",
    system: "viasat", equipped: 890, fleet: 989, free: "free",
    future: { system: "starlink", from: "2027-Q1", detail: "500+ Airbus aircraft signed" },
    note: "Free Viasat/Intelsat on ~90% of the fleet today. Airbus-only Starlink from 2027 — Boeing stays Viasat.",
  },
  delta: {
    name: "Delta", code: "DL", asOf: "2026-07",
    system: "viasat", coverage: 1.0, free: "free",
    future: { system: "leo", from: "2028", detail: "Amazon Leo signed for 500 aircraft" },
    note: "Free Viasat for SkyMiles members fleetwide today; Amazon Leo lands on 500 aircraft from 2028.",
  },
  jetblue: {
    name: "jetBlue", code: "B6", asOf: "2026-07",
    system: "viasat", coverage: 1.0, free: "free",
    future: { system: "leo", from: "2027", detail: "Amazon Leo" },
    note: "Free “Fly-Fi” Viasat on the whole fleet; Amazon Leo arrives 2027.",
  },
};

/* ── scoring constants ───────────────────────────────────────────────────── */
const SYSTEM_QUALITY = {
  starlink: 1.0,
  leo: 1.0,          // Amazon Leo (ex-Kuiper) — same LEO class as Starlink
  viasat: 0.6,
  "2ku": 0.6,        // Intelsat/Gogo 2Ku
  intelsat: 0.6,
  geo: 0.3,          // legacy GEO
  panasonic: 0.3,
  none: 0,
};

const FREE_FACTOR = {
  free: 1.0,               // free for everyone onboard
  "loyalty-free": 1.0,     // free with a free-to-join loyalty program
  "loyalty-tier": 0.85,    // free only on a paid status tier
  partial: 0.85,           // free on some cabins/routes only
  unknown: 0.85,           // not confirmed free in this data set — never assumed
  paid: 0.7,
};

// Display names for the hardware, so the popup never has to map them itself.
const SYSTEM_LABEL = {
  starlink: "Starlink",
  leo: "Amazon Leo",
  viasat: "Viasat",
  "2ku": "2Ku",
  intelsat: "Intelsat",
  geo: "legacy GEO",
  panasonic: "Panasonic",
};

const SCORE_CAVEAT =
  "ConnectScore is the chance of getting the GOOD system, not of any wifi at all. " +
  "Legacy satellite service on the not-yet-converted part of a fleet is not credited. " +
  "Signed-but-unflown deals (AA Starlink 2027, DL/B6 Amazon Leo) score zero until they fly.";

const SCORE_METHOD_LINE =
  "ConnectScore = connectivity probability × system quality × free-for-you. " +
  "Data: unitedstarlinktracker.com · alaskastarlinktracker.com · airline announcements (Jul 2026).";

/* ── pure helpers ────────────────────────────────────────────────────────── */
function clamp01(n) {
  if (typeof n !== "number" || isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function systemQuality(system) {
  const q = SYSTEM_QUALITY[String(system || "").toLowerCase()];
  return typeof q === "number" ? q : 0.3; // unknown hardware scores as legacy GEO
}
function freeFactor(free) {
  const f = FREE_FACTOR[String(free || "").toLowerCase()];
  return typeof f === "number" ? f : 0.85;
}
// Share of the fleet carrying the primary system. equipped/fleet when both are
// known, otherwise an explicit `coverage` fraction (Delta/jetBlue publish no
// tail counts, only "fleetwide").
function pctEquipped(entry) {
  if (!entry) return 0;
  if (typeof entry.fleet === "number" && entry.fleet > 0)
    return clamp01((entry.equipped || 0) / entry.fleet);
  return clamp01(entry.coverage);
}

function labelFor(score) {
  if (score >= 85) return "excellent";
  if (score >= 60) return "good";
  if (score >= 35) return "mixed";
  if (score >= 20) return "long shot";
  if (score >= 5) return "rare";
  return "not yet";
}
// Same thresholds as the flight badges in popup.js, so the chips read the same.
function scoreClass(score) {
  if (score >= 50) return "usl-pct-hi";
  if (score >= 35) return "usl-pct-mid";
  if (score >= 20) return "usl-pct-low";
  return "usl-pct-no";
}

/* Score any entry object — the blend lives here so it can be tested against a
 * synthetic mixed fleet without inventing a fake airline in the map. */
function scoreEntry(entry) {
  if (!entry) return null;
  const p = pctEquipped(entry);
  const q = systemQuality(entry.system);
  const f = freeFactor(entry.free);
  const primary = p * q * f;

  let legacyPart = null;
  let legacy = 0;
  if (entry.legacy) {
    // Legacy can only cover what the primary system does not.
    const cov = Math.min(clamp01(entry.legacy.coverage), 1 - p);
    const lq = systemQuality(entry.legacy.system);
    const lf = freeFactor(entry.legacy.free);
    legacy = cov * lq * lf;
    legacyPart = { coverage: cov, systemQuality: lq, freeFactor: lf, contribution: legacy };
  }

  const raw = clamp01(primary + legacy);
  const score = Math.round(raw * 100);
  return {
    score,
    label: labelFor(score),
    parts: {
      pctEquipped: p,
      systemQuality: q,
      freeFactor: f,
      primary: primary,
      legacy: legacyPart,
      raw: raw,
    },
  };
}

/* scoreAirline(key) → {key, name, score, label, parts, note, …} or null. */
function scoreAirline(key) {
  const entry = WIFI_AIRLINES[key];
  if (!entry) return null;
  const s = scoreEntry(entry);
  return {
    key: key,
    name: entry.name,
    code: entry.code || null,
    system: entry.system,
    systemLabel: SYSTEM_LABEL[entry.system] || entry.system,
    score: s.score,
    label: s.label,
    cls: scoreClass(s.score),
    parts: s.parts,
    note: entry.note || "",
    equipped: typeof entry.fleet === "number" ? entry.equipped : null,
    fleet: typeof entry.fleet === "number" ? entry.fleet : null,
    instrumented: !!entry.instrumented,
    // Upstream tracks the carrier but only by aircraft type — there is a data
    // source to credit, yet no per-flight number to ever show (Hawaiian).
    typeDerivedOnly: !!entry.typeDerivedOnly,
    tracker: entry.tracker || null,
    future: entry.future || null,
    asOf: entry.asOf || null,
  };
}

/* Every airline, best odds first; ties break alphabetically so the order is
 * stable across runs (three carriers sit at 100). */
function rankAirlines() {
  return Object.keys(WIFI_AIRLINES)
    .map(scoreAirline)
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
}

/* node harness support; `module` is undefined in the popup, so this is a no-op
 * there and the file stays a plain classic script. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WIFI_AIRLINES, SYSTEM_QUALITY, FREE_FACTOR, SYSTEM_LABEL,
    SCORE_CAVEAT, SCORE_METHOD_LINE,
    clamp01, systemQuality, freeFactor, pctEquipped,
    labelFor, scoreClass, scoreEntry, scoreAirline, rankAirlines,
  };
}
