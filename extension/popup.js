// popup.js — United x Starlink Odds popup logic (no inline scripts, MV3 CSP safe)
// v1.1: flights are sorted by odds, show departure times found on the page, and
// clicking a row scrolls the united.com tab to that flight.

var fromEl = document.getElementById("usl-from");
var toEl = document.getElementById("usl-to");
var formEl = document.getElementById("usl-form");
var goEl = document.getElementById("usl-go");
var statusEl = document.getElementById("usl-status");
var resultsEl = document.getElementById("usl-results");

var activeTab = null;      // active browser tab (if united.com with a route)
var tabRoute = null;       // {o,d} parsed from that tab
var pageFlights = {};      // fn -> times string, as found on the page
var lastData = null, lastO = null, lastD = null;

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
      row.title = "Scroll the united.com tab to " + f.fn;
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
  link.href = "https://unitedstarlinktracker.com/route-planner/" + o + "/" + d;
  link.target = "_blank";
  link.rel = "noopener";
  wrap.appendChild(link);
  wrap.appendChild(document.createTextNode("."));
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
  setStatus("Loading " + o + " → " + d + "…");
  clearResults();

  chrome.runtime.sendMessage({ type: "routeData", o: o, d: d }, function (res) {
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

function parseUnitedUrl(url) {
  try {
    var u = new URL(url);
    if (!/(^|\.)united\.com$/.test(u.hostname)) return null;
    var params = u.searchParams;
    var o = params.get("f") || params.get("origin") || params.get("Origin");
    var d = params.get("t") || params.get("destination") || params.get("Destination");
    if (o && d) return { o: o.toUpperCase(), d: d.toUpperCase() };
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
    var urlRoute = tab && tab.url ? parseUnitedUrl(tab.url) : null;
    if (!urlRoute) {
      setStatus("Enter a route to check Starlink odds.");
      return;
    }
    activeTab = tab;
    // Ask the content script which leg is actually being shown (round trips:
    // the URL still says outbound while the RETURN list is on screen).
    chrome.tabs.sendMessage(tab.id, { type: "pageContext" }, function (pc) {
      void chrome.runtime.lastError;
      var route = pc && pc.o && pc.d ? { o: pc.o, d: pc.d } : urlRoute;
      tabRoute = route;
      loadRoute(route.o, route.d);
    });
  });
}

init();
