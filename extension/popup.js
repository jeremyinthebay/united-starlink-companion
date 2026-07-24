// popup.js — United x Starlink Odds popup logic (no inline scripts, MV3 CSP safe)
// v1.1: flights are sorted by odds, show departure times found on the page, and
// clicking a row scrolls the united.com tab to that flight.

var fromEl = document.getElementById("usl-from");
var toEl = document.getElementById("usl-to");
var formEl = document.getElementById("usl-form");
var goEl = document.getElementById("usl-go");
var statusEl = document.getElementById("usl-status");
var resultsEl = document.getElementById("usl-results");
var airlineEl = document.getElementById("usl-airline");
var creditEl = document.getElementById("usl-credit");

var activeTab = null;      // active browser tab (if united.com/alaskaair.com with a route)
var tabRoute = null;       // {o,d} parsed from that tab
var pageFlights = {};      // fn -> times string, as found on the page
var lastData = null, lastO = null, lastD = null;

/* ── per-airline routing (1.6) ── */
var TRACKER_HOST = { UA: "unitedstarlinktracker.com", AS: "alaskastarlinktracker.com" };
var ALASKA_ORIGINS = ["https://www.alaskaair.com/*", "https://alaskaair.com/*"];

function airline() {
  var v = airlineEl && airlineEl.value ? airlineEl.value.toUpperCase() : "UA";
  return TRACKER_HOST[v] ? v : "UA";
}
function setAirline(a) {
  a = TRACKER_HOST[String(a || "").toUpperCase()] ? String(a).toUpperCase() : "UA";
  if (airlineEl) airlineEl.value = a;
  updateCredit();
  return a;
}
function updateCredit() {
  if (creditEl) creditEl.textContent = "data: " + TRACKER_HOST[airline()];
}

function pctClass(p) {
  if (p >= 50) return "usl-pct-hi";
  if (p >= 35) return "usl-pct-mid";
  if (p >= 20) return "usl-pct-low";
  return "usl-pct-no";
}

function el(tag, className, text) {
  var e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function clearResults() { resultsEl.innerHTML = ""; }
function setStatus(text) { statusEl.textContent = text || ""; }

function sameRoute(o, d) {
  return tabRoute && tabRoute.o === o && tabRoute.d === d;
}

function jumpTo(fn) {
  if (!activeTab) return;
  chrome.tabs.sendMessage(activeTab.id, { type: "gotoFlight", fn: fn }, function () {
    void chrome.runtime.lastError;
    window.close();
  });
}

function renderFlights(flights, o, d) {
  var top = flights.slice(0, 8);
  if (!top.length) return null;
  var onPage = sameRoute(o, d) && Object.keys(pageFlights).length > 0;
  var wrap = el("div", null);
  wrap.appendChild(el("div", "usl-section-label",
    onPage ? "Flights — highest odds first · click to jump to it on the page" : "Flights — highest odds first"));
  top.forEach(function (f, i) {
    var row = el("div", "usl-flight-row");
    var left = el("div", "usl-flight-left");
    if (i === 0) left.appendChild(el("span", "usl-star", "⭐"));
    left.appendChild(el("span", null, f.fn));
    var times = pageFlights[f.fn];
    if (times) left.appendChild(el("span", "usl-time", times));
    var right = el("div", "usl-flight-right");
    right.appendChild(el("span", "usl-pct " + pctClass(f.prob), f.prob + "%"));
    right.appendChild(el("span", "usl-obs", f.obs + " obs"));
    row.appendChild(left);
    row.appendChild(right);
    if (times !== undefined && onPage) {
      row.classList.add("usl-clickable");
      row.title = "Scroll the booking tab to " + f.fn;
      row.addEventListener("click", function () { jumpTo(f.fn); });
    } else if (onPage) {
      row.classList.add("usl-ghost");
      row.title = "Not operating in these results (odds are route history)";
      left.appendChild(el("span", "usl-time", "not in these results"));
    }
    wrap.appendChild(row);
  });
  return wrap;
}

function renderItins(itins) {
  var top = itins.slice(0, 3);
  if (!top.length) return null;
  var wrap = el("div", null);
  wrap.appendChild(el("div", "usl-section-label", "Best itineraries"));
  top.forEach(function (it) {
    var path = (it.via && it.via.length ? it.via : []).join(" → ");
    var text = path
      ? path + " · " + it.joint + "% · " + it.hours + "h"
      : it.joint + "% · " + it.hours + "h";
    wrap.appendChild(el("div", "usl-itin-row", text));
  });
  return wrap;
}

function renderDeps(deps) {
  var top = deps.slice(0, 4);
  if (!top.length) return null;
  var wrap = el("div", null);
  wrap.appendChild(el("div", "usl-section-label", "Confirmed departures (next ~72h)"));
  top.forEach(function (d) {
    var text = d.fn + " · " + d.date + " " + d.time + "Z · " + d.tail;
    wrap.appendChild(el("div", "usl-dep-row", text));
  });
  return wrap;
}

function renderEmpty(o, d) {
  var wrap = el("div", "usl-empty");
  wrap.appendChild(document.createTextNode("No Starlink history yet for this route. Try the "));
  var link = el("a", null, "full route planner");
  link.href = airline() === "AS"
    ? "https://alaskastarlinktracker.com/"
    : "https://unitedstarlinktracker.com/route-planner/" + o + "/" + d;
  link.target = "_blank";
  link.rel = "noopener";
  wrap.appendChild(link);
  wrap.appendChild(document.createTextNode("."));
  return wrap;
}

// Alaska's route tool answers with a prose summary instead of a flight table.
function renderNote(note) {
  if (!note) return null;
  var wrap = el("div", "usl-empty", note);
  wrap.appendChild(document.createTextNode(" · data: " + TRACKER_HOST[airline()]));
  return wrap;
}

function renderResults(o, d, data) {
  clearResults();
  var any = false;
  var flightsBlock = renderFlights(data.flights || [], o, d);
  if (flightsBlock) { resultsEl.appendChild(flightsBlock); any = true; }
  var itinsBlock = renderItins(data.itins || []);
  if (itinsBlock) { resultsEl.appendChild(itinsBlock); any = true; }
  var depsBlock = renderDeps(data.deps || []);
  if (depsBlock) { resultsEl.appendChild(depsBlock); any = true; }
  var noteBlock = renderNote(data.note);
  if (noteBlock) { resultsEl.appendChild(noteBlock); any = true; }
  if (!any) resultsEl.appendChild(renderEmpty(o, d));
}

function loadPageFlights(o, d) {
  if (!activeTab || !sameRoute(o, d)) return;
  chrome.tabs.sendMessage(activeTab.id, { type: "flightsOnPage" }, function (resp) {
    if (chrome.runtime.lastError || !resp || !resp.flights) return;
    pageFlights = {};
    resp.flights.forEach(function (f) { pageFlights[f.fn] = f.times || ""; });
    if (lastData) renderResults(lastO, lastD, lastData); // re-render with times + clickability
  });
}

function loadRoute(o, d) {
  o = (o || "").toUpperCase().trim();
  d = (d || "").toUpperCase().trim();
  if (o.length !== 3 || d.length !== 3) {
    setStatus("Enter two 3-letter airport codes.");
    return;
  }
  fromEl.value = o;
  toEl.value = d;
  goEl.disabled = true;
  updateCredit();
  setStatus("Loading " + airline() + " " + o + " → " + d + "…");
  clearResults();

  chrome.runtime.sendMessage({ type: "routeData", o: o, d: d, airline: airline() }, function (res) {
    goEl.disabled = false;
    if (chrome.runtime.lastError || !res) {
      setStatus("Could not reach the extension background page.");
      return;
    }
    lastData = res; lastO = o; lastD = d;
    if (!res.ok) {
      setStatus(res.error ? "Error: " + res.error : "No data available yet.");
      renderResults(o, d, res);
      return;
    }
    setStatus(res.cached ? "Cached result" : "Fresh result");
    renderResults(o, d, res);
    loadPageFlights(o, d);
  });
}

// Route + airline from the active tab's URL. united.com and alaskaair.com both
// carry the O/D pair in the query string (under different param names).
function parseTabUrl(url) {
  try {
    var u = new URL(url);
    var params = u.searchParams;
    var o, d;
    if (/(^|\.)united\.com$/.test(u.hostname)) {
      o = params.get("f") || params.get("origin") || params.get("Origin");
      d = params.get("t") || params.get("destination") || params.get("Destination");
      if (o && d) return { o: o.toUpperCase(), d: d.toUpperCase(), airline: "UA" };
      return null;
    }
    if (/(^|\.)alaskaair\.com$/.test(u.hostname)) {
      o = params.get("O") || params.get("o") || params.get("origin") || params.get("from");
      d = params.get("D") || params.get("d") || params.get("destination") || params.get("to");
      // Still worth flagging the tab as Alaska even with no parsable route: the
      // content script may know the route from the page itself.
      if (o && d) return { o: o.toUpperCase(), d: d.toUpperCase(), airline: "AS" };
      return { o: null, d: null, airline: "AS" };
    }
    return null;
  } catch (e) {
    return null;
  }
}

fromEl.addEventListener("input", function () {
  fromEl.value = fromEl.value.toUpperCase().replace(/[^A-Z]/g, "");
});
toEl.addEventListener("input", function () {
  toEl.value = toEl.value.toUpperCase().replace(/[^A-Z]/g, "");
});

formEl.addEventListener("submit", function (e) {
  e.preventDefault();
  loadRoute(fromEl.value, toEl.value);
});

function init() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    var urlRoute = tab && tab.url ? parseTabUrl(tab.url) : null;
    syncEnableButton(tab);
    if (!urlRoute) {
      setStatus("Enter a route to check Starlink odds.");
      return;
    }
    activeTab = tab;
    setAirline(urlRoute.airline);
    // Ask the content script which leg is actually being shown (round trips:
    // the URL still says outbound while the RETURN list is on screen).
    chrome.tabs.sendMessage(tab.id, { type: "pageContext" }, function (pc) {
      void chrome.runtime.lastError;
      if (pc && pc.airline) setAirline(pc.airline);
      var route = pc && pc.o && pc.d ? { o: pc.o, d: pc.d } : urlRoute;
      if (!route.o || !route.d) {
        setStatus("Enter a route to check Starlink odds.");
        return;
      }
      tabRoute = { o: route.o, d: route.d };
      loadRoute(route.o, route.d);
    });
  });
}

/* ── optional alaskaair.com permission ─────────────────────────────────────
 * chrome.permissions.request() only works from a user gesture, so it lives on
 * a popup button. Granting fires permissions.onAdded in the service worker,
 * which registers content.js on alaskaair.com (syncDynamicScripts). */
var enableBtn = document.getElementById("usl-enable-alaska");

function syncEnableButton(tab) {
  if (!enableBtn || !chrome.permissions) return;
  var onAlaska = !!(tab && tab.url && /^https:\/\/(www\.)?alaskaair\.com\//.test(tab.url));
  chrome.permissions.contains({ origins: ALASKA_ORIGINS }, function (granted) {
    void chrome.runtime.lastError;
    // Offer it on an Alaska tab, or any time it simply isn't enabled yet.
    enableBtn.hidden = !!granted;
    enableBtn.textContent = onAlaska
      ? "Enable Starlink odds on this alaskaair.com page"
      : "Enable on alaskaair.com";
  });
}

if (enableBtn) {
  enableBtn.addEventListener("click", function () {
    try {
      chrome.permissions.request({ origins: ALASKA_ORIGINS }, function (granted) {
        void chrome.runtime.lastError;
        if (granted) {
          enableBtn.hidden = true;
          setStatus("Enabled on alaskaair.com — reload the tab to see badges.");
          setAirline("AS");
        } else {
          setStatus("alaskaair.com access not granted.");
        }
      });
    } catch (e) {
      setStatus("Could not request permission.");
    }
  });
}

if (airlineEl) airlineEl.addEventListener("change", function () {
  updateCredit();
  if (fromEl.value.length === 3 && toEl.value.length === 3) loadRoute(fromEl.value, toEl.value);
});

updateCredit();
init();


/* ── Trip monitor (v1.4) ── */
var tripsEl = document.getElementById("usl-trips");
var watchForm = document.getElementById("usl-watch-form");
var watchFn = document.getElementById("usl-watch-fn");
var watchDate = document.getElementById("usl-watch-date");
var watchStatus = document.getElementById("usl-watch-status");
var checkNowBtn = document.getElementById("usl-check-now");

/* ── Guardian timeline helpers (v1.6) ── */
function histOf(t) { return t && t.history && t.history.length ? t.history : []; }
function prevHist(t) { var h = histOf(t); return h.length >= 2 ? h[h.length - 2] : null; }
function fmtTs(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined,
      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch (e) { return ""; }
}
// Newest entry that actually carried a tail, used for "was ✓ N127UA".
function lastPublished(t) {
  var h = histOf(t);
  for (var i = h.length - 1; i >= 0; i--)
    if ((h[i].status === "yes" || h[i].status === "no") && h[i].tail) return h[i];
  return null;
}
function statusGlyph(s) {
  return s === "yes" ? "✓" : s === "no" ? "✗" : s === "invalid" ? "⚠" : "⏳";
}

function tripLine(t) {
  var prev = prevHist(t);
  var swapped = prev && prev.tail && t.tail && prev.tail !== t.tail;
  if (t.lastStatus === "yes") {
    if (swapped && prev.status === "yes")
      return { cls: "usl-t-swap", txt: "✓ swapped, still ✓ — tail " + t.tail + " (was " + prev.tail + ")" };
    return { cls: "usl-t-yes", txt: "✓ Starlink confirmed — tail " + (t.tail || "?") };
  }
  if (t.lastStatus === "no") {
    var alt = t.alts && t.alts[0];
    var better = alt ? " · better: " + alt.flights + " (" + alt.pct + "%)" : "";
    if (swapped && prev.status === "yes")
      return { cls: "usl-t-no", txt: "✗ swap lost Starlink — " + t.tail + " (" + (t.equip || "non-Starlink") + ")" + better };
    if (swapped && prev.status === "no")
      return { cls: "usl-t-swap", txt: "✗ swapped, still ✗ — " + t.tail + " (" + (t.equip || "non-Starlink") + ")" + better };
    return { cls: "usl-t-no", txt: "✗ " + (t.equip || "non-Starlink tail") + better };
  }
  if (t.lastStatus === "early") {
    var was = lastPublished(t);
    if (was)
      return { cls: "usl-t-swap", txt: "⏳ assignment withdrawn — was " + statusGlyph(was.status) + " " + was.tail };
    return { cls: "usl-t-early", txt: "⏳ " + (t.prob != null ? "~" + t.prob + "% · " : "") +
      (t.typeDerived ? "odds derived from aircraft type · " : "") + "tail publishes ~48h out" };
  }
  if (t.lastStatus === "invalid")
    return { cls: "usl-t-no", txt: "⚠ flight number not recognized" +
      ((t.invalidCount || 0) >= 2 ? " — checks paused" : "") };
  return { cls: "usl-t-early", txt: "… not checked yet" };
}

function renderHistory(t) {
  var h = histOf(t);
  if (!h.length) return null;
  var wrap = el("div", "usl-hist");
  for (var i = h.length - 1; i >= 0; i--) {
    var e = h[i], before = i > 0 ? h[i - 1] : null;
    var detail = e.tail || (e.prob != null ? "~" + e.prob + "%" : "—");
    var swap = before && before.tail && e.tail && before.tail !== e.tail ? " (swap)" : "";
    wrap.appendChild(el("div", "usl-hist-row",
      "▸ " + fmtTs(e.ts) + "  " + statusGlyph(e.status) + " " + detail + swap));
  }
  return wrap;
}

function renderTrips(trips) {
  tripsEl.innerHTML = "";
  if (!trips.length) {
    var e = el("div", "usl-empty", "No guarded trips. Add one below, or click the ☆ next to any badge on united.com or alaskaair.com.");
    e.style.padding = "4px 2px";
    tripsEl.appendChild(e);
    return;
  }
  trips.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  trips.forEach(function (t) {
    var row = el("div", "usl-trip-row");
    var left = el("div", "usl-trip-left");
    left.appendChild(el("div", "usl-trip-main", t.fn + " · " + t.date + (t.routeSeen || t.route ? " · " + (t.routeSeen || t.route).replace("-", "→") : "")));
    var line = tripLine(t);
    var sub = el("div", "usl-trip-sub " + line.cls, line.txt);
    // Stale data: last check failed, so say when the state was last confirmed.
    if (t.lastError && t.asOf) sub.appendChild(el("span", "usl-asof", "as of " + fmtTs(t.asOf)));
    left.appendChild(sub);
    var hist = renderHistory(t);
    if (hist) {
      hist.style.display = "none";
      left.appendChild(hist);
      left.title = "Click for this trip's tail history";
      left.addEventListener("click", function (h) {
        return function () { h.style.display = h.style.display === "none" ? "" : "none"; };
      }(hist));
    }
    var x = el("button", "usl-trip-x", "×");
    x.title = "Stop guarding";
    x.addEventListener("click", function () {
      chrome.runtime.sendMessage({ type: "tripRemove", fn: t.fn, date: t.date }, function (res) {
        void chrome.runtime.lastError;
        if (res && res.trips) renderTrips(res.trips);
      });
    });
    row.appendChild(left);
    row.appendChild(x);
    tripsEl.appendChild(row);
  });
}
function loadTrips() {
  chrome.runtime.sendMessage({ type: "tripList" }, function (res) {
    void chrome.runtime.lastError;
    if (res && res.trips) renderTrips(res.trips);
  });
}
watchForm.addEventListener("submit", function (e) {
  e.preventDefault();
  var fn = (watchFn.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Bare digits inherit the airline currently selected above.
  if (/^\d{1,4}$/.test(fn)) fn = airline() + fn;
  if (!/^(?:UA|AS)\d{1,4}$/.test(fn)) { watchStatus.textContent = "Enter a flight like UA1812 or AS1."; return; }
  if (!watchDate.value) { watchStatus.textContent = "Pick a date."; return; }
  watchStatus.textContent = "Adding + checking…";
  chrome.runtime.sendMessage({ type: "tripAdd", fn: fn, date: watchDate.value }, function (res) {
    void chrome.runtime.lastError;
    // The service worker owns the rules (past date, max trips) — surface its text.
    watchStatus.textContent = res && res.ok === false && res.error ? res.error : "";
    if (!res || res.ok !== false) watchFn.value = "";
    if (res && res.trips) renderTrips(res.trips);
  });
});
checkNowBtn.addEventListener("click", function () {
  watchStatus.textContent = "Checking all watched flights…";
  chrome.runtime.sendMessage({ type: "tripCheckNow" }, function (res) {
    void chrome.runtime.lastError;
    watchStatus.textContent = "";
    if (res && res.trips) renderTrips(res.trips);
  });
});
var wd = new Date(Date.now() + 2 * 864e5);
watchDate.value = wd.toISOString().slice(0, 10);
loadTrips();
