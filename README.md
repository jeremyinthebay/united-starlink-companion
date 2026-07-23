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
