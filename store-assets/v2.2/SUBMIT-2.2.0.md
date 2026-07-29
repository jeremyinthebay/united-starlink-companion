# Chrome Web Store submission — WiFi Odds for Flights v2.2.0

Do NOT reuse `store-assets/v2.1/SUBMIT-2.1.0.md`. That copy says only a route leaves the device;
v2.2 also sends visible flight numbers, and v2.2 changes the default sort behaviour. This file is
the accurate disclosure for the v2.2 listing and privacy fields.

## What the extension does

Adds a next-gen WiFi odds badge to each flight in your united.com / Navan search results (and, with
your opt-in permission, alaskaair.com and Google Flights), and can sort the results by those odds.

## Single purpose

Show, per flight, the odds of next-generation (Starlink / Amazon Leo) WiFi, sourced from the
community trackers, and let the traveller sort their results by it.

## Data that leaves the device — name BOTH in the privacy disclosure

To fetch odds, the service worker sends to the community tracker
(`unitedstarlinktracker.com`, or `alaskastarlinktracker.com` for Alaska):

1. the **route** (origin and destination airport codes) you are viewing, and
2. the **visible flight numbers** on the page (e.g. `UA2402`), for per-flight odds.

Nothing else leaves the device. No account, no analytics, no third-party tracking, no advertising
identifiers, no page content beyond route and flight numbers. All caching is local
(`chrome.storage.local`).

## Default behaviour change in v2.2 (must be reflected in listing copy)

- **Auto-sort defaults ON.** For a fresh install/update with no stored preference, "auto-sort by
  odds when the page loads" and "keep sorted when the page updates" start checked. The user can
  uncheck either in the panel; the choice is remembered. The manifest description (kept under Chrome's
  132-char limit) reads: "See your flight's odds of next-gen WiFi in your search results. Auto-sorts
  by odds (toggle off anytime). Unofficial."
- **Sorting only reorders existing result rows.** `sortPage()` re-inserts the page's own flight-row
  elements into a different order within their container. It never edits fares, prices, selection
  state, or any booking control, and it never navigates. It is structurally incapable of changing
  what a flight costs or which flight is selected.
  - Automated proof on real united.com markup is NOT included: the E2E harness fulfils united.com
    from a local fixture to avoid hammering the live site / bot-detection. The safety claim rests on
    the code path (DOM reorder only). A manual real-page spot-check before submission is recommended.

## Permissions justification

- `storage` — local cache of odds and the sort preferences.
- `activeTab`, `scripting` — inject the badges/panel on the supported booking sites.
- `alarms` — the T-48h trip monitor and the daily selectors refresh.
- `notifications` — tail-swap alerts for guarded trips.
- host permission `unitedstarlinktracker.com` — fetch United odds. Alaska and Google are optional
  host permissions the user grants at runtime.

## Credit

Odds data: @martinamps' Starlink trackers. The extension is unofficial and not affiliated with
United, Alaska, Navan, Google, or SpaceX.
