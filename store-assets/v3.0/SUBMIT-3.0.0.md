# Chrome Web Store submission · WiFi Odds for Flights v3.0.0

This file is the accurate disclosure for the v3.0.0 listing and privacy fields. Do not reuse an
older SUBMIT file: v3.0.0 adds the decision card, the trip guard's three-state alerts, and a
guarded-trip disclosure line that older copy does not carry.

## What the extension does

Adds a next-gen WiFi odds badge to each flight in your united.com / Navan search results (and, with
your opt-in permission, alaskaair.com and Google Flights). A decision card names the best choice
when the data supports one and says why it declined when it does not. You can prioritize flights by
those odds when you ask it to.

## Single purpose

Show, per flight, the odds of next-generation (Starlink / Amazon Leo) WiFi, sourced from the
community trackers, and let the traveller act on it on request.

## What's new in 3.0.0 (listing "what's new" copy)

- A "Best WiFi choice" card. It names a winner only when at least two flights carry scores, the
  leader is 8 or more points ahead, and the tracker grades its odds high or medium confidence. In
  every other case the card says what is known and why it declined: too close, thin history, one
  scored flight, still checking, tracker unreachable, or no history for the route. All odds are
  historical tracker odds; the card never claims they are current or fresh.
- A confirmed tail assignment is a separate dated token, never folded into the odds figure.
- Next-gen first, and both metrics are now labelled on every flight row. The row carries a primary
  `NEXT-GEN` figure (per-flight Starlink / Amazon Leo odds) and a secondary `STREAMING` ConnectScore
  for today's systems. The old unlabelled percentage pill is gone: it meant per-flight odds on one
  site and an airline-wide score on another, with nothing on screen to tell them apart. Where a
  flight has no per-flight odds the row says which fact is missing — no history, unavailable,
  fleet-level context only, announced but not flying, or none in the fleet — and never prints a zero.
- Automatic sorting on single-carrier sites, off-switchable, plus settings for the mixed-carrier
  behaviour and which metrics each row shows. See the sort-behaviour section below.
- Trip guard alerts in three honest states: Starlink confirmed, not Starlink, or no current answer,
  each with its reason (awaiting assignment, update unavailable, or flight not found). A known
  aircraft whose WiFi cannot be determined says "Cannot confirm", never "No Starlink". Every alert
  routes back to the booking page you guarded from, and a withdrawn confirmation can suggest a
  grounded same-day alternative when the tracker shows one.
- On united.com the carrier-wide sort button is gone, since every flight there is United. The
  decision card's own button reorders that page by odds instead.

## Data that leaves the device · name ALL THREE in the privacy disclosure

To fetch odds, the service worker sends to the community tracker
(`unitedstarlinktracker.com`, or `alaskastarlinktracker.com` for Alaska):

1. the **route** (origin and destination airport codes) you are viewing,
2. the **visible flight numbers** on the page (e.g. `UA2402`), for per-flight odds, and
3. for trips you guard with the star, the **guarded flight number and date** on the check
   schedule (about every 3 hours), so the tracker can report its tail assignment.

Nothing else leaves the device. No account, no analytics, no third-party tracking, no advertising
identifiers, no page content beyond route and flight numbers. All caching is local
(`chrome.storage.local`).

## Sort behaviour — READ THIS BEFORE WRITING LISTING COPY

v3.0 sorts some pages automatically. The previous release's sentence about the booking site's order
never changing on its own is now FALSE for single-carrier pages and must not appear anywhere public.
The accurate disclosure is:

> WiFi Odds automatically sorts supported single-carrier results by historical per-flight next-gen
> odds by default. On mixed-carrier pages, it preserves the booking site's order until you choose to
> move scored United or Alaska flights first. Other airlines remain unscored — not lower — and keep
> their relative order. Sorting never changes fares, selections, or booking controls, and can be
> turned off in Settings.

Specifics:

- **Single-carrier pages (united.com, alaskaair.com): automatic sorting is ON by default.** Every
  row is the same airline, so no other carrier is displaced and no cross-carrier order changes. The
  panel visibly states "Sorted by historical next-gen odds" whenever rows have been moved, and
  offers a keyboard-operable "Keep site order" control that restores the booking site's captured
  order and stops future sorting.
- **Mixed-carrier pages (Navan, Google Flights): the booking site's order is preserved by default.**
  Per-flight next-gen odds cover only United and Alaska, so automatic reordering would move
  unscored airlines down the page on the strength of data we do not have about them. Reordering
  there requires the explicit "Move scored United and Alaska flights first" action.
- **Unscored airlines are unknown, not worse.** They are never ranked below a scored flight; scored
  flights float up and unscored rows keep their relative order. A visible coverage line names which
  carriers are actually scored on that page.
- All three behaviours are user-controllable in Settings: single-carrier auto-sort, the
  mixed-carrier mode, and which metrics each row displays.
- The manifest description (under Chrome's 132-char limit) reads exactly:
  "Per-flight odds your plane has next-gen WiFi, as you search. Auto-sorts single-airline results by odds. Unofficial."
  It was changed for this release. The previous listing described a manual action, which was
  accurate at the time. Since single-carrier pages now sort automatically by default, that wording
  would under-disclose the behaviour a reviewer sees within seconds of installing.
- **Whether automatic or explicit, it only reorders validated flight-result rows.** Scored flights float up by
  odds; every unscored flight row keeps its relative order; headings, filters, banners, tools,
  pagination and loading elements never move. It never edits fares, prices, selection state, or any
  booking control, and never navigates. It is structurally incapable of changing what a flight
  costs or which flight is selected.
  - Automated proof on real united.com / Navan markup is NOT included: the E2E harness fulfils
    those hosts from local fixtures to avoid hammering the live sites. The safety claim rests on
    the code path (DOM reorder of validated flight rows only). A manual real-page spot-check before
    submission is recommended.

## Permissions justification

- `storage` — local cache of odds and the sort preferences.
- `activeTab`, `scripting` — inject the badges/panel on the supported booking sites.
- `alarms` — the trip guard's check schedule and the daily selectors refresh.
- `notifications` — tail-assignment alerts for guarded trips.
- host permission `unitedstarlinktracker.com` — fetch United odds. Alaska and Google are optional
  host permissions the user grants at runtime.

## Credit

Odds data: @martinamps' Starlink trackers. The extension is unofficial and not affiliated with
United, Alaska, Navan, Google, SpaceX, or Amazon.
