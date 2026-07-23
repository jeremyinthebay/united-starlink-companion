/* United ✕ Starlink — content script for united.com  (v1.2.0)
 * - Badges + n/a pills on every flight row; full-page sort by odds.
 * - Round-trip aware: when United shows the RETURN leg, everything flips to the
 *   reverse route automatically.
 * - Date aware: ✓ marks and "confirmed tails" only shown when the searched date
 *   is within ~3 days (tail assignments publish ~48h out).
 * - Panel: jump-to-flight, ghost rows for non-operating flights, ↻ force
 *   refresh (busts the 6h cache), optional "keep sorted" that re-asserts the
 *   sort after United re-renders.
 * Selector-independent: keys on visible "UA ####" text. Data via service worker.
 */
(() => {
  "use strict";
  const FN_RE = /\bUA\s?(\d{2,4})\b/;
  const TIME_RE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/gi;
  let ctx = null;            // {o,d,date,phase} — the ACTIVE leg
  let ctxKey = "";
  let data = null, panelEl = null, scanScheduled = false;
  let probMap = new Map();
  let registry = new Map();
  let keepSorted = false, desiredOrder = null, lastSortTs = 0;
  let watched = new Set(); // "UA1812|2026-07-25"
  try { chrome.runtime.sendMessage({ type: "tripList" }, (res) => {
    if (!chrome.runtime.lastError && res && res.trips)
      watched = new Set(res.trips.map((t) => t.fn + "|" + t.date));
  }); } catch {}
  try { chrome.storage.local.get("uslKeepSorted", (v) => { keepSorted = !!v.uslKeepSorted; }); } catch {}

  /* ── context: route + leg phase + date ── */
  function getContext() {
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
  const depsRelevant = () => ctx && daysOut(ctx.date) <= 3;

  function loadData(r, force) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "routeData", o: r.o, d: r.d, force: !!force }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return resolve(null);
          resolve(resp);
        });
      } catch { resolve(null); }
    });
  }
  function indexData() {
    probMap = new Map();
    if (!data) return;
    const rel = depsRelevant();
    for (const f of data.flights || []) {
      probMap.set(f.fn, { prob: f.prob, obs: f.obs,
        dep: rel ? (data.deps || []).find((x) => x.fn === f.fn) || null : null });
    }
  }
  const cls = (p) => (p >= 50 ? "usl-hi" : p >= 35 ? "usl-mid" : p >= 20 ? "usl-low" : "usl-no");

  function findRow(el) {
    let e = el;
    for (let i = 0; i < 8 && e && e !== document.body; i++, e = e.parentElement) {
      const txt = e.textContent || "";
      const times = txt.match(TIME_RE);
      if (times && times.length) return { rowEl: e, times: times.slice(0, 2).join(" – ") };
    }
    return null;
  }

  /* ── badge injection ── */
  function scan() {
    scanScheduled = false;
    if (!data) return;
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
    for (const n of targets) {
      const el = n.parentElement;
      if (!el) continue;
      const m = n.nodeValue.match(FN_RE);
      const fn = "UA" + m[1];
      const hit = probMap.get(fn);
      const row = findRow(el);
      if (!el.dataset.uslBadged) {
        const dup = row && row.rowEl.querySelector('.usl-badge[data-b="' + fn + '"]');
        if (dup) {
          el.dataset.uslBadged = "dup";
        } else if (hit) {
          el.dataset.uslBadged = "1";
          const b = document.createElement("span");
          b.className = "usl-badge " + cls(hit.prob);
          b.textContent = "🛰️ " + hit.prob + "%" + (hit.dep ? " ✓" : "");
          b.title = `${fn}: gets a Starlink-equipped plane ~${hit.prob}% of the time (${hit.obs} recent departures)` +
            (hit.dep ? ` — CONFIRMED Starlink tail ${hit.dep.tail} on ${hit.dep.date}` : "") +
            " · data: unitedstarlinktracker.com";
          b.dataset.b = fn;
          el.appendChild(b);
          if (row) addWatchStar(el, fn);
        } else if (row) {
          el.dataset.uslBadged = "na";
          const b = document.createElement("span");
          b.className = "usl-badge usl-na";
          b.textContent = "🛰️ n/a";
          b.title = fn + ": no Starlink-assignment history for this flight number yet · data: unitedstarlinktracker.com";
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
    const key = fn + "|" + ctx.date;
    const on = watched.has(key);
    w.className = "usl-watch" + (on ? " usl-watching" : "");
    w.textContent = on ? "★" : "☆";
    w.title = on ? "Watching — manage in the extension popup"
      : "Watch " + fn + " on " + ctx.date + " — get an alert when its Starlink tail is confirmed (or not)";
    w.addEventListener("click", (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (watched.has(key)) return;
      watched.add(key);
      w.textContent = "★"; w.classList.add("usl-watching");
      w.title = "Watching — manage in the extension popup";
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
    for (let i = 0; i < 14 && e && e !== document.body; i++, e = e.parentElement) {
      const fns = [...e.children]
        .map((k) => ((k.textContent || "").match(FN_RE) || [])[1]).filter(Boolean);
      const distinct = new Set(fns).size;
      if (distinct > bestScore) { bestScore = distinct; best = e; }
    }
    return bestScore >= 2 ? best : null;
  }
  function currentOrder(P) {
    return [...P.children].map((k) => ((k.textContent || "").match(FN_RE) || [])[1])
      .filter(Boolean).map((n) => "UA" + n);
  }
  function sortPage() {
    const P = findContainer();
    if (!P) return { ok: false, why: "results container not found" };
    const flightUnits = [...P.children].filter((k) => FN_RE.test(k.textContent || ""));
    if (flightUnits.length < 2) return { ok: false, why: "fewer than 2 flight rows" };
    const key = (u) => {
      const m = (u.textContent || "").match(FN_RE);
      const hit = m ? probMap.get("UA" + m[1]) : null;
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
    if (!keepSorted || !desiredOrder || Date.now() - lastSortTs < 1500) return;
    const P = findContainer();
    if (!P) return;
    const now = currentOrder(P);
    if (now.join(",") !== desiredOrder.join(",")) sortPage();
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
  }
  function renderPanel() {
    if (panelEl) panelEl.remove();
    panelEl = null;
    if (!ctx) return;
    const p = document.createElement("div");
    p.className = "usl-panel";
    chrome.storage.local.get("uslCollapsed", (v) => { if (v.uslCollapsed) p.classList.add("usl-collapsed"); });
    const flights = (data && data.flights || []).slice(0, 6);
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
        : `<div class="usl-row">No Starlink history on this route yet.</div>`) +
      (flights.length ? `<button class="usl-sortbtn" style="display:none">⇅ Sort page by Starlink odds</button>
        <label class="usl-keep-wrap" style="display:none;font-size:11.5px;color:#93a1c0;margin-top:6px;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" class="usl-keep"> keep sorted when the page updates</label>` : "") +
      (itin ? `<div class="usl-row" style="border-top:1px solid rgba(148,178,255,.14);margin-top:6px;padding-top:8px">` +
        `<span>via ${esc(itin.via.join("+"))} (connection)</span><span class="usl-badge usl-mid">${Math.round(itin.joint)}%</span></div>` : "") +
      (deps.length ? `<div style="margin-top:8px;font-size:11px;opacity:.75">Confirmed tails (next ~72h): ` +
        deps.map((d) => `${esc(d.fn)} ${esc(d.date.slice(5))}`).join(" · ") + `</div>` :
        (ctx.date && daysOut(ctx.date) > 3 ? `<div style="margin-top:8px;font-size:11px;opacity:.6">Tail assignments publish ~48h out — firm ✓s appear closer to ${esc(fmtDate(ctx.date))}.</div>` : "")) +
      `<div style="margin-top:10px;font-size:11.5px"><a href="https://smithfamai.com/unitedstarlink/" target="_blank" rel="noopener" style="color:#8ecdff">full plan ↗</a>` +
      ` · <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener" style="color:#8ecdff">tracker ↗</a>` +
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
      if (msg.type === "pageContext") { sendResponse(ctx || {}); return false; }
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
    if (key === ctxKey && data) {
      if (!panelEl || !panelEl.isConnected) renderPanel();
      refreshPanelTimes();
      return;
    }
    const routeChanged = !ctx || c.o !== ctx.o || c.d !== ctx.d;
    ctx = c; ctxKey = key;
    desiredOrder = null;
    if (routeChanged || !data) data = await loadData(c, false);
    indexData();
    renderPanel();
    rebadge();
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(refresh, 2000);
  refresh();
})();
