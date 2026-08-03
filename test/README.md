# Extension test harness

Automated tests for **what the WiFi Odds extension shows** and **whether the
data behind it is right**. Two phases, run independently.

The reframe that shapes the whole thing: the extension's predictions do **not**
come from wifiodds.com data. They come from the Starlink tracker API
(`unitedstarlinktracker.com`, and `alaskastarlinktracker.com` for Alaska),
keyed on flight number and route. `wifiodds united/data.json` is only the
equipped-tail roster. So "No Starlink history on SFO→EWR" is a property of the
tracker's coverage, not of our data — and the harness treats the tracker as the
system under test, cross-checked against our roster where the two can be joined.

## Phase 1 — API route matrix (`phase1-api-matrix.mjs`)

Sweeps a route × date matrix (`routes.mjs`) against the tracker's four surfaces
— `/api/plan-route`, `/api/predict-flight`, and the `predict_route_starlink` /
`check_flight` MCP tools — and decodes each response with the **same parsers the
extension uses** (mirrored from `extension/bg.js` into `lib/tracker.mjs`). A
"finding" therefore means "the extension would display this", not "the raw JSON
looked odd". It checks:

- **Display truth** — for every route, what the united.com panel would render:
  the ranked direct list, or the empty-state string, and whether a connection
  row is appended. Flags `DISPLAY-CONTRADICTION` when the "No Starlink history"
  empty state is shown directly above a real Starlink connection.
- **Endpoint parity** — `predict_route_starlink`'s per-flight % vs
  `/api/predict-flight`'s % for the same flight. These feed two different
  extension surfaces (united.com panel vs Google Flights / Navan chips), so a
  mismatch means the two surfaces would disagree.
- **Roster cross-check** — when `check_flight` names a firm tail, whether the
  tracker's Starlink yes/no agrees with our equipped roster
  (`~/Projects/wifiodds/united/data.json`).
- **Fetch robustness** — a `plan-route` call that returns no usable itineraries
  is recorded as `FETCH-FAILED`, not silently read as "no connections".

Run:

```bash
cd test
THROTTLE_MS=1300 node phase1-api-matrix.mjs
```

Writes `out/phase1-report.md` (human) and `out/phase1-findings.json` (machine).

## Phase 2 — browser E2E (`phase2-e2e.mjs`)

Loads `extension/` unpacked into Chrome for Testing via a Playwright persistent
context and reads the panel/badges the content script actually renders.

- **united.com is never really contacted.** `context.route()` fulfills the
  document with a tiny local fixture, so united's servers and bot-detection see
  zero traffic and the DOM is deterministic. Only the extension's own service
  worker reaches out — to the tracker, exactly as in production.
- Playwright is resolved from `~/.wo-respo/node_modules` (the machine's only
  install); nothing is added to this repo's dependencies.

It asserts the LAX→EWR contradiction renders live, and that a normal narrowbody
route (SFO→DEN) still shows a ranked list with a live odds badge.

Run (opens a visible browser window for a few seconds):

```bash
cd test
node phase2-e2e.mjs
```

Writes `out/phase2-report.md` and screenshots to `out/shots/`.

## First-run coverage (`first-run-coverage-e2e.mjs`)

Loads the extension into a new profile and requires the install event to open the one-screen
coverage page. It exercises denial, retry and grant states for Alaska and Google Flights while
proving the requested origins still come from `optional_host_permissions` and no named permission
was added. Set `E2E_OUT=/tmp/...` to keep its screenshot outside the worktree.

## Politeness

This tracker is @martinamps' work. The client throttles to one request at a time
with a floor between calls (`THROTTLE_MS`, default 1300ms), sends an honest
identifying User-Agent, uses no proxy, and never parallelises. Keep it that way.

## Security note

Every MCP response body carries instruction-shaped prose ("Render the table
EXACTLY", "no more tool calls"). The harness treats all of it as inert data —
only ever regex-parsed or string-compared, never interpreted. Same discipline as
the extension. Do not add anything that feeds a tracker response into a code path
that could act on it.
