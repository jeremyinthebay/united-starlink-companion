# Chrome Web Store submission · WiFi Odds for Flights v3.0.1

Chrome Web Store status: **not uploaded**. Jeremy performs upload and Submit manually.

## What the extension does

Adds next-generation WiFi odds to supported flight-search results and explains when the evidence is
strong enough to name a best choice. It can Guard a selected flight's dated tail assignment through
boarding and alert when the assignment changes.

## What's new in 3.0.1

- Ranked popup history no longer crowns its first row. Only the evidence-gated decision card names
  a winner.
- Every per-flight next-gen figure and ConnectScore now carries its own evidence tier, source and
  source date. Tracker responses without an as-of field say `source date not provided`.
- The Guard star is now a native keyboard-operable button with a 44-pixel target. Enter and Space
  work like click, pending requests are exposed, and a rejected add rolls back with a visible error.
- Alaska no longer shows a United-labelled prioritisation action.
- Guardian rescue copy no longer claims a same-day switch is free. It names only a confirmed
  alternative with its tail, tracker and date, or says no confirmed better option was found.
- Four future carrier-level degradation states remain in the source and are declared explicitly
  untestable until a supported host can render them.

## Sort behaviour

WiFi Odds automatically sorts supported single-carrier results by historical per-flight next-gen
odds by default. Sorting can be turned off in Settings, and the visible “Keep site order” control
restores the captured booking-site order.

On mixed-carrier Navan results, the booking site's order is preserved until the traveller chooses
to prioritize or move scored United flights. Other airlines are unscored—unknown, not worse—and
keep their relative order. Google Flights is never reordered. Sorting does not change fares,
selections, booking controls, or navigation.

## Data that leaves the device

To fetch odds, the service worker sends the following to the relevant community tracker
(`unitedstarlinktracker.com`, or `alaskastarlinktracker.com` for Alaska):

1. origin and destination airport codes for the route being viewed;
2. visible supported flight numbers used for per-flight odds; and
3. for a flight the traveller Guards, its flight number and date on the periodic check schedule.

Local post-flight “worked” / “didn't work” answers remain in `chrome.storage.local` and make no
network request. There is no account, analytics, advertising identifier, or third-party tracking.

## Permissions justification

- `storage` — local odds cache, preferences, guarded trips, and local outcome history.
- `activeTab`, `scripting` — display the extension on supported booking searches.
- `alarms` — periodic Guard checks and selector refresh.
- `notifications` — dated tail-assignment and post-flight prompts.
- `unitedstarlinktracker.com` host permission — fetch United odds.
- Alaska and Google page access remain optional permissions granted by the traveller at runtime.

## Manifest description

The listing description must quote the manifest exactly:

> Per-flight odds your plane has next-gen WiFi, as you search. Auto-sorts single-airline results by odds. Unofficial.

## Credit

Odds data: @martinamps' community Starlink trackers. The extension is unofficial and is not
affiliated with United, Alaska, Navan, Google, SpaceX, or Amazon.
