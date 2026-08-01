/* airlines.js — THE EXTENSION COPY. Generated; do not hand-edit.
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything below this header is the VERBATIM bytes of the site repository's
 * `assets/airlines.js`, which owns the model. Regenerate and verify with
 * `sh build-airlines-parity.sh [--write]`; the release gate runs the same
 * comparison, so drift fails a build instead of surviving in a comment.
 *
 * This replaces a header that CLAIMED byte-identity while the file was 618
 * lines stale and still divided segmented fleets by resolved aircraft only.
 * That made airBaltic read 100 where the site published its 51 whole-fleet
 * floor, against 27 unresolved tails. Unknown is not zero, and a promise of
 * parity that nothing executes is not parity (Codex round 26, P1).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/* airlines.js — static WiFi ConnectScore map (v3.0, the segmented model)
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVENANCE — this file started as a COPY of the browser extension's
 * `extension/airlines.js` (repo: jeremyinthebay/united-starlink-companion,
 * branch bridge-1.6). As of the v3 model this copy is AHEAD of the extension:
 * the extension has no segment data and is mirrored separately. If you change
 * one, change the other — until the `airlines` table in Supabase replaces both
 * (Phase B of wifiodds-infrastructure-plan.md). The site loads this as a plain
 * classic script: the top-level consts below become globals for the inline page
 * scripts, and the module.exports guard at the bottom is a no-op in a browser.
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
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROJECTED SCORE — the number most likely to be misread, so it is fenced
 *
 * `projected` answers a different question from every field above it. Not what
 * a fleet is, but what an airline has signed for. Four carriers have committed
 * to a low-earth-orbit system that has not carried a single passenger yet.
 *
 *   projected = committed aircraft ÷ known fleet × 1.00 (LEO) × free-for-you
 *
 * That is the same denominator, the same quality weight and the same free factor
 * as nextGenScore, so the two sit on one axis: "Delta 0 today, 38 projected from
 * 2028" is a sentence a reader can check. Against a ConnectScore it would not be.
 *
 * The committed count is the FLOOR of what was announced. "500+ Airbus" scores
 * 500, for the same reason the published ConnectScore is the floor.
 *
 * FIVE FENCING RULES, each with a tripwire in build/prerender.js. A projection is
 * a promise somebody else made, and this file is where it could quietly turn into
 * a fact about an aircraft you are sitting in:
 *
 *   1. It sorts nothing. rankAirlines() ranks on today's floor, and the build
 *      asserts that deleting every projection changes no order and no score.
 *   2. It never takes the score arc. assets/site.css gives it a grey outline
 *      (.proj), and the build fails if a projected number ships inside an .sc-*
 *      element or a [data-band].
 *   3. The number never appears without its date. That is why projectionFor()
 *      returns a composed object (`parts` and `line`) instead of an integer, and
 *      why scoreAirline() carries no bare projected number anywhere.
 *   4. It always carries FIRM or SOFT.
 *   5. SLIPPED is COMPUTED from the build date and never stored. Once the
 *      announced start has passed with zero aircraft of the committed system
 *      flying, the confidence flips, the treatment greys out, and the original
 *      promised date keeps showing. A date that was missed should be louder than
 *      one that was met, and nobody should have to remember to make it so.
 *
 * Amazon Leo has no aircraft in the air and no passenger has measured it. A
 * projection is a share of a committed fleet. It is not a throughput claim, and
 * none of the strings below name a speed.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WIFI_AIRLINES = {
  /* ── instrumented: the extension can show real per-flight odds for these ── */
  united: {
    name: "United", code: "UA", asOf: "2026-07",
    nextGenSplit: { mainline: { n: 145, of: 1144 }, regional: { n: 341, of: 669 } },
    /* equipped/fleet MUST equal united/data.json fleet.equipped / fleet.total.
       They had drifted to 481/1807 while data.json said 481/1808, so the same
       homepage printed "481 of 1,807 (27%)" on the US card and "of 1,808
       aircraft" in the United section. build/prerender.js reconciles them from
       data.json on every build, and fails if it cannot find them. */
    system: "starlink", equipped: 486, fleet: 1813, free: "loyalty-free",
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
      { system: "starlink", n: 486, free: "loyalty-free", as: "2026-07-31",
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
    note: "486 of 1,813 aircraft, free for MileagePlus members. Odds swing a lot by route and aircraft type.",
  },
  alaska: {
    name: "Alaska", code: "AS", asOf: "2026-07",
    nextGenSplit: "split-not-published",
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
    name: "JSX", code: "XE", asOf: "2026-04",
    nextGenSplit: "no-mainline-fleet",
    system: "starlink", equipped: 56, fleet: 56, free: "free",
    resolution: "type",
    serviceTier: "next-gen", restTier: null,
    /* CORRECTED 2026-07-26. This entry said 75 of 75 and cited "JSX fleet
       announcements", which names no document. I could not find any JSX
       release, page or filing giving 75, and two dated trade sources
       contradict it. Doug Gollan, Private Jet Card Comparisons, 21 Apr 2026:
       "JSX currently operates 54 Embraer 135/145 jets and two ATR 42-600s",
       stated twice in the piece and again in its meta description. Air Data
       News, 7 Oct 2025, independently has JSX taking delivery of its 50th
       aircraft. So 56, not 75: the old figure overstated the fleet by a third.
       asOf moved from 2026-07 to 2026-04 to match the source date rather than
       implying a July count nobody published. The same Gollan piece expects
       five more E145s and two more ATRs during 2026, so this number should
       rise; do not carry it forward without a newer dated source. The
       fleetwide-and-free claim survives the correction: the same article lists
       Starlink wifi alongside checked bags and drinks as standard on JSX. */
    segments: [
      { system: "starlink", n: 56, free: "free", as: "2026-04",
        src: "Doug Gollan, Private Jet Card Comparisons, 21 Apr 2026 " +
          "(54 Embraer 135/145 + 2 ATR 42-600); Air Data News, 7 Oct 2025",
        note: "The whole fleet. Standard on JSX, like checked bags." },
    ],
    note: "Every aircraft in the fleet, free. JSX finished a Starlink rollout before anyone else.",
  },
  airbaltic: {
    name: "airBaltic", code: "BT", asOf: "2026-03",
    nextGenSplit: "no-regional-fleet",
    system: "starlink", equipped: 28, fleet: 55, free: "free",
    resolution: "type",
    /* mixed, not "next-gen": 28 of 55 aircraft are confirmed Starlink and 27 are
       unresolved, so next-gen odds are a 51% floor, not a fleetwide certainty
       (round 18, P0-02). "next-gen" here rendered "next-gen fleetwide". */
    serviceTier: "mixed", restTier: "unknown",
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
    nextGenSplit: "no-regional-fleet",
    /* CORRECTED 2026-07-26. This entry said 9 of 9 and cited "ZIPAIR
       announcements," which names no document. NO SOURCE FOUND for a ninth
       aircraft: ZIPAIR's own notification #298, 19 Mar 2025
       (https://www.zipair.net/en/notification/298), gives the fleet as "8
       aircraft" of the Boeing 787-8, and the 787-9s the same release announces
       are a different, not-yet-delivered type due "the early 2030s," not 2026.
       The ninth aircraft in the old figure does not exist yet.
       Denominator corrected to 8. The equipped count stays at 8 rather than
       moving to unresolved, because unlike SAS or Qatar there is no gap to
       represent: ZIPAIR is a single aircraft type with no report anywhere of a
       partial rollout, and Runway Girl Network (Feb 2026) states plainly that
       Starlink is live on ZIPAIR's fleet, not that it is still being
       installed. Two dated publishers, one fleet size and one fleetwide claim
       — not an invented number, but flag it if ZIPAIR ever reports a partial
       install; nobody has. */
    system: "starlink", equipped: 8, fleet: 8, free: "free",
    resolution: "type",
    serviceTier: "next-gen", restTier: null,
    segments: [
      { system: "starlink", n: 8, free: "free", as: "2026-02",
        src: "ZIPAIR notification #298, 19 Mar 2025 (fleet size); Runway Girl " +
          "Network, Feb 2026 (Starlink live on the fleet)",
        note: "All eight 787-8s. The 787-9s ZIPAIR has announced are a separate, " +
          "not-yet-delivered type, due \"the early 2030s.\"" },
    ],
    note: "All eight 787-8s, free onboard. ZIPAIR's incoming 787-9s are a different aircraft, not due until the early 2030s.",
  },
  westjet: {
    name: "WestJet", code: "WS", asOf: "2026-07",
    nextGenSplit: "split-not-published",
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
        /* CITATION FIXED 2026-07-26 (D4). The count was already right; "WestJet
           Encore fleet list" named no document. WestJet's own fleet page lists
           39 Q400s. Confirmed via Wikipedia's citation trail (the page itself
           renders client-side and would not return content to a plain fetch),
           dated 24 Mar 2026: "As of March 24, 2026, WestJet Encore lists 39
           aircraft," sourced to westjet.com/en-ca/aircraft. No number changed. */
        src: "WestJet Airlines Ltd., \"Our aircraft,\" westjet.com/en-ca/aircraft, " +
          "39 Q400s, checked via Wikipedia's citation trail dated 24 Mar 2026",
        note: "WestJet Encore Q400s. About a fifth of the passenger fleet, with no announced plan." },
    ],
    unresolved: { n: 54, why: "the 737-700s, the seven 787s and any 737 fitted since Oct 2025; " +
      "WestJet's last published count is nine months old and it has said nothing in 2026" },
    note: "100 of 193 at WestJet's own last count, 9 Oct 2025, and it has published nothing since. " +
      "The 39 Encore Q400s have nothing.",
  },
  airfrance: {
    name: "Air France", code: "AF", asOf: "2026-07",
    nextGenSplit: "split-not-published",
    /* CORRECTED 2026-07-26. This entry said 172 of 229 and cited "Air France
       Starlink rollout releases" — no release with that count exists. Air
       France's own press release (corporate.airfrance.com, "Complimentary
       high-speed wifi now available on board Air France flights," 9 Sep 2025)
       gives NO fleet-wide aircraft count: only "30% of its fleet by the end
       of the year and throughout its fleet by the end of 2026," plus one
       dated figure, "the fifth aircraft in its fleet," as of that date. The
       only type-by-type breakdown in circulation (28/31 777-300ER, 45/56
       A220, 24/30 E190, 30/41 A350, 3/28 A320 -> 130 of 229) runs through One
       Mile at a Time back to stardrift.ai, a banned aggregator (rule 3) that
       was the sole origin of two already-corrected wrong numbers on this
       site. Same shape as the Qatar and ZIPAIR corrections: an aggregator
       figure with no publisher of record behind it.

       So there is no sourced replacement, in either direction: not 172, not
       130 off the aggregator route, and — the trap that bit SAS the same
       night — not 0 either. equippedPublished(entry) derives "is this count
       real" from the data shape (starlink named in no segment, unresolved
       aircraft present) exactly as it does for SAS, so every template on the
       site prints "count unpublished" instead of a number in either
       direction nobody can check. The panasonic segment (57 aircraft) is
       untouched — independent of the Starlink figure, keeps its own
       citation. serviceTier moves from "mixed" to "basic" for the same
       reason it did for SAS: with the starlink segment gone, nextGenShare is
       0 and the remaining Panasonic aircraft do not clear the streaming
       threshold. */
    system: "starlink", equipped: 0, fleet: 229, free: "free",
    resolution: "systems",
    serviceTier: "basic", restTier: "basic",
    segments: [
      { system: "panasonic", n: 57, free: "partial", as: "2026-07",
        src: "Air France connectivity page; Ookla 2H 2025 per-provider medians",
        note: "Ookla measured Air France at 1.38 Mbps on Panasonic against 281.56 on " +
          "Starlink in the same period, a 200× spread inside one airline. The free " +
          "tier on these aircraft is messaging only." },
    ],
    unresolved: { n: 172, why: "Air France has never published a Starlink aircraft count. " +
      "Its 9 Sep 2025 release names a target of fleetwide by end of 2026 and one dated " +
      "figure, the fifth aircraft as of that date, but no fleet-wide total. The only " +
      "type-by-type breakdown in circulation traces to stardrift.ai, a banned aggregator, " +
      "not to Air France." },
    note: "Starlink is live and free for Flying Blue members; Air France's own target is " +
      "fleetwide by the end of 2026 (Air France, \"Complimentary high-speed wifi now " +
      "available on board Air France flights,\" corporate.airfrance.com, 9 Sep 2025). " +
      "Air France has not published an aircraft count. Panasonic remains on 57 aircraft, " +
      "measured at 1.38 Mbps.",
  },
  hawaiian: {
    name: "Hawaiian", code: "HA", asOf: "2026-07",
    nextGenSplit: "no-regional-fleet",
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
    note: "42 of 66. The A330 and A321neo fit is complete; the 19 Boeing 717s have never had wifi at all.",
  },
  qatar: {
    name: "Qatar Airways", code: "QR", asOf: "2026-01",
    nextGenSplit: "no-regional-fleet",
    /* CORRECTED 2026-07-26. This entry said 140 of 241 and cited "Qatar
       Airways press releases; OMAAT, Jul 2026" — but no Qatar release and no
       OMAAT piece from Jul 2026 exists giving 140. NO SOURCE FOUND for 140: it
       traces to starlinkflights.com, a banned aggregator (rule 3). The
       arithmetic gives away how it got there — Qatar's own newsroom, 7 Jan
       2026, states "nearly 120 widebody aircraft, representing over 58% of
       its widebody fleet" now have Starlink; apply that same 58% to the 241
       total here instead of Qatar's own ~207 widebody base and you land near
       140. Same January data, wrong denominator, not a second source.
       Qatar's newsroom archive has nothing dated between Jan and Jul 2026
       revising the count, so 120 (7 Jan 2026) is the newest confirmed figure.
       The 20-aircraft gap between 120 and the old 140 moves to unresolved
       rather than being carried forward on the aggregator's number. The other
       two rows (inmarsat/sita 53, none 48) are untouched — both are
       independent of the Starlink figure. */
    system: "starlink", equipped: 120, fleet: 241, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "basic",
    segments: [
      { system: "starlink", n: 120, free: "free", as: "2026-01-07",
        src: "Qatar Airways newsroom, \"Qatar Airways Launches World's First " +
          "Starlink-Equipped Boeing 787 and Completes Airbus A350 Starlink " +
          "Rollout,\" 7 Jan 2026",
        note: "Free for every passenger in every cabin, no sign-up. Qatar advertises " +
          "up to 500 Mbps per aircraft. \"Nearly 120,\" over 58% of the widebody fleet, " +
          "as of 7 Jan 2026 — the newest count Qatar has published." },
      { system: ["inmarsat", "sita"], n: 53, free: "paid", split: "unpublished", as: "2026-01",
        src: "Qatar Airways connectivity page",
        note: "The pre-Starlink widebody fit. Qatar names both systems and publishes no split." },
      { system: "none", n: 48, free: "none", as: "2026-07", assumed: true,
        src: "inferred: Qatar's fleet count less the aircraft it lists as connected",
        note: "INFERRED, not published. Qatar has never listed these aircraft as connected." },
    ],
    unresolved: { n: 20, why: "Qatar's newest confirmed Starlink count is \"nearly 120\" as of " +
      "7 Jan 2026; the old 140 traced to an aggregator applying Qatar's own percentage to the " +
      "wrong denominator, and nothing Qatar has published since narrows this gap" },
    note: "120 of 241 fitted with Starlink as of 7 Jan 2026, Qatar's newest published count; free for every passenger in every cabin, no sign-up.",
  },
  sas: {
    name: "SAS", code: "SK", asOf: "2026-07",
    nextGenSplit: "split-not-published",
    /* CORRECTED 2026-07-26. This entry said 60 of 123 and cited "SAS;
       Business Travel News Europe." NO SOURCE FOUND for 60 as an installed
       count: it traces to SAS's own CCO, Paul Verhagen, telling Rhys Jones of
       Head for Points on a 15 Jan 2026 test flight that SAS "expected" 60
       A320s equipped "by May-ish this year." That is a dated, named-executive
       quote — it clears the aggregator bar — but it is a January PROJECTION
       for a May target, not a confirmed count. SAS's own 24 Mar 2026 release
       gives no aircraft figure, and no SAS interim report, investor update or
       fleet page from Feb–Jul 2026 gives one either. Today is six weeks past
       Verhagen's own target and nothing newer confirms it landed at 60, or at
       any other number.
       The other two rows are untouched — SAS's own wifi availability table
       (none, 45) and connectivity page (viasat/panasonic, 18) are independent
       of the Starlink figure and still support what they always did. What
       changes is the remainder: 123 − 45 − 18 = 60 aircraft whose Starlink
       status nobody has published moves to unresolved, excluded from the
       denominator rather than assumed equipped on the strength of a January
       guess.

       CORRECTED AGAIN 2026-07-26, same night. The first pass left
       `equipped: 0` on this entry, which every generic "N of fleet" template
       on the site read literally: the page shipped "0 of 123 SAS aircraft
       carry Starlink (0%)" beside a note saying Starlink launched on SAS
       24 Mar 2026. That is the same rule-1 violation the 60 was, in the
       opposite direction and worse, because 0 is a more definite claim than
       an unpublished count and it ranked SAS last of 18 on next-gen odds
       purely for lacking a number. `equippedPublished(entry)` now derives
       "is this primary-system count real or a placeholder" from the shape
       of the data (unresolved aircraft present, primary system absent from
       every segment) rather than from a hand-set flag, so scoreAirline()
       and every template built on it treat SAS's Starlink count as
       unpublished, not zero, and nextGenPublished(entry) keeps a false zero
       from outranking a real measured near-zero like British Airways'
       sourced 5 of 261. The raw `equipped: 0` below is never read directly
       by a render path any more; it survives only as the legacy shape the
       ledger no longer needs it for. */
    system: "starlink", equipped: 0, fleet: 123, free: "loyalty-free",
    resolution: "systems",
    /* serviceTier moved from "mixed" to "basic": with the starlink segment
       gone, nextGenShare is 0 and the two remaining rows (mostly no-wifi
       Embraers/CRJs/ATRs, the rest legacy GEO) don't clear the streaming
       threshold. build/prerender.js asserts this against nextGenShare/
       fleetQuality on every build. */
    serviceTier: "basic", restTier: null,
    segments: [
      { system: "none", n: 45, free: "none", as: "2026-07", assumed: true,
        src: "inferred: absent from SAS's own wifi availability table",
        note: "E190/E195, CRJ900 and ATR 72. SAS's availability table puts this between " +
          "36 and 45; we take 45, because on an unpublished split the count that " +
          "cannot overstate wifi is the larger no-wifi one." },
      { system: ["viasat", "panasonic"], n: 18, free: "unknown", split: "unpublished", as: "2026-07",
        src: "SAS connectivity page",
        note: "The pre-Starlink mainline fit. Both systems named, no split published." },
    ],
    unresolved: { n: 60, why: "the only figure ever published for SAS's Starlink installs is " +
      "its CCO's 15 Jan 2026 projection of 60 A320s \"by May-ish.\" That is a target, not a " +
      "confirmed count. Nothing since, including SAS's own 24 Mar 2026 release, gives an actual number." },
    note: "SAS started free Starlink service for EuroBonus members (free to join) on 2026-03-24 but has published no aircraft count since a January target of 60 by \"May-ish\" that nothing since confirms.",
  },
  emirates: {
    name: "Emirates", code: "EK", asOf: "2026-07",
    nextGenSplit: "no-regional-fleet",
    system: "starlink", equipped: 36, fleet: 232, free: "free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    segments: [
      { system: "starlink", n: 36, free: "free", as: "2026-07-02",
        /* CITATION FIXED 2026-07-26 (D4). The count was already right; "Emirates
           Starlink retrofit announcements" named no document. Emirates' own
           newsroom, "One million connections and counting," 2 Jul 2026, states
           installations complete on "33 Boeing 777s and three Airbus A380s" —
           exactly 36. No number changed. */
        src: "Emirates, \"One million connections and counting: Emirates customers " +
          "embrace Starlink Wi-Fi,\" emirates.com/media-centre, 2 Jul 2026",
        note: "Ookla measured Emirates at 308.65 Mbps in 2H 2025, second only to United's Starlink fleet." },
      { system: ["panasonic", "thales"], n: 196, free: "unknown", split: "unpublished", as: "2026-07",
        src: "Emirates connectivity page",
        note: "Emirates has had wifi fleetwide for years and names both systems. It " +
          "publishes neither the split nor a current price, so this row takes the " +
          "0.85 unconfirmed factor rather than an assumed free." },
    ],
    note: "36 of 232 so far, free onboard. The widebody retrofit is early and the rest of the fleet is older Ku.",
  },
  virginatlantic: {
    name: "Virgin Atlantic", code: "VS", asOf: "2026-07",
    nextGenSplit: "no-regional-fleet",
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
    nextGenSplit: "split-not-published",
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
    note: "Just started. 12 Q400s equipped out of 216; free for Aeroplan members (free to join), per seatwifi.com/Runway Girl, Jun 2026.",
  },
  britishairways: {
    name: "British Airways", code: "BA", asOf: "2026-07",
    nextGenSplit: "split-not-published",
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
    note: "Rollout paused summer 2026, with only 5 aircraft equipped; free for every customer in every cabin once fitted (BA mediacentre, Mar 2026 launch).",
  },
  southwest: {
    name: "Southwest", code: "WN", asOf: "2026-07",
    nextGenSplit: "no-regional-fleet",
    /* fleet: 803 Boeing 737s as of Dec 31 2025, read verbatim from Southwest's
       FY2025 10-K (filed 2026-02-05). The 817 previously here was the Dec 31
       2023 figure and had gone stale. Third-party trackers still quote 817. */
    system: "starlink", equipped: 1, fleet: 803, free: "loyalty-free",
    resolution: "systems",
    serviceTier: "mixed", restTier: "unknown",
    /* The one projection here that is a COMPLETION target rather than a start
       date: installs are already running, one aircraft is in service, and the
       published promise is 300+ of 803 by the end of 2026. That matters for rule
       5 — the SLIPPED flip fires when a horizon passes with NOTHING installed, so
       a fleet with one aircraft flying can never trip it. If Southwest reaches
       2027 with 40 aircraft done, `horizonPassed` goes true and the confidence
       does not. Read the note in build/prerender.js before "fixing" that. */
    /* CITATION FIXED 2026-07-26 (D4). The 300 target was already right; "the
       300-by-year-end target, restated when N8543Z entered service" named no
       document. Southwest's own investor-relations newsroom, 11 Feb 2026:
       "it will be available on more than 300 aircraft by the end of 2026." No
       number changed. */
    projected: {
      system: "starlink", n: 300, free: "loyalty-free",
      starts: null, by: "2026",
      horizon: "300+ by end-2026, installs running",
      confidence: "FIRM",
      src: "Southwest Airlines, \"Southwest Airlines Brings Starlink Ultra-Fast " +
        "Wifi Onboard,\" southwestairlinesinvestorrelations.com, 11 Feb 2026",
      as: "2026-02-11",
      note: "300 is the floor of “300+”, and it counts the aircraft already in service. " +
        "Free for Rapid Rewards members, and joining is free.",
    },
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
    nextGenSplit: "split-not-published",
    system: "viasat", equipped: 890, fleet: 989, free: "free",
    future: { system: "starlink", from: "2027-Q1", detail: "500+ Airbus aircraft signed" },
    /* SIGNED, NOT FLYING. 500+ Airbus narrowbodies out of 989, installs from
       2027-Q1. The Boeing narrowbodies stay on Viasat under this deal and the
       Panasonic widebodies are not in it either, which caps American's
       projection near half.
       On `free`: American's free wifi is an AAdvantage-sponsored fleet product,
       not a per-system offer, so an aircraft that swaps Viasat for Starlink stays
       free. American has published no separate Starlink price. I am reading that
       as free rather than unconfirmed; if a price appears this drops to "unknown"
       and the projection falls from 51 to 43. */
    projected: {
      system: "starlink", n: 500, free: "free",
      starts: "2027-Q1", by: null,
      horizon: "installs begin 2027-Q1",
      confidence: "FIRM",
      src: "Runway Girl Network, 2026-05-26: American pivots to Starlink for 500+ Airbus narrowbodies",
      as: "2026-05-26",
      note: "500 is the floor of “500+”.",
    },
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
    note: "Free Viasat/Intelsat on ~90% of the fleet today. Airbus-only Starlink from 2027. Boeing stays Viasat.",
  },
  delta: {
    name: "Delta", code: "DL", asOf: "2026-07",
    nextGenSplit: "split-not-published",
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
    /* SIGNED, NOT FLYING, and the deal with the largest gap between what it is
       and what it sounds like. 500 aircraft out of the 1,330 the segments below
       account for, from 2028. Delta also says "hundreds more over time"; that is
       not a count, so it is not counted, and the projection is 38 rather than the
       50-ish a reader might assume from the press release. */
    projected: {
      system: "leo", n: 500, free: "loyalty-free",
      starts: "2028", by: null,
      horizon: "begins 2028",
      confidence: "FIRM",
      src: "Delta news release and Amazon news release, both 2026-03-31",
      as: "2026-03-31",
      note: "Free for SkyMiles members, and joining is free. Delta keeps Viasat and " +
        "Hughes alongside Leo, so this is not a fleet conversion.",
    },
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
    note: "Delta Sync (Viasat + Hughes) on 1,150+ aircraft, free for SkyMiles members, but not fleetwide: the 80 Boeing 717s lost their legacy wifi in May 2026 awaiting the Hughes retrofit, and transpacific widebodies come online fall 2026. Amazon Leo lands on 500 aircraft from 2028.",
  },
  jetblue: {
    name: "jetBlue", code: "B6", asOf: "2026-07",
    nextGenSplit: "no-regional-fleet",
    /* coverage stays 1.0 — every one of the 291 aircraft (129 A320, 101 A321,
       61 A220 as of 2026-03-31, per JetBlue's Q1 8-K) carries Viasat Ka-band
       Fly-Fi. TWO HARDWARE GENERATIONS are flying and that much is sourced:
       JetBlue's own Kuiper release (2025-09-04) says Leo goes to "aircraft
       currently flying JetBlue's original Fly-Fi technology", and Runway Girl
       Network (2025-09-09) reports the extended Viasat pact covers "aircraft
       already equipped with Viasat's latest technology". Two cohorts, named
       by the airline and its vendor.

       ═══ WHICH AIRFRAMES ARE IN WHICH COHORT IS NOT PUBLISHED ═════════════
       Corrected 2026-07-26. Until tonight this entry asserted a full mapping
       (A220 + A321neo/LR on ViaSat-2, A320/A321ceo on ViaSat-1) and cited the
       Q1 2026 8-K for it. The 8-K contains fleet COUNTS ONLY and says nothing
       about satellites. Two of the five types have a real source and three do
       not:
         A321ceo   ViaSat-1  Runway Girl Network, 2022-12-24 (one flight report)
         A220-300  ViaSat-2  Viasat contract release, 2019-08-07
         A320ceo   no published generation found
         A321neo   no published generation found
         A321LR    no published generation found
       The 2021 Viasat/JetBlue release names the A220-300 and A321LR together
       but gives a satellite generation for neither, so do NOT read the A220's
       ViaSat-2 across to the A321LR. A 2017 PaxEx report of a ViaSat-2 A320
       retrofit was never confirmed as completed and its own 2018 follow-up
       calls the timing "unclear". Do not restore a per-type split without a
       source that states it.

       Both generations are Viasat Ka, so they are one segment: the model
       scores the system, and the generation gap is a note. The E190s (the one
       sub-fleet with patchy Fly-Fi) were fully retired 2025-09-10. Amazon Leo
       from 2027 explicitly targets the first-gen kit first. */
    system: "viasat", coverage: 1.0, free: "free",
    future: { system: "leo", from: "2027", detail: "Amazon Leo" },
    /* SIGNED, NOT FLYING, and the only projection stored as a SHARE instead of a
       count. JetBlue published a fraction — about a quarter of the fleet, the
       airframes still on the original ViaSat-1 kit — and never a number. Which
       airframes those are (older A321s out of JFK and BOS) is secondary
       reporting. So the confidence is SOFT and the stored value stays 0.25 rather
       than hardening into a tail count nobody published. projectionFor() still
       reports 73 aircraft for a surface that needs a head count, but it flags it
       with aircraftPublished:false, because 0.25 × 291 is 72.75 and the airline
       never said 73. */
    projected: {
      system: "leo", n: null, share: 0.25, free: "free",
      starts: "2027", by: "2028",
      horizon: "begins 2027, complete 2028",
      confidence: "SOFT",
      src: "JetBlue press release, 2025-09-04; sub-fleet detail from secondary reporting",
      as: "2025-09-04",
      note: "Free for everyone onboard. JetBlue keeps GEO Fly-Fi alongside Leo, so " +
        "the rest of the fleet does not go dark.",
    },
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
  "ConnectScore is a conservative whole-fleet lower bound, not an expected value or a prediction about one flight: " +
  "United measured 320, 56 and 15 Mbps on three systems in one livery in one reporting period. " +
  "Aircraft whose system an airline does not publish stay in the denominator and add zero to the " +
  "lower bound rather than being dropped from it. Signed-but-unflown deals (AA Starlink 2027, " +
  "DL/B6 Amazon Leo) score zero until they fly.";

const SCORE_METHOD_LINE =
  "ConnectScore = the sum, over every segment of the fleet, of whole-fleet share × system quality × " +
  "free-for-you. Unresolved aircraft stay in the denominator and add zero, so the published score " +
  "is a whole-fleet lower bound. " +
  "Data: unitedstarlinktracker.com · alaskastarlinktracker.com · airline announcements (Jul 2026).";

/* The headline line for the two-number reading. Deliberately says what it does
 * NOT count: a signed deal, and the older hardware on the rest of the fleet. */
const TIER_METHOD_LINE =
  "Next-gen odds = share of the fleet flying Starlink or Amazon Leo today × free-for-you. " +
  "Signed-but-unflown deals count zero. The second line is what the fleet actually " +
  "delivers today: next-gen, streaming-class, basic, or mixed.";

/* ── the projected score ──────────────────────────────────────────────────
 * The header carries the five fencing rules. These three constants are the data
 * half; build/prerender.js is the enforcement half. */
const PROJECTION_CONFIDENCE = {
  FIRM: "signed, with the aircraft count and the date both published",
  SOFT: "signed, but the count or the date is secondary reporting",
  SLIPPED: "the announced date has passed and nothing is installed",
};

/* Stored confidence may only be one of these. SLIPPED is derived at build time,
 * so it is deliberately absent. */
const PROJECTION_STORED = ["FIRM", "SOFT"];

const PROJECTION_METHOD_LINE =
  "Projected score = committed aircraft ÷ the same known-fleet denominator the next-gen odds " +
  "use × 1.00 for low-earth orbit × free-for-you. It is the next-gen number a fleet would carry " +
  "if the announced deal lands as announced, so read it against next-gen odds and never against " +
  "the ConnectScore. A projection never moves the leaderboard and it carries its date and its " +
  "confidence wherever it appears. FIRM: count and date both published. SOFT: one of the two is " +
  "secondary reporting. SLIPPED: the announced date has passed with nothing installed, computed " +
  "from the build date rather than stored. A committed share of a fleet is not a measurement — " +
  "nobody has measured Amazon Leo in a cabin, because nobody is flying it.";

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
/* Free-for-you as an INTERVAL, for the ConnectScore lower/upper bounds. A
 * confirmed tier is a point (min === max). An UNKNOWN or unrecorded free status
 * is [0, 1]: it contributes zero to the floor and one to the ceiling. It never
 * enters the floor as an assumed 0.85 midpoint — that midpoint is exactly what
 * the round-18 P0-02 ruling forbids inside a quantity called a floor. This is
 * separate from freeFactor() on purpose: the next-gen odds and the projected
 * score keep the documented point estimate, because every next-gen segment
 * publishes a real free status; only the ConnectScore bound needs the honest
 * range. */
function freeInterval(free) {
  const k = String(free || "").toLowerCase();
  if (k === "unknown" || !(k in FREE_FACTOR)) return { min: 0, max: 1 };
  const f = FREE_FACTOR[k];
  return { min: f, max: f };
}
/* Whole-fleet evidence status for a ledger. fleetwide when nothing is
 * unresolved; mixed when most of the fleet is resolved; limited evidence when a
 * large share is unresolved and the lower bound is therefore far below the
 * ceiling. Thresholds are deliberate and coarse — this is a label, not a
 * second score. */
function fleetStatusOf(L) {
  if (!L || !L.unresolved || L.unresolved <= 0) return "fleetwide";
  if (L.coverage >= 0.7) return "mixed";
  return "limited evidence";
}
/* True unless the primary system's `equipped` count is a placeholder for
 * "nobody has published this." A segmented entry with unresolved aircraft
 * whose primary system never names a segment has NO known count for that
 * system — not a zero. `equipped: 0` must never again stand in for
 * "unpublished" the way it did for SAS until this was caught 2026-07-26: 0
 * asserts a confirmed absence, and nothing SAS has published confirms that in
 * either direction. airBaltic/Qatar/WestJet are the contrast case — each
 * names its primary system in a real segment (28, 120, 100 respectively), so
 * a genuine floor exists even with aircraft left unresolved, and this
 * returns true for them. Depends on isSegmented/segmentSystems/
 * unresolvedAircraft below; safe because function declarations hoist. */
function equippedPublished(entry) {
  if (!entry) return true;
  if (!isSegmented(entry)) return true;
  if (unresolvedAircraft(entry) <= 0) return true;
  var sys = String(entry.system || "").toLowerCase();
  return entry.segments.some(function (s) { return segmentSystems(s).indexOf(sys) >= 0; });
}
// Share of the fleet carrying the primary system. equipped/fleet when both are
// known, otherwise an explicit `coverage` fraction (Delta/jetBlue publish no
// tail counts, only "fleetwide"). Returns null, never 0, when the count
// itself is unpublished — see equippedPublished() above.
function pctEquipped(entry) {
  if (!entry) return 0;
  if (!equippedPublished(entry)) return null;
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

  /* THE WHOLE-FLEET DENOMINATOR. `T` is every tail a passenger could be
     assigned, resolved or not. Round-18 P0-02: the published ConnectScore is the
     whole-fleet LOWER BOUND, so each segment's share is n/T, not n/known.
     Unresolved aircraft are a real part of the fleet that we cannot vouch for;
     they contribute zero to the floor and their whole share to the ceiling,
     rather than being dropped from the denominator. That is why airBaltic reads
     51 (28 of 55) and not a false fleetwide 100 (28 of 28). */
  const T = known + unresolved;
  let rawFloor = 0, rawCeiling = 0, rawNextGen = 0, nextGenShare = 0;
  let resolvedFloor = 0, resolvedCeiling = 0;
  const rows = entry.segments.map(function (seg) {
    const systems = segmentSystems(seg);
    const q = segmentQuality(seg);
    const n = Number(seg.n) || 0;
    const share = T > 0 ? n / T : 0;          // whole-fleet share
    const shareResolved = known > 0 ? n / known : 0;  // resolved-subset share
    const fi = freeInterval(seg.free);        // [0,1] when free is unknown
    const nextGen = segmentIsNextGen(seg);
    const pointsMin = share * q.min * fi.min * 100;
    const pointsMax = share * q.max * fi.max * 100;
    rawFloor += pointsMin / 100;
    rawCeiling += pointsMax / 100;
    /* The resolved-subset bound is the same arithmetic over `known`. It is the
       `resolvedSubsetScore` diagnostic, labelled "Among resolved aircraft"
       wherever it appears, and it never sorts, ranks, or stands in for the
       public ConnectScore. */
    resolvedFloor += shareResolved * q.min * fi.min;
    resolvedCeiling += shareResolved * q.max * fi.max;
    /* NEXT-GEN ODDS already divide by the whole fleet, and keep the documented
       free POINT estimate (freeFactor): every next-gen segment publishes a real
       free status, so the [0,1] interval never applies to one. */
    const fNg = freeFactor(seg.free);
    const ngShareFleet = share;
    if (nextGen) { rawNextGen += ngShareFleet * fNg; nextGenShare += ngShareFleet; }
    return {
      systems: systems,
      systemLabel: systems.map(function (s) { return SYSTEM_LABEL[s] || s; }).join(" or "),
      tier: SYSTEM_TIER[systems[0]] || "legacyGeo",
      n: n,
      share: share,
      shareResolved: shareResolved,
      qMin: q.min, qMax: q.max,
      free: seg.free || "unknown",
      /* A single number when free is confirmed, null when it is a [0,1] range,
         so a surface never prints an invented midpoint for an unknown price. */
      freeFactor: fi.min === fi.max ? fi.min : null,
      freeMin: fi.min, freeMax: fi.max,
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

  /* The unresolved aircraft as one visible ledger line: zero at the floor,
     their whole share of the fleet at the ceiling. */
  const unresolvedShare = T > 0 ? unresolved / T : 0;
  const sumFloor = rows.reduce(function (t, r) { return t + r.pointsMin; }, 0);
  const sumCeiling = Math.min(100,
    rows.reduce(function (t, r) { return t + r.pointsMax; }, 0) + unresolvedShare * 100);

  return {
    rows: rows,
    known: known,
    unresolved: unresolved,
    unresolvedWhy: (entry.unresolved && entry.unresolved.why) || null,
    unresolvedShare: unresolvedShare,
    total: T,
    coverage: T > 0 ? known / T : 1,
    /* Whole-fleet lower and upper bounds, 0..1. rawFloor is the published
       ConnectScore; rawCeiling carries the unresolved share and is capped at 1. */
    rawFloor: sumFloor / 100,
    rawCeiling: sumCeiling / 100,
    /* Resolved-subset bounds, 0..1 — the "Among resolved aircraft" diagnostic. */
    resolvedFloor: clamp01(resolvedFloor),
    resolvedCeiling: clamp01(resolvedCeiling),
    rawNextGen: rawNextGen,
    nextGenShare: nextGenShare,
    /* Σ over the rows, before rounding. The build asserts these match the
       published integers to within half a point. sumFloor is the whole-fleet
       floor; sumCeiling adds the unresolved share. */
    sumFloor: sumFloor,
    sumCeiling: sumCeiling,
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

/* True unless nextGenScore's 0 is a false zero: a segmented entry with
 * unresolved aircraft and ZERO confirmed next-gen aircraft in its known
 * segments. That shape means the next-gen question was never actually
 * answered — it means "unpublished," not "measured at zero" — and it must
 * not rank the same as a real, fully- or mostly-accounted near-zero like
 * British Airways (5 of 261, unresolved 0). Any entry with at least one
 * confirmed next-gen aircraft (airBaltic, Qatar, WestJet) keeps a real floor
 * and returns true even though more aircraft remain unresolved. */
function nextGenPublished(entry) {
  if (!entry) return true;
  const L = ledgerFor(entry);
  if (!L) return true;
  if (L.unresolved <= 0) return true;
  return L.nextGenShare > 0;
}

/* ── the mainline/regional split of NEXT-GEN ODDS, not of ConnectScore ─────
 * D2: the united/data.json roster is Starlink-only (tail/type/fleet/seen, no
 * system field), so aircraft type ties to a segment but Viasat/Panasonic/Thales
 * installs do NOT. Building that crosstab for anyone but United would be
 * inventing data, which rule 1 forbids. So this splits next-gen odds only, and
 * only United carries real numbers.
 *
 * `entry.nextGenSplit` is either:
 *   a STRING state — "no-regional-fleet" | "split-not-published" |
 *     "no-mainline-fleet" — for every airline this cannot be computed for, or
 *   an OBJECT { mainline: {n, of}, regional: {n, of} } — United only, kept in
 *     sync with united/data.json by reconcileUnited() in build/prerender.js.
 *
 * A STATE IS NOT A ZERO. mainline/regional are null whenever the state is not
 * "value" — never 0, which would read as "no Starlink" instead of "no data". */
function nextGenSplitFor(entry) {
  const raw = entry && entry.nextGenSplit;
  if (!raw) return { state: "split-not-published", mainline: null, regional: null };
  if (typeof raw === "string") return { state: raw, mainline: null, regional: null };
  const f = freeFactor(entry.free);
  function seg(x) {
    if (!x || !x.of) return null;
    return { n: x.n, of: x.of, pct: Math.round(clamp01((Number(x.n) / Number(x.of)) * f) * 100) };
  }
  return { state: "value", mainline: seg(raw.mainline), regional: seg(raw.regional) };
}

/* ── the projected score ──────────────────────────────────────────────────
 * Five small functions. Four are pure arithmetic on one entry; the fifth,
 * projectionFor(), is the only one anything should render, and it is the fence
 * for rules 3 and 4 — it composes the number, the promised date and the
 * confidence word into one object so they cannot be separated by accident. */

/* The last day a horizon can still be met, derived from however coarsely the
 * airline announced it. Nothing here is stored. "2027-Q1" becomes 2027-03-31 on
 * every build, and that is what lets SLIPPED fire without anyone editing a
 * field. Returns null for a spec this cannot read, which fails the build. */
function horizonEnd(spec) {
  const s = String(spec || "");
  let m;
  if (/^\d{4}$/.test(s)) return s + "-12-31";
  if ((m = /^(\d{4})-Q([1-4])$/.exec(s))) {
    return m[1] + "-" + ["03-31", "06-30", "09-30", "12-31"][Number(m[2]) - 1];
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) {
    /* day 0 of the next month is the last day of this one, leap years included */
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return s + "-" + (last < 10 ? "0" : "") + last;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/* Aircraft of the COMMITTED system flying today, counted off the segments. This
 * is the "nothing is installed" half of rule 5, and it is a count rather than a
 * flag so the surfaces can say 1 of 300 instead of "started". */
function projectedInstalled(entry) {
  const p = entry && entry.projected;
  if (!p || !isSegmented(entry)) return 0;
  const want = String(p.system || "").toLowerCase();
  return entry.segments.reduce(function (t, seg) {
    return segmentSystems(seg).indexOf(want) >= 0 ? t + (Number(seg.n) || 0) : t;
  }, 0);
}

/* Committed share of the fleet. A projection stores either a count (`n`) or,
 * where the airline published a fraction and no count, a `share`. JetBlue is the
 * second case: 0.25 of 291 is 72.75 aircraft and rounding it would be inventing
 * a number the source does not contain. */
function projectedShare(entry) {
  const p = entry && entry.projected;
  if (!p) return 0;
  const known = knownAircraft(entry) || (typeof entry.fleet === "number" ? entry.fleet : 0);
  if (typeof p.n === "number" && known) return clamp01(p.n / known);
  return clamp01(typeof p.share === "number" ? p.share : 0);
}

/* The bare integer. NOTHING THAT RENDERS SHOULD CALL THIS. It exists for
 * arithmetic, for the tripwires and for the tests; scoreAirline() deliberately
 * exposes no bare projected number, only projectionFor()'s composed object. */
function projectedScore(entry) {
  const p = entry && entry.projected;
  if (!p) return null;
  return Math.round(
    clamp01(projectedShare(entry) * systemQuality(p.system) * freeFactor(p.free)) * 100);
}

/* The renderable shape, and the whole reason rules 3 and 4 hold: the score, the
 * promised date and the confidence word arrive together or not at all.
 *
 * `now` is a YYYY-MM-DD string and defaults to the build date. It is a parameter
 * only so the build can ask "what does this become the day after its horizon?"
 * and fail if the answer is not SLIPPED — see build/prerender.js. */
function projectionFor(entry, now) {
  const p = entry && entry.projected;
  if (!p) return null;
  const known = knownAircraft(entry) || (typeof entry.fleet === "number" ? entry.fleet : 0);
  const share = projectedShare(entry);
  const score = projectedScore(entry);
  const q = systemQuality(p.system);
  const f = freeFactor(p.free);
  const end = horizonEnd(p.starts || p.by);
  const today = String(now || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const installed = projectedInstalled(entry);
  const passed = !!end && today > end;
  const slipped = passed && installed === 0;
  const confidence = slipped ? "SLIPPED" : String(p.confidence || "");
  const aircraft = typeof p.n === "number" ? p.n : Math.round(share * known);
  /* The date in `horizon` is the ORIGINAL promise and it is never rewritten,
     including after a slip. That is rule 5's second half. */
  const value = String(score) + " projected";
  return Object.freeze({
    score: score,
    share: share,
    aircraft: aircraft,
    aircraftPublished: typeof p.n === "number",
    known: known,
    system: p.system,
    systemLabel: SYSTEM_LABEL[p.system] || p.system,
    quality: q,
    free: p.free,
    freeFactor: f,
    starts: p.starts || null,
    by: p.by || null,
    horizon: p.horizon,
    horizonEnd: end,
    horizonPassed: passed,
    installed: installed,
    confidence: confidence,
    confidenceMeans: PROJECTION_CONFIDENCE[confidence] || "",
    slipped: slipped,
    /* three parts for a surface with three slots, one line for a surface with
       one. Either way the date and the confidence travel with the number. */
    parts: Object.freeze({ value: value, horizon: p.horizon, confidence: confidence }),
    line: value + " · " + p.horizon + " · " + confidence,
    basis: (typeof p.n === "number" ? p.n.toLocaleString("en-US") : Math.round(share * 100) + "%")
      + " of " + known.toLocaleString("en-US")
      + " aircraft committed × " + q.toFixed(2) + " low-earth orbit × "
      + f.toFixed(2) + " free-for-you",
    means: "A committed share of the fleet, not a measurement. " + (installed
      ? installed + " of them " + (installed === 1 ? "is" : "are") + " flying it today."
      : String(p.system || "").toLowerCase() === "leo"
        ? "Amazon Leo has no aircraft in the air, and no passenger has measured it."
        : "None of them are flying it yet."),
    src: p.src || null,
    as: p.as || null,
    note: p.note || null,
  });
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
      score: floor,          // the published ConnectScore IS the whole-fleet lower bound
      floor: floor,
      ceiling: ceiling,
      /* Unrounded lower bound, 0..100 — the ONLY key the leaderboard sorts on,
         so American's 51.036 outranks airBaltic's 50.909 even though both
         display 51 (round-18 P0-02, tie rule 1). */
      scoreExact: clamp01(L.rawFloor) * 100,
      coverage: L.coverage,
      total: L.total,
      /* "Among resolved aircraft" — a diagnostic, never a rank or a headline. */
      resolvedSubsetScore: Math.round(L.resolvedFloor * 100),
      resolvedSubsetCeiling: Math.round(L.resolvedCeiling * 100),
      fleetStatus: fleetStatusOf(L),
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
  const legacyTotal = typeof entry.fleet === "number" ? entry.fleet : null;
  return {
    score: score,
    floor: score,
    ceiling: score,          // no segments, no range
    /* A legacy entry has no unresolved cohort, so the whole-fleet lower bound IS
       the score, coverage is full, and the resolved-subset equals it. */
    scoreExact: raw * 100,
    coverage: 1,
    total: legacyTotal,
    resolvedSubsetScore: score,
    resolvedSubsetCeiling: score,
    fleetStatus: "fleetwide",
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
    equipped: typeof entry.fleet === "number" && equippedPublished(entry) ? entry.equipped : null,
    fleet: typeof entry.fleet === "number" ? entry.fleet : null,
    /* Never invented, never defaulted true: false is the SAS shape (0 known,
       aircraft still unresolved). Every surface that prints "N of M" or ranks
       on nextGenScore must check this before it uses a number as a number. */
    equippedPublished: equippedPublished(entry),
    instrumented: !!entry.instrumented,
    tracker: entry.tracker || null,
    future: entry.future || null,
    asOf: entry.asOf || null,
    /* ── the second axis. Every field above is unchanged; these are new. ── */
    nextGenScore: nextGenScore(entry),
    nextGenShare: nextGenShare(entry),
    nextGenPublished: nextGenPublished(entry),
    nextGenSystem: isNextGen(entry.system) ? entry.system : null,
    nextGenLabel: isNextGen(entry.system) ? (SYSTEM_LABEL[entry.system] || entry.system) : null,
    /* ── D2: the mainline/regional split of next-gen odds, United-only today. ── */
    nextGenSplit: nextGenSplitFor(entry),
    serviceTier: serviceTierOf(entry),
    serviceTierLabel: serviceTierLabel(entry),
    serviceTierBlurb: SERVICE_TIER_BLURB[serviceTierOf(entry)] || "",
    restTier: entry.restTier || null,
    restTierLabel: restTierLabel(entry),
    /* ── the segmented model. null on the legacy path. ── */
    floor: s.floor,
    ceiling: s.ceiling,
    hasRange: s.ceiling > s.floor,
    /* ── round-18 P0-02: the whole-fleet recommendation contract. `score`,
       `floor` and `connectScoreLower` are the same number — the published
       lower bound — and `scoreExact` is its unrounded form for ranking.
       `resolvedSubsetScore` is the "Among resolved aircraft" diagnostic and
       never ranks. Every recommendation surface reads these. ── */
    connectScoreLower: s.floor,
    connectScoreUpper: s.ceiling,
    scoreExact: s.scoreExact,
    coverage: typeof s.coverage === "number" ? s.coverage : 1,
    coveragePct: Math.round((typeof s.coverage === "number" ? s.coverage : 1) * 100),
    total: s.total != null ? s.total : (L ? L.total : (typeof entry.fleet === "number" ? entry.fleet : null)),
    resolvedSubsetScore: s.resolvedSubsetScore,
    resolvedSubsetCeiling: s.resolvedSubsetCeiling,
    fleetStatus: s.fleetStatus,
    ledger: L,
    segments: L ? L.rows : null,
    known: L ? L.known : (typeof entry.fleet === "number" ? entry.fleet : null),
    unresolved: L ? L.unresolved : 0,
    unresolvedWhy: L ? L.unresolvedWhy : null,
    resolution: s.resolution,
    resolutionLabel: s.resolution ? (RESOLUTION_LABEL[s.resolution] || s.resolution) : null,
    /* ── the projected score. An OBJECT or null, and there is deliberately no
       sibling integer: a surface that wants the number has to take the promised
       date and the confidence word with it. See the fencing rules in the header
       and the tripwires in build/prerender.js. ── */
    projected: projectionFor(entry),
  };
}

/* Whole-fleet coverage, used ONLY to break an exact lower-bound tie: known ÷
 * (known + unresolved). Round-18 P0-02 tie rule 2 — a genuinely fleetwide
 * result outranks a partial-fleet one that merely lands on the same number.
 * airBaltic (28 of 55, coverage 0.51) can never share a rank with a fleetwide
 * carrier because its unrounded lower bound is lower to begin with; this only
 * settles an EXACT tie, and then by more-resolved-fleet-first. */
function tieCoverage(a) {
  return typeof a.coverage === "number" ? a.coverage : 1;
}

/* Every airline, best odds first. Round-18 P0-02: rank on the UNROUNDED
 * whole-fleet lower bound (scoreExact), so American's 51.036 sits above
 * airBaltic's 50.909 even though both display 51. Exact ties break on
 * whole-fleet coverage (more resolved first), then stable airline name. The
 * upper bound is never a ranking key — it communicates uncertainty, not
 * expected performance. Rounding is for display only, after ranking. */
function rankAirlines() {
  return Object.keys(WIFI_AIRLINES)
    .map(scoreAirline)
    .sort(function (a, b) {
      if (b.scoreExact !== a.scoreExact) return b.scoreExact - a.scoreExact;
      var bc = tieCoverage(b), ac = tieCoverage(a);
      if (bc !== ac) return bc - ac;
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
    PROJECTION_CONFIDENCE, PROJECTION_STORED, PROJECTION_METHOD_LINE,
    horizonEnd, projectedInstalled, projectedShare, projectedScore, projectionFor,
    clamp01, systemQuality, freeFactor, freeInterval, fleetStatusOf, pctEquipped,
    isSegmented, segmentSystems, segmentQuality, segmentIsNextGen,
    knownAircraft, unresolvedAircraft, resolutionOf, ledgerFor, fleetQuality,
    isNextGen, nextGenShare, nextGenScore, nextGenSplitFor,
    serviceTierOf, serviceTierExpected, serviceTierLabel, restTierLabel,
    labelFor, scoreClass, scoreEntry, scoreAirline, rankAirlines, tieCoverage,
  };
}
