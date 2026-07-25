# Publishing to the Chrome Web Store

Everything is prepared; the only steps that require Jeremy personally are the developer
account (payment) and clicking Submit.

## One-time setup (~10 min)
1. Go to https://chrome.google.com/webstore/devconsole and sign in with your Google account.
2. Pay the **$5 one-time** developer registration fee and verify your email.
3. (Recommended) In *Account* settings, set publisher name (e.g. "Smith Family Labs") and
   verify the `wifiodds.com` publisher website.

## Create the item
1. Developer Dashboard → **+ New item** → upload `store-assets/extension-upload.zip`.
2. **Store listing tab** — paste from below.
   *(This block is the shipped v1.5.x/1.6 copy. For the 2.0 submission use
   **“v2.0 SUBMISSION COPY (WiFi Odds rename)”** near the bottom of this file instead.)*
   - **Name:** Starlink Odds for United Flights
   - **Summary:** See every United flight's Starlink WiFi odds while you book: badges on united.com, rankings, one-click sort. Unofficial.
   - **Category:** Travel  ·  **Language:** English
   - **Description:**

     ```
     Wondering if your United flight will have free Starlink WiFi? This extension overlays the
     odds directly on united.com search results while you book.

     ★ Odds badge on every flight — how often that flight number draws a Starlink-equipped
       aircraft (gold ≥50%, green ≥35%, blue ≥20%, red <20%; gray n/a = no history yet)
     ★ ✓ marks when a flight already has a confirmed Starlink tail assigned (shown only when
       your travel date is close enough for assignments to exist)
     ★ One-click "Sort page by Starlink odds" — reorders United's actual results, with an
       optional keep-sorted mode
     ★ Floating route panel: top flights with times, click to jump to a flight on the page,
       near-guaranteed regional-jet connections
     ★ Round-trip aware: automatically flips to the return route on the return-leg screen
     ★ Popup works on any route, anywhere

     Privacy: no data collection, no analytics, no accounts. Route-level statistics come from
     the public API of unitedstarlinktracker.com, the independent community tracker that
     verifies every United tail against united.com — all credit to them for the data.
     Open source: github.com/jeremyinthebay/united-starlink-companion

     Unofficial. Not affiliated with, endorsed by, or sponsored by United Airlines, SpaceX/
     Starlink, or unitedstarlinktracker.com. Probabilities are historical estimates, not
     guarantees — verify your aircraft ~48h before departure.
     ```
   - **Screenshots (v1.5.1):** upload `store-assets/screenshot-united-1280x800.png` and `store-assets/screenshot-navan-1280x800.png` — the extension now works on both united.com and Navan. (`store-assets/screenshot-1280x800.png` is the older single United shot.)
   - **Small promo tile:** `store-assets/tile-440x280.png`
   - **Marquee (optional):** `store-assets/marquee-1400x560.png`
3. **Privacy tab:**
   - Single purpose: "Displays Starlink WiFi availability odds for United Airlines flights on
     united.com search results."
   - Permission justifications:
     - `storage` — caches route statistics locally for ~6h, stores UI preferences and the
       user's locally-kept watched-flight list.
     - `activeTab` — lets the popup read the route of the united.com tab it is opened on.
     - `alarms` — periodically re-checks the user's watched flights (every 3h) so the
       T-48h tail-assignment alert can fire.
     - `notifications` — shows a local notification when a watched flight's Starlink
       status is confirmed or changes. No data leaves the device.
     - Host `united.com` — content script that displays the odds badges on search results.
     - Host `unitedstarlinktracker.com` — fetches route-level statistics from its public API.
   - Data usage: check **"Does not collect or use user data"**.
   - Privacy policy URL: `https://wifiodds.com/privacy.html`
4. **Distribution tab:** Public (or Unlisted first, to soft-launch — the install link still
   works and you can flip to Public later). All regions. Free.
5. **Submit for review.** Typical review is 1–3 days for a small-permission MV3 extension.

---

# v2.0 SUBMISSION COPY (WiFi Odds rename)

**Use this block, not the 1.5.x one above, for the 2.0 upload.** The extension is no longer
United-only: it covers united.com, alaskaair.com and Navan, and the popup now carries a coarse
ConnectScore for 18 airlines. The item name changes in the same submission (a rename is allowed
on an existing item — the extension ID, install base and reviews carry over).

- **Name:** `WiFi Odds for Flights`
- **Summary (128 chars, limit 132):**

  ```
  WiFi odds per flight while you book: Starlink, Amazon Leo, Viasat badges + sort on united.com, alaskaair.com, Navan. Unofficial.
  ```

  *(Identical to `manifest.json` → `description`. Keep the two in sync; re-count before editing —
  the Chrome Web Store hard-limits both at 132 characters.)*

- **Category:** Travel · **Language:** English
- **Description:**

  ```
  Will your flight have usable WiFi? WiFi Odds answers that while you are still choosing the
  flight — a colored odds badge on every result on united.com, alaskaair.com and Navan, plus a
  one-click sort that floats the best-connected flights to the top.

  ★ Per-flight odds badge — how often that exact flight number draws a Starlink-equipped
    aircraft (gold ≥50%, green ≥35%, blue ≥20%, red <20%; gray n/a = no history yet)
  ★ ✓ when a confirmed Starlink tail is already assigned for your date
  ★ One-click "Sort page by odds" — reorders the airline's own results, with an optional
    keep-sorted mode
  ★ Floating route panel: top flights with departure times, click one to jump straight to it
  ★ Guardian — watch a flight from booking to boarding and get a local alert if a tail swap
    gains or loses Starlink, with a same-day alternative when it loses it
  ★ ConnectScore — a coarse 0–100 WiFi score for 18 airlines in the popup: which satellite
    system they fly (Starlink, Amazon Leo, Viasat), how much of the fleet is equipped, and
    whether it is free to you
  ★ Round-trip aware, and the popup works for any route, from any tab

  Credits: the per-flight statistics come from the public APIs of unitedstarlinktracker.com and
  alaskastarlinktracker.com — the independent community trackers built by @martinamps, which
  verify each aircraft tail against the airline's own schedule. All credit for that data is
  theirs; this extension only puts it where you are booking.

  Privacy: no accounts, no sign-in, no analytics, no tracking, no data collection. Nothing you
  type or browse leaves your machine except an anonymous route or flight-number lookup to the
  trackers above. Watched flights live in local browser storage only.
  Open source: github.com/jeremyinthebay/united-starlink-companion

  Unofficial. Not affiliated with, endorsed by, or sponsored by United Airlines, Alaska Airlines,
  Navan, SpaceX/Starlink, Amazon Leo, Viasat, or the trackers named above. ConnectScore and the
  per-flight odds are historical estimates, not guarantees — verify your aircraft ~48h before
  departure.
  ```

- **Screenshots:** reuse `store-assets/screenshot-united-1280x800.png` and
  `store-assets/screenshot-navan-1280x800.png`; add an alaskaair.com shot and a popup shot
  showing the ConnectScore list before submitting.

## v2.0 privacy tab

- **Single purpose:** "Shows the probability that a given flight has satellite WiFi (Starlink,
  Amazon Leo or Viasat) directly on airline booking pages, so the traveler can pick a
  better-connected flight."
- **Data usage:** still **"Does not collect or use user data."**
- **Privacy policy URL:** `https://wifiodds.com/privacy.html`

### Permission justifications (v2.0)

- `storage` — caches route statistics locally for ~6h, plus UI preferences and the user's own
  watched-flight list. Never leaves the device.
- `activeTab` — lets the popup read the route of the booking tab it was opened on.
- `alarms` — re-checks watched flights every 3h so a tail-swap alert can fire, and refreshes the
  page-selector manifest once a day.
- `notifications` — local desktop notification when a watched flight's WiFi status changes
  (assignment published, or a tail swap gained/lost Starlink). No data leaves the device.
- `scripting` — registers the content script at runtime for host permissions the user has
  optionally granted (currently alaskaair.com), and unregisters it the moment access is revoked.
- Host `united.com` — content script that draws the odds badges on search results.
- Host `app.navan.com` — same content script for users who book through Navan.
- Host `unitedstarlinktracker.com` — fetches route- and flight-level statistics from its public
  API. (`alaskastarlinktracker.com` needs no host permission: it answers with an open CORS
  header, so the service worker reaches it under plain CORS.)

### Optional permission justification — `alaskaair.com`

Requested **only** at runtime, never at install. The popup shows an "Enable on alaskaair.com"
button; clicking it calls `chrome.permissions.request()` from that user gesture. Granting it
registers the same content script that already runs on united.com so the odds badges appear on
Alaska's results, and revoking it in `chrome://extensions` unregisters the script immediately.
Nothing from an alaskaair.com page is transmitted anywhere — the script only reads flight
numbers already visible on screen and asks the tracker API about them. Declaring it optional
keeps the install-time permission prompt limited to United users, who are the majority.

## Notes / risks
- **Trademarks:** the name uses "for United Flights" (descriptive) rather than leading with a
  brand, the listing declares non-affiliation, and the icon is generic — this is the standard
  posture for companion extensions, but a reviewer can still flag brand names. If rejected on
  naming, resubmit as "Flight WiFi Odds for United" — same listing otherwise.
- **Updates:** bump `version` in manifest.json, re-zip, upload in the dashboard — reviews for
  updates are usually faster. Keep the GitHub repo the source of truth.
- The tracker folks' own Google Flights extension is complementary — consider coordinating
  with @martinamps before/at launch; co-promotion helps both.

## Regenerating the upload zip
```
cd extension && zip -r ../store-assets/extension-upload.zip . -x "*.DS_Store"
```
