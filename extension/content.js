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
  // v2.2: on united.com, ALSO fetch per-flight odds for on-page flights the
  // route table doesn't cover. The route table (predict_route_starlink) only
  // lists flights that EVER get Starlink, so a transcon flight that is 0% (with
  // real history) is absent from it and would otherwise badge a bare "n/a".
  // predict-flight returns its true number (e.g. 0% · 51 obs), which is a real
  // answer, not a blank. United only; Navan/Alaska/GF already predict per-flight.
  const UNITED_FALLBACK = !NAVAN && !ALASKA && !GFLIGHTS;
  // Anywhere we keep per-flight predictions across a context change / re-index.
  const KEEP_PREDICTIONS = PAGE_PREDICT || UNITED_FALLBACK;
  const TIME_RE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/gi;
  // Non-global twin of TIME_RE. .test() on a /g regex advances lastIndex and
  // silently alternates true/false across calls — never use TIME_RE for tests.
  const TIME_ONE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/i;
  let ctx = null;            // {o,d,date,phase} — the ACTIVE leg
  let ctxKey = "", dataKey = "";
  // Route-fetch backoff so a tracker outage recovers WITHOUT a page reload but
  // never hammers: on a failed fetch (directOk:false or a null response) the same
  // route may be retried, but only after an exponential delay (15s→30s→60s→120s,
  // capped), never on the 2s tick. A success clears it.
  let dataFail = false, dataTries = 0, dataNextTry = 0;
  const ROUTE_BACKOFFS = [15000, 30000, 60000, 120000];
  let navanCtxCache = null, navanCtxKey = "", navanSig = "";
  // Bug 3 (Navan): the panel must never claim "no history" before the page's
  // United flights have been read and predicted. navanUnitedCount is how many
  // distinct UA flight numbers scan() last saw on the page; navanLoading marks
  // the "reading the page" state so renderPanel shows a loading line, not the
  // empty-history copy. Both are only consulted on Navan.
  let navanUnitedCount = 0, navanLoading = false, navanUnavailable = false;
  // Bug 3: the exact SET of on-page United flight numbers scan() last saw. The
  // panel is "loading" ONLY while a genuine prediction is pending for one of
  // these — never because a periodic/DOM scan happens to be scheduled.
  let navanUnitedFns = new Set();
  let data = null, panelEl = null, scanScheduled = false;
  let probMap = new Map();
  let registry = new Map();
  let prioritizeActive = false, desiredOrder = null, lastSortTs = 0;
  /* ══ v3.0 settings (Codex round 26) ═══════════════════════════════════════
   * THREE independent controls. The two the brief proposed ("auto-sort on
   * mixed" + "prioritize next-gen on cross-carrier") overlapped — neither said
   * what mixed auto-sort does when prioritize is off — so they collapse into
   * one mixed-carrier MODE.
   *
   *   uslSortSingle : bool          single-carrier auto-sort           default ON
   *   uslSortMixed  : preserve|prioritize   mixed-carrier behaviour    default preserve
   *   uslMetrics    : both|nextgen|streaming   row display             default both
   *
   * Codex approved default-ON only for SINGLE-carrier pages, where every row is
   * the same airline and carries the same per-flight metric. Mixed-carrier
   * default-ON was REJECTED: floating a scored row up necessarily moves an
   * unscored airline DOWN in absolute position, handing an unknown flight the
   * rank of a worse one, and silently displacing whatever the traveller sorted
   * by. Jeremy took the recommendation, so mixed defaults to preserve.
   *
   * DISPLAY MODE NEVER CHANGES SORT. uslMetrics is presentation only: it must
   * not touch sort metric, winner eligibility, requests, or the candidate set. */
  const MIXED_HOST = NAVAN || GFLIGHTS;          // several carriers on one page
  const SINGLE_HOST = !MIXED_HOST;               // united.com / alaskaair.com
  let sortSingle = true;                          // default ON (Codex-approved)
  let sortMixed = "preserve";                     // default preserve (Codex-recommended)
  let metricsMode = "both";                       // default both
  let settingsReady = false;
  // The booking site's OWN flight order, captured before this extension moves
  // anything. "Keep site order" restores exactly this, so turning the setting
  // off is a real undo rather than a promise (Codex round 26, gate assertion 2).
  let hostOrder = null;      // array of row tokens, or null when never captured
  let hostOrderKey = "";     // route+phase the capture belongs to
  let didAutoSort = false;   // this context has been auto-sorted at least once
  let watched = new Set(); // "UA1812|2026-07-25"
  // R23 cross-model precedence: the Guard's latest published fact for an EXACT
  // fn|date, read from the same trip store the popup renders. "no" (confirmed
  // non-Starlink) disqualifies that candidate from winner treatment; "no",
  // "early" (withdrawn/unpublished) and "invalid" all suppress the separate
  // ✓-confirmed token, so a stale deps feed can never contradict a newer check.
  let guardFacts = new Map(); // "UA1812|2026-07-25" -> lastStatus
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
  // Per-flight retry ledger for transient failures. Bounded: after
  // PREDICT_MAX_TRIES attempts a flight becomes terminally "unavailable" (a
  // distinct display from "n/a"), and between attempts it waits out an
  // exponential backoff so a persistent 429/500 can never be re-requested every
  // scan. A recognised answer (odds or genuine n/a) clears the ledger entry.
  const PREDICT_MAX_TRIES = 4;
  const PREDICT_BACKOFFS = [3000, 8000, 20000, 60000];
  // Must equal bg.js's PREDICT_ERR: the message-safe sentinel the worker sends
  // for a per-flight fetch that was ATTEMPTED but failed transiently. Distinct
  // from null (genuine n/a) and from an absent key (25-cap, not attempted) — a
  // plain `undefined` would be dropped by Chrome messaging and read as absent.
  const PREDICT_ERR = "error";
  let predictFail = new Map(); // fn -> { tries, nextTry }
  function markPredictFail(f) {
    const pf = predictFail.get(f) || { tries: 0, nextTry: 0 };
    pf.tries++;
    if (pf.tries >= PREDICT_MAX_TRIES) {
      probMap.set(f, { unavailable: true }); // terminal: stop asking, show "unavailable"
      predictFail.delete(f);
    } else {
      pf.nextTry = Date.now() + PREDICT_BACKOFFS[Math.min(pf.tries - 1, PREDICT_BACKOFFS.length - 1)];
      predictFail.set(f, pf);
    }
  }
  function requestPredictions(fns) {
    const now = Date.now();
    const need = fns.filter((f) => {
      if (probMap.has(f) || pendingPredict.has(f)) return false; // resolved or in flight
      const pf = predictFail.get(f);
      return !(pf && now < pf.nextTry);                          // still cooling down
    });
    if (!need.length) return;
    need.forEach((f) => pendingPredict.add(f));
    const release = () => need.forEach((f) => pendingPredict.delete(f));
    try {
      chrome.runtime.sendMessage({ type: "predictFlights", fns: need, airline: AIRLINE }, (res) => {
        release();
        if (chrome.runtime.lastError || !res || !res.ok) {
          need.forEach(markPredictFail); // whole-batch failure counts against each
          scheduleScan();
          return;
        }
        const flights = res.flights || {};
        for (const f of need) {
          // A flight NOT present in the reply was beyond the worker's 25-per-call
          // cap — not attempted, so retry next scan with NO penalty (fair
          // progress past item 25). A present value is a settled outcome.
          if (!Object.prototype.hasOwnProperty.call(flights, f)) continue;
          const v = flights[f];
          // PREDICT_ERR is bg.js's ATTEMPTED-failure sentinel. A plain undefined
          // is dropped by Chrome messaging and would look absent (the 25-cap
          // case), so the worker sends this instead. It is a non-empty (truthy)
          // string, so it MUST be checked before the odds-object branch below,
          // and it counts against the bounded ledger (backoff, then terminal).
          if (v === PREDICT_ERR) { markPredictFail(f); continue; }              // attempted, transient error
          if (v === null) { probMap.set(f, null); predictFail.delete(f); continue; } // genuine n/a
          if (v && typeof v.prob === "number") {                               // real per-flight odds
            probMap.set(f, { prob: v.prob, obs: v.obs, conf: v.conf || null, dep: depFor(f) });
            predictFail.delete(f);
            continue;
          }
          markPredictFail(f); // any other unexpected shape → attempted failure
        }
        scheduleScan();
      });
    } catch (e) { release(); need.forEach(markPredictFail); }
  }
  try { chrome.runtime.sendMessage({ type: "getSelectors" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    if (res.cfg && res.cfg.selectors) SEL = Object.assign({}, DEFAULT_SEL, res.cfg.selectors);
  }); } catch {}
  try { chrome.runtime.sendMessage({ type: "tripList" }, (res) => {
    if (!chrome.runtime.lastError && res && res.trips) {
      watched = new Set(res.trips.map((t) => t.fn + "|" + t.date));
      guardFacts = new Map(res.trips.map((t) => [t.fn + "|" + t.date, t.lastStatus || ""]));
    }
  }); } catch {}
  // Round-18 Bug 4 ruling: NOTHING reorders cross-carrier by default — the
  // page's own order is preserved on load. Reordering happens only when the user
  // activates the explicit "Prioritize United flights…" action, which persists
  // as uslPrioritize so a deliberate choice sticks across reloads (default off).
  try {
    chrome.storage.local.get(["uslPrioritize", "uslSortSingle", "uslSortMixed", "uslMetrics"], (v) => {
      // Defaults apply only when the key is genuinely ABSENT, so a stored
      // `false` is never silently re-enabled on the next load. A fresh profile
      // and the rendered settings state must agree (gate assertion 1).
      sortSingle = v.uslSortSingle === undefined ? true : !!v.uslSortSingle;
      sortMixed = v.uslSortMixed === "prioritize" ? "prioritize" : "preserve";
      metricsMode = ["both", "nextgen", "streaming"].includes(v.uslMetrics) ? v.uslMetrics : "both";
      // The legacy explicit action persists per-session on mixed hosts only.
      prioritizeActive = MIXED_HOST ? (!!v.uslPrioritize || sortMixed === "prioritize") : false;
      settingsReady = true;
      scheduleScan();
      if (panelEl) renderPanel();
    });
  } catch { settingsReady = true; }
  // A settings change made in the popup takes effect in open tabs immediately:
  // turning single-carrier sort OFF must restore the captured host order right
  // then, not on the next reload (Codex round 26: off is a real undo).
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local") return;
      let touched = false;
      if (ch.uslSortSingle) { sortSingle = !!ch.uslSortSingle.newValue; touched = true; }
      if (ch.uslSortMixed) { sortMixed = ch.uslSortMixed.newValue === "prioritize" ? "prioritize" : "preserve"; touched = true; }
      if (ch.uslMetrics) { metricsMode = ch.uslMetrics.newValue || "both"; touched = true; }
      if (!touched) return;
      if (SINGLE_HOST && !sortSingle) restoreHostOrder();
      if (MIXED_HOST && sortMixed === "preserve") { prioritizeActive = false; restoreHostOrder(); }
      rebadge();
      if (panelEl) renderPanel();
    });
  } catch {}

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

  /* United panel list = the route-history rows MERGED with the odds of the
   * flights actually visible on the page, deduped by flight number. The on-page
   * (current) value wins on a tie, so a flight the page shows can never be
   * omitted just because a stale/partial route response left it out — the panel
   * and the on-page badge can no longer contradict (Codex round-18 P1-01).
   * Reduces to the on-page list when there is no route table (empty transcon). */
  function mergedFlights() {
    const map = new Map();
    for (const f of (data && data.flights) || [])
      if (typeof f.prob === "number") map.set(f.fn, { fn: f.fn, prob: f.prob });
    for (const [fn, r] of registry.entries()) {
      if (!r || !r.rowEl || !r.rowEl.isConnected) continue;
      const hit = probMap.get(fn);
      if (hit && typeof hit.prob === "number") map.set(fn, { fn, prob: hit.prob });
    }
    return [...map.values()].sort((a, b) => b.prob - a.prob).slice(0, 6);
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
          // Return the response even when resp.ok is false. ok:false covers BOTH
          // a genuinely empty route (directOk:true, flights:[]) AND a tracker
          // outage (directOk:false) — collapsing them to null (the old behaviour)
          // threw away directOk and made renderPanel treat an outage as a proven
          // absence. Only a true messaging failure (no resp / lastError) is null.
          if (chrome.runtime.lastError || !resp) return resolve(null);
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
    // would never come back. united.com now keeps them too (v2.2 fallback), so a
    // route change re-uses fetched per-flight odds instead of re-requesting them.
    probMap = KEEP_PREDICTIONS ? new Map(probMap) : new Map();
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
      // Tier 2: live per-flight odds replace the static score. LABELLED (Codex
      // round 26): an unlabelled "🛰 42" meant ConnectScore here and per-flight
      // next-gen odds on united.com, with nothing on screen to tell them apart.
      return {
        sig: "live|" + fn + "|" + hit.prob + "|" + (hit.dep ? hit.dep.tail : "") + "|" + (hit.conf || "") + opSig,
        cn: "usl-badge usl-gf-chip usl-gf-live " + cls(hit.prob),
        tx: "NEXT-GEN " + hit.prob + "%" + (hit.dep ? " ✓" : ""),
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
        tx: "NEXT-GEN —",
        ti: fn + ": no per-flight next-gen history for this flight number yet" +
          opNote + " · " + GF_CREDIT,
      };
    }
    // Tier 1: the airline's static STREAMING-class ConnectScore. This is NOT a
    // per-flight next-gen probability and must never look like one, so it is
    // labelled and stays on the neutral outline treatment.
    const fleet = a.fleet ? a.equipped + " of " + a.fleet + " aircraft" : "fleetwide";
    const freeTxt = GF_FREE_TEXT[String(entry.free || "unknown").toLowerCase()] || "";
    return {
      sig: "cs|" + key + "|" + a.score + opSig,
      cn: "usl-badge usl-gf-chip usl-gf-cs " + cls(a.score),
      tx: "STREAMING " + a.score,
      ti: a.name + " · streaming-class ConnectScore " + a.score + " (" + a.label + ") — " +
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
    // Next-gen first (Jeremy, 31 Jul): section 1 ranks the airlines in these
    // results by NEXT-GEN ODDS (chance of a Starlink / Amazon Leo aircraft,
    // from the same published segment ledger); section 2 is the streaming-class
    // ConnectScore (today's system quality, the floor). A missing next-gen
    // number renders n/a — unknown is never zero.
    const byNextGen = ranked.slice().sort((a, b) => {
      const av = typeof a.nextGenScore === "number" ? a.nextGenScore : -1;
      const bv = typeof b.nextGenScore === "number" ? b.nextGenScore : -1;
      return (bv - av) || a.name.localeCompare(b.name);
    });
    p.innerHTML =
      `<header><span>🛰️ WiFi odds in these results</span><span><span class="usl-x">▾</span></span></header>` +
      `<div class="usl-body">` +
      `<p class="usl-sect">Next-gen odds · Starlink and Amazon Leo</p>` +
      byNextGen.map((a) => {
        const ng = typeof a.nextGenScore === "number" ? Math.round(a.nextGenScore) : null;
        // A real but tiny share must not print a bare "0%": Southwest has 1
        // next-gen aircraft in 803, which reads as "none in the fleet", a
        // different and false fact. Test the UNROUNDED share, because
        // nextGenScore is already rounded by the model and is itself 0 here —
        // testing it would make this branch permanently dead, which is exactly
        // what shipped in the first attempt at this fix.
        const share = typeof a.nextGenShare === "number" ? a.nextGenShare : null;
        const txt = ng === null ? "n/a" : (share > 0 && ng === 0 ? "<1%" : ng + "%");
        return `<div class="usl-row" title="${esc(a.note || "")}">` +
          `<span>${esc(a.name)}<span class="usl-time"> · ${esc(a.nextGenLabel || "no next-gen fleet announced")}</span></span>` +
          `<span class="usl-badge ${ng === null ? "usl-na" : cls(ng)}">${txt}</span></div>`;
      }).join("") +
      `<p class="usl-sect usl-sect--stream">Streaming-class · ConnectScore</p>` +
      ranked.map((a) =>
        `<div class="usl-row usl-stream" title="${esc(a.note || "")}">` +
        `<span>${esc(a.name)}<span class="usl-time"> · ${esc(a.systemLabel)}${a.fleet ? " " + a.equipped + "/" + a.fleet : ""}</span></span>` +
        `<span class="usl-badge usl-cs ${cls(a.score)}">${a.score}</span></div>`).join("") +
      `<div style="margin-top:8px;font-size:11px;opacity:.75;line-height:1.45">` +
      `Next-gen odds = chance of a Starlink or Amazon Leo aircraft. ConnectScore = odds of the good satellite wifi today, not of any wifi. ` +
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

  /* ══ v3.0 — the labelled dual-metric row group (Codex round 26) ═════════════
   * ONE compact group carrying a LABELLED primary next-gen figure and a
   * LABELLED secondary streaming figure. The bare `🛰️ 48%` pill is retired: an
   * identical-looking chip meant per-flight next-gen odds on united.com and an
   * airline ConnectScore on Google Flights, and nothing on screen said which.
   *
   * Next-gen has SEVEN mutually exclusive states and none of them is a zero.
   * A fleet share is a different fact from a per-flight probability, so it gets
   * its own outline treatment and never enters the odds ramp, the winner
   * comparison, or the sort.
   *
   * `metricsMode` chooses which lines are VISIBLE. It never changes the state
   * that was computed, the requests made, or the sort — presentation only. */
  const NG_STATES = {
    prob:      { label: "NEXT-GEN", cls: "usl-ng--prob" },
    nohistory: { label: "NEXT-GEN", cls: "usl-ng--none", value: "—", sub: "No flight history" },
    unavail:   { label: "NEXT-GEN", cls: "usl-ng--none", value: "—", sub: "Unavailable" },
    fleet:     { label: "NEXT-GEN · FLEET", cls: "usl-ng--fleet", sub: "Fleet context" },
    announced: { label: "NEXT-GEN · ANNOUNCED", cls: "usl-ng--fleet", value: "", sub: "Not flying yet" },
    notinfleet:{ label: "NEXT-GEN · NOT IN FLEET", cls: "usl-ng--none", value: "", sub: "" },
    nofleet:   { label: "NEXT-GEN", cls: "usl-ng--none", value: "—", sub: "No fleet data" },
  };
  // The airline entry for a host row, or null. united.com/Navan rows are United,
  // alaskaair.com rows are Alaska; Google Flights passes its matched key.
  function airlineEntry(key) {
    try { return typeof scoreAirline === "function" ? scoreAirline(key || (ALASKA ? "alaska" : "united")) : null; }
    catch (e) { return null; }
  }
  /* Resolve the next-gen state for a row. `hit` is probMap's entry:
   *   {prob:…}      a real per-flight tracker probability
   *   {unavailable} the tracker was asked and failed  → NOT "no history"
   *   null          the tracker answered with no data → known absence
   *   undefined     never asked (caller does not render yet) */
  function nextGenStateFor(hit, entry, instrumented) {
    if (hit && typeof hit.prob === "number") return { k: "prob", value: hit.prob + "%", hit };
    if (hit && hit.unavailable) return { k: "unavail" };
    if (instrumented) return { k: "nohistory" };   // asked this flight, no history
    if (!entry) return { k: "nofleet" };
    // Not instrumented: fleet-level context only, and only when PUBLISHED.
    // `nextGenPublished === false` means the count is unpublished, which is
    // unknown — never a zero (the site's own fence).
    if (entry.nextGenPublished === false) return { k: "nofleet" };
    const share = typeof entry.nextGenScore === "number" ? Math.round(entry.nextGenScore) : null;
    if (share === null) return { k: "nofleet" };
    // Same fence as the panel: a real but sub-1% share reads "<1%", never a
    // bare 0% that would claim the airline has no next-gen aircraft at all.
    // Tested on the UNROUNDED nextGenShare — nextGenScore is pre-rounded and is
    // itself 0 for a sub-1% fleet, so testing it would never fire.
    if (entry.nextGenShare > 0) return { k: "fleet", value: share === 0 ? "<1%" : share + "%" };
    if (entry.future) return { k: "announced" };
    return { k: "notinfleet" };
  }
  /* Build the group. Returns an element, or null when there is nothing honest
   * to say yet. `fn` may be null for a carrier-only row (Google Flights). */
  function metricsGroup(fn, hit, key, opts) {
    opts = opts || {};
    const entry = airlineEntry(key);
    const instrumented = !!(entry && entry.instrumented) && !!fn;
    const st = nextGenStateFor(hit, entry, instrumented);
    const def = NG_STATES[st.k];
    const grp = document.createElement("span");
    grp.className = "usl-metrics" + (opts.compact ? " usl-metrics--compact" : "");
    if (fn) grp.dataset.b = fn;
    grp.dataset.ngState = st.k;

    const showNg = metricsMode !== "streaming";
    const showStream = metricsMode !== "nextgen";

    const typed = !!(hit && hit.conf === "type");
    const obsN = obsCount(hit);
    let ngText = "";
    if (showNg) {
      const line = document.createElement("span");
      line.className = "usl-ng " + def.cls;
      const lab = document.createElement("span");
      lab.className = "usl-ng__label";
      lab.textContent = def.label;
      line.appendChild(lab);
      const val = st.value !== undefined ? st.value : def.value;
      if (val) {
        const v = document.createElement("span");
        // Only a REAL per-flight probability takes the odds ramp. Fleet share
        // and every absence state stay outline/neutral so the two can never be
        // read as the same kind of fact.
        v.className = "usl-ng__value" + (st.k === "prob" ? " usl-badge " + cls(hit.prob) : "");
        v.textContent = (st.k === "prob" && typed ? "~" : "") + val;
        line.appendChild(v);
      }
      grp.appendChild(line);
      ngText = def.label + " " + (val || "");
      // Evidence / reason sits OUTSIDE the value, hidden ≤600px by CSS while
      // its meaning survives in the group's accessible name.
      const subTxt = st.k === "prob" ? (obsN ? obsN + " tracked" : (typed ? "aircraft type" : "")) : (def.sub || "");
      if (subTxt) {
        const sub = document.createElement("span");
        sub.className = "usl-ng__sub";
        sub.textContent = subTxt;
        line.appendChild(sub);
      }
    }

    let streamText = "";
    if (showStream) {
      const line = document.createElement("span");
      line.className = "usl-stream-line";
      const lab = document.createElement("span");
      lab.className = "usl-stream__label";
      lab.textContent = "STREAMING";
      line.appendChild(lab);
      if (entry && typeof entry.score === "number") {
        const v = document.createElement("span");
        v.className = "usl-stream__value";
        v.textContent = String(entry.score);
        line.appendChild(v);
        const w = document.createElement("span");
        w.className = "usl-stream__word";     // hidden at narrow widths
        w.textContent = "ConnectScore";
        line.appendChild(w);
        streamText = "Streaming-class ConnectScore " + entry.score + " out of 100";
      } else {
        const v = document.createElement("span");
        v.className = "usl-stream__value usl-stream__value--none";
        v.textContent = "No ConnectScore";
        line.appendChild(v);
        streamText = "No streaming-class ConnectScore for this airline";
      }
      grp.appendChild(line);
    }

    // The separate, dated confirmation token — never folded into a metric, and
    // suppressed when the Guard's newer fact for this exact date contradicts it.
    if (hit && hit.dep && fn && !guardContradicts(fn)) {
      const cf = document.createElement("span");
      cf.className = "usl-confirm";
      cf.appendChild(document.createTextNode("✓"));
      const cw = document.createElement("span");
      cw.className = "usl-confirm-w";
      cw.textContent = " Confirmed";
      cf.appendChild(cw);
      cf.setAttribute("aria-label", "Confirmed Starlink tail " + hit.dep.tail + " for " + hit.dep.date);
      grp.appendChild(cf);
    }

    // The full accessible sentence. Every visible state's MEANING survives here
    // even where CSS hides the words at narrow widths.
    const ngSentence =
      st.k === "prob"
        ? (typed
            ? `about ${hit.prob}% historical next-gen odds, estimated from aircraft type`
            : `${hit.prob}% historical per-flight next-gen odds` + (obsN ? ` from ${obsN} tracked departures` : "")) +
          (hit.conf && hit.conf !== "type" ? `. ${confWord(hit)}` : "")
        : st.k === "nohistory" ? "no per-flight next-gen history for this flight number"
        : st.k === "unavail" ? "per-flight next-gen odds unavailable right now"
        : st.k === "fleet" ? `no per-flight odds for this flight; ${st.value} of this airline's known fleet is next-gen`
        : st.k === "announced" ? "next-gen announced for this airline but not flying yet"
        : st.k === "notinfleet" ? "no next-gen aircraft in this airline's current fleet"
        : "no fleet data for this airline";
    const sentence = (fn ? fn + ": " : "") +
      (showNg ? ngSentence : "") + (showNg && showStream ? ". " : "") +
      (showStream ? streamText : "") +
      (hit && hit.dep && fn && !guardContradicts(fn) ? `. Confirmed Starlink tail ${hit.dep.tail} for ${hit.dep.date}` : "") +
      `. Data from ${TRACKER}`;
    grp.setAttribute("role", "img");
    grp.setAttribute("aria-label", sentence);
    grp.title = sentence;
    return grp;
  }

  /* ── badge injection ── */
  function scan() {
    scanScheduled = false;
    // Google Flights has its own scanner and must never reach the united.com
    // pass below (that one would badge "United 1812" prose with UA route odds
    // it has no route for, and would try to reorder a virtualized list).
    // GOOGLE FLIGHTS NEVER REORDERS, whatever the mixed-carrier setting says.
    // This early return is deliberate and load-bearing: GF virtualises its list
    // and owns its own ordering, so moving its rows would fight the host. Codex
    // (relay round 5) correctly flagged that the popup named Google Flights as a
    // host the mixed-carrier control governed, while the control could not reach
    // it — a setting claiming something it cannot do. The fix is the COPY, not
    // this branch: the popup now scopes that control to Navan and says outright
    // that Google Flights is never reordered.
    if (GFLIGHTS) { try { gfScan(); } catch (e) {} return; }
    // united.com fallback must run even when the route call returned nothing
    // (data === null): that is the transcon case where per-flight odds are the
    // only signal, so an empty route must not short-circuit the page scan.
    if (!data && !PAGE_PREDICT && !UNITED_FALLBACK) return;
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
    // Bug 3: record how many distinct United flight numbers are on the page so
    // the Navan render can tell "still reading the page" from "genuinely none".
    if (NAVAN) {
      const seenNav = new Set();
      for (const n of targets) { const m = n.nodeValue.match(FN_RE); if (m) seenNav.add(AIRLINE + m[1]); }
      navanUnitedFns = seenNav;
      navanUnitedCount = seenNav.size;
    }
    let registered = false;
    const navanWants = [];
    // The on-page "best" ring binds to the SAME fail-closed winner eligibility as
    // the panel/strip: rank the scored predictions and ask winnerFnOf(). A mere
    // highest number that isn't decision-grade (gap <8pt, or low/type/missing
    // confidence) gets NO ring anywhere (Codex R23 "leaked best ring" control).
    const rankedOnPage = [...probMap.entries()]
      .filter(([, v]) => v && typeof v.prob === "number")
      .map(([f, v]) => ({ fn: f, prob: v.prob }))
      .sort((a, b) => b.prob - a.prob);
    const onPageWinnerFn = winnerFnOf(rankedOnPage);
    for (const n of targets) {
      const el = n.parentElement;
      if (!el) continue;
      const m = n.nodeValue.match(FN_RE);
      const fn = AIRLINE + m[1];
      // On prediction hosts AND united.com (v2.2 fallback), a flight not yet in
      // the map is queued for a per-flight fetch instead of being badged "n/a"
      // outright. After the fetch it badges its real % (or "n/a" only if the
      // tracker genuinely has no data for that flight number).
      if ((PAGE_PREDICT || UNITED_FALLBACK) && !probMap.has(fn)) { navanWants.push(fn); continue; }
      const hit = probMap.get(fn);
      const row = findRow(el);
      if (!el.dataset.uslBadged) {
        const dup = row && row.rowEl.querySelector('[data-b="' + fn + '"]');
        if (dup) {
          el.dataset.uslBadged = "dup";
        } else if (hit !== undefined || row) {
          // ONE labelled dual-metric group for every resolved state (Codex
          // round 26). The old code had three separate branches emitting three
          // differently-shaped chips — a bare "🛰️ —" for a failed request, a
          // bare "🛰️ n/a" for a genuine absence, and a percentage pill — none
          // of which said whether the number was per-flight next-gen or an
          // airline ConnectScore. metricsGroup() resolves the state and labels
          // it. `hit === undefined` still means "never asked": no group yet.
          el.dataset.uslBadged = hit && hit.unavailable ? "unavail" : hit ? "1" : "na";
          const grp = metricsGroup(fn, hit, null);
          // "best" is a RING modifier bound to the shared winner eligibility,
          // applied to the probability pill only, and never a colour change.
          if (fn === onPageWinnerFn && !PAGE_PREDICT) {
            const pill = grp.querySelector(".usl-ng__value.usl-badge");
            if (pill) pill.classList.add("usl-best");
          }
          el.appendChild(grp);
          if (row) addWatchStar(el, fn);
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
    if ((PAGE_PREDICT || UNITED_FALLBACK) && navanWants.length) requestPredictions([...new Set(navanWants)]);
    // Capture the host's own order on EVERY scan until something moves rows, so
    // an undo target exists on mixed hosts too (where nothing auto-sorts).
    captureHostOrder();
    autoSortIfEnabled();
    maybeResort();
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
      // Score each ancestor by how many validated flight-result rows of ANY
      // carrier it holds as direct children — the results list is the ancestor
      // with the most. This must NOT gate on ≥2 United rows (Round-19 finding):
      // a single scored United row among other-carrier rows is still a container
      // we can prioritize within. Requiring ≥2 flight rows of any carrier still
      // separates the real results list from an incidental single-row block.
      const flights = [...e.children].filter(isFlightUnit).length;
      if (flights > bestScore) { bestScore = flights; best = e; }
    }
    return bestScore >= 2 ? best : null;
  }
  /* ── validated flight-result rows only (Round-18 Bug 4) ────────────────────
   * A "flight unit" is a results row that is genuinely a flight: it carries a
   * recognized flight-number token AND a clock time. That pairing is what keeps
   * headings, filters, banners, result-tools/notice blocks, pagination and
   * loading sentinels OUT of the reorder — the old sorter moved every direct
   * child of the container and detached the reading order from the booking
   * controls. GEN_FN_RE is deliberately generic (any carrier), so an unscored
   * Frontier/Southwest row is still recognized as a flight and kept in the
   * sort's stable tail rather than mistaken for structure. */
  const GEN_FN_RE = /\b(?:[A-Z]{2,3}|[A-Z][a-zA-Z]{3,})\s?\d{2,4}\b/;
  /* The HOST's own text for a row, with every element this extension injected
   * removed. Load-bearing, and it cost a real defect to learn: the v3.0 row
   * label "NEXT-GEN 68%" matches GEN_FN_RE as carrier "GEN" flight "68", so a
   * row's identity token flipped from UA1596 to GEN68 the moment we badged it,
   * which broke sorting and the order probes. Anything that reads a row to
   * decide what it IS must read the page, never our own annotations. */
  function hostText(el) {
    if (!el) return "";
    let out = "";
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) {
          const cl = c.classList;
          if (cl && cl.length) {
            let ours = false;
            for (const k of cl) if (k.lastIndexOf("usl-", 0) === 0) { ours = true; break; }
            if (ours) continue;
          }
          walk(c);
        } else if (c.nodeType === 3) out += c.nodeValue;
      }
    })(el);
    return out;
  }
  function isFlightUnit(el) {
    const t = hostText(el);
    return TIME_ONE.test(t) && GEN_FN_RE.test(t);
  }
  // Stable per-row identity from its flight token ("United 1596" → "UNITED1596",
  // "Frontier 1229" → "FRONTIER1229"). Used to compare the FULL cross-carrier row
  // order so a Navan rerender that lifts another carrier back above United — even
  // while United's own relative order is preserved — is detected and re-corrected.
  function rowToken(el) {
    const m = hostText(el).match(GEN_FN_RE);
    return m ? m[0].replace(/\s+/g, "").toUpperCase() : null;
  }
  function currentFlightOrder(P) {
    return [...P.children].filter(isFlightUnit).map(rowToken).filter(Boolean);
  }
  // Numeric odds for a United row, or null when the row is unscored (another
  // carrier, an n/a United flight, or one still loading). null is NOT "worse
  // than 0" — unscored rows simply follow the scored ones in their own order.
  function unitScore(el) {
    const m = hostText(el).match(FN_RE);
    const hit = m ? probMap.get(AIRLINE + m[1]) : null;
    return hit && typeof hit.prob === "number" ? hit.prob : null;
  }
  // The target flight-token order given the CURRENT prediction set: scored United
  // rows by odds desc (stable), then every unscored flight row in its existing
  // relative order. Recomputed each pass so a score that settles in a later batch
  // (beyond the worker's 25-per-call cap) reranks correctly.
  function idealFlightTokens(P) {
    const flights = [...P.children].filter(isFlightUnit)
      .map((el, k) => ({ el, k, s: unitScore(el), tok: rowToken(el) }));
    const scored = flights.filter((x) => x.s !== null).slice()
      .sort((a, b) => b.s - a.s || a.k - b.k);
    const unscored = flights.filter((x) => x.s === null);
    return { scoredCount: scored.length, tokens: [...scored, ...unscored].map((x) => x.tok) };
  }
  function sortPage() {
    const P = findContainer();
    if (!P) return { ok: false, why: "results container not found" };
    const kids = [...P.children];
    const flightIdx = [];
    kids.forEach((el, i) => { if (isFlightUnit(el)) flightIdx.push(i); });
    const meta = flightIdx.map((i, k) => ({ el: kids[i], k, s: unitScore(kids[i]) }));
    const scored = meta.filter((x) => x.s !== null);
    // ONE scored United row is enough to prioritize (Round-19 finding): float it
    // into the first flight slot ahead of the unscored rows. Only a genuinely
    // EMPTY scored set is a no-op the caller reports truthfully.
    if (scored.length < 1) return { ok: false, why: "no scored flights" };
    const scoredSorted = scored.slice().sort((a, b) => b.s - a.s || a.k - b.k);
    const unscored = meta.filter((x) => x.s === null); // original relative order
    const newFlightEls = [...scoredSorted, ...unscored].map((x) => x.el);
    // Reinsert so the FLIGHT slots take the new flight sequence and every
    // non-flight sibling stays in its own slot — structure never moves.
    const flightSet = new Set(flightIdx);
    let fi = 0;
    const desired = kids.map((el, i) => (flightSet.has(i) ? newFlightEls[fi++] : el));
    const anchor = document.createComment("usl-anchor");
    P.insertBefore(anchor, P.firstChild);
    for (const el of desired) P.insertBefore(el, anchor);
    anchor.remove();
    desiredOrder = currentFlightOrder(P);
    lastSortTs = Date.now();
    return { ok: true, count: scored.length };
  }
  /* While the explicit action is active, re-assert the order after United/Navan
   * re-renders AND after new odds settle. Recomputes the ideal from current
   * scores and compares it to the live FULL flight-row order (all carriers), so
   * both a cross-carrier rerender and a late high score re-correct. Loop-guarded:
   * our own reorder is a DOM mutation that reschedules a scan, so a short window
   * after each sort is ignored. */
  /* ── host-order capture and real undo (Codex round 26) ────────────────────
   * Capture the booking site's OWN flight-row order BEFORE this extension has
   * moved anything. "Keep site order" then restores those exact rows to those
   * exact slots. Without a capture, turning sorting off could only stop future
   * reorders, leaving the page in a state the traveller never chose — which is
   * not an undo, and the gate asserts the difference. */
  function captureHostOrder() {
    if (didAutoSort || prioritizeActive) return;      // already moved: too late
    const P = findContainer();
    if (!P) return;
    const key = ctx ? `${ctx.o}-${ctx.d}|${ctx.phase}` : "";
    const now = currentFlightOrder(P);
    if (now.length < 2) return;
    if (hostOrder && hostOrderKey === key) return;    // keep the FIRST capture
    hostOrder = now;
    hostOrderKey = key;
  }
  function restoreHostOrder() {
    const P = findContainer();
    const key = ctx ? `${ctx.o}-${ctx.d}|${ctx.phase}` : "";
    if (!P || !hostOrder || hostOrderKey !== key) { didAutoSort = false; desiredOrder = null; return false; }
    const kids = [...P.children];
    const flightIdx = [];
    kids.forEach((el, i) => { if (isFlightUnit(el)) flightIdx.push(i); });
    // Rebuild the captured sequence from the rows PRESENT now. A row the host
    // has since removed is simply absent; anything unrecognised keeps its place
    // at the end rather than being dropped.
    const byTok = new Map();
    for (const i of flightIdx) { const t = rowToken(kids[i]); if (t && !byTok.has(t)) byTok.set(t, kids[i]); }
    const seq = [];
    for (const t of hostOrder) { const el = byTok.get(t); if (el) { seq.push(el); byTok.delete(t); } }
    for (const el of byTok.values()) seq.push(el);
    if (seq.length !== flightIdx.length) { didAutoSort = false; desiredOrder = null; return false; }
    const flightSet = new Set(flightIdx);
    let fi = 0;
    const desired = kids.map((el, i) => (flightSet.has(i) ? seq[fi++] : el));
    const anchor = document.createComment("usl-anchor");
    P.insertBefore(anchor, P.firstChild);
    for (const el of desired) P.insertBefore(el, anchor);
    anchor.remove();
    didAutoSort = false;
    desiredOrder = null;
    lastSortTs = Date.now();
    return true;
  }
  /* Single-carrier automatic sort. Codex approved default-ON here ONLY: every
   * row is the same airline, so no other carrier is displaced and no
   * cross-carrier order changes. Never runs on a mixed host, never before the
   * stored settings have loaded (a default must not act before it is known),
   * and never before the host's own order has been captured. */
  function autoSortIfEnabled() {
    if (!settingsReady || !SINGLE_HOST || !sortSingle) return;
    if (Date.now() - lastSortTs < 1200) return;
    const P = findContainer();
    if (!P) return;
    captureHostOrder();
    const ideal = idealFlightTokens(P);
    if (ideal.scoredCount < 2) return;   // nothing meaningful to order yet
    const now = currentFlightOrder(P);
    if (now.join(",") === ideal.tokens.join(",")) { didAutoSort = true; return; }
    const res = sortPage();
    if (res && res.ok) { didAutoSort = true; if (panelEl) renderPanel(); }
  }

  function maybeResort() {
    if (!prioritizeActive || Date.now() - lastSortTs < 1200) return;
    const P = findContainer();
    if (!P) return;
    const ideal = idealFlightTokens(P);
    if (ideal.scoredCount < 1) return; // one scored row is enough to keep floated
    const now = currentFlightOrder(P);
    if (now.join(",") !== ideal.tokens.join(",")) sortPage();
  }

  /* ── panel ── */
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ══ v2.3 (prototype) — confidence surfacing + "Best WiFi choice" strip ══════
   * Everything here reads ONLY fields the tracker already returns and stores in
   * probMap (prob, obs, conf, dep). Nothing is invented: when a value is absent
   * (e.g. no observation count, or odds derived from aircraft type rather than
   * this flight's own departures), the corresponding bit is simply omitted. */

  // Sample size to display next to the odds, but ONLY a genuine per-flight
  // departure count. conf === "type" means the odds came from the aircraft type,
  // not this flight number's history, so there is no sample to show.
  function obsCount(hit) {
    return hit && typeof hit.obs === "number" && hit.obs > 0 && hit.conf !== "type" ? hit.obs : null;
  }
  // Confidence word straight from the tracker's calibrated label — NEVER
  // synthesised from observation count (Codex R23: obs count is evidence shown
  // to the traveller, not a confidence rule and not an eligibility threshold).
  // Returns "" when the tracker gives no usable label, so a missing confidence
  // stays missing rather than being invented from sample size.
  function confWord(hit) {
    if (!hit) return "";
    if (hit.conf === "high") return "High confidence";
    if (hit.conf === "medium") return "Medium confidence";
    if (hit.conf === "low") return "Low confidence";
    if (hit.conf === "type") return "Estimated from aircraft type";
    return "";
  }
  // The muted " · N flights" sample-size tag for a panel row, or "" when unknown.
  function obsSpan(fn) {
    const on = obsCount(probMap.get(fn));
    return on ? `<span class="usl-obs"> · ${on} flights</span>` : "";
  }

  // Below this lead (in percentage points) the top two are "too close to call".
  const STRIP_MIN_GAP = 8;

  /* R23 Answer-3 precedence helpers. The Guard's latest published fact for the
   * EXACT flight/date being shopped outranks the strip's historical comparison:
   *   · lastStatus "no" (confirmed non-Starlink) → that candidate is ineligible
   *     for winner/CTA/ring/star while the fact is current (historical odds may
   *     stay visible, explicitly historical);
   *   · "no" / "early" (withdrawn) / "invalid" → the separate ✓-Confirmed token
   *     must not render for that flight (no confirmation token after B or C). */
  function guardFact(fn) {
    if (!ctx || !ctx.date) return "";
    return guardFacts.get(fn + "|" + ctx.date) || "";
  }
  function guardNo(fn) { return guardFact(fn) === "no"; }
  function guardContradicts(fn) {
    const v = guardFact(fn);
    return v === "no" || v === "early" || v === "invalid";
  }

  /* THE single winner-eligibility predicate. Codex R23 + freshness amendment:
   * a winner is earned iff (1) ≥2 scored comparable flights, (2) finite gap ≥8
   * pts, (3) the leader carries a TRACKER-SUPPLIED calibrated confidence of
   * `high` or `medium` — low / type / missing / unknown / invented are all
   * ineligible. No freshness fence (predict-flight has no source as-of), and
   * observation count is evidence, never an eligibility threshold. Returns the
   * winner shape or null. BOTH the strip and every best ring/star bind to THIS
   * function, so a highest number that is not eligible never gets crowned or
   * ringed anywhere (the "leaked best ring" mutation the gate hunts for). */
  function eligibleWinner(flights) {
    const scored = (flights || []).filter((f) => typeof f.prob === "number");
    // R23 precedence: a candidate the Guard has CONFIRMED non-Starlink for this
    // exact date cannot take winner treatment; another candidate may still win,
    // so the comparison runs over the remaining eligible field.
    const field = scored.filter((f) => !guardNo(f.fn));
    if (field.length < 2) return null;
    const best = field[0], second = field[1];
    const gap = best.prob - second.prob;
    if (!(gap >= STRIP_MIN_GAP)) return null;
    const bestHit = probMap.get(best.fn);
    const conf = bestHit && bestHit.conf;
    if (conf !== "high" && conf !== "medium") return null;
    return { best, second, gap, bestHit };
  }
  // The winning flight number for the current ranked list, or null. Marker
  // binding (panel ⭐ and on-page ring) calls this so it can never disagree with
  // the strip about who won.
  function winnerFnOf(flights) { const w = eligibleWinner(flights); return w ? w.best.fn : null; }

  /* Build the decision strip as ONE structured component with an explicit state
   * modifier (Codex spec §4/§8). Winner is fail-closed via eligibleWinner();
   * every non-winner state still tells the traveller what is known and why the
   * extension declined to decide. No trophy glyph; the winner wash is the brand
   * cyan/violet (CSS), never green (green is the odds ramp). No freshness claim
   * — evidence is permanently scoped "Historical tracker odds" (R23 amendment).
   * Returns "" when there is nothing scored to speak to. */
  /* What a refusal state may say about ORDER.
   *
   * Codex found this on a live alaskaair.com capture: the card's note read
   * "Flights stay in the booking site's order" while the bar directly above it
   * read "Sorted by historical next-gen odds". Both were on screen at once and
   * one of them was false. The note was written when nothing sorted without an
   * explicit press; single-carrier auto-sort now defaults ON, so the sentence
   * became a lie the moment the default changed and nothing caught it, because
   * no gate case combined a refusal state with sorting active.
   *
   * Declining to pick a winner and leaving the page order alone are DIFFERENT
   * claims. The card may only speak about order it actually controls. */
  function orderNote(kind) {
    const moved = didAutoSort || prioritizeActive;
    if (kind === "single") {
      return moved
        ? "The scored flight is first. The rest keep their order."
        : "Other flights stay unscored and in place.";
    }
    return moved
      ? "Sorted by odds, but neither is a clear pick."
      : "Flights stay in the booking site's order.";
  }

  /* Announce-once (spec §7): the strip is a role=status live region, but it
   * must announce only when its SEMANTIC state key changes, never on a
   * same-state re-render — so an unchanged state renders with aria-live="off"
   * and a replaced node with identical meaning cannot re-announce. */
  let lastStripState = "";
  function stripLive(key) {
    const v = key === lastStripState ? "off" : "polite";
    lastStripState = key;
    return v;
  }

  function decisionStrip(flights, sys) {
    // System states (spec §5): loading / tracker-unavailable / no-data are the
    // SAME structured component with explicit modifiers, never a bare prose row.
    // Loading carries aria-busy=true and settles; unavailable and genuine
    // no-data stay distinct — an unmeasured route is never a proven absence.
    if (sys) {
      if (sys.state === "loading") {
        return `<section class="usl-decision usl-decision--loading" data-usl-state="loading" role="status"` +
          ` aria-live="${stripLive("loading")}" aria-busy="true"` +
          ` aria-label="Checking this page. Comparing WiFi history.">` +
          `<p class="usl-decision__kicker">Checking this page</p>` +
          `<p class="usl-decision__comparison">Comparing WiFi history…</p>` +
          `<div class="usl-decision__skel" aria-hidden="true"></div>` +
          `<div class="usl-decision__skel usl-decision__skel--short" aria-hidden="true"></div>` +
          `</section>`;
      }
      if (sys.state === "unavailable") {
        return `<section class="usl-decision usl-decision--unavailable" data-usl-state="unavailable" role="status"` +
          ` aria-live="${stripLive("unavailable")}" aria-busy="false"` +
          ` aria-label="Comparison unavailable. We couldn't refresh flight odds. Page order is unchanged.">` +
          `<p class="usl-decision__kicker">Comparison unavailable</p>` +
          `<p class="usl-decision__comparison">We couldn't refresh flight odds.</p>` +
          `<p class="usl-decision__note">Page order is unchanged. Use ↻ to retry.</p>` +
          `</section>`;
      }
      return `<section class="usl-decision usl-decision--no-data" data-usl-state="no-data" role="status"` +
        ` aria-live="${stripLive("no-data")}" aria-busy="false"` +
        ` aria-label="No comparison available. ${esc(sys.body)}">` +
        `<p class="usl-decision__kicker">No comparison available</p>` +
        `<p class="usl-decision__comparison">${esc(sys.body)}</p>` +
        `</section>`;
    }

    const scored = (flights || []).filter((f) => typeof f.prob === "number");
    if (!scored.length) return "";
    // R23 precedence: candidates the Guard confirmed non-Starlink for this exact
    // date are out of the winner field (their historical odds stay in the rows).
    const excluded = scored.filter((f) => guardNo(f.fn));
    const field = scored.filter((f) => !guardNo(f.fn));

    // SINGLE — only one scored flight; nothing to compare, no winner treatment.
    if (scored.length === 1) {
      const only = scored[0];
      const obsN = obsCount(probMap.get(only.fn));
      const ev = only.prob + "%" + (obsN ? ` · ${obsN} tracked departures` : "");
      return `<section class="usl-decision usl-decision--single" data-usl-state="single" role="status"` +
        ` aria-live="${stripLive("single")}" aria-busy="false"` +
        ` aria-label="Not enough to compare: only ${esc(only.fn)} has a historical Starlink score.">` +
        `<p class="usl-decision__kicker">Not enough to compare</p>` +
        `<p class="usl-decision__comparison">Only ${esc(only.fn)} has a score</p>` +
        `<p class="usl-decision__evidence">${esc(ev)} · Historical tracker odds</p>` +
        `<p class="usl-decision__note">${orderNote("single")}</p>` +
        `</section>`;
    }

    const w = eligibleWinner(flights);

    // No eligible winner → CLOSE / refusal. Say plainly why (too close, the
    // leader's confidence is not decision-grade, or the Guard disqualified the
    // top candidate and too little is left), never manufacture a winner.
    if (!w) {
      let reason, detail;
      if (excluded.length && field.length < 2) {
        // The comparison collapsed because the Guard's published fact removed a
        // candidate. Name the fact; ambiguity is never converted to a negative.
        reason = `${excluded[0].fn} is confirmed non-Starlink for this date`;
        detail = field.length
          ? `${esc(field[0].fn)} ${field[0].prob}% is the only other scored flight.`
          : `No other scored flight to compare.`;
      } else {
        const best = field[0], second = field[1];
        const gap = best.prob - second.prob;
        const bestHit = probMap.get(best.fn);
        const conf = bestHit && bestHit.conf;
        const lowGrade = conf !== "high" && conf !== "medium"; // low/type/missing/unknown
        reason = lowGrade
          ? `The leader is based on limited history`
          : `Top two are ${gap} point${gap === 1 ? "" : "s"} apart`;
        detail = lowGrade
          ? `${esc(best.fn)} leads, but its odds are not decision-grade.`
          : `${esc(best.fn)} ${best.prob}% · ${esc(second.fn)} ${second.prob}%`;
      }
      return `<section class="usl-decision usl-decision--close" data-usl-state="close" role="status"` +
        ` aria-live="${stripLive("close")}" aria-busy="false"` +
        ` aria-label="No clear winner. ${esc(reason)}.">` +
        `<p class="usl-decision__kicker">No clear winner</p>` +
        `<p class="usl-decision__comparison">${esc(reason)}</p>` +
        `<p class="usl-decision__evidence">${detail}</p>` +
        `<p class="usl-decision__note">${orderNote("close")}</p>` +
        `</section>`;
    }

    // WINNER — earned and rare. Evidence is permanently historical; a confirmed
    // exact-date tail is a SEPARATE fact, never a freshness signal.
    const { best, second, gap, bestHit } = w;
    const obsN = obsCount(bestHit);
    const cw = confWord(bestHit); // guaranteed High/Medium by eligibility
    // No confirmation token after a Guard B or C fact for this exact date.
    const dep = bestHit && !guardContradicts(best.fn) ? bestHit.dep : null;
    const evBits = [];
    if (obsN) evBits.push(`${obsN} tracked departures`);
    if (cw) evBits.push(cw);
    evBits.push("Historical tracker odds");
    const confirm = dep
      ? `<p class="usl-decision__confirm">✓ Confirmed for ${esc(dep.date)}</p>` : "";
    const aria = `Best WiFi choice ${best.fn}: ${gap} points higher historical Starlink odds than ${second.fn}.` +
      (obsN ? ` ${obsN} tracked departures.` : "") + (cw ? ` ${cw}.` : "") +
      (dep ? ` Confirmed Starlink tail for ${dep.date}.` : "") +
      ` Prioritize ${best.fn}; unscored flights remain after scored United flights.`;
    return `<section class="usl-decision usl-decision--winner" data-usl-state="winner" role="status"` +
      ` aria-live="${stripLive("winner")}" aria-busy="false"` +
      ` aria-label="${esc(aria)}" aria-labelledby="usl-decision-title">` +
      `<div class="usl-decision__top">` +
        `<p class="usl-decision__kicker">Best WiFi choice</p>` +
        `<span class="usl-badge ${cls(best.prob)}" aria-hidden="true">${best.prob}%</span>` +
      `</div>` +
      `<h2 id="usl-decision-title" class="usl-decision__title">${esc(best.fn)}</h2>` +
      `<p class="usl-decision__comparison">${gap} points higher historical odds than ${esc(second.fn)}</p>` +
      confirm +
      `<p class="usl-decision__evidence">${esc(evBits.join(" · "))}</p>` +
      `<button type="button" class="usl-decision__cta usl-strip-cta" data-fn="${esc(best.fn)}"` +
      ` aria-pressed="${prioritizeActive ? "true" : "false"}">` +
      `${prioritizeActive ? "✓ " + esc(best.fn) + " prioritized" : "Prioritize " + esc(best.fn)}</button>` +
      `</section>`;
  }

  /* ── streaming-class section (next-gen first, streaming second) ────────────
   * ConnectScore is TODAY'S system quality — the published floor from
   * airlines.js — and answers a different question than the next-gen odds
   * above it. On Navan the section lists every supported carrier matched in
   * the results (falling back to United); single-carrier hosts list their own
   * airline. Renders "" when airlines.js is absent. A missing score renders
   * nothing: unknown is never zero. */
  function streamingRows() {
    if (metricsMode === "nextgen") return "";   // display mode: presentation only
    if (typeof scoreAirline !== "function") return "";
    let keys;
    if (NAVAN) {
      keys = ["united"];
      try {
        const P = findContainer();
        const txt = P ? P.textContent || "" : "";
        if (txt && typeof GF_AIRLINES !== "undefined") {
          const found = GF_AIRLINES.filter((a) => a.re.test(txt)).map((a) => a.key);
          if (found.length) keys = found;
        }
      } catch (e) {}
    } else {
      keys = [ALASKA ? "alaska" : "united"];
    }
    const rows = keys.map((k) => { try { return scoreAirline(k); } catch (e) { return null; } })
      .filter((a) => a && typeof a.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (!rows.length) return "";
    return `<p class="usl-sect usl-sect--stream">Streaming-class · ConnectScore</p>` +
      rows.map((a) =>
        `<div class="usl-row usl-stream" title="${esc(a.note || "")}">` +
        `<span>${esc(a.name)}<span class="usl-time"> · ${esc(a.systemLabel)}</span></span>` +
        `<span class="usl-badge usl-cs ${a.cls || cls(a.score)}">${a.score}</span></div>`).join("");
  }

  function updatePanelSortBtn() {
    const btn = panelEl && panelEl.querySelector(".usl-prioritize");
    if (!btn) return;
    // Show the explicit action once there is at least one on-page United row it
    // could act on. It reorders as soon as ≥1 is actually scored (sortPage guards
    // that); if none can be scored, the click handler keeps the button truthful
    // rather than claiming an active prioritization over an unchanged page.
    const n = [...registry.values()].filter((r) => r.rowEl.isConnected).length;
    btn.style.display = n >= 1 ? "" : "none";
  }
  function renderPanel() {
    if (panelEl) panelEl.remove();
    panelEl = null;
    if (!ctx) return;
    const p = document.createElement("div");
    p.className = "usl-panel";
    chrome.storage.local.get("uslCollapsed", (v) => {
      if (!v.uslCollapsed) return;
      p.classList.add("usl-collapsed");
      const cb = p.querySelector(".usl-x");
      if (cb) { cb.setAttribute("aria-expanded", "false"); cb.setAttribute("aria-label", "Expand panel"); }
    });
    const hasRouteRows = !!(data && data.flights && data.flights.length);
    // Navan/Alaska rank from the on-page badges (no route table). United MERGES
    // the route-history rows with the on-page per-flight odds (mergedFlights), so
    // a flight visible on the page is never omitted by a stale/partial route
    // response — panel and page agree (Codex round-18 P1-01).
    const flights = (ctx.navan || ALASKA) ? navanTopFlights() : mergedFlights();
    // The ⭐ marks the eligible winner ONLY — the same fail-closed predicate the
    // strip uses. When there is no earned winner (too close, low-grade, single),
    // NO row gets the star, exactly as no winner card renders (Codex R23).
    const winFn = winnerFnOf(flights);
    // The "per-flight odds" caption shows when the list is carried purely by the
    // on-page fallback (no route-history rows at all — the empty-transcon case).
    const fromFallback = UNITED_FALLBACK && !ctx.navan && !hasRouteRows && flights.length > 0;
    // Display-only summary line from the tracker; escaped, never interpreted.
    const note = !flights.length && data && data.note ? data.note : "";
    const typed = flights.some((f) => { const h = probMap.get(f.fn); return h && h.conf === "type"; });
    const rel = depsRelevant();
    // Footer confirmed-tails list: drop any entry whose exact fn/date the Guard
    // has since contradicted (no/withdrawn/invalid) — same precedence as the ✓.
    const deps = rel ? ((data && data.deps || []).filter((x) => {
      const v = guardFacts.get(x.fn + "|" + x.date) || "";
      return v !== "no" && v !== "early" && v !== "invalid";
    })).slice(0, 3) : [];
    const itin = (data && data.itins || []).find((it) => it.via && it.via.length && it.coverage === "full");
    // Four-state empty copy (Codex-approved, v2.2). The panel must not claim "no
    // history" when the direct-history call FAILED, and must not say "no route"
    // when it is really only "no DIRECT flight" with a connection available. A
    // missing directOk (pre-2.2 service worker) defaults to true. Alaska keeps
    // its own prose summary (note) unchanged.
    // data === null now means the fetch itself failed (messaging error / outage
    // that didn't even return a response), so it is NOT a proven absence — it's
    // "unavailable". A present response carries the real directOk.
    const directOk = data ? data.directOk !== false : false;
    // Bug 3: on Navan, while the page's flights are still being read/predicted
    // the panel shows a loading line — never the empty-history copy. navanLoading
    // is only ever set on Navan (see refresh()), so this is inert elsewhere.
    // v3.0: the empty-state prose row became the SAME structured decision
    // component with explicit system-state modifiers (spec §5). Precedence is
    // unchanged from the audited v2.2 four-state copy: loading while genuinely
    // pending; unavailable on a failed/unmeasured fetch (never a false absence);
    // genuine no-data otherwise, with the connection-estimate variant intact.
    const sys = flights.length ? null
      : navanLoading ? { state: "loading" }
      : navanUnavailable ? { state: "unavailable" }
      : note ? { state: "no-data", body: note }
      : !directOk ? { state: "unavailable" }
      : itin ? { state: "no-data", body: "No direct-flight Starlink history yet. Connection estimate below." }
      : { state: "no-data", body: "No direct-flight Starlink history for this route yet." };
    const legTag = ctx.phase === "return" ? " · return leg" : "";
    p.innerHTML =
      `<header><span class="usl-rt">🛰️ ${esc(ctx.o)} → ${esc(ctx.d)} · ${esc(fmtDate(ctx.date) || "WiFi odds")}${legTag}</span>` +
      `<span class="usl-rhs"><span class="usl-est" title="Historical Starlink tracker odds">ESTIMATES</span>` +
      `<button type="button" class="usl-refresh" aria-label="Refresh odds (bypass cache)" title="Refresh odds (bypass cache)">↻</button>` +
      `<button type="button" class="usl-x" aria-expanded="true" aria-label="Collapse panel" title="Collapse">▾</button></span></header>
      <div class="usl-body">` +
      decisionStrip(flights, sys) +
      // Mixed-carrier coverage boundary (spec §5): Navan lists several carriers
      // and only United is scored there, so the boundary states the coverage
      // honestly and persists across winner, refusal and system states. It
      // renders exactly once, below the strip and above the rows.
      (ctx.navan ? `<p class="usl-boundary">Coverage: United. Other airlines stay unscored and keep the booking site's order.</p>` : "") +
      // Sorted-state disclosure + real undo (Codex round 26). The label names
      // the metric explicitly — never "Best", "Smart sort" or "WiFi order" —
      // and the Undo control is a real keyboard-operable button that restores
      // the captured booking-site order. It renders only while rows are
      // actually moved by us, so it can never claim a sort that did not happen.
      (didAutoSort || prioritizeActive
        ? `<div class="usl-sorted" role="status">` +
          `<span class="usl-sorted__t">Sorted by historical next-gen odds</span>` +
          `<button type="button" class="usl-undo" aria-label="Keep the booking site's order and stop sorting">Keep site order</button>` +
          `</div>`
        : "") +
      // Next-gen first (Jeremy, 31 Jul): the ranked flight odds ARE the
      // next-gen number — the chance of drawing a Starlink / Amazon Leo
      // aircraft — and the section says so. Streaming-class (ConnectScore,
      // today's system quality) renders BELOW as its own labelled section.
      (flights.length ? `<p class="usl-sect">Next-gen odds · Starlink and Amazon Leo</p>` : "") +
      (flights.length
        ? flights.map((f, i) =>
            `<div class="usl-row usl-jump" data-fn="${esc(f.fn)}" role="button" tabindex="0" aria-label="Jump to ${esc(f.fn)} on the page">` +
            `<span>${f.fn === winFn ? "⭐ " : ""}${esc(f.fn)}${probMap.get(f.fn) && probMap.get(f.fn).dep && !guardContradicts(f.fn) ? " ✓" : ""}` +
            (isGuarded(f.fn) ? GUARD_MARK : "") +
            `<span class="usl-time" data-time="${esc(f.fn)}"></span>${obsSpan(f.fn)}</span>` +
            `<span class="usl-badge ${cls(f.prob)}">${f.prob}%</span></div>`).join("")
        : "") +
      (fromFallback && flights.length ? `<div style="margin-top:6px;font-size:11px;opacity:.7">Flights in these results · per-flight odds (no Starlink route history yet)</div>` : "") +
      // The carrier-framed action renders ONLY on mixed-carrier hosts. On
      // united.com every flight is United, so "Prioritize United flights" is a
      // meaningless promise there (Jeremy, 31 Jul) — the winner CTA carries the
      // flight-specific action instead.
      (flights.length && (NAVAN || ALASKA) ? `<button type="button" class="usl-sortbtn usl-prioritize" aria-pressed="${prioritizeActive ? "true" : "false"}" style="display:none">Prioritize United flights with available WiFi odds; unscored flights follow</button>` : "") +
      (itin ? `<div class="usl-row" style="border-top:1px solid rgba(148,178,255,.14);margin-top:6px;padding-top:8px">` +
        `<span>via ${esc(itin.via.join("+"))} · all-legs estimate</span><span class="usl-badge ${cls(Math.round(itin.joint))}">${Math.round(itin.joint)}%</span></div>` : "") +
      (deps.length ? `<div style="margin-top:8px;font-size:11px;opacity:.75">Confirmed tails (next ~72h): ` +
        deps.map((d) => `${esc(d.fn)} ${esc(d.date.slice(5))}`).join(" · ") + `</div>` :
        (ctx.date && daysOut(ctx.date) > 3 ? `<div style="margin-top:8px;font-size:11px;opacity:.6">Tail assignments publish ~48h out — firm ✓s appear closer to ${esc(fmtDate(ctx.date))}.</div>` : "")) +
      streamingRows() +
      `<div style="margin-top:10px;font-size:11.5px">` +
      (ALASKA
        ? `data: <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener" style="color:#8ecdff">alaskastarlinktracker.com ↗</a>`
        : `<a href="https://wifiodds.com/" target="_blank" rel="noopener" style="color:#8ecdff">wifiodds.com ↗</a>`) +
      (typed ? `<span style="opacity:.55"> · odds derived from aircraft type</span>` : "") +
      (rel ? `<span style="opacity:.55"> · ✓ = confirmed Starlink tail</span>` : "") + `</div>` +
      `</div>`;
    // Collapse control: a real <button> carrying aria-expanded. Clicking the
    // header title (not a button) also toggles, for mouse convenience.
    const collapseBtn = p.querySelector(".usl-x");
    const toggleCollapse = () => {
      const collapsed = p.classList.toggle("usl-collapsed");
      collapseBtn.setAttribute("aria-expanded", String(!collapsed));
      collapseBtn.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
      chrome.storage.local.set({ uslCollapsed: collapsed });
    };
    collapseBtn.addEventListener("click", (ev) => { ev.stopPropagation(); toggleCollapse(); });
    p.querySelector("header").addEventListener("click", (ev) => {
      if (ev.target.closest("button")) return;   // buttons handle themselves
      toggleCollapse();
    });
    // "Keep site order": a REAL undo. It restores the captured booking-site
    // order and persists the choice, so the page does not re-sort on the next
    // paint, reload, rerender or late score (Codex round 26, assertion 2).
    const undoBtn = p.querySelector(".usl-undo");
    if (undoBtn) undoBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      restoreHostOrder();
      prioritizeActive = false;
      if (SINGLE_HOST) { sortSingle = false; try { chrome.storage.local.set({ uslSortSingle: false }); } catch (e) {} }
      else { sortMixed = "preserve"; try { chrome.storage.local.set({ uslSortMixed: "preserve", uslPrioritize: false }); } catch (e) {} }
      renderPanel();
    });
    const refreshBtn = p.querySelector(".usl-refresh");
    refreshBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      refreshBtn.textContent = "…";
      data = await loadData(ctx, true);
      indexData();
      renderPanel();
      rebadge();
    });
    // Jump rows are keyboard-operable (role=button tabindex=0): Enter/Space jump,
    // exactly like a click; ghost rows (not on the page) neither jump nor focus.
    p.querySelectorAll(".usl-jump").forEach((row) => {
      const jump = () => { if (!row.classList.contains("usl-ghost")) gotoFlight(row.dataset.fn); };
      row.addEventListener("click", jump);
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); jump(); }
      });
    });
    // Bug 4 ruling: one explicit, keyboard-operable action. Off by default; the
    // page's cross-carrier order is untouched until the user presses it. When on,
    // it reorders only validated flight rows now and stays on (maybeResort reranks
    // as odds settle and re-corrects rerenders). Pressing again turns it off.
    const PRIORITIZE_LABEL = "Prioritize United flights with available WiFi odds; unscored flights follow";
    const pr = p.querySelector(".usl-prioritize");
    if (pr) {
      const applyState = () => {
        pr.setAttribute("aria-pressed", prioritizeActive ? "true" : "false");
        pr.classList.toggle("usl-prioritize-on", prioritizeActive);
        pr.textContent = prioritizeActive
          ? "✓ Prioritizing United flights — unscored follow (press to undo)"
          : PRIORITIZE_LABEL;
      };
      applyState();
      // A real <button> is keyboard-operable (Enter/Space) and focusable for free;
      // the focus ring lives in content.css (.usl-prioritize:focus-visible).
      pr.addEventListener("click", () => {
        if (!prioritizeActive) {
          // Turning ON: only claim an active prioritization if the sort can
          // actually run. sortPage() returns {ok:false} when there is no scored
          // United row in a findable results container — in that case stay OFF
          // and say so, never show "✓ Prioritizing" over a byte-identical page
          // (Round-19 finding: the button must not lie about what it did).
          lastSortTs = 0;
          const res = sortPage();
          if (!res || !res.ok) {
            prioritizeActive = false;
            try { chrome.storage.local.set({ uslPrioritize: false }); } catch (e) {}
            applyState();
            pr.textContent = "No scored United flight to prioritize in these results yet";
            pr.setAttribute("aria-pressed", "false");
            return;
          }
          prioritizeActive = true;
        } else {
          prioritizeActive = false;
        }
        try { chrome.storage.local.set({ uslPrioritize: prioritizeActive }); } catch (e) {}
        applyState();
      });
    }
    // v2.3: the decision strip's CTA REUSES the existing, audited Prioritize
    // action — it does not reimplement sorting. It simply forwards to the same
    // button, so all of that button's truthfulness guards (won't claim an active
    // prioritization over an unchanged page) apply unchanged.
    const stripCta = p.querySelector(".usl-strip-cta");
    if (stripCta) stripCta.addEventListener("click", () => {
      const fn = stripCta.dataset.fn || "";
      if (pr) {
        // Mixed-carrier host: forward to the audited carrier action and mirror
        // its TRUE state — its truthfulness guards (no claim over an unchanged
        // page) carry over to the CTA.
        pr.click();
        const on = pr.getAttribute("aria-pressed") === "true";
        stripCta.setAttribute("aria-pressed", on ? "true" : "false");
        stripCta.textContent = on ? "✓ " + fn + " prioritized" : "Prioritize " + fn;
        return;
      }
      // united.com: no carrier-framed button exists (everything is United), so
      // the CTA runs the SAME audited sortPage() directly, with the same
      // truthfulness rule: never claim an active prioritization when the page
      // could not actually be reordered.
      if (stripCta.getAttribute("aria-pressed") === "true") {
        prioritizeActive = false;
        try { chrome.storage.local.set({ uslPrioritize: false }); } catch (e) {}
        stripCta.setAttribute("aria-pressed", "false");
        stripCta.textContent = "Prioritize " + fn;
        return;
      }
      lastSortTs = 0;
      const res = sortPage();
      if (!res || !res.ok) {
        stripCta.setAttribute("aria-pressed", "false");
        stripCta.textContent = "Nothing to reorder in these results yet";
        return;
      }
      prioritizeActive = true;
      try { chrome.storage.local.set({ uslPrioritize: true }); } catch (e) {}
      stripCta.setAttribute("aria-pressed", "true");
      stripCta.textContent = "✓ " + fn + " prioritized";
    });
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
      // Ghost rows don't jump, so they leave the tab order and mark themselves
      // disabled to assistive tech; on-page rows are focusable button-rows.
      row.tabIndex = onPage ? 0 : -1;
      row.setAttribute("aria-disabled", onPage ? "false" : "true");
      row.title = onPage ? "Click to find this flight on the page" : "Not operating in these results (odds are route history)";
      const s = row.querySelector(".usl-time");
      if (s) s.textContent = onPage && r.times ? " · " + r.times.split(" – ")[0] : (onPage ? "" : " · not in results");
    });
  }
  function rebadge() {
    document.querySelectorAll("[data-usl-badged]").forEach((el) => {
      delete el.dataset.uslBadged;
      // Remove the whole three-layer group AND any standalone badge (na/unavail
      // rows inject a plain .usl-badge, scored rows inject a .usl-badge-grp).
      el.querySelectorAll(".usl-metrics, .usl-badge-grp, .usl-badge").forEach((b) => b.remove());
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

  // Bug 3: is any on-page United flight number still awaiting its FIRST resolved
  // prediction? A flight counts as resolved once probMap has it — numeric odds,
  // a genuine n/a (null), or a terminal "unavailable" all count. This, plus a
  // request in flight (pendingPredict), is the ONLY thing that keeps the Navan
  // panel in its loading line; a scheduled scan does not.
  function navanHasUnresolved() {
    for (const fn of navanUnitedFns) if (!probMap.has(fn)) return true;
    return false;
  }

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
      // the on-page flights and let the explicit Prioritize action reorder if on.
      const routeChanged = !ctx || c.o !== ctx.o || c.d !== ctx.d || c.phase !== ctx.phase;
      ctx = c; ctxKey = key;
      if (routeChanged) { desiredOrder = null; navanSig = ""; }
      scheduleScan();
      const flights = navanTopFlights();
      // Bug 3: do not render the panel at all until United flights are actually
      // on the page — an empty ranked list before any UA row has been read must
      // not surface as "no history". Once UA rows are present but predictions
      // are still in flight (or a scan is pending), show a loading line instead.
      if (!flights.length && !navanUnitedCount) {
        if (panelEl) { panelEl.remove(); panelEl = null; }
        navanSig = ""; navanLoading = false; navanUnavailable = false;
        return;
      }
      // Bug 3 fix: loading is true ONLY while a prediction is genuinely pending
      // for an on-page United row — a request in flight, or a United flight
      // number scan() saw that is not yet resolved in probMap (numeric, genuine
      // n/a, or terminal "unavailable" all count as resolved). scanScheduled — a
      // periodic/DOM flag that is ~always true on a churny Navan page — is NOT a
      // settlement signal and must never keep the panel loading.
      navanLoading = !flights.length && (pendingPredict.size > 0 || navanHasUnresolved());
      // Terminal-but-empty classification: every on-page United row has resolved
      // and none produced odds. If ANY of them terminally FAILED (repeated
      // tracker errors → "unavailable"), the honest summary is "unavailable right
      // now", never a proven absence — that flight could not be measured, so a
      // "no history" claim would be unsupported (mixed n/a + failure included).
      navanUnavailable = !navanLoading && !flights.length && navanUnitedFns.size > 0 &&
        [...navanUnitedFns].some((fn) => { const h = probMap.get(fn); return h && h.unavailable; });
      const sig = navanLoading ? "loading" : navanUnavailable ? " unavail" : flights.map((f) => f.fn + f.prob).join(",");
      if (!panelEl || !panelEl.isConnected || sig !== navanSig) { navanSig = sig; renderPanel(); }
      refreshPanelTimes();
      return;
    }
    // dataKey means "this context has already been fetched", so a route with no
    // usable answer isn't re-fetched every 2s. This now covers united.com too
    // (UNITED_FALLBACK): a legitimately empty route (SW returned ok:false, data
    // stays null) must NOT restart three tracker requests every tick. A route
    // change or the ↻ button re-fetches; the 2s loop no longer hammers.
    const emptyRoute = !(data && data.flights && data.flights.length);
    // A failed fetch is eligible to retry once its backoff window elapses. This
    // is the ONLY thing that re-fetches the same route; a success never does.
    const mayRetry = dataKey === key && dataFail && Date.now() >= dataNextTry;
    if (key === ctxKey && (data || ((ALASKA || UNITED_FALLBACK) && dataKey === key)) && !mayRetry) {
      if (!panelEl || !panelEl.isConnected) renderPanel();
      else if (ALASKA || UNITED_FALLBACK) {
        // Per-flight odds arrive after the route data, so re-render whenever the
        // ranked list changes — this is how a page-visible flight (via fallback)
        // gets folded into the United panel even when the route table omitted it.
        const list = ALASKA ? navanTopFlights() : mergedFlights();
        const sig = list.map((f) => f.fn + f.prob).join(",");
        if (sig !== navanSig) { navanSig = sig; renderPanel(); }
      }
      refreshPanelTimes();
      return;
    }
    const routeChanged = !ctx || c.o !== ctx.o || c.d !== ctx.d;
    ctx = c; ctxKey = key;
    desiredOrder = null;
    if (routeChanged) { data = null; dataFail = false; dataTries = 0; dataNextTry = 0; }
    if (dataKey !== key || mayRetry) {
      dataKey = key;                    // mark attempted BEFORE the await so 2s ticks short-circuit
      data = await loadData(c, false);
      // Classify: a null response (messaging/outage) or an explicit directOk:false
      // is a FAILURE that earns a backoff retry; anything else clears the backoff.
      const failed = !data || data.directOk === false;
      if (failed) {
        dataFail = true;
        dataNextTry = Date.now() + ROUTE_BACKOFFS[Math.min(dataTries, ROUTE_BACKOFFS.length - 1)];
        dataTries++;
      } else {
        dataFail = false; dataTries = 0; dataNextTry = 0;
      }
    }
    indexData();
    if (ALASKA || UNITED_FALLBACK) navanSig = (ALASKA ? navanTopFlights() : mergedFlights()).map((f) => f.fn + f.prob).join(",");
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
