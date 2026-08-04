# United ✕ Starlink Route Optimizer

A single-file companion page to **[UnitedStarlinkTracker.com](https://unitedstarlinktracker.com)** that turns its
fleet and per-flight data into a route-level *booking strategy*: every daily flight on a route ranked by Starlink
probability, a round-trip odds builder, a T-48h verify-and-switch playbook, and a fleet-rollout pulse — refreshed daily.

**Live:** https://smithfamai.com/unitedstarlink/

## Credit where it's due

All underlying data comes from [unitedstarlinktracker.com](https://unitedstarlinktracker.com) by
[@martinamps](https://x.com/martinamps) — the independent community tracker that verifies every United tail's
WiFi system against united.com ([methodology](https://unitedstarlinktracker.com/methodology)). This project is a
fan-made companion, not a replacement: it adds a per-route planning layer on top of their work. If you haven't,
go use the real thing — the per-tail live data, check-flight pages, route planner, and MCP/API integrations are all theirs.

If the tracker folks want any of this — the UI, the route-plan data schema, the daily-refresh approach — take it,
it's MIT. PRs welcome.

## What's here

| File | What it is |
|---|---|
| `index.html` | The entire app — no build step, no dependencies. Fetches `data.json` at load. Mobile-optimized, zero horizontal scroll down to 320px. |
| `data.json` | The data contract: fleet stats, per-route ranked flights (probability, observations, confidence, verdict), regional-jet connection near-guarantees, confirmed-tail snapshots, and a daily history array that feeds the trend chart. |
| `UPDATER.md` | How the daily refresh works (scrapes the tracker's server-rendered pages; the schema it maintains). |
| `og.png` | Social preview card. |

## How the daily refresh works

A scheduled agent task runs each morning: it pulls the tracker's homepage (fleet totals), `/fleet` (per-type
counts + install pace), and each tracked flight's `/check-flight/UA####` page ("Starlink on X of Y recent
departures"), rewrites `data.json` (appending to `history`), verifies the live page by response body, and commits.
Details in [UPDATER.md](UPDATER.md).

## Adding a route

Add a `"XXX-YYY"` key to `routes` in `data.json` following the existing shape and list its flight numbers —
the page picks it up automatically, and the updater refreshes any flight number it finds there.

## License

MIT. Data referenced from unitedstarlinktracker.com remains theirs; probabilities are historical estimates,
not guarantees — verify your tail ~48h before departure.

## Chrome extension (`extension/`)

Injects Starlink odds directly into **united.com** flight search results while you book — a companion to the
tracker team's own [Google Flights extension](https://chromewebstore.google.com/detail/jjfljoifenkfdbldliakmmjhdkbhehoi)
(use both; they don't overlap).

- **Badges**: every flight number in United's results gets a 🛰️ odds pill (gold ≥50%, green ≥35%, blue ≥20%, red <20%);
  a ✓ means that flight already has a confirmed Starlink tail. Selector-independent (keys on visible "UA ####" text),
  so United's frequent DOM changes don't break it.
- **Route panel**: floating summary (top flights, best full-coverage connection, confirmed tails) detected from the
  booking URL; collapsible.
- **Popup**: quick odds lookup for any route; auto-detects the route from the active united.com tab.
- All data flows through a service worker with a 6-hour cache, hitting the tracker's public API/MCP endpoints.

**Install (unpacked):** chrome://extensions → enable *Developer mode* → *Load unpacked* → select the `extension/`
folder. Then search a flight on united.com.

## Browser testing

Routine browser tests must not open a visible Chrome window. `node test/phase2-e2e.mjs` uses
Playwright's full Chromium channel in native headless mode because its default headless shell does
not register this MV3 extension's service worker. Keep `headless: true` and `channel: "chromium"`
together; a missing service worker is a hard gate failure, never a reason to fall back to headed.

`node test/first-run-coverage-e2e.mjs` uses a separate fresh browser profile to prove a real install
opens the coverage page and both optional-host buttons call `permissions.request`. Its three named
mutations are included in `node test/mutation-matrix.mjs`.

`test/store-screenshots.mjs` is not a routine test: it is the explicit headed exception that captures
real-site Chrome Web Store artwork. Do not run that artifact generator as part of automated testing.

## Release history and tags

[`CHANGELOG.md`](CHANGELOG.md) is the extension repository's release history. Keep current work under
`[Unreleased]`; the first dated release entry must always equal `extension/manifest.json`'s version.
`node build-release-history-verify.mjs` enforces that binding, the date and ordering rules, and the
backfill through 2.0.0. `sh test/release-history-gate.sh` proves the gate fails in each named
direction. The read-only store verifier runs the binding automatically before checking artifacts.

Cut a release in this order:

1. Update the manifest and move the packaged source notes from `[Unreleased]` into the matching
   dated changelog entry. The date is the immutable source/package release date; state Chrome Web
   Store publication separately and truthfully.
2. Build and commit the upload ZIP, file manifest, submission copy and store bundle, then run every
   release gate against that exact commit.
3. Create an annotated `vX.Y.Z` tag on that release commit and push that tag by its explicit name.
   Never move or force-update a published tag.

A Git tag and changelog release record source identity; neither claims the Chrome Web Store has
published that source. Before Jeremy uploads, the entry says `Chrome Web Store: not uploaded`.
Store upload and Submit remain Jeremy's manual actions, and the public website's release ledger moves
only after the live listing has been owner-verified.

## Shared driver lock

This repository shares the relay's one-driver-at-a-time lock. Install the enforcement once per clone:

    sh install-driver-lock-hooks.sh

Both `pre-commit` and `pre-push` then read `wifiodds-relay/exchange/.driver-lock`. An active lock held
by a different `WIFIODDS_DRIVER_ID` blocks the write. A missing, malformed, expired or dead-pid lock
logs and allows, matching the relay's fail-open stale-lock semantics so an unattended refresh cannot
be wedged by a bad lock file. Run `sh test/driver-lock-hooks-gate.sh` for healthy and failing controls.
