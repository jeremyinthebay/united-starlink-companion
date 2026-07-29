// routes.mjs — the route × date matrix the API harness sweeps.
//
// `hint` is a HYPOTHESIS about the metal, not an assertion the harness enforces:
//   narrowbody  — United mainline 737/A320 or regional; Starlink retrofit is
//                 well underway, so we EXPECT some direct history.
//   widebody    — long/transcon flying on 757/767/777/787; Starlink retrofit is
//                 far less complete, so an empty direct list is plausible and
//                 the SFO→EWR "no history" report belongs here.
// The harness reports what it finds against the hint; it never fails a route for
// disagreeing with one. A hint that is consistently wrong is itself a finding.

export const ROUTES = [
  // hub-to-hub narrowbody — expect direct Starlink history
  { o: "SFO", d: "DEN", hint: "narrowbody" },
  { o: "DEN", d: "SFO", hint: "narrowbody" },
  { o: "DEN", d: "ORD", hint: "narrowbody" },
  { o: "ORD", d: "EWR", hint: "narrowbody" },
  { o: "IAH", d: "DEN", hint: "narrowbody" },
  { o: "LGA", d: "ORD", hint: "narrowbody" },   // #1 by departures on our leaderboard
  { o: "DEN", d: "LAS", hint: "narrowbody" },
  { o: "IAD", d: "ORD", hint: "narrowbody" },

  // premium transcon — historically widebody/757, Starlink far less complete
  { o: "SFO", d: "EWR", hint: "widebody" },     // the flagged case
  { o: "EWR", d: "SFO", hint: "widebody" },
  { o: "LAX", d: "EWR", hint: "widebody" },
  { o: "SFO", d: "BOS", hint: "widebody" },
  { o: "JFK", d: "LAX", hint: "widebody" },     // United flies EWR not JFK — coverage-gap probe

  // international widebody — expect little/no direct history
  { o: "SFO", d: "LHR", hint: "widebody" },
  { o: "EWR", d: "LHR", hint: "widebody" },

  // regional-heavy spokes
  { o: "DEN", d: "ASE", hint: "narrowbody" },
  { o: "ORD", d: "MSN", hint: "narrowbody" },
];

// Dates for the near-term check-flight probe (tail assignments publish ~48h out,
// so only near dates yield a firm tail). Filled at runtime relative to today so
// the file never goes stale.
export function nearDates(n = 2) {
  const out = [];
  const base = new Date();
  for (let i = 2; i <= 1 + n; i++) {
    const d = new Date(base.getTime() + i * 864e5);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// A small set of specific flights for the check-flight / predict-flight cross
// check. Kept short on purpose — check-flight is the heaviest call.
export const SAMPLE_FLIGHTS = ["UA1", "UA2402", "UA1596", "UA2019", "UA5693"];
