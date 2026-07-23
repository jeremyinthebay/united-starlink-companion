# Publishing to the Chrome Web Store

Everything is prepared; the only steps that require Jeremy personally are the developer
account (payment) and clicking Submit.

## One-time setup (~10 min)
1. Go to https://chrome.google.com/webstore/devconsole and sign in with your Google account.
2. Pay the **$5 one-time** developer registration fee and verify your email.
3. (Recommended) In *Account* settings, set publisher name (e.g. "Smith Family Labs") and
   verify the `smithfamai.com` publisher website.

## Create the item
1. Developer Dashboard → **+ New item** → upload `store-assets/extension-upload.zip`.
2. **Store listing tab** — paste from below:
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
   - **Screenshots:** upload `store-assets/screenshot-1280x800.png` (add more later if desired)
   - **Small promo tile:** `store-assets/tile-440x280.png`
   - **Marquee (optional):** `store-assets/marquee-1400x560.png`
3. **Privacy tab:**
   - Single purpose: "Displays Starlink WiFi availability odds for United Airlines flights on
     united.com search results."
   - Permission justifications:
     - `storage` — caches route statistics locally for ~6h and stores two UI preferences.
     - `activeTab` — lets the popup read the route of the united.com tab it is opened on.
     - Host `united.com` — content script that displays the odds badges on search results.
     - Host `unitedstarlinktracker.com` — fetches route-level statistics from its public API.
   - Data usage: check **"Does not collect or use user data"**.
   - Privacy policy URL: `https://smithfamai.com/unitedstarlink/privacy.html`
4. **Distribution tab:** Public (or Unlisted first, to soft-launch — the install link still
   works and you can flip to Public later). All regions. Free.
5. **Submit for review.** Typical review is 1–3 days for a small-permission MV3 extension.

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
