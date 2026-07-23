/* United ✕ Starlink — content script for united.com
 * Injects Starlink-odds badges next to flight numbers in search results and
 * shows a floating route summary panel. Selector-independent by design:
 * united.com ships hashed CSS classes, so we key on visible "UA ####" text
 * (TreeWalker) and re-scan on DOM mutations. Route comes from URL params.
 * Data: unitedstarlinktracker.com via the extension service worker (6h cache).
 */
(() => {
  "use strict";
  const FN_RE = /\bUA\s?(\d{2,4})\b/;
  let route = null;        // {o, d}
  let data = null;         // {flights, deps, itins}
  let probMap = new Map(); // "UA1812" -> {prob, obs, dep(confirmed)|null}
  let panelEl = null;
  let scanScheduled = false;

  /* ── route detection from URL ── */
  function detectRoute() {
    try {
      const p = new URLSearchParams(location.search);
      const o = (p.get("f") || p.get("origin") || "").toUpperCase();
      const d = (p.get("t") || p.get("destination") || "").toUpperCase();
      if (/^[A-Z]{3}$/.test(o) && /^[A-Z]{3}$/.test(d) && o !== d) return { o, d };
    } catch {}
    return null;
  }

  /* ── data via service worker ── */
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
    for (const n of targets) {
      const el = n.parentElement;
      if (!el || el.dataset.uslBadged) continue;
      const m = n.nodeValue.match(FN_RE);
      const fn = "UA" + m[1];
      const hit = probMap.get(fn);
      if (!hit) { el.dataset.uslBadged = "miss"; continue; }
      el.dataset.uslBadged = "1";
      const b = document.createElement("span");
      b.className = "usl-badge " + cls(hit.prob);
      b.textContent = "🛰️ " + hit.prob + "%" + (hit.dep ? " ✓" : "");
      b.title = `${fn}: gets a Starlink-equipped plane ~${hit.prob}% of the time (${hit.obs} recent departures)` +
        (hit.dep ? ` — CONFIRMED Starlink tail ${hit.dep.tail} on ${hit.dep.date}` : "") +
        " · data: unitedstarlinktracker.com";
      el.appendChild(b);
    }
  }
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(scan, 700);
  }

  /* ── floating panel ── */
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function renderPanel() {
    if (panelEl) panelEl.remove();
    if (!route) return;
    const p = document.createElement("div");
    p.className = "usl-panel";
    chrome.storage.local.get("uslCollapsed", (v) => { if (v.uslCollapsed) p.classList.add("usl-collapsed"); });
    const flights = (data && data.flights || []).slice(0, 6);
    const deps = (data && data.deps || []).slice(0, 3);
    const itin = (data && data.itins || []).find((it) => it.via && it.via.length && it.coverage === "full");
    const site = "https://smithfamai.com/unitedstarlink/";
    p.innerHTML =
      `<header><span>🛰️ Starlink odds · ${esc(route.o)}→${esc(route.d)}</span><span class="usl-x">▾</span></header>
      <div class="usl-body">` +
      (flights.length
        ? flights.map((f, i) =>
            `<div class="usl-row"><span>${i === 0 ? "⭐ " : ""}${esc(f.fn)}${probMap.get(f.fn) && probMap.get(f.fn).dep ? " ✓" : ""}</span>` +
            `<span class="usl-badge ${cls(f.prob)}">${f.prob}%</span></div>`).join("")
        : `<div class="usl-row">No Starlink history on this route yet.</div>`) +
      (itin ? `<div class="usl-row" style="border-top:1px solid rgba(148,178,255,.14);margin-top:6px;padding-top:8px">` +
        `<span>via ${esc(itin.via.join("+"))} (connection)</span><span class="usl-badge usl-mid">${Math.round(itin.joint)}%</span></div>` : "") +
      (deps.length ? `<div style="margin-top:8px;font-size:11px;opacity:.75">Confirmed tails: ` +
        deps.map((d) => `${esc(d.fn)} ${esc(d.date.slice(5))}`).join(" · ") + `</div>` : "") +
      `<div style="margin-top:10px;font-size:11.5px"><a href="${site}" target="_blank" rel="noopener" style="color:#8ecdff">full plan ↗</a>` +
      ` · <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener" style="color:#8ecdff">tracker ↗</a>` +
      `<span style="opacity:.55"> · ✓ = confirmed Starlink tail · odds from tail-assignment history</span></div>` +
      `</div>`;
    p.querySelector("header").addEventListener("click", () => {
      p.classList.toggle("usl-collapsed");
      chrome.storage.local.set({ uslCollapsed: p.classList.contains("usl-collapsed") });
    });
    document.documentElement.appendChild(p);
    panelEl = p;
  }

  /* ── orchestration ── */
  async function refresh() {
    const r = detectRoute();
    if (!r) { if (panelEl) { panelEl.remove(); panelEl = null; } route = null; return; }
    if (route && r.o === route.o && r.d === route.d && data) return;
    route = r;
    data = await loadData(r);
    indexData();
    renderPanel();
    // clear badge markers so new route re-badges
    document.querySelectorAll("[data-usl-badged]").forEach((el) => {
      delete el.dataset.uslBadged;
      el.querySelectorAll(".usl-badge").forEach((b) => b.remove());
    });
    scheduleScan();
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(refresh, 2000); // SPA URL changes (pushState) — cheap poll
  refresh();
})();
