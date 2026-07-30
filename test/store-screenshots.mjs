// store-screenshots.mjs — capture v2.2 Chrome Web Store screenshots (1280×800)
// from the REAL extension: the injected panel + on-page badges over a realistic
// united.com-style results backdrop, and the popup on a branded canvas.
//
// united.com is fulfilled from a local fixture (no real-site traffic / bot
// detection); the extension's service worker still fetches the real tracker so
// the odds are genuine. Output → test/out/store/ (1280×800 PNGs).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire("/Users/jeremysmith/.wo-respo/");
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..", "extension");
const OUT = join(HERE, "out", "store");
const W = 1280, H = 800;

// A realistic united.com results backdrop: masthead, search summary, filter row,
// and five fare-carded flight rows. Flight numbers are real ones with tracker
// history so the badges/panel show genuine odds.
function unitedFixture() {
  // Real DEN→SFO route-history flight numbers, so the panel's ranked list matches
  // the on-page flights (nothing shows as greyed "not in results").
  const rows = [
    { fn: 1812, dep: "8:30 AM", arr: "12:14 PM", dur: "3h 44m", eq: "A321neo", econ: 194, ep: 336, first: 479 },
    { fn: 1561, dep: "11:05 AM", arr: "2:49 PM", dur: "3h 44m", eq: "A320", econ: 208, ep: 351, first: 512 },
    { fn: 1007, dep: "1:40 PM", arr: "5:29 PM", dur: "3h 49m", eq: "737-900", econ: 231, ep: 372, first: 540 },
    { fn: 1450, dep: "4:15 PM", arr: "8:02 PM", dur: "3h 47m", eq: "737-800", econ: 219, ep: 360, first: 505 },
    { fn: 1506, dep: "6:50 PM", arr: "10:31 PM", dur: "3h 41m", eq: "A319", econ: 245, ep: 388, first: 566 },
  ].map((r) => `
    <div class="row">
      <div class="rl">
        <div class="fn">United ${r.fn}</div>
        <div class="tm">${r.dep} <span class="mut">→</span> ${r.arr}</div>
        <div class="mut sm">DEN → SFO · Nonstop · ${r.dur} · ${r.eq}</div>
      </div>
      <div class="fares">
        <div class="fare"><div class="fl">Economy</div><div class="fp">$${r.econ}</div></div>
        <div class="fare"><div class="fl">Economy Plus</div><div class="fp">$${r.ep}</div></div>
        <div class="fare"><div class="fl">United First</div><div class="fp">$${r.first}</div></div>
      </div>
    </div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>United — choose flights</title>
  <style>
    *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f2f4f7;color:#1a1a2b}
    .mast{background:#0a1f44;color:#fff;height:52px;display:flex;align-items:center;padding:0 22px;gap:16px}
    .logo{width:34px;height:22px;background:#1668e3;border-radius:3px}
    .mast .sp{flex:1}
    .mast .mi{opacity:.85;font-size:13px}
    .sub{background:#fff;border-bottom:1px solid #e2e6ec;padding:14px 22px}
    .sub h1{margin:0 0 3px;font-size:19px} .sub .mut{color:#5b6472;font-size:13px}
    .filters{display:flex;gap:10px;padding:12px 22px;background:#fff;border-bottom:1px solid #eef1f5;flex-wrap:wrap}
    .filters span{font-size:12.5px;color:#33415c;border:1px solid #d7dde6;border-radius:16px;padding:5px 12px;background:#fbfcfe}
    .results{padding:16px 22px;display:flex;flex-direction:column;gap:12px;max-width:900px}
    .row{background:#fff;border:1px solid #e4e8ee;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:20px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
    .rl{flex:1;min-width:0}
    .fn{font-weight:700;font-size:14px;margin-bottom:3px}
    .tm{font-size:17px;font-weight:600} .tm .mut{color:#9aa3b2;font-weight:400}
    .mut{color:#6b7280} .sm{font-size:12px;margin-top:3px}
    .fares{display:flex;gap:10px}
    .fare{width:118px;border:1px solid #e4e8ee;border-radius:9px;padding:9px 10px;text-align:center;background:#fbfcfe}
    .fl{font-size:11px;color:#6b7280;margin-bottom:3px} .fp{font-size:16px;font-weight:700}
    h1 .mut{font-weight:400}
  </style></head><body>
    <div class="mast"><div class="logo"></div><div class="mi">Book</div><div class="mi">My trips</div><div class="sp"></div><div class="mi">English · US $</div><div class="mi">Sign in</div></div>
    <div class="sub"><h1>Choose your flight <span class="mut">· DEN → SFO</span></h1><div class="mut">DEPART ON: Thu, Aug 28 · 1 traveler · Economy</div></div>
    <div class="filters"><span>Sort</span><span>Stops</span><span>Fare type</span><span>Duration</span><span>Aircraft</span><span>Times</span></div>
    <div class="results">${rows}</div>
  </body></html>`;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const ud = join(tmpdir(), "usl-store-" + Date.now());
  const ctx = await chromium.launchPersistentContext(ud, {
    headless: false, viewport: { width: W, height: H },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  await ctx.route(/https:\/\/(www\.)?united\.com\/.*/, (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: unitedFixture() }));

  // 1 · panel + on-page badges over the results page
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  await page.goto(`https://www.united.com/en/us/fsr/choose-flights?f=DEN&t=SFO&d=2026-08-28&tt=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".usl-panel", { timeout: 30000 });
  // Fail-CLOSED (Codex P2-02): the required UI must be present or the capture
  // throws — a regressed tracker/DOM can never produce a "release" screenshot.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".usl-badge")];
    return b.some((x) => /\d+%/.test(x.textContent));
  }, null, { timeout: 25000 });
  await page.waitForTimeout(2500);
  // Assert the panel carries a ramp band and the ESTIMATES chip before shooting.
  const ok = await page.evaluate(() => {
    const p = document.querySelector(".usl-panel");
    if (!p || !/ESTIMATES/.test(p.innerText)) return false;
    return !!p.querySelector(".usl-badge.usl-hi, .usl-badge.usl-mid, .usl-badge.usl-low, .usl-badge.usl-no");
  });
  if (!ok) throw new Error("panel missing ESTIMATES chip or ramp band — refusing to capture");
  await page.screenshot({ path: join(OUT, "1-panel-united.png"), clip: { x: 0, y: 0, width: W, height: H } });

  // 2 · popup, captured raw then composited onto a branded 1280×800 canvas
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 400, height: 640 });
  await pop.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await pop.fill("#usl-from", "DEN"); await pop.fill("#usl-to", "SFO");
  await pop.click("#usl-go");
  await pop.waitForSelector(".usl-pct", { timeout: 20000 }); // required, not swallowed
  await pop.waitForTimeout(1200);
  // fullPage → the COMPLETE popup, so the hero can never clip a control mid-row.
  const popShot = (await pop.screenshot({ fullPage: true })).toString("base64");
  const canvas = await ctx.newPage();
  await canvas.setViewportSize({ width: W, height: H });
  await canvas.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;
    background:radial-gradient(1200px 700px at 72% 38%,#141a2e,#050505);display:flex;align-items:center;
    justify-content:space-between;padding:0 90px;box-sizing:border-box;font-family:Inter,-apple-system,sans-serif;overflow:hidden">
    <div style="max-width:520px;color:#fff">
      <div style="font:700 13px ui-monospace,Menlo,monospace;letter-spacing:.12em;
        background:linear-gradient(105deg,#29d8ff,#926cff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:14px">STARLINK + AMAZON LEO ODDS</div>
      <div style="font-size:54px;line-height:1.05;font-weight:800;letter-spacing:-.02em;margin:0 0 18px">Will your flight have real WiFi?</div>
      <div style="font-size:19px;color:#aab2c5;line-height:1.5">Odds on every flight in your search results, before you book. Free · no account or ad tracking.</div>
    </div>
    <img src="data:image/png;base64,${popShot}" style="max-height:724px;width:auto;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6);border:1px solid #23232e">
  </body></html>`);
  await canvas.waitForTimeout(400);
  await canvas.screenshot({ path: join(OUT, "2-popup-hero.png"), clip: { x: 0, y: 0, width: W, height: H } });

  process.stderr.write("wrote test/out/store/1-panel-united.png and 2-popup-hero.png\n");
  await ctx.close();
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });
