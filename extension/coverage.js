// First-run coverage setup. Optional origins are always read from the shipped
// manifest, so this page cannot request a host the release did not declare.
"use strict";

var OPTIONAL_ORIGINS = (chrome.runtime.getManifest().optional_host_permissions || []).slice();
var FIRST_RUN_HOSTS = {
  alaska: { matches: function (origin) { return /^https:\/\/(?:www\.)?alaskaair\.com\//.test(origin); } },
  gflights: { matches: function (origin) { return /^https:\/\/www\.google\.com\//.test(origin); } },
};

function originsForHost(key) {
  var host = FIRST_RUN_HOSTS[key];
  return host ? OPTIONAL_ORIGINS.filter(host.matches) : [];
}

// Named seam: the browser gate replaces this function after proving its source
// calls permissions.request. That lets the gate exercise allow/deny UI without
// accepting a real Chrome permission prompt in automation.
function requestHostOrigins(origins) {
  return chrome.permissions.request({ origins: origins });
}

function containsHostOrigins(origins) {
  return chrome.permissions.contains({ origins: origins });
}

function paintHost(key, granted, message) {
  var button = document.getElementById("grant-" + key);
  var state = document.getElementById("state-" + key);
  if (!button || !state) return;
  button.disabled = !!granted;
  button.dataset.granted = String(!!granted);
  button.removeAttribute("aria-busy");
  button.textContent = granted
    ? "Access on"
    : key === "alaska" ? "Allow on alaskaair.com" : "Allow on Google Flights";
  state.className = "state " + (granted ? "state-on" : "state-off");
  state.textContent = message || (granted ? "access on" : "optional access off");
}

async function syncHost(key) {
  var origins = originsForHost(key);
  if (!origins.length) {
    paintHost(key, false, "unavailable in this build");
    var missing = document.getElementById("grant-" + key);
    if (missing) missing.disabled = true;
    return;
  }
  try {
    paintHost(key, await containsHostOrigins(origins));
  } catch (e) {
    paintHost(key, false, "could not check access");
  }
}

async function askForHost(key) {
  var origins = originsForHost(key);
  var button = document.getElementById("grant-" + key);
  if (!origins.length || !button) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Requesting…";
  try {
    var granted = await requestHostOrigins(origins);
    paintHost(key, !!granted, granted ? "access on" : "not granted — you can try again");
  } catch (e) {
    paintHost(key, false, "request failed — you can try again");
  }
}

Object.keys(FIRST_RUN_HOSTS).forEach(function (key) {
  var button = document.getElementById("grant-" + key);
  if (button) button.addEventListener("click", function () { askForHost(key); });
  syncHost(key);
});
