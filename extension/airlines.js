/* airlines.js — static WiFi ConnectScore map (v3.0, the segmented model)
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVENANCE — THIS IS THE EXTENSION COPY, and as of the v3 model it is
 * byte-identical to `assets/airlines.js` in the wifiodds site repo apart from
 * this paragraph. The two used to drift: the site gained the three-tier fields
 * and the extension did not, so the popup and the site disagreed about Delta
 * for a week. Keeping them identical is cheaper than reconciling them, and the
 * file is deliberately dependency-free so both can just load it.
 *
 * If you change one, copy it to the other and re-run `node --check` plus the
 * export harness. Until the `airlines` table in Supabase replaces both (Phase B
 * of wifiodds-infrastructure-plan.md), a copy is the mechanism.
 *
 * The extension loads this as a plain classic script before popup.js: the
 * top-level consts become globals, and the module.exports guard at the bottom
 * is a no-op in a browser. The extension calls five names from here —
 * WIFI_AIRLINES, scoreAirline, rankAirlines, SCORE_METHOD_LINE, SCORE_CAVEAT.
 * ═══════════════════════════════════════════════════════════════════════════
 * A plain classic script (loaded by popup.html BEFORE popup.js) that defines
 * one global const WIFI_AIRLINES plus pure scoring helpers. It makes NO network
 * calls and touches no chrome.* API — it is a frozen snapshot of what was true
 * in July 2026, so it can be unit-tested straight from node.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MODEL — a fleet is a list of segments, not a single system
 *
 * v2 scored one system per airline and dropped the rest of the fleet on the
 * floor. United came out 27 on the Starlink share and 27 on next-gen odds: the
 * same number printed twice, with 1,152 aircraft unaccounted for. Fifteen of
 * eighteen airlines had that problem.
 *
 * A segment is a count of aircraft, a system, and a price:
 *
 *   known    = Σ n over segments      (unresolved aircraft are NOT in the
 *                                      denominator — we exclude them rather
 *                                      than assume anything about them)
 *   share_i  = n_i / known
 *   floor    = Σ share_i × qMin(system_i) × free_i × 100
 *   ceiling  = Σ share_i × qMax(system_i) × free_i × 100
 *   nextGen  = Σ share_i × free_i × 100, over the Starlink and Amazon Leo rows
 *
 * qMin and qMax differ only where a segment names more than one possible system
 * and the split is unpublished. For a single-system segment the range collapses.
 *
 * THE PUBLISHED CONNECTSCORE IS THE FLOOR. It is the only value defensible
 * without an assumption, it errs toward the reader (overstating wifi is the
 * failure that strands someone), and range width tracks fleet heterogeneity, so
 * sorting by floor rewards fleet consistency. `ceiling` rides alongside and the
 * surfaces show it whenever the two differ.
 *
 * Next-gen odds stop being a second mystery number: they are the first row of
 * the same ledger, and /airlines/{key}/ prints the ledger.
 *
 * BACKWARD COMPATIBILITY. scoreEntry() still accepts a legacy single-system
 * entry with `system` + `equipped`/`fleet` (or `coverage`), so an airline with
 * no segment data keeps working and this landed incrementally. Every entry in
 * the July 2026 set now carries segments; the legacy path is exercised by
 * build/apitest.js against a synthetic entry.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE QUALITY WEIGHTS, ANCHORED TO OOKLA 2H 2025
 *
 * The old 1.0 / 0.6 / 0.3 scale was asserted. Ookla's provider medians and
 * tenth percentiles validate the shape and correct two of the values.
 *
 *   leo        1.00  median 212.68 Mbps, P10 63.71, 43 ms. Its tenth percentile
 *                    beats every rival's median, which justifies the ceiling
 *                    better than any adjective
 *   modernGeo  0.55  Viasat / Intelsat / Hughes / Thales / 2Ku: medians 42–58,
 *                    P10 14–28, about 740 ms
 *   legacyGeo  0.22  Panasonic / Inmarsat / SITA / Anuvu: medians 9–16, and a
 *                    P10 of 1.06–1.58 Mbps. The median is tolerable and the
 *                    bottom tenth is unusable; an expected value should say so
 *   atg        0.12  Gogo ATG-4, EAN: 0.1–0.8 Mbps per device, but 260–310 ms
 *                    and 75% of tests lossless
 *   none       0.00  no connectivity of any kind
 *
 * ATG is its own tier because it and legacy GEO are unlike in opposite
 * directions: an order of magnitude worse on throughput, three times better on
 * latency and loss. Messaging works, streaming cannot. The systems page says
 * that rather than hiding it in a shared bucket.
 * ═══════════════════════════════════════════════════════════════════════════
 * RESOLUTION TIER — how the segments were sourced, stored per airline
 *
 *   tail       every segment from published per-tail data (United only)
 *   type       segments from a published fleet table by aircraft type
 *   systems    every system on the fleet is named, the counts are not
 *   announced  next-gen signed, nothing flying; segments describe today
 *
 * The spec called for deriving this. Only half of it is derivable: nothing in
 * the data says whether a count came from a tail registry or a press release.
 * So it is stored, and build/prerender.js asserts the half that IS derivable —
 * a tail- or type-resolved fleet cannot carry an unpublished split, so its
 * ceiling must equal its floor.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE-TIER READING — TWO NUMBERS, NEVER ONE
 *
 *   nextGenScore  the headline. Odds of a NEXT-GEN system — Starlink or Amazon
 *                 Leo, the only two low-earth-orbit products flying — times
 *                 free-for-you. Delta is 0 here. A signed deal is still zero.
 *   serviceTier   what the fleet delivers TODAY, in three words:
 *                   next-gen   — LEO across (effectively) the whole fleet
 *                   streaming  — modern GEO fleetwide: Viasat / 2Ku / Hughes
 *                   basic      — legacy Panasonic / Ku. Email and messaging.
 *                   mixed      — part next-gen, the rest one of the above
 *   restTier      the tier on the part of the fleet that is NOT next-gen yet.
 *                 "unknown" renders as "streaming-class or basic".
 *
 * Both fields are DATA, not prose: the wording lives in the site/popup, the keys
 * live here, and build/prerender.js fails the build if a stored serviceTier
 * disagrees with the fleet share it is supposed to describe.
 *
 * We do not promise video calls anywhere. "Streams, uploads, real work" is the
 * claim the hardware supports; a Zoom call at 35,000 feet over a full cabin is
 * not something this data set can underwrite.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WIFI_AIRLINES = {
  /* ── instrumented: the extension can show real per-flight odds for these ── */
  united: {
    name: "United", code: "UA", asOf: "2026-07",
    /* equipped/fleet MUST equal united/data.json fleet.equipped / fleet.total.
       They had drifted to 481/1807 while data.json said 481/1808, so the same
       homepage printed "481 of 1,807 (27%)" on the US card and "of 1,808
       aircraft" in the United section. build/prerender.js reconciles them from
       data.json on every build, and fails if it cannot find them. */
    system: "starlink", equipped: 481, fleet: 1808, free: "loyalty-free",
    instrumented: true, tracker: "unitedstarlinktracker.com",
    resolution: "tail",
    serviceTier: "mixed", restTier: "unknown",
    /* The only tail-resolved fleet on the site. Martin publishes the provider
       for every tail; the segments below are his hangar grid joined against his
       tail registry — 1,631 tails, 1,577 of them with a published system.
       United's own fleet is 1,808, so 177 tails are absent from the join
       entirely; those and the 54 published-without-a-system tails are what
       `unresolved` holds.
       reconcileUnited() in build/prerender.js rewrites the starlink row's `n`
       and `as` from data.json every morning and takes the difference out of
       `unresolved`, so the rows keep summing to 1,808. The other four rows move
       only when the join is re-run, which means the viasat and panasonic counts
       creep stale by a handful of aircraft between joins. Re-run the join, do
       not nudge the numbers. */
    segments: [
      { system: "starlink", n: 481, free: "loyalty-free", as: "2026-07-25",
        src: "united/data.json, the daily pull from unitedstarlinktracker.com",
        note: "Free for MileagePlus members, and joining is free." },
      { system: "viasat", n: 525, free: "paid", as: "2026-07-25",
        src: "unitedstarlinktracker.com/fleet, hangar grid joined to the tail registry",
        note: "$8 for MileagePlus members, $10 for everyone else. The April 2026 " +
          "“free wifi expanded to Viasat” stories were a glitch United corrected." },
      { system: "panasonic", n: 407, free: "paid", as: "2026-07-25",
        src: "unitedstarlinktracker.com/fleet, hangar grid joined to the tail registry",
        note: "16.31 Mbps median and 833 ms in Ookla's 2H 2025 set, the slowest " +
          "major provider measured. $8 / $10." },
      { system: "thales", n: 35, free: "paid", as: "2026-07-25",
        src: "unitedstarlinktracker.com/fleet, hangar grid joined to the tail registry",
        note: "Thales FlytLIVE Ka. $8 / $10." },
      { system: "none", n: 131, free: "none", as: "2026-07-25",
        src: "unitedstarlinktracker.com/fleet, hangar grid joined to the tail registry",
        note: "CRJ-200, ERJ-145 and CRJ-700. No connectivity of any kind, and none " +
          "of them are in the Starlink programme, so this row shrinks when the " +
          "aircraft retire rather than when installs proceed." },
    ],
    unresolved: { n: 229, why: "the tracker publishes no system for these tails" },
    note: "481 of 1,808 aircraft — free for MileagePlus members. Odds swing a lot by route and aircraft type.",
  },
  alaska: {
    name: "Alaska", code: "AS", asOf: "2026-07",
    system: "starlink", equipped: 99, fleet: 350, free: "free",
    instrumented: true, tracker: "alaskastarlinktracker.com",
    resolution: "type",
    serviceTier: "mixed", restTier: "streaming",
    /* WHICH DENOMINATOR WE PUBLISH, because there are two defensible ones and
       they count different things. Ours is 99 of 350 from Martin's Alaska
       tracker: 92 regional E175s plus 7 mainline 737s, against the mainline +
       regional fleet. Alaska's own page says 142 of 384 group-wide, which
       folds in Hawaiian (counted separately here) and leaves out the 11
       737-700s. Neither is wrong; they are not the same set.
       The 2Ku row is the balance of the mainline 737 fleet after the Starlink
       and ATG-4 sub-fleets. Alaska's page says "about 237" — the 240 here ties
       the ledger to the 350 we publish. */
    segments: [
      { system: "starlink", n: 99, free: "free", as: "2026-07-25",
        src: "alaskastarlinktracker.com",
        note: "92 regional E175s and 7 mainline 737-8s, verified tail by tail." },
      { system: "2ku", n: 240, free: "paid", as: "2026-07",
        src: "alaskaair.com inflight wifi page",
        note: "Gogo 2Ku on the mainline 737s. Paid per flight." },
      { system: "atg", n: 11, free: "paid", as: "2026-07",
        src: "alaskaair.com inflight wifi page",
        note: "737-700s on Gogo ATG-4: 0.1–0.8 Mbps per device, but 260–310 ms. " +
          "Messaging and email work, streaming does not." },
    ],
    note: "99 of 350 mainline + regional and installing fast. We publish alaskastarlinktracker.com's count; Alaska's own page says 142 of 384 group-wide, which folds in Hawaiian and leaves out the 11 737-700s. The ex-Hawaiian widebodies are counted under Hawaiian.",
  },

  /* ── Starlink, no per-flight instrumentation ── */
  jsx: {
    name: "JSX", code: "XE", asOf: "2026-07",
    system: "starlink", equipped: 75, fleet: 75, free: "free",
    resolution: "type",
    serviceTier: "next-gen", restTier: null,
    segments: [
      { system: "starlink", n: 75, free: "free", as: "2026-07",
        src: "JSX fleet announcements", note: "The whole fleet, and the first anywhere to finish." },
    ],
    note: "Every aircraft in the fleet — the first airline anywhere to finish its Starlink rollout.",
  },
  airbaltic: {
    name: "airBaltic", code: "BT", asOf: "2026-03",
    system: "starlink", equipped: 28, fleet: 55, free: "free",
    resolution: "type",
    serviceTier: "next-gen", restTier: null,
    /* CORRECTED 2026-07-26. This entry said 55 of 55 and called the fit
       complete. There is no completion announcement and airBaltic says the
       opposite. Its 2025 annual results presentation, 11 Mar 2026, slide 12:
       "Until March 2026 28 aircraft have been equipped with Starlink", against
       a fleet the same deck puts at 53 on slide 14. The v3 brief's "~half the
       fleet has nothing" was right and the source is airBaltic's own investor
       deck. The 55/55 claim traces to starlinkflights.com, an aggregator whose
       own tail table on the same page reads 54 aircraft.
       The 27 aircraft below are unresolved rather than a no-wifi row: 28 is a
       March count, installs continued through the spring, and airBaltic has
       published no number since. We know at least 28 have it and we do not
       know today's split. Ookla's 98.3% is not evidence against any of this —
       it measures the aircraft that have Starlink, not how many there are. */
    segments: [
      { system: "starlink", n: 28, free: "free", as: "2026-03-11",
        src: "airBaltic 2025 annual results presentation, 11 Mar 2026, slide 12",
        note: "Single-type A220 fleet, so an equipped aircraft is the same aircraft every time. " +
          "airBaltic's own booking-side answer, checked 26 Jul 2026, is still \"being gradually " +
          "installed\" with the rollout continuing through 2026, and it tells passengers to ask " +
          "the crew." },
    ],
    unresolved: { n: 27, why: "airBaltic's last published count is 28 aircraft in March 2026 " +
      "against a fleet now at 55; it has not said how many of the rest were done since" },
    note: "28 of 55 as of March 2026, free, and the rollout is still running. Fastest measured " +
      "cabin in Ookla's 2H 2025 set when you get an equipped aircraft.",
  },
  zipair: {
    name: "ZIPAIR", code: "ZG", asOf: "2026-07",
    system: "starlink", equipped: 9, fleet: 9, free: "free",
    resolution: "type",
    serviceTier: "next-gen", restTier: null,
    segments: [
      { system: "starlink", n: 9, free: "free", as: "2026-07",
        src: "ZIPAIR announcements", note: "All nine 787s." },
    ],
    note: "All nine 787s equipped, free onboard.",
  },
  westjet: {
    name: "WestJet", code: "WS", asOf: "2026-07",
    /* CORRECTED 2026-07-26. The 151-of-159 that was here has no publisher of
       record behind it. It traces to starlinkflights.com, which states a fleet
       of 159 while its own tail table on the same page reads 204, and which
       applies a blanket 95% to Encore Q400 flights. A second aggregator gives
       133 against the same 159. Neither number appears in anything WestJet,
       SpaceX or the trade press published, and 159 matches no WestJet fleet
       figure either.
       So this is back to WestJet's own last count, which is nine months old:
       100 of its 737s, 9 Oct 2025, when it said it intended to finish the
       737-800 and 737-8 MAX by the end of 2025. No completion announcement
       followed and WestJet has published nothing on connectivity in 2026 — I
       read its full 2026 release list to check. The real figure today is
       certainly above 100 and I will not guess by how much.
       Denominator is 193 from WestJet's 3 Sep 2025 fleet release: 147 737s,
       seven 787s, 39 Q400s. Its own aircraft page adds to 192 today. Both are
       WestJet's; I took the dated one. */
    system: "starlink", equipped: 100, fleet: 193, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 100, free: "free", as: "2025-10-09",
        src: "WestJet newsroom, 9 Oct 2025, 100th aircraft release",
        note: "Free for WestJet Rewards members. WestJet intended to finish the 737-800 and " +
          "737-8 MAX by the end of 2025 and has not said since whether it did." },
      { system: "none", n: 39, free: "none", as: "2026-07",
        src: "WestJet Encore fleet list",
        note: "WestJet Encore Q400s. About a fifth of the passenger fleet, with no announced plan." },
    ],
    unresolved: { n: 54, why: "the 737-700s, the seven 787s and any 737 fitted since Oct 2025; " +
      "WestJet's last published count is nine months old and it has said nothing in 2026" },
    note: "100 of 193 at WestJet's own last count, 9 Oct 2025, and it has published nothing since. " +
      "The 39 Encore Q400s have nothing.",
  },
  airfrance: {
    name: "Air France", code: "AF", asOf: "2026-07",
    system: "starlink", equipped: 172, fleet: 229, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "basic",
    segments: [
      { system: "starlink", n: 172, free: "free", as: "2026-07",
        src: "Air France Starlink rollout releases",
        note: "Free for all Flying Blue members." },
      { system: "panasonic", n: 57, free: "partial", as: "2026-07",
        src: "Air France connectivity page; Ookla 2H 2025 per-provider medians",
        note: "Ookla measured Air France at 1.38 Mbps on Panasonic against 281.56 on " +
          "Starlink in the same period, a 200× spread inside one airline. The free " +
          "tier on these aircraft is messaging only." },
    ],
    note: "172 of 229 done and free for all Flying Blue members; the remaining Panasonic aircraft measured 1.38 Mbps.",
  },
  hawaiian: {
    name: "Hawaiian", code: "HA", asOf: "2026-07",
    /* CORRECTED 2026-07-25. Hawaiian NEVER had Viasat — it went from no wifi at
       all straight to Starlink in 2024, and the site used to imply otherwise.
       fleet is 66, not the 61 that was here: 61 counted the A330s and A321neos
       and the 717s, and left out the 787-9s. */
    system: "starlink", equipped: 42, fleet: 66, free: "free",
    tracker: "airlinestarlinktracker.com",
    resolution: "type",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 42, free: "free", as: "2026-07",
        src: "airlinestarlinktracker.com; Alaska Air Group fleet page",
        note: "18 A321neos and 24 A330s. The transpacific fit is complete." },
      { system: "none", n: 19, free: "none", as: "2026-07",
        src: "Alaska Air Group fleet page; Alaska Air Group statements, 2024 and 2025",
        note: "The Boeing 717 interisland fleet, roughly 150 flights a day. These " +
          "aircraft have never carried connectivity and the group has said twice " +
          "that they never will." },
      { system: "none", n: 5, free: "none", as: "2026-07",
        src: "Hawaiian 787 Starlink announcement",
        note: "787-9s. Nothing today; Starlink from fall 2026." },
    ],
    note: "42 of 66 — the A330 and A321neo fit is complete, the 19 Boeing 717s have never had wifi at all.",
  },
  qatar: {
    name: "Qatar Airways", code: "QR", asOf: "2026-07",
    system: "starlink", equipped: 140, fleet: 241, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "basic",
    segments: [
      { system: "starlink", n: 140, free: "free", as: "2026-07",
        src: "Qatar Airways press releases; OMAAT, Jul 2026",
        note: "Free for every passenger in every cabin, no sign-up. Qatar advertises " +
          "up to 500 Mbps per aircraft." },
      { system: ["inmarsat", "sita"], n: 53, free: "paid", split: "unpublished", as: "2026-01",
        src: "Qatar Airways connectivity page",
        note: "The pre-Starlink widebody fit. Qatar names both systems and publishes no split." },
      { system: "none", n: 48, free: "none", as: "2026-07", assumed: true,
        src: "inferred: Qatar's fleet count less the aircraft it lists as connected",
        note: "INFERRED, not published. Qatar has never listed these aircraft as connected." },
    ],
    note: "140 of 241 fitted with Starlink; free for every passenger in every cabin, no sign-up (OMAAT, Jul 2026).",
  },
  sas: {
    name: "SAS", code: "SK", asOf: "2026-07",
    system: "starlink", equipped: 60, fleet: 123, free: "loyalty-free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 60, free: "loyalty-free", as: "2026-03-24",
        src: "SAS; Business Travel News Europe",
        note: "Free for EuroBonus members, and joining is free." },
      { system: "none", n: 45, free: "none", as: "2026-07", assumed: true,
        src: "inferred: absent from SAS's own wifi availability table",
        note: "E190/E195, CRJ900 and ATR 72. SAS's availability table puts this between " +
          "36 and 45; we take 45, because on an unpublished split the count that " +
          "cannot overstate wifi is the larger no-wifi one." },
      { system: ["viasat", "panasonic"], n: 18, free: "unknown", split: "unpublished", as: "2026-07",
        src: "SAS connectivity page",
        note: "The pre-Starlink mainline fit. Both systems named, no split published." },
    ],
    note: "About half the fleet equipped and still installing; free for EuroBonus members (free to join) since 2026-03-24 (SAS/Business Travel News Europe).",
  },
  emirates: {
    name: "Emirates", code: "EK", asOf: "2026-07",
    system: "starlink", equipped: 36, fleet: 232, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 36, free: "free", as: "2026-07",
        src: "Emirates Starlink retrofit announcements",
        note: "Ookla measured Emirates at 308.65 Mbps in 2H 2025, second only to United's Starlink fleet." },
      { system: ["panasonic", "thales"], n: 196, free: "unknown", split: "unpublished", as: "2026-07",
        src: "Emirates connectivity page",
        note: "Emirates has had wifi fleetwide for years and names both systems. It " +
          "publishes neither the split nor a current price, so this row takes the " +
          "0.85 unconfirmed factor rather than an assumed free." },
    ],
    note: "36 of 232 so far, free onboard — the widebody retrofit is early, and the rest of the fleet is older Ku.",
  },
  virginatlantic: {
    name: "Virgin Atlantic", code: "VS", asOf: "2026-07",
    system: "starlink", equipped: 12, fleet: 43, free: "loyalty-free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 12, free: "loyalty-free", as: "2026-05-01",
        src: "OMAAT; Virgin Atlantic",
        note: "Free for Flying Club members, and joining is free. The A350 fleet went in a month." },
      { system: ["geo", "intelsat"], n: 31, free: "paid", split: "unpublished", as: "2026-07",
        src: "Virgin Atlantic onboard wifi page",
        note: "The pre-Starlink A330 and 787 fit. Virgin does not say which generation " +
          "is on which airframe, so the row spans legacy Ku to 2Ku." },
    ],
    note: "12 of 43 aircraft; free for Flying Club members (free to join) since launch 2026-05-01 (OMAAT/Virgin Atlantic).",
  },
  aircanada: {
    name: "Air Canada", code: "AC", asOf: "2026-07",
    system: "starlink", equipped: 12, fleet: 216, free: "loyalty-free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 12, free: "loyalty-free", as: "2026-06",
        src: "seatwifi.com; Runway Girl Network, Jun 2026",
        note: "Q400s first. Free for Aeroplan members, and joining is free." },
      { system: "none", n: 34, free: "none", as: "2026-07", assumed: true,
        src: "inferred: Jazz fleet list against Air Canada's connectivity page",
        note: "INFERRED. Jazz Q400s and CRJ200s. Actively closing as the Starlink fit proceeds." },
      { system: ["geo", "intelsat"], n: 170, free: "paid", split: "unpublished", as: "2026-07",
        src: "Air Canada onboard wifi page",
        note: "Mainline. Air Canada names no generation per airframe, so the row spans " +
          "legacy Ku to 2Ku, and it is paid per flight." },
    ],
    note: "Just started — 12 Q400s equipped out of 216; free for Aeroplan members (free to join), per seatwifi.com/Runway Girl, Jun 2026.",
  },
  britishairways: {
    name: "British Airways", code: "BA", asOf: "2026-07",
    system: "starlink", equipped: 5, fleet: 261, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "basic",
    segments: [
      { system: "starlink", n: 5, free: "free", as: "2026-03",
        src: "BA mediacentre, Mar 2026 launch; Simple Flying, 2026-06-07",
        note: "G-ZBJA, -JI, -JJ, -JK and -JM. Installs stopped after five aircraft on " +
          "hangar availability, not on the technology; BA expects to resume in " +
          "October 2026 against an IAG target of 500+." },
      { system: "none", n: 31, free: "none", as: "2026-07", assumed: true,
        src: "inferred: BA CityFlyer fleet list; BA's own wifi availability page",
        note: "INFERRED. 20 CityFlyer E190s plus several 787s." },
      { system: ["panasonic", "inmarsat"], n: 225, free: "paid", split: "unpublished", as: "2026-07",
        src: "British Airways onboard wifi page",
        note: "Panasonic Ku on long-haul, Inmarsat on short-haul. Both are legacy GEO " +
          "on the measured numbers, so naming both does not widen the range. Paid." },
    ],
    note: "Rollout paused summer 2026 — only 5 aircraft equipped; free for every customer in every cabin once fitted (BA mediacentre, Mar 2026 launch).",
  },
  southwest: {
    name: "Southwest", code: "WN", asOf: "2026-07",
    /* fleet: 803 Boeing 737s as of Dec 31 2025, read verbatim from Southwest's
       FY2025 10-K (filed 2026-02-05). The 817 previously here was the Dec 31
       2023 figure and had gone stale. Third-party trackers still quote 817. */
    system: "starlink", equipped: 1, fleet: 803, free: "loyalty-free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 1, free: "loyalty-free", as: "2026-06-22",
        src: "Southwest; N8543Z entered service 2026-06-22",
        note: "One aircraft. Southwest targets 300+ of 803 by year-end." },
      { system: ["anuvu", "viasat"], n: 802, free: "paid", split: "unpublished", as: "2026-07",
        src: "Southwest inflight wifi page; Southwest FY2025 10-K for the fleet count",
        note: "Southwest has run Anuvu Ku for years and has been fitting Viasat on newer " +
          "deliveries without publishing a split. Its 17 Mbps Ookla median and 9.2% " +
          "consistency say most of the fleet is still the older kit, which is why " +
          "the floor sits near the legacy end of a very wide range. Messaging is " +
          "free, $8 per device for the rest, streaming blocked on the free tier." },
    ],
    note: "First Starlink aircraft (N8543Z) entered service 2026-06-22; Southwest targets 300+ of 803 by year-end. Free for Rapid Rewards members. The rest of the fleet is paid Anuvu or Viasat.",
  },

  /* ── legacy GEO today, LEO signed for later (future deals are NOT scored) ── */
  american: {
    name: "American", code: "AA", asOf: "2026-07",
    system: "viasat", equipped: 890, fleet: 989, free: "free",
    future: { system: "starlink", from: "2027-Q1", detail: "500+ Airbus aircraft signed" },
    /* the only entry with a KNOWN rest tier: AA's free Viasat/Intelsat covers ~90%
       of the fleet and the Panasonic widebodies are explicitly excluded from it */
    resolution: "type",
    serviceTier: "streaming", restTier: "basic",
    segments: [
      { system: ["viasat", "intelsat"], n: 890, free: "free", split: "unpublished", as: "2026-07",
        src: "American free-wifi announcement; RGN, 2026-05-26",
        note: "Free for everyone. American names both systems and publishes no split, " +
          "but both are modern GEO on the measured numbers, so the range does not widen." },
      { system: "panasonic", n: 99, free: "paid", as: "2026-07",
        src: "American onboard wifi page",
        note: "The widebodies, explicitly excluded from the free offer." },
    ],
    note: "Free Viasat/Intelsat on ~90% of the fleet today. Airbus-only Starlink from 2027 — Boeing stays Viasat.",
  },
  delta: {
    name: "Delta", code: "DL", asOf: "2026-07",
    /* CORRECTED 2026-07-25. coverage was 1.0 ("streaming-class fleetwide"),
       which is not true today. Delta's own two public data points bound it:
         · 2025-12-08 — "1,000+ Sync-equipped aircraft, >75% of the entire
           fleet"  ⇒ total fleet ≈ 1,330
         · 2026-03-31 press release — "more than 1,150 aircraft"
       1,150 / ~1,330 ≈ 0.86. `coverage` stays as the published ratio; the
       segments carry the counts. Delta's modern service is Viasat AND Hughes,
       not Viasat alone. */
    system: "viasat", coverage: 0.86, free: "free",
    future: { system: "leo", from: "2028", detail: "Amazon Leo signed for 500 aircraft" },
    /* "systems" rather than "type": the Sync count and the 717 count are both
       published, but the transpacific remainder is a lump with two possible
       systems and no split, which is what puts a range on this score. */
    resolution: "systems",
    serviceTier: "streaming", restTier: "basic",
    segments: [
      { system: ["viasat", "hughes"], n: 1150, free: "free", split: "unpublished", as: "2026-03-31",
        src: "Delta news release, 2026-03-31; Hughes/Delta Fusion release, Feb 2025",
        note: "Delta Sync, free for SkyMiles members. Both systems are modern GEO on " +
          "the measured numbers, so the unpublished split does not widen the range. " +
          "Delta's 2H 2025 consistency was 2.2%, the lowest in Ookla's set." },
      { system: "none", n: 80, free: "none", as: "2026-05",
        src: "Delta 717 wifi deactivation, May 2026",
        note: "The Boeing 717s. Delta switched off their legacy Intelsat/Gogo units in " +
          "May 2026 ahead of a Hughes Fusion retrofit, so most of them are flying " +
          "the summer 2026 schedule with no wifi at all." },
      { system: ["geo", "intelsat"], n: 100, free: "unknown", split: "unpublished", as: "2026-07",
        assumed: true,
        src: "inferred: Delta's fleet estimate less the Sync count and the 717s",
        note: "INFERRED. The A330/A350 transpacific aircraft Delta says come online " +
          "“fall 2026”. They carry older service today and Delta does not say " +
          "which, so the row spans legacy Ku to 2Ku." },
    ],
    note: "Delta Sync (Viasat + Hughes) on 1,150+ aircraft, free for SkyMiles members — but not fleetwide: the 80 Boeing 717s lost their legacy wifi in May 2026 awaiting the Hughes retrofit, and transpacific widebodies come online fall 2026. Amazon Leo lands on 500 aircraft from 2028.",
  },
  jetblue: {
    name: "jetBlue", code: "B6", asOf: "2026-07",
    /* coverage stays 1.0 — every one of the 291 aircraft (129 A320, 101 A321,
       61 A220 as of 2026-03-31, per JetBlue's Q1 8-K) carries Viasat Ka-band
       Fly-Fi. TWO HARDWARE GENERATIONS are flying and that much is sourced:
       JetBlue's Kuiper release (2025-09-04) sends Leo to "aircraft currently
       flying JetBlue's original Fly-Fi technology" and RGN (2025-09-09) has
       Viasat extending service on "aircraft already equipped with Viasat's
       latest technology".

       ═══ WHICH AIRFRAMES ARE IN WHICH COHORT IS NOT PUBLISHED ═════════════
       Corrected 2026-07-26, mirroring wifiodds assets/airlines.js. This entry
       used to assert a full per-type mapping and cite the Q1 2026 8-K for it;
       the 8-K has fleet COUNTS ONLY and names no satellite. Sourced: A321ceo
       on ViaSat-1 (Runway Girl Network, 2022-12-24), A220-300 on ViaSat-2
       (Viasat contract release, 2019-08-07). NOT sourced, do not restore:
       A320ceo, A321neo, A321LR. The 2021 Viasat release names the A220-300
       and A321LR together but gives a generation for neither.

       Both generations are Viasat Ka, so they are one segment: the
       model scores the system, and the generation gap is a note. The E190s (the
       one sub-fleet with patchy Fly-Fi) were fully retired 2025-09-10. Amazon
       Leo from 2027 explicitly targets the first-gen kit first. */
    system: "viasat", coverage: 1.0, free: "free",
    future: { system: "leo", from: "2027", detail: "Amazon Leo" },
    resolution: "type",
    serviceTier: "streaming", restTier: null,
    segments: [
      { system: "viasat", n: 291, free: "free", as: "2026-03-31",
        src: "JetBlue Q1 2026 8-K fleet table",
        note: "129 A320, 101 A321, 61 A220. Two Viasat hardware generations fly in " +
          "this fleet and JetBlue has not published which airframes are in which: " +
          "its Kuiper release says only that Leo goes to aircraft on the original " +
          "Fly-Fi kit. Two types are sourced on their own — A321ceo on ViaSat-1 " +
          "(Runway Girl Network, 2022-12-24) and A220-300 on ViaSat-2 (Viasat, " +
          "2019-08-07). JetBlue's 2H 2025 consistency was 3.8%." },
    ],
    note: "Free “Fly-Fi” Viasat on every aircraft, but two hardware generations are flying and JetBlue does not publish which airframes carry which. The A321ceo was reported on the original ViaSat-1 kit in Dec 2022 and the A220-300 was contracted on ViaSat-2 in 2019; the A320ceo, A321neo and A321LR have no published generation. Amazon Leo arrives 2027, first-gen aircraft first.",
  },
};

/* ── scoring constants ─────────────────────────────────────────────────────
 * Five tiers, each anchored to Ookla's 2H 2025 provider medians and tenth
 * percentiles. See the header for what each number is anchored to. */
const QUALITY_TIER = {
  leo: 1.0,
  modernGeo: 0.55,
  legacyGeo: 0.22,
  atg: 0.12,
  none: 0,
};

/* Which tier each system sits in. Systems, not brands: "geo" is the generic
 * legacy bucket for a fleet whose operator names no vendor. */
const SYSTEM_TIER = {
  starlink: "leo",
  leo: "leo",              // Amazon Leo (ex-Kuiper)
  viasat: "modernGeo",
  intelsat: "modernGeo",
  "2ku": "modernGeo",      // Intelsat/Gogo 2Ku
  hughes: "modernGeo",     // Jupiter / Fusion
  thales: "modernGeo",     // FlytLIVE Ka
  panasonic: "legacyGeo",
  inmarsat: "legacyGeo",
  sita: "legacyGeo",
  anuvu: "legacyGeo",
  geo: "legacyGeo",        // legacy GEO, vendor unnamed
  atg: "atg",              // Gogo ATG-4
  ean: "atg",              // European Aviation Network
  none: "none",
};

/* Derived from the two tables above so a weight cannot be typed twice. */
const SYSTEM_QUALITY = (function () {
  const q = {};
  Object.keys(SYSTEM_TIER).forEach(function (k) { q[k] = QUALITY_TIER[SYSTEM_TIER[k]]; });
  return q;
})();

const QUALITY_TIER_LABEL = {
  leo: "low-earth orbit",
  modernGeo: "modern geostationary",
  legacyGeo: "legacy geostationary",
  atg: "air-to-ground",
  none: "no connectivity",
};

const FREE_FACTOR = {
  free: 1.0,               // free for everyone onboard
  "loyalty-free": 1.0,     // free with a free-to-join loyalty program
  "loyalty-tier": 0.85,    // free only on a paid status tier
  partial: 0.85,           // free on some cabins/routes only
  unknown: 0.85,           // not confirmed free in this data set — never assumed
  paid: 0.7,
  /* Only ever used on a `none` segment: there is no service to be free or paid.
     The quality weight is already 0, so this changes no arithmetic; it keeps the
     ledger row from printing a price for an aircraft that has no wifi. */
  none: 0,
};

/* How the segments were sourced. Stored per airline — see the header for why
 * only half of this is derivable. */
const RESOLUTION_LABEL = {
  tail: "tail-resolved",
  type: "type-resolved",
  systems: "systems named, counts unpublished",
  announced: "announced, nothing flying",
};

const RESOLUTION_BLURB = {
  tail: "Every segment comes from published per-tail data, so the range is zero.",
  type: "Segments come from a published fleet table by aircraft type.",
  systems: "Every system on the fleet is named and the counts are not published, so the score is a range.",
  announced: "Next-gen is signed and nothing is flying; the segments describe the fleet as it is today.",
};

/* ── the three-tier reading ───────────────────────────────────────────────
 * NEXT_GEN_SYSTEMS is derived-by-hand from SYSTEM_QUALITY on purpose: "quality
 * 1.0" and "low-earth orbit" happen to coincide today, but they are different
 * claims, and if a future GEO product ever earned 1.0 it still would not be
 * next-gen. Keep the list explicit. */
const NEXT_GEN_SYSTEMS = { starlink: true, leo: true };

/* A fleet is called next-gen once the retrofit is effectively done. 0.9 rather
 * than 1.0 because WestJet's last eight aircraft should not make the other 151
 * read as a coin flip — the numbers are shown either way. */
const NEXT_GEN_DONE = 0.9;

/* The line between "streaming" and "basic" for a fleet with no next-gen
 * hardware: the midpoint between the legacy and modern GEO weights, computed
 * rather than typed, so moving a weight moves the threshold with it. */
const STREAMING_MIN_Q = (QUALITY_TIER.legacyGeo + QUALITY_TIER.modernGeo) / 2;

const SERVICE_TIER_LABEL = {
  "next-gen": "next-gen fleetwide",
  mixed: "mixed",
  streaming: "streaming-class",
  basic: "basic",
};

/* What the not-yet-converted part of the fleet gets. "unknown" is the common
 * case: we have verified next-gen tail counts, not a verified inventory of
 * everybody's older hardware. */
const REST_TIER_LABEL = {
  streaming: "streaming-class",
  basic: "basic",
  unknown: "streaming-class or basic",
};

/* One sentence per tier, for the surfaces that have room. No video-call promise
 * anywhere in here — see the header. */
const SERVICE_TIER_BLURB = {
  "next-gen": "Low-earth-orbit across the fleet: streams, uploads, real work.",
  mixed: "Part of the fleet is low-earth orbit; the rest is older satellite service.",
  /* Deliberately says nothing about COVERAGE — the blurb describes the class of
     service, and how much of the fleet has it is a separate number that the
     surfaces state themselves. Saying "fleetwide" here made Delta's card claim
     something Delta's own data contradicts. */
  streaming: "Modern geostationary service — streams, uploads, real work, " +
    "with more lag than low-earth orbit.",
  basic: "Legacy satellite service — email, messaging, and not much else.",
};

// Display names for the hardware, so the popup never has to map them itself.
const SYSTEM_LABEL = {
  starlink: "Starlink",
  leo: "Amazon Leo",
  viasat: "Viasat",
  "2ku": "2Ku",
  intelsat: "Intelsat",
  hughes: "Hughes",
  thales: "Thales FlytLIVE",
  geo: "legacy GEO",
  panasonic: "Panasonic",
  inmarsat: "Inmarsat",
  sita: "SITA",
  anuvu: "Anuvu",
  atg: "Gogo ATG-4",
  ean: "EAN",
  none: "no wifi",
};

const SCORE_CAVEAT =
  "ConnectScore is an expected value over a whole fleet, not a prediction about one flight: " +
  "United measured 320, 56 and 15 Mbps on three systems in one livery in one reporting period. " +
  "Aircraft whose system an airline does not publish are left out of the denominator rather than " +
  "assumed. Signed-but-unflown deals (AA Starlink 2027, DL/B6 Amazon Leo) score zero until they fly.";

const SCORE_METHOD_LINE =
  "ConnectScore = the sum, over every segment of the fleet, of fleet share × system quality × " +
  "free-for-you. The published score is the floor. " +
  "Data: unitedstarlinktracker.com · alaskastarlinktracker.com · airline announcements (Jul 2026).";

/* The headline line for the two-number reading. Deliberately says what it does
 * NOT count: a signed deal, and the older hardware on the rest of the fleet. */
const TIER_METHOD_LINE =
  "Next-gen odds = share of the fleet flying Starlink or Amazon Leo today × free-for-you. " +
  "Signed-but-unflown deals count zero. The second line is what the fleet actually " +
  "delivers today: next-gen, streaming-class, basic, or mixed.";

/* ── pure helpers ────────────────────────────────────────────────────────── */
function clamp01(n) {
  if (typeof n !== "number" || isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function systemQuality(system) {
  const q = SYSTEM_QUALITY[String(system || "").toLowerCase()];
  return typeof q === "number" ? q : QUALITY_TIER.legacyGeo; // unknown hardware scores as legacy GEO
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

/* ── segments ─────────────────────────────────────────────────────────────
 * All five of these are pure functions of one entry, and every one of them
 * returns something sensible for a legacy entry with no segments, because the
 * legacy path has to keep working for any airline not yet migrated. */

function isSegmented(entry) {
  return !!(entry && Array.isArray(entry.segments) && entry.segments.length);
}

/* A segment's system is a string, or an array when the airline names more than
 * one possibility and publishes no split. Always returns an array. */
function segmentSystems(seg) {
  if (!seg) return [];
  const s = seg.system;
  return (Array.isArray(s) ? s : [s]).map(function (x) { return String(x || "").toLowerCase(); });
}

/* qMin and qMax are equal for a single-system segment, and that is what
 * collapses the range for a tail- or type-resolved fleet. */
function segmentQuality(seg) {
  const qs = segmentSystems(seg).map(systemQuality);
  if (!qs.length) return { min: 0, max: 0 };
  return { min: Math.min.apply(null, qs), max: Math.max.apply(null, qs) };
}

function segmentIsNextGen(seg) {
  const systems = segmentSystems(seg);
  return systems.length > 0 && systems.every(isNextGen);
}

/* The denominator. Aircraft in `unresolved` are deliberately NOT in it. */
function knownAircraft(entry) {
  if (!isSegmented(entry)) return 0;
  return entry.segments.reduce(function (t, s) { return t + (Number(s.n) || 0); }, 0);
}
function unresolvedAircraft(entry) {
  return (entry && entry.unresolved && Number(entry.unresolved.n)) || 0;
}
function resolutionOf(entry) {
  return (entry && entry.resolution) || null;
}

/* ── the ledger ───────────────────────────────────────────────────────────
 * One row per segment, and the rows sum to the floor. That is the whole point:
 * an assumption sitting in a visible row is a different thing from an assumption
 * buried in a score. build/prerender.js asserts the sum on every build, because
 * a ledger that does not add up is the failure this model exists to prevent.
 *
 * Returns null for a legacy entry, which is how scoreEntry() decides which path
 * it is on. */
function ledgerFor(entry) {
  if (!isSegmented(entry)) return null;
  const known = knownAircraft(entry);
  if (!known) return null;
  const unresolved = unresolvedAircraft(entry);

  let rawFloor = 0, rawCeiling = 0, rawNextGen = 0, nextGenShare = 0;
  const rows = entry.segments.map(function (seg) {
    const systems = segmentSystems(seg);
    const q = segmentQuality(seg);
    const share = (Number(seg.n) || 0) / known;
    const f = freeFactor(seg.free);
    const nextGen = segmentIsNextGen(seg);
    const pointsMin = share * q.min * f * 100;
    const pointsMax = share * q.max * f * 100;
    rawFloor += pointsMin / 100;
    rawCeiling += pointsMax / 100;
    if (nextGen) { rawNextGen += share * f; nextGenShare += share; }
    return {
      systems: systems,
      systemLabel: systems.map(function (s) { return SYSTEM_LABEL[s] || s; }).join(" or "),
      tier: SYSTEM_TIER[systems[0]] || "legacyGeo",
      n: Number(seg.n) || 0,
      share: share,
      qMin: q.min, qMax: q.max,
      free: seg.free || "unknown",
      freeFactor: f,
      pointsMin: pointsMin,
      pointsMax: pointsMax,
      nextGen: nextGen,
      split: seg.split || null,
      assumed: !!seg.assumed,
      src: seg.src || null,
      as: seg.as || null,
      note: seg.note || null,
    };
  });

  return {
    rows: rows,
    known: known,
    unresolved: unresolved,
    unresolvedWhy: (entry.unresolved && entry.unresolved.why) || null,
    total: known + unresolved,
    rawFloor: rawFloor,
    rawCeiling: rawCeiling,
    rawNextGen: rawNextGen,
    nextGenShare: nextGenShare,
    /* Σ over the rows, before rounding. The build asserts these match the
       published integers to within half a point. */
    sumFloor: rows.reduce(function (t, r) { return t + r.pointsMin; }, 0),
    sumCeiling: rows.reduce(function (t, r) { return t + r.pointsMax; }, 0),
  };
}

/* ── the three-tier helpers ───────────────────────────────────────────────
 * These are ADDITIVE. scoreEntry() and scoreAirline() keep returning every field
 * they returned before, including `score`; what they add is the second axis: how
 * much of the fleet is next-gen (the headline) versus what the fleet actually
 * delivers today (the tier). */

function isNextGen(system) {
  return NEXT_GEN_SYSTEMS[String(system || "").toLowerCase()] === true;
}

/* Share of the fleet on a next-gen system RIGHT NOW. A signed deal is not a
 * system: `future` never contributes here, which is the whole point.
 *
 * For a segmented fleet the denominator is `known`, not the whole fleet, so
 * United reads 30% (481 of 1,579 resolved) rather than 27% (481 of 1,808). Both
 * are true and they answer different questions; the ledger prints both counts
 * side by side so the difference is visible rather than confusing. */
function nextGenShare(entry) {
  if (!entry) return 0;
  const L = ledgerFor(entry);
  if (L) return clamp01(L.nextGenShare);
  if (!isNextGen(entry.system)) return 0;
  return pctEquipped(entry);
}

/* The headline number: odds of drawing a next-gen aircraft, times free-for-you.
 * System quality is not a factor because next-gen IS the quality ceiling (1.0) —
 * multiplying by it would just be multiplying by one. */
function nextGenScore(entry) {
  if (!entry) return 0;
  const L = ledgerFor(entry);
  if (L) return Math.round(clamp01(L.rawNextGen) * 100);
  return Math.round(clamp01(nextGenShare(entry) * freeFactor(entry.free)) * 100);
}

/* Share-weighted quality across the fleet, at the floor. Only used to choose
 * between "streaming" and "basic" for a fleet with no next-gen hardware. */
function fleetQuality(entry) {
  const L = ledgerFor(entry);
  if (L) return L.rows.reduce(function (t, r) { return t + r.share * r.qMin; }, 0);
  return systemQuality(entry && entry.system);
}

/* The stored tier is the answer; the derivation is the fallback AND the check.
 * build/prerender.js asserts the two agree, so a fleet that crosses the
 * threshold cannot keep a stale word next to a fresh number. */
function serviceTierOf(entry) {
  if (!entry) return "basic";
  if (entry.serviceTier) return entry.serviceTier;
  return serviceTierExpected(entry);
}
function serviceTierExpected(entry) {
  const share = nextGenShare(entry);
  if (share >= NEXT_GEN_DONE) return "next-gen";
  if (share > 0) return "mixed";
  return fleetQuality(entry) >= STREAMING_MIN_Q ? "streaming" : "basic";
}
function serviceTierLabel(entry) {
  return SERVICE_TIER_LABEL[serviceTierOf(entry)] || serviceTierOf(entry);
}
function restTierLabel(entry) {
  const r = entry && entry.restTier;
  return r ? (REST_TIER_LABEL[r] || r) : null;
}

/* Score any entry object — both paths live here so they can be tested against a
 * synthetic fleet without inventing a fake airline in the map. */
function scoreEntry(entry) {
  if (!entry) return null;

  const L = ledgerFor(entry);
  if (L) {
    const floor = Math.round(clamp01(L.rawFloor) * 100);
    const ceiling = Math.round(clamp01(L.rawCeiling) * 100);
    return {
      score: floor,          // the published ConnectScore IS the floor
      floor: floor,
      ceiling: ceiling,
      label: labelFor(floor),
      resolution: resolutionOf(entry),
      ledger: L,
      /* `parts` keeps every key it had, so nothing downstream breaks. On this
         path pctEquipped/systemQuality/freeFactor describe the PRIMARY system
         only and no longer multiply out to the score — the ledger does that. */
      parts: {
        pctEquipped: pctEquipped(entry),
        systemQuality: systemQuality(entry.system),
        freeFactor: freeFactor(entry.free),
        primary: L.rawFloor,
        legacy: null,
        raw: L.rawFloor,
        floor: L.rawFloor,
        ceiling: L.rawCeiling,
      },
    };
  }

  /* ── legacy single-system path, unchanged ── */
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
    score: score,
    floor: score,
    ceiling: score,          // no segments, no range
    label: labelFor(score),
    resolution: resolutionOf(entry),
    ledger: null,
    parts: {
      pctEquipped: p,
      systemQuality: q,
      freeFactor: f,
      primary: primary,
      legacy: legacyPart,
      raw: raw,
      floor: raw,
      ceiling: raw,
    },
  };
}

/* scoreAirline(key) → {key, name, score, floor, ceiling, ledger, …} or null. */
function scoreAirline(key) {
  const entry = WIFI_AIRLINES[key];
  if (!entry) return null;
  const s = scoreEntry(entry);
  const L = s.ledger;
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
    tracker: entry.tracker || null,
    future: entry.future || null,
    asOf: entry.asOf || null,
    /* ── the second axis. Every field above is unchanged; these are new. ── */
    nextGenScore: nextGenScore(entry),
    nextGenShare: nextGenShare(entry),
    nextGenSystem: isNextGen(entry.system) ? entry.system : null,
    nextGenLabel: isNextGen(entry.system) ? (SYSTEM_LABEL[entry.system] || entry.system) : null,
    serviceTier: serviceTierOf(entry),
    serviceTierLabel: serviceTierLabel(entry),
    serviceTierBlurb: SERVICE_TIER_BLURB[serviceTierOf(entry)] || "",
    restTier: entry.restTier || null,
    restTierLabel: restTierLabel(entry),
    /* ── the segmented model. null on the legacy path. ── */
    floor: s.floor,
    ceiling: s.ceiling,
    hasRange: s.ceiling > s.floor,
    ledger: L,
    segments: L ? L.rows : null,
    known: L ? L.known : null,
    unresolved: L ? L.unresolved : null,
    unresolvedWhy: L ? L.unresolvedWhy : null,
    resolution: s.resolution,
    resolutionLabel: s.resolution ? (RESOLUTION_LABEL[s.resolution] || s.resolution) : null,
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
    WIFI_AIRLINES, SYSTEM_QUALITY, QUALITY_TIER, SYSTEM_TIER, QUALITY_TIER_LABEL,
    FREE_FACTOR, SYSTEM_LABEL, RESOLUTION_LABEL, RESOLUTION_BLURB,
    NEXT_GEN_SYSTEMS, NEXT_GEN_DONE, STREAMING_MIN_Q,
    SERVICE_TIER_LABEL, REST_TIER_LABEL, SERVICE_TIER_BLURB,
    SCORE_CAVEAT, SCORE_METHOD_LINE, TIER_METHOD_LINE,
    clamp01, systemQuality, freeFactor, pctEquipped,
    isSegmented, segmentSystems, segmentQuality, segmentIsNextGen,
    knownAircraft, unresolvedAircraft, resolutionOf, ledgerFor, fleetQuality,
    isNextGen, nextGenShare, nextGenScore,
    serviceTierOf, serviceTierExpected, serviceTierLabel, restTierLabel,
    labelFor, scoreClass, scoreEntry, scoreAirline, rankAirlines,
  };
}
