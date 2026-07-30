# Chrome Web Store submission — WiFi Odds for Flights v2.2.0

Do NOT reuse `store-assets/v2.1/SUBMIT-2.1.0.md`. That copy says only a route leaves the device;
v2.2 also sends visible flight numbers, and v2.2 changes the default sort behaviour. This file is
the accurate disclosure for the v2.2 listing and privacy fields.

## What the extension does

Adds a next-gen WiFi odds badge to each flight in your united.com / Navan search results (and, with
your opt-in permission, alaskaair.com and Google Flights), and can prioritize United flights by those odds when you ask it to.

## Single purpose

Show, per flight, the odds of next-generation (Starlink / Amazon Leo) WiFi, sourced from the
community trackers, and let the traveller prioritize United flights by it on request.

## Data that leaves the device — name BOTH in the privacy disclosure

To fetch odds, the service worker sends to the community tracker
(`unitedstarlinktracker.com`, or `alaskastarlinktracker.com` for Alaska):

1. the **route** (origin and destination airport codes) you are viewing, and
2. the **visible flight numbers** on the page (e.g. `UA2402`), for per-flight odds.

Nothing else leaves the device. No account, no analytics, no third-party tracking, no advertising
identifiers, no page content beyond route and flight numbers. All caching is local
(`chrome.storage.local`).

## Sort behaviour in v2.2 — explicit opt-in (must be reflected in listing copy)

- **No automatic reordering; the booking site's own order is preserved until the traveller acts.**
  v2.2 does NOT auto-sort on load, and no sort control is pre-checked. The panel offers one explicit,
  keyboard-operable action — "Prioritize United flights with available WiFi odds; unscored flights
  follow" — that the user must activate. The manifest description (under Chrome's 132-char limit)
  reads exactly:
  "See each flight's odds of next-gen WiFi in your search results. Tap to prioritize United flights by odds. Unofficial."
- **When activated, it only reorders validated flight-result rows.** The action floats scored United
  flights up by odds and keeps every unscored flight row in its relative order; it never moves
  headings, filters, banners, tools, pagination, or loading elements, never edits fares, prices,
  selection state, or any booking control, and never navigates. It is structurally incapable of
  changing what a flight costs or which flight is selected.
  - Automated proof on real united.com / Navan markup is NOT included: the E2E harness fulfils those
    hosts from local fixtures to avoid hammering the live sites / bot-detection. The safety claim
    rests on the code path (DOM reorder of validated flight rows only). A manual real-page spot-check
    before submission is recommended.

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
