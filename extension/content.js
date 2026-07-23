/* United ✕ Starlink — content script for united.com  (v1.1)
 * - Badges: Starlink-odds pill next to every flight number in results.
 * - Registry: captures each flight's row element + departure times from the page.
 * - Panel: floating route summary; rows click-to-scroll; "Sort page by odds" button.
 * - Popup bridge: answers {flightsOnPage} and {gotoFlight} messages.
 * Selector-independent: keys on visible "UA ####" text (united.com ships hashed
 * CSS classes). Route comes from URL params. Data via service worker (6h cache).
 */
(() => {
  "use strict";
  const FN_RE = /\bUA\s?(\d{2,4})\b/;
  const TIME_RE = /\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/gi;
  let route = null, data = null, panelEl = null, scanScheduled = false;
  let probMap = new Map();   // "UA1812" -> {prob, obs, dep|null}
  let registry = new Map();  // "UA1812" -> {rowEl, times}

  function detectRoute() {
    try {
      const p = new URLSearchParams(location.search);
      const o = (p.get("f") || p.get("origin") || "").toUpperCase();
      const d = (p.get("t") || p.get("destination") || "").toUpperCase();
      if (/^[A-Z]{3}$/.test(o) && /^[A-Z]{3}$/.test(d) && o !== d) return { o, d };
    } catch {}
    return null;
  }

  function loadData(r) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "routeData", o: r.o, d: r.d }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return resolve(null);
          resolve(resp);
        });
      } catch { resolve(null); }
    });
  }

  function indexData() {
    probMap = new Map();
    if (!data) return;
    for (const f of data.flights || []) {
      probMap.set(f.fn, { prob: f.prob, obs: f.obs,
        dep: (data.deps || []).find((x) => x.fn === f.fn) || null });
    }
  }

  const cls = (p) => (p >= 50 ? "usl-hi" : p >= 35 ? "usl-mid" : p >= 20 ? "usl-low" : "usl-no");

  /* Climb from the badged element to the smallest ancestor whose text includes
   * departure times — that's our "row". Capture the first two times. */
  function findRow(el) {
    let e = el;
    for (let i = 0; i < 8 && e && e !== document.body; i++, e = e.parentElement) {
      const txt = e.textContent || "";
      const times = txt.match(TIME_RE);
      if (times && times.length) return { rowEl: e, times: times.slice(0, 2).join(" – ") };
    }
    return { rowEl: el, times: "" };
  }

  /* ── badge injection ── */
  function scan() {
    scanScheduled = false;
    if (!probMap.size) return;
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
      if (!el.dataset.uslBadged) {
        el.dataset.uslBadged = hit ? "1" : "miss";
        if (hit) {
          const b = document.createElement("span");
          b.className = "usl-badge " + cls(hit.prob);
          b.textContent = "🛰️ " + hit.prob + "%" + (hit.dep ? " ✓" : "");
          b.title = `${fn}: gets a Starlink-equipped plane ~${hit.prob}% of the time (${hit.obs} recent departures)` +
            (hit.dep ? ` — CONFIRMED Starlink tail ${hit.dep.tail} on ${hit.dep.date}` : "") +
            " · data: unitedstarlinktracker.com";
          el.appendChild(b);
        }
      }
      if (hit && (!registry.has(fn) || !registry.get(fn).rowEl.isConnected)) {
        registry.set(fn, findRow(el));
        registered = true;
      }
    }
    if (registered) updatePanelSortBtn();
  }
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, 700);
  }

  /* ── jump to a flight on the page ── */
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

  /* ── sort the actual results list by odds ── */
  function sortPage() {
    const rows = [...registry.entries()]
      .filter(([, r]) => r.rowEl.isConnected)
      .map(([fn, r]) => ({ fn, prob: (probMap.get(fn) || { prob: 0 }).prob, el: r.rowEl }));
    if (rows.length < 2) return { ok: false, why: "fewer than 2 known flights on page" };
    let P = rows[0].el;
    while (P && !rows.every((r) => P.contains(r.el))) P = P.parentElement;
    if (!P || P === document.body) return { ok: false, why: "no common container" };
    const unitOf = (el) => { let e = el; while (e.parentElement !== P) e = e.parentElement; return e; };
    const seen = new Set();
    const sorted = rows.sort((a, b) => b.prob - a.prob)
      .map((r) => unitOf(r.el))
      .filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
    if (sorted.length < 2) return { ok: false, why: "rows share one container" };
    const domOrder = [...P.children].filter((c) => seen.has(c));
    const anchor = document.createComment("usl-anchor");
    P.insertBefore(anchor, domOrder[0]);
    for (const u of sorted) P.insertBefore(u, anchor);
    anchor.remove();
    return { ok: true, count: sorted.length };
  }

  /* ── floating panel ── */
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function updatePanelSortBtn() {
    const btn = panelEl && panelEl.querySelector(".usl-sortbtn");
    if (!btn) return;
    const n = [...registry.values()].filter((r) => r.rowEl.isConnected).length;
    btn.style.display = n >= 2 ? "" : "none";
  }
  function renderPanel() {
    if (panelEl) panelEl.remove();
    if (!route) return;
    const p = document.createElement("div");
    p.className = "usl-panel";
    chrome.storage.local.get("uslCollapsed", (v) => { if (v.uslCollapsed) p.classList.add("usl-collapsed"); });
    const flights = (data && data.flights || []).slice(0, 6);
    const deps = (data && data.deps || []).slice(0, 3);
    const itin = (data && data.itins || []).find((it) => it.via && it.via.length && it.coverage === "full");
    p.innerHTML =
      `<header><span>🛰️ Starlink odds · ${esc(route.o)}→${esc(route.d)}</span><span class="usl-x">▾</span></header>
      <div class="usl-body">` +
      (flights.length
        ? flights.map((f, i) =>
            `<div class="usl-row usl-jump" data-fn="${esc(f.fn)}" title="Click to find this flight on the page">` +
            `<span>${i === 0 ? "⭐ " : ""}${esc(f.fn)}${probMap.get(f.fn) && probMap.get(f.fn).dep ? " ✓" : ""}<span class="usl-time" data-time="${esc(f.fn)}"></span></span>` +
            `<span class="usl-badge ${cls(f.prob)}">${f.prob}%</span></div>`).join("")
        : `<div class="usl-row">No Starlink history on this route yet.</div>`) +
      (flights.length ? `<button class="usl-sortbtn" style="display:none">⇅ Sort page by Starlink odds</button>` : "") +
      (itin ? `<div class="usl-row" style="border-top:1px solid rgba(148,178,255,.14);margin-top:6px;padding-top:8px">` +
        `<span>via ${esc(itin.via.join("+"))} (connection)</span><span class="usl-badge usl-mid">${Math.round(itin.joint)}%</span></div>` : "") +
      (deps.length ? `<div style="margin-top:8px;font-size:11px;opacity:.75">Confirmed tails: ` +
        deps.map((d) => `${esc(d.fn)} ${esc(d.date.slice(5))}`).join(" · ") + `</div>` : "") +
      `<div style="margin-top:10px;font-size:11.5px"><a href="https://smithfamai.com/unitedstarlink/" target="_blank" rel="noopener" style="color:#8ecdff">full plan ↗</a>` +
      ` · <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener" style="color:#8ecdff">tracker ↗</a>` +
      `<span style="opacity:.55"> · ✓ = confirmed Starlink tail</span></div>` +
      `</div>`;
    p.querySelector("header").addEventListener("click", () => {
      p.classList.toggle("usl-collapsed");
      chrome.storage.local.set({ uslCollapsed: p.classList.contains("usl-collapsed") });
    });
    p.querySelectorAll(".usl-jump").forEach((row) => row.addEventListener("click", () => {
      gotoFlight(row.dataset.fn);
      refreshPanelTimes();
    }));
    const sb = p.querySelector(".usl-sortbtn");
    if (sb) sb.addEventListener("click", () => {
      const r = sortPage();
      sb.textContent = r.ok ? `✓ sorted ${r.count} flights by odds` : `couldn't sort (${r.why})`;
      setTimeout(() => { sb.textContent = "⇅ Sort page by Starlink odds"; }, 3000);
    });
    document.documentElement.appendChild(p);
    panelEl = p;
    refreshPanelTimes();
    updatePanelSortBtn();
  }
  function refreshPanelTimes() {
    if (!panelEl) return;
    panelEl.querySelectorAll(".usl-time").forEach((s) => {
      const r = registry.get(s.dataset.time);
      s.textContent = r && r.times ? " · " + r.times.split(" – ")[0] : "";
    });
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
      if (msg.type === "gotoFlight") { sendResponse({ ok: gotoFlight(msg.fn) }); return false; }
      if (msg.type === "sortPage") { sendResponse(sortPage()); return false; }
      return false;
    });
  } catch {}

  /* ── orchestration ── */
  async function refresh() {
    const r = detectRoute();
    if (!r) { if (panelEl) { panelEl.remove(); panelEl = null; } route = null; return; }
    if (route && r.o === route.o && r.d === route.d && data) { refreshPanelTimes(); return; }
    route = r;
    registry = new Map();
    data = await loadData(r);
    indexData();
    renderPanel();
    document.querySelectorAll("[data-usl-badged]").forEach((el) => {
      delete el.dataset.uslBadged;
      el.querySelectorAll(".usl-badge").forEach((b) => b.remove());
    });
    scheduleScan();
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(refresh, 2000);
  refresh();
})();
