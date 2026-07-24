/* Starlink odds — content script for united.com / Navan / alaskaair.com (v1.6)
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
  const AIRLINE = ALASKA ? "AS" : "UA";
  const TRACKER = ALASKA ? "alaskastarlinktracker.com" : "unitedstarlinktracker.com";
  // The trailing lookahead keeps "Alaska 737-900" (an aircraft type) from being
  // read as flight AS737.
  const FN_RE = ALASKA
    ? /\b(?:AS|Alaska)\s?(\d{1,4})\b(?!\s?-\s?\d)/
    : /\b(?:UA|United)\s?(\d{2,4})\b/;
  // Odds fetched per-flight (rather than from a route table) on sites where the
  // tracker has no per-route flight list.
  const PAGE_PREDICT = NAVAN || ALASKA;
  const TIME_RE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/gi;
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
  const DEFAULT_SEL = {
    navanRoute: ".flight-header__route",
    alaskaRoute: "[data-testid='search-summary'], .search-summary, .fare-header__route",
    rowDepth: 8,
    containerDepth: 20,
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
    const key = fn + "|" + ctx.date;
    const on = watched.has(key);
    w.className = "usl-watch" + (on ? " usl-watching" : "");
    w.textContent = on ? "★" : "☆";
    w.title = on ? "Guarded — manage in the extension popup"
      : "Guard " + fn + " on " + ctx.date + " — alerts from booking to boarding if its Starlink tail changes.";
    w.addEventListener("click", (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (watched.has(key)) return;
      watched.add(key);
      w.textContent = "★"; w.classList.add("usl-watching");
      w.title = "Guarded — manage in the extension popup";
      try { chrome.runtime.sendMessage({ type: "tripAdd", fn, date: ctx.date, route: ctx.o + "-" + ctx.d }, () => { void chrome.runtime.lastError; }); } catch {}
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
            `<span>${i === 0 ? "⭐ " : ""}${esc(f.fn)}${probMap.get(f.fn) && probMap.get(f.fn).dep ? " ✓" : ""}<span class="usl-time" data-time="${esc(f.fn)}"></span></span>` +
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
        : `<a href="https://smithfamai.com/unitedstarlink/" target="_blank" rel="noopener" style="color:#8ecdff">full plan ↗</a>` +
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
