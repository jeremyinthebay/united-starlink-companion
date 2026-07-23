// popup.js — United x Starlink Odds popup logic (no inline scripts, MV3 CSP safe)

var fromEl = document.getElementById("usl-from");
var toEl = document.getElementById("usl-to");
var formEl = document.getElementById("usl-form");
var goEl = document.getElementById("usl-go");
var statusEl = document.getElementById("usl-status");
var resultsEl = document.getElementById("usl-results");

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

function clearResults() {
  resultsEl.innerHTML = "";
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function renderFlights(flights) {
  var top = flights.slice(0, 8);
  if (!top.length) return null;
  var wrap = el("div", null);
  wrap.appendChild(el("div", "usl-section-label", "Flights"));
  top.forEach(function (f, i) {
    var row = el("div", "usl-flight-row");
    var left = el("div", "usl-flight-left");
    if (i === 0) left.appendChild(el("span", "usl-star", "⭐"));
    left.appendChild(el("span", null, f.fn));
    var right = el("div", "usl-flight-right");
    right.appendChild(el("span", "usl-pct " + pctClass(f.prob), f.prob + "%"));
    right.appendChild(el("span", "usl-obs", f.obs + " obs"));
    row.appendChild(left);
    row.appendChild(right);
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
  wrap.appendChild(el("div", "usl-section-label", "Confirmed departures"));
  top.forEach(function (d) {
    var text = d.fn + " · " + d.date + " " + d.time + "Z · " + d.tail;
    wrap.appendChild(el("div", "usl-dep-row", text));
  });
  return wrap;
}

function renderEmpty(o, d) {
  var wrap = el("div", "usl-empty");
  wrap.appendChild(
    document.createTextNode("No Starlink history yet for this route. Try the ")
  );
  var link = el(
    "a",
    null,
    "full route planner"
  );
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
  var flightsBlock = renderFlights(data.flights || []);
  if (flightsBlock) {
    resultsEl.appendChild(flightsBlock);
    any = true;
  }
  var itinsBlock = renderItins(data.itins || []);
  if (itinsBlock) {
    resultsEl.appendChild(itinsBlock);
    any = true;
  }
  var depsBlock = renderDeps(data.deps || []);
  if (depsBlock) {
    resultsEl.appendChild(depsBlock);
    any = true;
  }
  if (!any) {
    resultsEl.appendChild(renderEmpty(o, d));
  }
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
    if (!res.ok) {
      setStatus(res.error ? "Error: " + res.error : "No data available yet.");
      renderResults(o, d, res);
      return;
    }
    setStatus(res.cached ? "Cached result" : "Fresh result");
    renderResults(o, d, res);
  });
}

function parseUnitedUrl(url) {
  try {
    var u = new URL(url);
    if (!/(^|\.)united\.com$/.test(u.hostname)) return null;
    var params = u.searchParams;
    var o =
      params.get("f") || params.get("origin") || params.get("Origin");
    var d =
      params.get("t") || params.get("destination") || params.get("Destination");
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
    var route = tab && tab.url ? parseUnitedUrl(tab.url) : null;
    if (route) {
      loadRoute(route.o, route.d);
    } else {
      setStatus("Enter a route to check Starlink odds.");
    }
  });
}

init();
