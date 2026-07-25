/* Starlink odds — content script for united.com / Navan / alaskaair.com /
 * Google Flights (v2.0)
 * - Badges + n/a pills on every flight row; full-page sort by odds.
 * - Round-trip aware: when United shows the RETURN leg, everything flips to the
 *   reverse route automatically.
 * - Date aware: ✓ marks and "confirmed tails" only shown when the searched date
 *   is within ~3 days (tail assignments publish ~48h out).
 * - Panel: jump-to-flight, ghost rows for non-operating flights, ↻ force
 *   refresh (busts the 6h cache), optional "keep sorted" that re-asserts the
 *   sort after United re-renders.
 * Selector-independent: keys on visible flight-number text ("UA ####" on
 * united.com/Navan, "AS ###" on alaskaair.com). Data via the service worker,
 * which routes each airline to its own tracker.
 */
(() => {
  "use strict";
  const NAVAN = /(^|\.)navan\.com$/.test(location.hostname);
  // 1.6: alaskaair.com runs the same code through a dynamically-registered
  // content script (optional host permission). Navan stays UA-only on purpose —
  // it lists several carriers and mixed matching would regress United there.
  const ALASKA = /(^|\.)alaskaair\.com$/.test(location.hostname);
  /* ── Google Flights (2.0) ─────────────────────────────────────────────────
   * GFLIGHTS is the HOST flag (the injection match is already narrowed to
   * /travel/* in the manifest / dynamic registration). GF_ACTIVE is the much
   * stricter render gate: flights search/results only, and never anything that
   * smells like checkout, payment or a booking hand-off. When GFLIGHTS is true
   * and GF_ACTIVE is false the script does NOTHING AT ALL — it must not fall
   * through to the united.com scanner, which would badge "United 1812" text on
   * a page we have no business touching. */
  const GFLIGHTS = location.hostname === "www.google.com" &&
    location.pathname.indexOf("/travel") === 0;
  const GF_RESULTS_PATH = /^\/travel\/flights(\/|$)/;
  const GF_DENY_PATH = /(?:checkout|payment|payments|purchase|billing|pay|book(?:ing)?-?confirm|confirmation)/i;
  const GF_ACTIVE = GFLIGHTS &&
    GF_RESULTS_PATH.test(location.pathname) &&
    !GF_DENY_PATH.test(location.pathname);
  // Hard stop before anything else is even defined: on a www.google.com/travel
  // path that is not a flights search/results page — Explore, Hotels, a booking
  // hand-off, anything checkout-shaped — we install no observer, no interval and
  // no message listener, and touch no DOM.
  if (GFLIGHTS && !GF_ACTIVE) return;
  const AIRLINE = ALASKA ? "AS" : "UA";
  const TRACKER = ALASKA ? "alaskastarlinktracker.com" : "unitedstarlinktracker.com";
  // The trailing lookahead keeps "Alaska 737-900" (an aircraft type) from being
  // read as flight AS737.
  const FN_RE = ALASKA
    ? /\b(?:AS|Alaska)\s?(\d{1,4})\b(?!\s?-\s?\d)/
    : /\b(?:UA|United)\s?(\d{2,4})\b/;
  // Odds fetched per-flight (rather than from a route table) on sites where the
  // tracker has no per-route flight list.
  const PAGE_PREDICT = NAVAN || ALASKA || GFLIGHTS;
  const TIME_RE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/gi;
  // Non-global twin of TIME_RE. .test() on a /g regex advances lastIndex and
  // silently alternates true/false across calls — never use TIME_RE for tests.
  const TIME_ONE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/i;
  let ctx = null;            // {o,d,date,phase} — the ACTIVE leg
  let ctxKey = "", dataKey = "";
  let navanCtxCache = null, navanCtxKey = "", navanSig = "";
  let data = null, panelEl = null, scanScheduled = false;
  let probMap = new Map();
  let registry = new Map();
  let keepSorted = false, autoSort = false, desiredOrder = null, lastSortTs = 0;
  let watched = new Set(); // "UA1812|2026-07-25"
  // Selector/tuning values, overridable by the remotely-hosted manifest the
  // service worker caches. Absent a remote config these defaults are used
  // verbatim, so behavior is unchanged.
  // alaskaRoute is a best-guess hook for alaskaair.com's search summary; it is
  // optional — the URL params and the "SEA to SFO" text scan both work without
  // it, and the remote manifest can patch it in once the real markup is known.
  //
  // Google Flights keys are deliberately generic. GF ships obfuscated, rotating
  // class names (".pIav2d", ".Rk10dc"), so NOTHING here may reference one: the
  // row selector is a plain structural "ul li" and every actual decision is made
  // from ARIA labels and visible text (a time range + an airline name). The
  // length window is what keeps the outermost-wins pass from mistaking the whole
  // results list for a single row. All of it is remote-patchable via the
  // selector manifest if Google reshuffles the structure.
  const DEFAULT_SEL = {
    navanRoute: ".flight-header__route",
    alaskaRoute: "[data-testid='search-summary'], .search-summary, .fare-header__route",
    rowDepth: 8,
    containerDepth: 20,
    gfRow: "ul li",
    gfMinLen: 30,
    gfMaxLen: 1200,
    gfMaxRows: 120,
  };
  let SEL = DEFAULT_SEL;
  let pendingPredict = new Set();
  function requestPredictions(fns) {
    const need = fns.filter((f) => !probMap.has(f) && !pendingPredict.has(f));
    if (!need.length) return;
    need.forEach((f) => pendingPredict.add(f));
    try {
      chrome.runtime.sendMessage({ type: "predictFlights", fns: need, airline: AIRLINE }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return;
        for (const [fn, v] of Object.entries(res.flights || {})) {
          if (v) probMap.set(fn, { prob: v.prob, obs: v.obs, conf: v.conf || null, dep: depFor(fn) });
          else if (v === null) probMap.set(fn, null); // known: no data → n/a
        }
        scheduleScan();
      });
    } catch (e) {}
  }
  try { chrome.runtime.sendMessage({ type: "getSelectors" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    if (res.cfg && res.cfg.selectors) SEL = Object.assign({}, DEFAULT_SEL, res.cfg.selectors);
  }); } catch {}
  try { chrome.runtime.sendMessage({ type: "tripList" }, (res) => {
    if (!chrome.runtime.lastError && res && res.trips)
      watched = new Set(res.trips.map((t) => t.fn + "|" + t.date));
  }); } catch {}
  try { chrome.storage.local.get("uslKeepSorted", (v) => { keepSorted = !!v.uslKeepSorted; }); } catch {}
  try { chrome.storage.local.get("uslAutoSort", (v) => { autoSort = !!v.uslAutoSort; if (autoSort) scheduleScan(); }); } catch {}

  /* ── Navan: derive route context from the DOM (no URL params there) ── */
  function getNavanContext() {
    const txt = (document.body && document.body.innerText) || "";
    const legO = (txt.match(/Depart from\s*([A-Z]{3})/) || [])[1] || "";
    const cacheKey = location.pathname + "|" + legO;
    if (navanCtxCache && navanCtxKey === cacheKey) return navanCtxCache;
    let o, d;
    // the trip strip is a stable ".flight-header__route" whose text is the two
    // airport codes with the swap glyph as an icon (e.g. innerText "DENSFO").
    let el = document.querySelector(SEL.navanRoute);
    if (!el) el = [...document.querySelectorAll("div, span, button, h1, h2, h3")].find((e) =>
      e.children.length <= 4 && /^[A-Z]{3}[^A-Z]{0,3}[A-Z]{3}$/.test((e.textContent || "").trim())
      && !e.closest(".flight-search-results__option"));
    if (el) { const m = (el.textContent || "").trim().match(/([A-Z]{3})[^A-Z]{0,3}([A-Z]{3})/); if (m) { o = m[1]; d = m[2]; } }
    if (!/^[A-Z]{3}$/.test(o || "") || !/^[A-Z]{3}$/.test(d || "") || o === d) return null;
    const isReturn = legO && legO === d;              // showing the return leg
    if (isReturn) { const t = o; o = d; d = t; }
    const c = { o, d, date: "", phase: isReturn ? "return" : "depart", navan: true };
    navanCtxCache = c; navanCtxKey = cacheKey;
    return c;
  }
  /* ── Alaska: route context from the URL, falling back to a DOM text scan ──
   * alaskaair.com's booking deep-links carry the O/D pair (and usually the
   * date) as query params, but the markup varies by flow, so nothing here may
   * depend on a selector: SEL.alaskaRoute is tried, then the whole page's text
   * is scanned for an "SEA to SFO" / "SEA → SFO" pair. */
  const AK_O_PARAMS = ["O", "o", "origin", "Origin", "from", "departureCity", "originCity", "OriginCity", "A0"];
  const AK_D_PARAMS = ["D", "d", "destination", "Destination", "to", "arrivalCity", "destinationCity", "DestinationCity", "A1"];
  const AK_DATE_PARAMS = ["OD", "od", "departureDate", "DepartureDate", "deptDate", "date", "D0", "startDate"];
  function pickParam(p, names) {
    for (const n of names) {
      const v = p.get(n);
      if (v) return v.trim();
    }
    return "";
  }
  function normDate(v) {
    if (!v) return "";
    let m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // mm/dd/yyyy
    if (m) return m[3] + "-" + m[1] + "-" + m[2];
    return "";
  }
  // Codes that show up as ordinary words/currencies on a booking page and must
  // never be read as airports.
  const AK_STOP = new Set(["USD", "CAD", "MXN", "THE", "AND", "FOR", "YOU", "ALL", "NEW", "ONE", "TWO", "MAY", "AAA", "PDF", "FAQ", "TSA", "USA", "WIFI", "ADA"]);
  function scanRouteText() {
    const el = (SEL.alaskaRoute && document.querySelector(SEL.alaskaRoute)) || document.body;
    const txt = (el && el.innerText) || "";
    const re = /\b([A-Z]{3})\s*(?:to|→|›|»|–|—|-)\s*([A-Z]{3})\b/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const o = m[1], d = m[2];
      if (o === d || AK_STOP.has(o) || AK_STOP.has(d)) continue;
      return { o, d };
    }
    return null;
  }
  function getAlaskaContext() {
    let o = "", d = "", date = "";
    try {
      const p = new URLSearchParams(location.search);
      o = pickParam(p, AK_O_PARAMS).toUpperCase();
      d = pickParam(p, AK_D_PARAMS).toUpperCase();
      date = normDate(pickParam(p, AK_DATE_PARAMS));
    } catch (e) { /* fall through to the text scan */ }
    if (!/^[A-Z]{3}$/.test(o) || !/^[A-Z]{3}$/.test(d) || o === d) {
      const s = scanRouteText();
      if (!s) return null;
      o = s.o; d = s.d;
    }
    return { o, d, date, phase: "depart", alaska: true };
  }

  // Panel ranked list on Navan is built from the on-page badged flights (there is
  // no route-data fetch on Navan — the per-flight badge path stays untouched).
  // Alaska uses the same list: its tracker answers per route with prose, not a
  // flight table, so the ranking comes from the badged flights on screen.
  function navanTopFlights() {
    const seen = new Set(), arr = [];
    for (const [fn, r] of registry.entries()) {
      if (!r.rowEl.isConnected || seen.has(fn)) continue;
      const hit = probMap.get(fn);
      if (!hit || typeof hit.prob !== "number") continue;
      seen.add(fn);
      arr.push({ fn, prob: hit.prob });
    }
    return arr.sort((a, b) => b.prob - a.prob).slice(0, 6);
  }

  /* ── context: route + leg phase + date ── */
  function getContext() {
    if (NAVAN) return getNavanContext();
    if (ALASKA) return getAlaskaContext();
    let o, d, dep, ret;
    try {
      const p = new URLSearchParams(location.search);
      o = (p.get("f") || p.get("origin") || "").toUpperCase();
      d = (p.get("t") || p.get("destination") || "").toUpperCase();
      dep = p.get("d"); ret = p.get("r");
    } catch { return null; }
    if (!/^[A-Z]{3}$/.test(o) || !/^[A-Z]{3}$/.test(d) || o === d) return null;
    const txt = document.body ? document.body.innerText : "";
    const isReturn = /RETURN ON:/i.test(txt) && !/DEPART ON:/i.test(txt);
    return isReturn
      ? { o: d, d: o, date: ret || dep || "", phase: "return" }
      : { o, d, date: dep || "", phase: "depart" };
  }
  function daysOut(dateStr) {
    if (!dateStr) return 0;
    const t = Date.parse(dateStr + "T12:00:00");
    return isNaN(t) ? 0 : Math.round((t - Date.now()) / 864e5);
  }
  function fmtDate(dateStr) {
    const t = Date.parse(dateStr + "T12:00:00");
    if (isNaN(t)) return "";
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const depsRelevant = () => ctx && !!ctx.date && daysOut(ctx.date) <= 3;

  function loadData(r, force) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "routeData", o: r.o, d: r.d, airline: AIRLINE, force: !!force }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return resolve(null);
          resolve(resp);
        });
      } catch { resolve(null); }
    });
  }
  // Confirmed-tail departure for a flight number, when the searched date is
  // close enough for assignments to be published.
  function depFor(fn) {
    if (!data || !depsRelevant()) return null;
    return (data.deps || []).find((x) => x.fn === fn) || null;
  }
  function indexData() {
    // Per-flight predictions are route-independent (the tracker keys them on the
    // flight number alone), so on prediction-driven hosts they survive a context
    // change — dropping them here would strand pendingPredict and the badges
    // would never come back. United still starts from an empty map.
    probMap = PAGE_PREDICT ? new Map(probMap) : new Map();
    if (!data) return;
    // Confirmed-tail ✓s may arrive after the odds did; re-attach on every index.
    for (const [fn, v] of probMap.entries()) if (v) v.dep = depFor(fn);
    for (const f of data.flights || []) {
      probMap.set(f.fn, { prob: f.prob, obs: f.obs, conf: f.conf || null, dep: depFor(f.fn) });
    }
  }
  const cls = (p) => (p >= 50 ? "usl-hi" : p >= 35 ? "usl-mid" : p >= 20 ? "usl-low" : "usl-no");

  /* ══ Google Flights overlay (2.0) ══════════════════════════════════════════
   * GF is the first MULTI-AIRLINE surface, and it is nothing like united.com:
   *   · a collapsed result row usually has no flight number at all, only an
   *     airline name in an ARIA label ("Nonstop flight with United"), so the
   *     primary signal has to be the CARRIER, not the flight;
   *   · class names are obfuscated and rotate, so every hook here is an ARIA
   *     label or a text node, and the one structural selector (SEL.gfRow) is
   *     remote-patchable;
   *   · the list virtualizes and GF owns its own sort, so we NEVER reorder the
   *     DOM here — that is what killed the idea of reusing sortPage().
   * Two tiers:
   *   Tier 1 (always) — detect the operating airline(s) from the row text and
   *     render a static ConnectScore chip from airlines.js. No network at all.
   *   Tier 2 (when the row happens to expose a UA/AS flight number) — ask the
   *     service worker for live per-flight odds and upgrade that chip in place.
   *     HA is excluded on purpose: its tracker publishes no per-flight
   *     probability (see the probe transcript in bg.js), so it can only ever be
   *     Tier 1 and asking would just burn a request.
   * Everything below is wrapped so a GF redesign degrades to NO RENDER. A
   * missing chip is fine; a broken Google Flights page is not.
   * ─────────────────────────────────────────────────────────────────────────── */

  /* ==USL-GF-MATCHER-START==
   * Extracted verbatim and evaluated by the node harness. Keep this region
   * self-contained: no chrome.*, no DOM, no outer-scope references. */
  // Ordered name→key table for the 18 carriers in airlines.js. Matched with word
  // boundaries against a row's ARIA label / visible text.
  //   · "United" carries a negative lookahead so "United States" is not a match.
  //   · SAS and JSX are CASE-SENSITIVE — a case-insensitive \bsas\b or \bjsx\b
  //     is a live false-positive risk in ordinary prose; the real labels are
  //     always upper-case. Every other pattern is case-insensitive.
  //   · "airBaltic"/"Air Baltic", "WestJet"/"West Jet", "ZIPAIR"/"Zip Air" and
  //     "SAS"/"Scandinavian Airlines" all resolve to one key.
  const GF_AIRLINES = [
    { key: "united",         re: /\bUnited\b(?!\s+States)/i },
    { key: "alaska",         re: /\bAlaska\b/i },
    { key: "hawaiian",       re: /\bHawaiian\b/i },
    { key: "delta",          re: /\bDelta\b/i },
    { key: "american",       re: /\bAmerican\b/i },
    { key: "jetblue",        re: /\bjet\s?blue\b/i },
    { key: "southwest",      re: /\bSouthwest\b/i },
    { key: "aircanada",      re: /\bAir\s?Canada\b/i },
    { key: "airfrance",      re: /\bAir\s?France\b/i },
    { key: "britishairways", re: /\bBritish\s?Airways\b/i },
    { key: "emirates",       re: /\bEmirates\b/i },
    { key: "qatar",          re: /\bQatar(?:\s+Airways)?\b/i },
    { key: "westjet",        re: /\bWest\s?Jet\b/i },
    { key: "sas",            re: /\bSAS\b|\bScandinavian\s+Airlines\b/ },
    { key: "virginatlantic", re: /\bVirgin\s+Atlantic\b/i },
    { key: "jsx",            re: /\bJSX\b/ },
    { key: "airbaltic",      re: /\bair\s?Baltic\b/i },
    { key: "zipair",         re: /\bZIP\s?AIR\b/i },
  ];

  /* gfDetect(text) → airline keys in the order they first appear in the text.
   * Order is the whole point: on "1 stop flight with Delta and Alaska" the FIRST
   * key is the operating carrier of the first leg, which is what the chip
   * represents; the rest are the other carriers on the itinerary. Deduplicated,
   * so "United … United Express" yields ["united"] once. */
  function gfDetect(text) {
    if (!text || typeof text !== "string") return [];
    const hits = [];
    for (let i = 0; i < GF_AIRLINES.length; i++) {
      const a = GF_AIRLINES[i];
      const m = text.match(a.re);
      if (m && typeof m.index === "number") hits.push({ key: a.key, at: m.index });
    }
    hits.sort(function (x, y) { return x.at - y.at; });
    const seen = {}, keys = [];
    for (let i = 0; i < hits.length; i++) {
      if (seen[hits[i].key]) continue;
      seen[hits[i].key] = 1;
      keys.push(hits[i].key);
    }
    return keys;
  }

  /* ── operating carrier (1.6) ───────────────────────────────────────────────
   * CONFIRMED LIVE BUG: a row marketed "Alaska" whose label also said
   * "Operated by … as Hawaiian …" was chipped 28 (Alaska's coarse score) when
   * the metal is an ex-Hawaiian widebody — Starlink-equipped, and scored 69
   * under `hawaiian` in airlines.js (which is exactly where airlines.js says
   * the ex-HA widebodies are counted). The wifi is a property of the AIRCRAFT,
   * so the score must follow the OPERATING carrier, up or down: truth over
   * marketing.
   *
   * Both word orders are accepted, because GF/airline prose uses both slots
   * ("Operated by Hawaiian as Alaska", "Operated by Alaska as Hawaiian") and
   * either way the non-marketing carrier named in the operating clause is the
   * one whose fleet is flying. What matters is that exactly ONE other mapped
   * carrier is named — see the ambiguity guard below.
   *
   * REGIONALS ARE NOT AN OVERRIDE. "Operated by SkyWest as United Express" is a
   * United row: SkyWest owns no wifi programme of its own, and the UA/AS fleet
   * counts in airlines.js already include the regional aircraft. Those brands
   * are stripped before matching so they can never move the score. */
  const GF_REGIONALS =
    /\b(?:Sky\s?West|Horizon\s?Air|Horizon|Republic(?:\s+Airways)?|Mesa(?:\s+Airlines)?|Envoy(?:\s+Air)?|Endeavor(?:\s+Air)?|Piedmont|PSA(?:\s+Airlines)?|Air\s+Wisconsin|CommuteAir|GoJet|Trans\s?States|Compass(?:\s+Airlines)?|Express\s?Jet|Cape\s+Air|Contour|Silver)\b/gi;
  // "Operated by <clause>" — the clause is bounded so it can never run into the
  // next sentence of the ARIA label and swallow half the itinerary.
  const GF_OPERATED_BY = /\boperated\s+by\s+([^.;:()|•·]{2,90})/i;
  // Itinerary prose that must never be inside the clause: airport, city and
  // route wording is a rich source of accidental carrier matches.
  const GF_OP_STOP = /\b(?:Leaves|Leave|Departs?|Arrives?|Arrival|Nonstop|Non-stop|stops?\s+flight|Layover|Overnight|Total\s+duration|Selected|Price|dollars)\b/i;

  /* gfOperatedClause(text) → the bounded "operated by …" clause, or "". */
  function gfOperatedClause(text) {
    if (!text || typeof text !== "string") return "";
    const m = text.match(GF_OPERATED_BY);
    if (!m || !m[1]) return "";
    let seg = m[1];
    const cut = seg.search(GF_OP_STOP);
    if (cut > 0) seg = seg.slice(0, cut);
    else if (cut === 0) return "";
    return seg;
  }

  /* gfOperating(text, marketingKey) → an airline key to score INSTEAD of the
   * marketing carrier, or null to keep the marketing carrier.
   *
   * THE AMBIGUITY GUARD IS THE POINT. It returns a key only when the clause
   * names exactly one mapped carrier other than the marketing one. Zero other
   * carriers (the ordinary "Operated by Alaska Airlines" on an Alaska row, or a
   * pure-regional operator) and two-or-more (a codeshare word-salad we cannot
   * resolve) both fall back to marketing — a wrong score is worse than a coarse
   * one. */
  function gfOperating(text, marketingKey) {
    const seg = gfOperatedClause(text);
    if (!seg) return null;
    const keys = gfDetect(seg.replace(GF_REGIONALS, " "));
    const cand = [];
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === marketingKey) continue;
      if (cand.indexOf(keys[i]) < 0) cand.push(keys[i]);
    }
    return cand.length === 1 ? cand[0] : null;
  }
  /* ==USL-GF-MATCHER-END== */

  // Tier 2 flight-number extraction, only for the two instrumented carriers.
  // The bare-name form ("United 737") is rejected when the digits are a known
  // aircraft-type number — a wrong badge is worse than no badge, so the code
  // form ("UA737") is required in that case.
  const GF_FN = {
    united: /\b(UA|United)\s?(\d{2,4})\b(?!\s?-\s?\d)/,
    alaska: /\b(AS|Alaska)\s?(\d{1,4})\b(?!\s?-\s?\d)/,
  };
  const GF_FN_PREFIX = { united: "UA", alaska: "AS" };
  const GF_TYPE_NUMS = { 145:1, 175:1, 190:1, 195:1, 220:1, 223:1, 319:1, 320:1,
    321:1, 330:1, 332:1, 333:1, 339:1, 350:1, 359:1, 380:1, 717:1, 737:1, 738:1,
    739:1, 747:1, 757:1, 767:1, 777:1, 787:1 };
  const GF_FREE_TEXT = {
    free: "free for everyone onboard",
    "loyalty-free": "free for loyalty members",
    "loyalty-tier": "free on paid status tiers",
    partial: "free on some cabins/routes",
    unknown: "free status unconfirmed",
    paid: "paid",
  };
  const GF_CREDIT = "ConnectScore by wifiodds.com";

  let gfPresent = new Map();   // airline key → count of rows it appears in
  let gfSig = "";              // panel signature, so we don't re-render on churn

  // airlines.js is a separate content-script file; if it ever fails to load we
  // render nothing rather than throwing on every mutation.
  function gfScoring() {
    return typeof scoreAirline === "function" && typeof WIFI_AIRLINES !== "undefined";
  }
  /* GF_ACTIVE is the load-time gate; this is the LIVE one. Google Flights is a
   * single-page app — the path changes under us without a reload, so the
   * checkout/booking exclusion has to be re-checked on every pass, not just at
   * injection. When it goes false we also pull our own panel back off the page. */
  function gfPathOk() {
    return GF_RESULTS_PATH.test(location.pathname) && !GF_DENY_PATH.test(location.pathname);
  }
  function gfTeardown() {
    if (panelEl) { try { panelEl.remove(); } catch (e) {} }
    panelEl = null;
    gfSig = "";
  }

  function gfFnIn(text, key) {
    const re = GF_FN[key];
    if (!re) return null;
    const m = text.match(re);
    if (!m) return null;
    const byCode = m[1].length === 2;
    if (!byCode && GF_TYPE_NUMS[m[2]]) return null; // "United 737" is an aircraft
    return GF_FN_PREFIX[key] + String(parseInt(m[2], 10));
  }

  /* Row text. Deliberately textContent, NOT innerText: innerText forces a layout
   * flush, and this runs on every debounced mutation of a page that mutates
   * constantly — innerText here measurably janks GF. The row's own aria-label is
   * prepended when present, and gfAriaText() is the bounded fallback for the
   * layouts where the carrier name lives ONLY in a descendant's label. */
  function gfText(r) {
    let t = "";
    try { t = r.textContent || ""; } catch (e) { return ""; }
    if (t.length > (SEL.gfMaxLen || 1200)) return "";
    try {
      const al = r.getAttribute && r.getAttribute("aria-label");
      if (al) t = al + " " + t;
    } catch (e) {}
    return t;
  }
  function gfAriaText(r) {
    let s = "";
    try {
      const ls = r.querySelectorAll("[aria-label]");
      for (let i = 0; i < ls.length && i < 12; i++)
        s += " " + (ls[i].getAttribute("aria-label") || "");
    } catch (e) {}
    return s;
  }

  // Candidate result rows: one structural selector, then filtered purely on
  // content (a clock time + at least one known airline). The length window is
  // what keeps the outermost-wins pass in gfScan() from swallowing the whole
  // list as a single "row".
  function gfRows() {
    let all;
    try { all = document.querySelectorAll(SEL.gfRow); } catch (e) { return []; }
    const out = [];
    const max = SEL.gfMaxRows || 120;
    for (let i = 0; i < all.length && out.length < max; i++) {
      const r = all[i];
      const t = gfText(r);
      if (t.length < (SEL.gfMinLen || 30)) continue;
      if (!TIME_ONE.test(t)) continue;
      out.push({ el: r, text: t });
    }
    return out;
  }

  /* Compute what the chip should say. Split from the write so the write can be
   * skipped when nothing changed — see gfChipFill(). */
  function gfChipState(key, fn, hit, op) {
    const a = scoreAirline(key);
    if (!a) return null;
    const entry = WIFI_AIRLINES[key] || {};
    // op = {name, marketedAs} when the row's operating carrier ≠ its marketing
    // carrier and we moved the score onto the operating one.
    const opSig = op ? "|op:" + op.name : "";
    const opNote = op
      ? " · operated by " + op.name + " — scored on operating carrier" +
        (op.marketedAs ? " (marketed as " + op.marketedAs + ")" : "")
      : "";
    if (hit && typeof hit.prob === "number") {
      // Tier 2: live per-flight odds replace the static score.
      return {
        sig: "live|" + fn + "|" + hit.prob + "|" + (hit.dep ? hit.dep.tail : "") + "|" + (hit.conf || "") + opSig,
        cn: "usl-badge usl-gf-chip usl-gf-live " + cls(hit.prob),
        tx: "🛰️ " + hit.prob + "%" + (hit.dep ? " ✓" : ""),
        ti: fn + ": " +
          (hit.conf === "type"
            ? "~" + hit.prob + "% odds derived from aircraft type"
            : "gets a Starlink-equipped plane ~" + hit.prob + "% of the time (" +
              (hit.obs || 0) + " recent departures)") +
          (hit.dep ? " — CONFIRMED Starlink tail " + hit.dep.tail : "") +
          " · data: " + (key === "alaska" ? "alaskastarlinktracker.com" : "unitedstarlinktracker.com") +
          opNote + " · " + GF_CREDIT,
      };
    }
    if (hit === null) {
      // Known-unknown: the tracker has this flight number and has no history.
      return {
        sig: "na|" + fn + opSig,
        cn: "usl-badge usl-gf-chip usl-na",
        tx: "🛰️ n/a",
        ti: fn + ": no Starlink-assignment history for this flight number yet" +
          opNote + " · " + GF_CREDIT,
      };
    }
    // Tier 1: static ConnectScore.
    const fleet = a.fleet ? a.equipped + " of " + a.fleet + " aircraft" : "fleetwide";
    const freeTxt = GF_FREE_TEXT[String(entry.free || "unknown").toLowerCase()] || "";
    return {
      sig: "cs|" + key + "|" + a.score + opSig,
      cn: "usl-badge usl-gf-chip " + cls(a.score),
      tx: "🛰️ " + a.score,
      ti: a.name + " · ConnectScore " + a.score + " (" + a.label + ") — " +
        a.systemLabel + " on " + fleet + (freeTxt ? ", " + freeTxt : "") + ". " +
        (a.note || "") + opNote + " · " + GF_CREDIT,
    };
  }

  /* WRITE-IF-CHANGED, and that is not an optimisation — it is required.
   * Assigning textContent replaces child nodes, which is a childList mutation,
   * which our own MutationObserver sees, which schedules another scan. Rewriting
   * an unchanged chip every pass is therefore a self-sustaining 700 ms loop for
   * as long as the tab is open. The dataset write below is safe because we
   * observe childList/subtree only, never attributes. */
  function gfChipFill(chip, key, fn, hit, op) {
    const s = gfChipState(key, fn, hit, op);
    if (!s) return;
    if (chip.dataset.gfSig === s.sig) return;
    chip.dataset.gfSig = s.sig;
    chip.className = s.cn;
    chip.textContent = s.tx;
    chip.title = s.ti;
  }

  // The chip is attached next to the text node that named the airline, so it
  // lands inside the row's own layout rather than on the flex container.
  function gfAnchor(row, re) {
    try {
      const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !re.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (!p || p.closest(".usl-panel,.usl-badge,script,style,noscript"))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const n = w.nextNode();
      return n ? n.parentElement : null;
    } catch (e) {
      return null;
    }
  }

  function gfScan() {
    if (!gfPathOk()) { gfTeardown(); return; }
    if (!gfScoring()) return;
    const present = new Map();
    const want = [];
    const rows = gfRows();
    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i].el;
        let text = rows[i].text;
        // Outermost qualifying row wins: one chip per itinerary card. Safe only
        // because of the gfMaxLen window above.
        if (row.parentElement && row.parentElement.closest('[data-usl-gf="1"]')) continue;
        let keys = gfDetect(text);
        if (!keys.length) {
          // Carrier named only in a descendant's ARIA label.
          const extra = gfAriaText(row);
          if (extra) { text = extra + " " + text; keys = gfDetect(text); }
        }
        if (!keys.length) continue;
        for (let k = 0; k < keys.length; k++) {
          if (!WIFI_AIRLINES[keys[k]]) continue;
          present.set(keys[k], (present.get(keys[k]) || 0) + 1);
        }
        const marketKey = keys[0];
        if (!WIFI_AIRLINES[marketKey]) continue;

        /* Score the metal, not the ticket. When the row names an unambiguous
         * operating carrier that is not the marketing one, that carrier's fleet
         * is what is flying, so its ConnectScore is the honest answer — higher
         * (ex-Hawaiian widebody on an Alaska ticket: 28 → 69) or lower.
         *
         * Tier 2 is deliberately given up in that case: a per-flight number is
         * the MARKETING carrier's (AS1234), and its tail-assignment history
         * describes the marketing carrier's own fleet — the wrong aircraft pool.
         * A coarse score about the right metal beats a precise one about the
         * wrong metal. Ordinary rows (including regional-operated ones, which
         * gfOperating() refuses to override) keep live odds exactly as before. */
        let key = marketKey;
        let op = null;
        try {
          const opKey = gfOperating(text, marketKey);
          if (opKey && opKey !== marketKey && WIFI_AIRLINES[opKey]) {
            key = opKey;
            op = {
              name: WIFI_AIRLINES[opKey].name,
              marketedAs: WIFI_AIRLINES[marketKey].name,
            };
          }
        } catch (e) { key = marketKey; op = null; }
        // The operating carrier is normally already counted (its name is in the
        // row text), but never assume it — the panel must list what we scored.
        if (op && !present.has(key)) present.set(key, 1);

        const fn = op ? null : gfFnIn(text, key);
        const hit = fn ? (probMap.has(fn) ? probMap.get(fn) : undefined) : undefined;
        if (fn && hit === undefined) want.push(fn);

        let chip = row.querySelector(":scope > .usl-gf-chip") ||
          row.querySelector(".usl-gf-chip");
        if (!chip) {
          const spec = GF_AIRLINES.find((x) => x.key === key);
          const anchor = (spec && gfAnchor(row, spec.re)) || row;
          chip = document.createElement("span");
          chip.dataset.gfKey = key;
          anchor.appendChild(chip);
          row.dataset.uslGf = "1";
        }
        // Re-fill every pass: cheap, idempotent, and how Tier 1 upgrades to
        // Tier 2 once the odds arrive.
        chip.dataset.gfFn = fn || "";
        gfChipFill(chip, key, fn, hit, op);
      } catch (e) { /* one bad row never stops the rest */ }
    }
    gfPresent = present;
    if (want.length) requestPredictions([...new Set(want)]);
    renderGFPanel();
  }

  /* GF panel: a per-airline summary of what is actually in these results,
   * ranked by ConnectScore. Deliberately NOT the united.com route flight list —
   * on GF there is no single route/airline, and no sort button, because GF owns
   * its own ordering and its list virtualizes. */
  function renderGFPanel() {
    if (!gfPathOk() || !gfScoring()) return;
    const ranked = [...gfPresent.keys()]
      .map((k) => scoreAirline(k))
      .filter(Boolean)
      .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
    const live = [];
    for (const [fn, v] of probMap.entries())
      if (v && typeof v.prob === "number") live.push(fn + ":" + v.prob);
    live.sort();
    const sig = ranked.map((a) => a.key + a.score).join(",") + "|" + live.join(",");
    if (panelEl && panelEl.isConnected && sig === gfSig) return;
    gfSig = sig;
    if (panelEl) panelEl.remove();
    panelEl = null;
    if (!ranked.length) return;

    const p = document.createElement("div");
    p.className = "usl-panel";
    try {
      chrome.storage.local.get("uslCollapsed", (v) => { if (v.uslCollapsed) p.classList.add("usl-collapsed"); });
    } catch (e) {}
    const liveRows = ranked.filter((a) => a.instrumented).length;
    p.innerHTML =
      `<header><span>🛰️ WiFi odds in these results</span><span><span class="usl-x">▾</span></span></header>` +
      `<div class="usl-body">` +
      ranked.map((a) =>
        `<div class="usl-row" title="${esc(a.note || "")}">` +
        `<span>${esc(a.name)}<span class="usl-time"> · ${esc(a.systemLabel)}${a.fleet ? " " + a.equipped + "/" + a.fleet : ""}</span></span>` +
        `<span class="usl-badge ${cls(a.score)}">${a.score}</span></div>`).join("") +
      `<div style="margin-top:8px;font-size:11px;opacity:.75;line-height:1.45">` +
      `ConnectScore = odds of the good satellite wifi, not of any wifi. ` +
      (liveRows ? `United and Alaska rows upgrade to live per-flight odds when Google shows a flight number. ` : ``) +
      `</div>` +
      `<div style="margin-top:8px;font-size:11.5px">` +
      `<a href="https://wifiodds.com/" target="_blank" rel="noopener" style="color:#8ecdff">${esc(GF_CREDIT)} ↗</a>` +
      `</div></div>`;
    p.querySelector("header").addEventListener("click", () => {
      p.classList.toggle("usl-collapsed");
      try { chrome.storage.local.set({ uslCollapsed: p.classList.contains("usl-collapsed") }); } catch (e) {}
    });
    document.documentElement.appendChild(p);
    panelEl = p;
  }

  function findRow(el) {
    let e = el;
    for (let i = 0; i < SEL.rowDepth && e && e !== document.body; i++, e = e.parentElement) {
      const txt = e.textContent || "";
      const times = txt.match(TIME_RE);
      if (times && times.length) return { rowEl: e, times: times.slice(0, 2).join(" – ") };
    }
    return null;
  }

  /* ── badge injection ── */
  function scan() {
    scanScheduled = false;
    // Google Flights has its own scanner and must never reach the united.com
    // pass below (that one would badge "United 1812" prose with UA route odds
    // it has no route for, and would try to reorder a virtualized list).
    if (GFLIGHTS) { try { gfScan(); } catch (e) {} return; }
    if (!data && !PAGE_PREDICT) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !FN_RE.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        const el = n.parentElement;
        if (!el || el.closest(".usl-panel,.usl-badge,script,style,noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    let node;
    while ((node = walker.nextNode())) targets.push(node);
    let registered = false;
    const navanWants = [];
    let bestFn = null, bestP = -1;
    for (const [f, v] of probMap.entries())
      if (v && v.prob > bestP) { bestP = v.prob; bestFn = f; }
    for (const n of targets) {
      const el = n.parentElement;
      if (!el) continue;
      const m = n.nodeValue.match(FN_RE);
      const fn = AIRLINE + m[1];
      if (PAGE_PREDICT && !probMap.has(fn)) { navanWants.push(fn); continue; }
      const hit = probMap.get(fn);
      const row = findRow(el);
      if (!el.dataset.uslBadged) {
        const dup = row && row.rowEl.querySelector('.usl-badge[data-b="' + fn + '"]');
        if (dup) {
          el.dataset.uslBadged = "dup";
        } else if (hit) {
          el.dataset.uslBadged = "1";
          const b = document.createElement("span");
          const isBest = fn === bestFn && hit.prob >= 30 && !PAGE_PREDICT;
          b.className = "usl-badge " + (isBest ? "usl-best-badge" : cls(hit.prob));
          b.textContent = (isBest ? "★ " : "") + "🛰️ " + hit.prob + "%" + (hit.dep ? " ✓" : "");
          // "type" confidence = the tracker derived the odds from the aircraft
          // type/subfleet rather than this flight number's own history.
          const typed = hit.conf === "type";
          b.title = `${fn}: ` +
            (typed
              ? `~${hit.prob}% odds derived from aircraft type`
              : `gets a Starlink-equipped plane ~${hit.prob}% of the time (${hit.obs} recent departures)`) +
            (hit.dep ? ` — CONFIRMED Starlink tail ${hit.dep.tail} on ${hit.dep.date}` : "") +
            " · data: " + TRACKER;
          b.dataset.b = fn;
          el.appendChild(b);
          if (row) addWatchStar(el, fn);
        } else if (row) {
          el.dataset.uslBadged = "na";
          const b = document.createElement("span");
          b.className = "usl-badge usl-na";
          b.textContent = "🛰️ n/a";
          b.title = fn + ": no Starlink-assignment history for this flight number yet · data: " + TRACKER;
          b.dataset.b = fn;
          el.appendChild(b);
          addWatchStar(el, fn);
        } else {
          el.dataset.uslBadged = "miss";
        }
      }
      if (hit && row && (!registry.has(fn) || !registry.get(fn).rowEl.isConnected)) {
        registry.set(fn, row);
        registered = true;
      }
    }
    if (registered) { updatePanelSortBtn(); refreshPanelTimes(); }
    if (PAGE_PREDICT && navanWants.length) requestPredictions([...new Set(navanWants)]);
    maybeResort();
    maybeAutoSort();
  }
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, 700);
  }


  function addWatchStar(el, fn) {
    if (!ctx || !ctx.date || el.querySelector(".usl-watch")) return;
    const w = document.createElement("span");
    // The base class is NOT optional and is NOT set by paint(): it carries the
    // margin, the size and the dark-with-halo unfilled look, and the dedupe
    // guard above queries for it. Dropping it (as 24af7c2 did) leaves a bare
    // <span>★</span> that inherits united.com's near-black row colour and sits
    // flush against the odds pill. paint() only toggles the STATE class.
    w.className = "usl-watch";
    const key = fn + "|" + ctx.date;
    const date = ctx.date;
    const route = ctx.o + "-" + ctx.d;
    // Two titles, one per state — the star is a toggle, so both are needed on
    // every flip (the popup is not the only way to stop guarding a flight).
    const OFF_TITLE = "Guard " + fn + " on " + date + " — alerts from booking to boarding if its Starlink tail changes.";
    const ON_TITLE = "Guarding — click to unguard (or manage in the popup)";
    const paint = (on) => {
      w.textContent = on ? "★" : "☆";
      w.classList.toggle("usl-watching", on);
      w.title = on ? ON_TITLE : OFF_TITLE;
    };
    paint(watched.has(key));
    w.addEventListener("click", (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const on = watched.has(key);
      // Optimistic: flip the UI first, then tell bg.js. Both handlers are
      // idempotent, so a dropped message just leaves the popup as the truth.
      if (on) {
        watched.delete(key);
        paint(false);
        try { chrome.runtime.sendMessage({ type: "tripRemove", fn, date }, () => { void chrome.runtime.lastError; }); } catch {}
      } else {
        watched.add(key);
        paint(true);
        try { chrome.runtime.sendMessage({ type: "tripAdd", fn, date, route }, () => { void chrome.runtime.lastError; }); } catch {}
      }
      // Keep the panel's ranked list in step with the row that was just clicked.
      refreshPanelGuards();
    });
    el.appendChild(w);
  }

  /* ── jump ── */
  function gotoFlight(fn) {
    const r = registry.get(fn);
    if (!r || !r.rowEl.isConnected) return false;
    r.rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
    const prev = r.rowEl.style.cssText;
    r.rowEl.style.outline = "3px solid #ffd166";
    r.rowEl.style.outlineOffset = "3px";
    r.rowEl.style.borderRadius = "8px";
    setTimeout(() => { r.rowEl.style.cssText = prev; }, 2600);
    return true;
  }

  /* ── sort ── */
  function findContainer() {
    const badge = document.querySelector(".usl-badge");
    if (!badge) return null;
    let best = null, bestScore = 0, e = badge.parentElement;
    for (let i = 0; i < SEL.containerDepth && e && e !== document.body; i++, e = e.parentElement) {
      const fns = [...e.children]
        .map((k) => ((k.textContent || "").match(FN_RE) || [])[1]).filter(Boolean);
      const distinct = new Set(fns).size;
      if (distinct > bestScore) { bestScore = distinct; best = e; }
    }
    return bestScore >= 2 ? best : null;
  }
  function currentOrder(P) {
    return [...P.children].map((k) => ((k.textContent || "").match(FN_RE) || [])[1])
      .filter(Boolean).map((n) => AIRLINE + n);
  }
  function sortPage() {
    const P = findContainer();
    if (!P) return { ok: false, why: "results container not found" };
    const flightUnits = [...P.children].filter((k) => FN_RE.test(k.textContent || ""));
    if (flightUnits.length < 2) return { ok: false, why: "fewer than 2 flight rows" };
    const key = (u) => {
      const m = (u.textContent || "").match(FN_RE);
      const hit = m ? probMap.get(AIRLINE + m[1]) : null;
      return hit ? hit.prob : -1;
    };
    const sorted = flightUnits.map((u, i) => ({ u, i, k: key(u) }))
      .sort((a, b) => b.k - a.k || a.i - b.i).map((x) => x.u);
    const anchor = document.createComment("usl-anchor");
    P.insertBefore(anchor, flightUnits[0]);
    for (const u of sorted) P.insertBefore(u, anchor);
    anchor.remove();
    desiredOrder = currentOrder(P);
    lastSortTs = Date.now();
    return { ok: true, count: sorted.length };
  }
  /* Re-assert the sort after United re-renders (opt-in, loop-guarded). */
  function maybeResort() {
    if ((!keepSorted && !autoSort) || !desiredOrder || Date.now() - lastSortTs < 1500) return;
    const P = findContainer();
    if (!P) return;
    const now = currentOrder(P);
    if (now.join(",") !== desiredOrder.join(",")) sortPage();
  }
  /* Auto-sort once on load (opt-in) after odds for the on-page flights have settled;
     maybeResort() then keeps it sorted through United's re-renders. */
  function maybeAutoSort() {
    if (!autoSort || desiredOrder) return;
    const P = findContainer();
    if (!P) return;
    const units = [...P.children].filter((k) => FN_RE.test(k.textContent || ""));
    if (units.length < 2) return;
    const withOdds = units.filter((u) => {
      const m = (u.textContent || "").match(FN_RE);
      const hit = m ? probMap.get(AIRLINE + m[1]) : null;
      return hit && hit.prob >= 0;
    }).length;
    if (withOdds < 2) return;
    sortPage();
  }

  /* ── panel ── */
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function updatePanelSortBtn() {
    const btn = panelEl && panelEl.querySelector(".usl-sortbtn");
    if (!btn) return;
    const n = [...registry.values()].filter((r) => r.rowEl.isConnected).length;
    btn.style.display = n >= 1 ? "" : "none";
    const kc = panelEl.querySelector(".usl-keep-wrap");
    if (kc) kc.style.display = n >= 1 ? "flex" : "none";
    const ac = panelEl.querySelector(".usl-auto-wrap");
    if (ac) ac.style.display = n >= 1 ? "flex" : "none";
  }
  function renderPanel() {
    if (panelEl) panelEl.remove();
    panelEl = null;
    if (!ctx) return;
    const p = document.createElement("div");
    p.className = "usl-panel";
    chrome.storage.local.get("uslCollapsed", (v) => { if (v.uslCollapsed) p.classList.add("usl-collapsed"); });
    const routeFlights = (data && data.flights || []).slice(0, 6);
    // Alaska's route tool answers with prose, so the ranked list comes from the
    // flights badged on the page (same path Navan uses).
    const flights = ctx.navan || (ALASKA && !routeFlights.length) ? navanTopFlights() : routeFlights;
    // Display-only summary line from the tracker; escaped, never interpreted.
    const note = !flights.length && data && data.note ? data.note : "";
    const typed = flights.some((f) => { const h = probMap.get(f.fn); return h && h.conf === "type"; });
    const rel = depsRelevant();
    const deps = rel ? (data && data.deps || []).slice(0, 3) : [];
    const itin = (data && data.itins || []).find((it) => it.via && it.via.length && it.coverage === "full");
    const legTag = ctx.phase === "return" ? " · return leg" : "";
    p.innerHTML =
      `<header><span>🛰️ ${esc(ctx.o)}→${esc(ctx.d)} · ${esc(fmtDate(ctx.date) || "Starlink odds")}${legTag}</span>` +
      `<span><span class="usl-refresh" title="Refresh odds (bypass cache)">↻</span> <span class="usl-x">▾</span></span></header>
      <div class="usl-body">` +
      (flights.length
        ? flights.map((f, i) =>
            `<div class="usl-row usl-jump" data-fn="${esc(f.fn)}">` +
            `<span>${i === 0 ? "⭐ " : ""}${esc(f.fn)}${probMap.get(f.fn) && probMap.get(f.fn).dep ? " ✓" : ""}` +
            (isGuarded(f.fn) ? GUARD_MARK : "") +
            `<span class="usl-time" data-time="${esc(f.fn)}"></span></span>` +
            `<span class="usl-badge ${cls(f.prob)}">${f.prob}%</span></div>`).join("")
        : `<div class="usl-row" style="display:block;line-height:1.45">${esc(note || "No Starlink history on this route yet.")}</div>`) +
      (flights.length ? `<button class="usl-sortbtn" style="display:none">⇅ Sort page by Starlink odds</button>
        <label class="usl-auto-wrap" style="display:none;font-size:11.5px;color:#93a1c0;margin-top:6px;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" class="usl-auto"> auto-sort by odds when the page loads</label>
        <label class="usl-keep-wrap" style="display:none;font-size:11.5px;color:#93a1c0;margin-top:4px;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" class="usl-keep"> keep sorted when the page updates</label>` : "") +
      (itin ? `<div class="usl-row" style="border-top:1px solid rgba(148,178,255,.14);margin-top:6px;padding-top:8px">` +
        `<span>via ${esc(itin.via.join("+"))} (connection)</span><span class="usl-badge usl-mid">${Math.round(itin.joint)}%</span></div>` : "") +
      (deps.length ? `<div style="margin-top:8px;font-size:11px;opacity:.75">Confirmed tails (next ~72h): ` +
        deps.map((d) => `${esc(d.fn)} ${esc(d.date.slice(5))}`).join(" · ") + `</div>` :
        (ctx.date && daysOut(ctx.date) > 3 ? `<div style="margin-top:8px;font-size:11px;opacity:.6">Tail assignments publish ~48h out — firm ✓s appear closer to ${esc(fmtDate(ctx.date))}.</div>` : "")) +
      `<div style="margin-top:10px;font-size:11.5px">` +
      (ALASKA
        ? `data: <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener" style="color:#8ecdff">alaskastarlinktracker.com ↗</a>`
        : `<a href="https://wifiodds.com/united/" target="_blank" rel="noopener" style="color:#8ecdff">full plan ↗</a>` +
          ` · <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener" style="color:#8ecdff">tracker ↗</a>`) +
      (typed ? `<span style="opacity:.55"> · odds derived from aircraft type</span>` : "") +
      (rel ? `<span style="opacity:.55"> · ✓ = confirmed Starlink tail</span>` : "") + `</div>` +
      `</div>`;
    p.querySelector("header").addEventListener("click", (ev) => {
      if (ev.target.classList.contains("usl-refresh")) return;
      p.classList.toggle("usl-collapsed");
      chrome.storage.local.set({ uslCollapsed: p.classList.contains("usl-collapsed") });
    });
    p.querySelector(".usl-refresh").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      ev.target.textContent = "…";
      data = await loadData(ctx, true);
      indexData();
      renderPanel();
      rebadge();
    });
    p.querySelectorAll(".usl-jump").forEach((row) => row.addEventListener("click", () => {
      if (row.classList.contains("usl-ghost")) return;
      gotoFlight(row.dataset.fn);
    }));
    const sb = p.querySelector(".usl-sortbtn");
    if (sb) sb.addEventListener("click", () => {
      const r = sortPage();
      sb.textContent = r.ok ? `✓ sorted ${r.count} flights (best first)` : `couldn't sort (${r.why})`;
      setTimeout(() => { sb.textContent = "⇅ Sort page by Starlink odds"; }, 3500);
    });
    const keep = p.querySelector(".usl-keep");
    if (keep) {
      keep.checked = keepSorted;
      keep.addEventListener("change", () => {
        keepSorted = keep.checked;
        chrome.storage.local.set({ uslKeepSorted: keepSorted });
        if (keepSorted && !desiredOrder) sortPage();
      });
    }
    const auto = p.querySelector(".usl-auto");
    if (auto) {
      auto.checked = autoSort;
      auto.addEventListener("change", () => {
        autoSort = auto.checked;
        chrome.storage.local.set({ uslAutoSort: autoSort });
        desiredOrder = null;
        if (autoSort) maybeAutoSort();
      });
    }
    document.documentElement.appendChild(p);
    panelEl = p;
    refreshPanelTimes();
    updatePanelSortBtn();
  }
  // The panel's ranked rows get a gold ★ for flights this browser is guarding.
  // Deliberately a DIFFERENT class from .usl-watch: that one is the clickable
  // toggle on the page row, this is a read-only marker (no click handler, no
  // hover scale). Same gold so the two read as one feature.
  const GUARD_MARK = `<span class="usl-guarded" title="Guarding this flight">★</span>`;
  function isGuarded(fn) { return !!(ctx && ctx.date && watched.has(fn + "|" + ctx.date)); }
  // Lighter than renderPanel(): mutates the markers in place. renderPanel()
  // re-reads uslCollapsed ASYNCHRONOUSLY (storage.local.get callback), so a full
  // re-render on every star click would flash the panel open for a frame on a
  // collapsed panel. Patching the two spans avoids the round trip entirely.
  function refreshPanelGuards() {
    if (!panelEl) return;
    panelEl.querySelectorAll(".usl-jump").forEach((row) => {
      const label = row.firstElementChild;
      if (!label) return;
      const cur = label.querySelector(".usl-guarded");
      const want = isGuarded(row.dataset.fn);
      if (want && !cur) {
        const m = document.createElement("span");
        m.className = "usl-guarded";
        m.title = "Guarding this flight";
        m.textContent = "★";
        // Same slot renderPanel() uses: after the fn (and its ✓), before the time.
        label.insertBefore(m, label.querySelector(".usl-time"));
      } else if (!want && cur) {
        cur.remove();
      }
    });
  }
  function refreshPanelTimes() {
    if (!panelEl) return;
    panelEl.querySelectorAll(".usl-jump").forEach((row) => {
      const fn = row.dataset.fn;
      const r = registry.get(fn);
      const onPage = !!(r && r.rowEl.isConnected);
      row.classList.toggle("usl-ghost", !onPage);
      row.title = onPage ? "Click to find this flight on the page" : "Not operating in these results (odds are route history)";
      const s = row.querySelector(".usl-time");
      if (s) s.textContent = onPage && r.times ? " · " + r.times.split(" – ")[0] : (onPage ? "" : " · not in results");
    });
  }
  function rebadge() {
    document.querySelectorAll("[data-usl-badged]").forEach((el) => {
      delete el.dataset.uslBadged;
      el.querySelectorAll(".usl-badge").forEach((b) => b.remove());
    });
    registry = new Map();
    scheduleScan();
  }

  /* ── popup bridge ── */
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return false;
      if (msg.type === "flightsOnPage") {
        sendResponse({ flights: [...registry.entries()]
          .filter(([, r]) => r.rowEl.isConnected)
          .map(([fn, r]) => ({ fn, times: r.times })) });
        return false;
      }
      if (msg.type === "pageContext") {
        sendResponse(ctx ? Object.assign({ airline: AIRLINE }, ctx) : { airline: AIRLINE });
        return false;
      }
      if (msg.type === "gotoFlight") { sendResponse({ ok: gotoFlight(msg.fn) }); return false; }
      if (msg.type === "sortPage") { sendResponse(sortPage()); return false; }
      return false;
    });
  } catch {}

  /* ── orchestration ── */
  async function refresh() {
    // GF carries no single route/leg context, so none of the route machinery
    // below applies — the chips and the summary panel are all there is.
    if (GFLIGHTS) { try { gfScan(); } catch (e) {} return; }
    const c = getContext();
    if (!c) { if (panelEl) { panelEl.remove(); panelEl = null; } ctx = null; ctxKey = ""; return; }
    const key = `${c.o}-${c.d}|${c.date}|${c.phase}`;
    if (c.navan) {
      // Navan: badges come from scan()/predictions; just (re)render the panel from
      // the on-page flights and let sortPage/auto-sort/keep-sorted do their thing.
      const routeChanged = !ctx || c.o !== ctx.o || c.d !== ctx.d || c.phase !== ctx.phase;
      ctx = c; ctxKey = key;
      if (routeChanged) { desiredOrder = null; navanSig = ""; }
      scheduleScan();
      const sig = navanTopFlights().map((f) => f.fn + f.prob).join(",");
      if (!panelEl || !panelEl.isConnected || sig !== navanSig) { navanSig = sig; renderPanel(); }
      refreshPanelTimes();
      return;
    }
    // Alaska: dataKey means "this context has already been fetched", so a route
    // with no usable answer isn't re-fetched every 2s. United keeps its old
    // behavior (retry until it succeeds) exactly.
    if (key === ctxKey && (data || (ALASKA && dataKey === key))) {
      if (!panelEl || !panelEl.isConnected) renderPanel();
      else if (ALASKA) {
        // Odds arrive per flight, so re-render when the ranked list changes.
        const sig = navanTopFlights().map((f) => f.fn + f.prob).join(",");
        if (sig !== navanSig) { navanSig = sig; renderPanel(); }
      }
      refreshPanelTimes();
      return;
    }
    const routeChanged = !ctx || c.o !== ctx.o || c.d !== ctx.d;
    ctx = c; ctxKey = key;
    desiredOrder = null;
    if (routeChanged || !data) { data = await loadData(c, false); dataKey = key; }
    indexData();
    if (ALASKA) navanSig = navanTopFlights().map((f) => f.fn + f.prob).join(",");
    renderPanel();
    rebadge();
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(refresh, 2000);
  refresh();
  if (PAGE_PREDICT) {
    if (NAVAN) data = data || {}; // Navan never fetches route data
    scheduleScan();
    setInterval(scheduleScan, 4000);
  }
})();
