// Focused browser gate for the install-only coverage page.
// Loads an untouched production-shaped extension copy into a fresh profile,
// proves onInstalled opened the page, and exercises both optional host buttons.
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire("/Users/jeremysmith/.wo-respo/");
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_SRC = join(HERE, "..", "extension");
const EXT = join(tmpdir(), "wifiodds-first-run-ext-" + Date.now());
const PROFILE = join(tmpdir(), "wifiodds-first-run-profile-" + Date.now());
const OUT = process.env.E2E_OUT || join(HERE, "out", "first-run");

cpSync(EXT_SRC, EXT, { recursive: true });

const MUTATIONS = {
  "first-run-opens-on-update": {
    file: "bg.js",
    from: 'if (!details || details.reason !== "install") return false;',
    to: 'if (!details || details.reason !== "update") return false;',
    note: "onboarding opens on update instead of fresh install",
  },
  "first-run-no-permission-request": {
    file: "coverage.js",
    from: "return chrome.permissions.request({ origins: origins });",
    to: "return chrome.permissions.contains({ origins: origins });",
    note: "grant buttons check permission but never request it",
  },
  "first-run-add-tabs-permission": {
    file: "manifest.json",
    json: function (manifest) { manifest.permissions.push("tabs"); return manifest; },
    note: "the onboarding tab silently adds a named tabs permission",
  },
};

const mutationName = process.env.E2E_MUT || "";
if (mutationName) {
  const mutation = MUTATIONS[mutationName];
  if (!mutation) throw new Error("E2E_MUT: unknown first-run mutation " + mutationName);
  const file = join(EXT, mutation.file);
  if (mutation.json) {
    const value = mutation.json(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  } else {
    const source = readFileSync(file, "utf8");
    if (!source.includes(mutation.from))
      throw new Error("E2E_MUT " + mutationName + ": anchor not found");
    writeFileSync(file, source.replace(mutation.from, mutation.to));
  }
  process.stderr.write("MUTATION LANDED " + mutationName + " (" + mutation.note + ")\n");
}

const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function findCoveragePage(context, url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = context.pages().find((page) => page.url() === url);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, {
      headless: true,
      channel: "chromium",
      viewport: { width: 1280, height: 800 },
      args: ["--disable-extensions-except=" + EXT, "--load-extension=" + EXT],
    });

    const consoleErrors = [];
    const watchConsole = (page) => page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    context.pages().forEach(watchConsole);
    context.on("page", watchConsole);

    let sw = context.serviceWorkers()[0];
    if (!sw) {
      try { sw = await context.waitForEvent("serviceworker", { timeout: 8000 }); } catch (e) {}
    }
    const swUrl = sw ? sw.url() : "";
    const extId = swUrl.replace("chrome-extension://", "").split("/")[0];
    const coverageUrl = extId ? "chrome-extension://" + extId + "/coverage.html" : "";
    const automaticPage = coverageUrl ? await findCoveragePage(context, coverageUrl) : null;
    const page = automaticPage || await context.newPage();
    if (!automaticPage && coverageUrl)
      await page.goto(coverageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof requestHostOrigins === "function", null, { timeout: 10000 });

    const initial = await page.evaluate(() => ({
      manifest: chrome.runtime.getManifest(),
      hosts: [...document.querySelectorAll("[data-host].host")].map((node) => node.dataset.host),
      buttons: [...document.querySelectorAll("button[data-host]")].map((node) => ({
        host: node.dataset.host,
        tag: node.tagName,
        minHeight: getComputedStyle(node).minHeight,
      })),
      text: document.body.innerText,
      alaskaOrigins: originsForHost("alaska"),
      googleOrigins: originsForHost("gflights"),
      requestSource: String(requestHostOrigins),
      oneScreen: document.documentElement.scrollHeight <= window.innerHeight,
    }));

    const lifecycle = sw ? await sw.evaluate(() => {
      const updateCalls = [];
      const installCalls = [];
      const updateResult = openFirstRunCoverage({ reason: "update" }, (props) => updateCalls.push(props));
      const installResult = openFirstRunCoverage({ reason: "install" }, (props) => installCalls.push(props));
      return { updateCalls, installCalls, updateResult, installResult };
    }) : null;

    await page.evaluate(() => {
      window.__permissionRequests = [];
      window.__grantResult = false;
      window.requestHostOrigins = async function (origins) {
        window.__permissionRequests.push(origins.slice());
        return window.__grantResult;
      };
    });

    await page.focus("#grant-alaska");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /try again/i.test(document.getElementById("state-alaska").textContent));
    const deniedRetry = await page.$eval("#grant-alaska", (button) => !button.disabled && button.tagName === "BUTTON");

    await page.evaluate(() => { window.__grantResult = true; });
    await page.click("#grant-alaska");
    await page.click("#grant-gflights");
    await page.waitForFunction(() =>
      document.getElementById("grant-alaska").dataset.granted === "true" &&
      document.getElementById("grant-gflights").dataset.granted === "true");

    const exercised = await page.evaluate(() => ({
      requests: window.__permissionRequests,
      alaskaState: document.getElementById("state-alaska").textContent,
      googleState: document.getElementById("state-gflights").textContent,
      grantedButtons: [...document.querySelectorAll('button[data-granted="true"]')].length,
    }));

    await page.screenshot({ path: join(OUT, "first-run-coverage.png"), fullPage: true });

    const checks = {
      serviceWorkerPresent: !!sw,
      openedAutomaticallyOnInstall: !!automaticPage,
      updateDoesNotOpen: !!lifecycle && lifecycle.updateResult === false && lifecycle.updateCalls.length === 0,
      installHandlerTargetsCoverage: !!lifecycle && lifecycle.installResult === true &&
        lifecycle.installCalls.length === 1 && /\/coverage\.html$/.test(lifecycle.installCalls[0].url),
      fourHostsExact: exact(initial.hosts, ["united", "alaska", "navan", "gflights"]),
      twoNativeGrantButtons: initial.buttons.length === 2 && initial.buttons.every((button) =>
        button.tag === "BUTTON" && parseFloat(button.minHeight) >= 44),
      honestUnitedBoundary: /united\.com[\s\S]*single-airline results sort automatically/i.test(initial.text),
      honestNavanBoundary: /app\.navan\.com[\s\S]*order is preserved until you choose Prioritize United/i.test(initial.text),
      honestGoogleBoundary: /Google Flights[\s\S]*never reorders Google Flights/i.test(initial.text) &&
        /grants all of www\.google\.com[\s\S]*not Search, Gmail, or checkout/i.test(initial.text),
      permissionsUnchanged: exact(initial.manifest.permissions,
        ["storage", "activeTab", "alarms", "notifications", "scripting"]),
      requiredHostsUnchanged: exact(initial.manifest.host_permissions,
        ["https://unitedstarlinktracker.com/*"]),
      optionalHostsUnchanged: exact(initial.manifest.optional_host_permissions,
        ["https://www.alaskaair.com/*", "https://alaskaair.com/*", "https://www.google.com/*"]),
      originsDerivedExactly: exact(initial.alaskaOrigins,
        ["https://www.alaskaair.com/*", "https://alaskaair.com/*"]) &&
        exact(initial.googleOrigins, ["https://www.google.com/*"]),
      productionSeamCallsRequest: /chrome\.permissions\.request/.test(initial.requestSource),
      deniedGrantStaysRetryable: deniedRetry,
      bothButtonsFireExactRequests: exact(exercised.requests, [
        ["https://www.alaskaair.com/*", "https://alaskaair.com/*"],
        ["https://www.alaskaair.com/*", "https://alaskaair.com/*"],
        ["https://www.google.com/*"],
      ]),
      bothGrantedStatesPainted: exercised.alaskaState === "access on" &&
        exercised.googleState === "access on" && exercised.grantedButtons === 2,
      keyboardActivationWorked: exercised.requests.length >= 1,
      oneScreenAt1280x800: initial.oneScreen,
      noConsoleErrors: consoleErrors.length === 0,
    };

    const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
    process.stderr.write("first-run checks: " + JSON.stringify(checks) + "\n");
    if (failed.length) {
      process.stderr.write("first-run-coverage FAILED: " + failed.join(",") + "\n");
      process.exitCode = 1;
    } else {
      process.stderr.write("first-run-coverage PASS · install page + two optional permission gestures · no new permission\n");
    }
  } finally {
    if (context) await context.close();
    rmSync(EXT, { recursive: true, force: true });
    rmSync(PROFILE, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write("first-run-coverage FAILED: fatal " + String(error && (error.stack || error)) + "\n");
  process.exit(1);
});
