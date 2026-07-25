# Chrome Web Store — v2.0.0 submission, field by field

Everything you need is in `~/Desktop/wifiodds-store-upload/`. Work through the four pages in this
order. Do **not** hit "Submit for review" until the last step.

Two things to know before you start:

- **Title and Summary come from the package**, not from the form. They change by themselves the
  moment you upload the zip: title becomes "WiFi Odds for Flights", summary becomes the new one-line
  description. You cannot edit them on the Store listing page.
- **Every graphic is new.** The old set was v1.5 and United-only. These were captured today against
  a live v2.0.0 with the segmented ConnectScore, on united.com, alaskaair.com and Google Flights.

---

## PAGE 1 — Package

Click **Upload new package** (top right).

Upload: **`wifi-odds-v2.0.0.zip`**

After it processes, the Draft column should read:

```
Version       2.0.0
Permissions   storage, activeTab, alarms, notifications, scripting, host permission
```

`scripting` is new. If it is missing, the wrong zip went up.

---

## PAGE 2 — Store listing

Title and Summary update themselves. Only the **Description** needs replacing.

Select everything in the Description box and paste this:

```
Every flight in your search results gets a WiFi odds badge, so you can see which aircraft is likely to have Starlink before you book.

WHAT IT DOES

Odds badge on every result — how often that flight number actually draws a Starlink-equipped aircraft. Colour-coded: green 35% or better, blue 20% or better, red under 20%, grey when there is no history yet.

A checkmark when the aircraft is already confirmed. Tail assignments publish about 48 hours out, so the badge firms up as your departure gets closer.

One-click sort — reorders United's own results best-odds-first, with prices and times intact. Optional keep-sorted mode survives the page updating itself.

Floating route panel — the top flights with times, click to jump to one on the page. Flips itself to the return route on the return leg.

An 18-airline scorecard in the popup, on any page. Alaska, Hawaiian, Delta, jetBlue, American, Southwest and eleven more, each with the odds of a next-gen aircraft today and what the rest of the fleet actually runs.

WHERE IT WORKS

united.com and app.navan.com, automatically.

alaskaair.com and Google Flights are built and ship in this version behind an optional permission you grant yourself. The extension asks for nothing it is not using.

HOW THE ODDS ARE WORKED OUT

Route-level statistics come from the public API of unitedstarlinktracker.com, the independent community tracker that verifies every United tail against united.com. Fleet numbers for Alaska and Hawaiian come from the same family of trackers. Full method and the per-airline confidence tiers: https://wifiodds.com/methodology/

Probabilities are historical estimates over a route, not a guarantee about your aircraft. Equipment changes right up until departure. Check again about 48 hours before you fly.

PRIVACY

No data collection. No analytics. No accounts. Nothing leaves your device except the route lookup to the tracker's public API.

Open source: github.com/jeremyinthebay/united-starlink-companion

Unofficial. Not affiliated with, endorsed by, or sponsored by United Airlines, Alaska Airlines, SpaceX/Starlink, Amazon, Viasat, or unitedstarlinktracker.com.
```

**Category:** Travel (unchanged) · **Language:** English (unchanged)

### Graphic assets — REPLACE ALL OF THEM

The ones in the listing are v1.5 and United-only. These are captured today, with v2.0.0 loaded and
the segmented ConnectScore live, so the numbers match wifiodds.com.

**Screenshots.** Delete the two currently in the listing, then upload these four in order:

| File | What it shows |
|---|---|
| `screenshots/1-united-1280x800.png` | united.com. Green 57% on UA1812, blue 49% on UA1561, the route panel, the sort control |
| `screenshots/2-alaska-1280x800.png` | alaskaair.com. The E175 regionals at 100%, the mainline 737s at 3% |
| `screenshots/3-googleflights-1280x800.png` | Google Flights. Per-airline badges plus the cross-carrier panel |
| `screenshots/4-navan-1280x800.png` | Navan. DEN→ORD, UA617 at 69%, the corporate booking flow |

Order matters. The first is the tile most people see, and united.com is still the deepest surface.
Alaska goes second because it carries the most surprising result on the whole listing. Navan goes
last because it speaks to the smallest audience.

The Navan shot came from a live corporate account. The browser chrome is cropped off entirely, and
the account name is repainted as **Alex Morgan** in Navan's own header styling. Worth a look before
you upload, since I redacted it rather than you.

**Small promo tile:** `promo-tiles/small-tile-440x280.png`
**Marquee:** `promo-tiles/marquee-1400x560.png`

Both are rebuilt. The old pair said "Starlink odds on every United flight", which stopped being true
at v2.0.0. The marquee now carries the real route panel rather than a drawing of one.

All five are 24-bit PNG with no alpha, at the exact dimensions the store requires. I checked.

### Additional fields — both currently blank

**Homepage URL**

```
https://wifiodds.com
```

**Support URL**

```
https://github.com/jeremyinthebay/united-starlink-companion/issues
```

Filling these gives anyone with a problem somewhere to go other than a one-star review.

---

## PAGE 3 — Privacy

Four fields change, and **`scripting` needs a new box** that appears after the package upload.

### Single purpose

```
Shows the odds that a given flight will have Starlink WiFi, displayed on airline and travel-booking search results while the user is booking.
```

The old text said "for United Airlines flights on united.com search results", which no longer covers
Navan, Alaska or Google Flights and would read as a mismatch against the new host list.

### storage justification

```
Caches route-level Starlink statistics locally for about six hours and stores two UI preferences (panel collapsed, keep-sorted). Nothing leaves the device.
```

### activeTab justification

```
Lets the popup read the route (origin and destination) of the booking tab it is opened on, so it can show the odds for that route.
```

### alarms justification

```
Periodically re-checks a flight the user has chosen to watch, every three hours, so the extension can tell them when the aircraft assignment is confirmed or changes. All checks are route and flight level. No personal data is involved.
```

### notifications justification

```
Shows a local notification when a watched flight's Starlink status is confirmed or changes. Notifications are generated entirely on-device and no data leaves the machine.
```

### scripting justification — NEW, this box will be empty

```
Registers the content script on alaskaair.com and Google Flights only while the user has granted the optional permission for that site, and unregisters it the moment they revoke it. The extension does not inject anywhere the user has not explicitly approved.
```

### Host permission justification

```
united.com and app.navan.com: content script that adds a Starlink odds badge to the flight search results the user is already looking at.

unitedstarlinktracker.com: fetches public route-level Starlink statistics from its open API. This is the only outbound request the extension makes, and it contains a route and flight number, never user data.

alaskaair.com and www.google.com are optional and requested only if the user turns those sites on. The Google origin has to be the whole domain because Chrome scopes optional permissions per origin; the content script then narrows itself to google.com/travel/ and runs nowhere else on Google.
```

That last paragraph matters. A reviewer seeing a request for all of `www.google.com` will otherwise
assume the extension reads Gmail and Docs.

### Data usage

Leave all ten checkboxes **unchecked**. Leave all three certification boxes **checked**.

### Privacy policy URL

Currently `https://smithfamai.com/unitedstarlink/pri...`. That path 301-redirects to the new site,
and a redirect on a privacy policy is the kind of thing a reviewer flags. Replace with:

```
https://wifiodds.com/privacy
```

**No `.html`.** I checked both: `/privacy` returns 200 and serves the policy, `/privacy.html`
returns a 308 redirect. I had `.html` in the first draft of this file, which would have handed the
reviewer the exact redirect I am telling you to avoid.

---

## PAGE 4 — Submit

**Save draft** first, reread the Description once, then **Submit for review**.

Expect a longer review than last time. The yellow banner on the Privacy page already warns that host
permissions trigger an in-depth review, and this version adds `scripting` plus three optional
origins. Last review ran about a week; plan for longer.

---

## What I fixed before packaging

**The manifest description was 144 characters and the store limit is 132.** It would have been
rejected or silently truncated mid-sentence. Now 125.

The zip also carries the ConnectScore v3 model, so the popup shows the same numbers as the site:
United 48, Alaska 55, Hawaiian 64, Delta 49. The previous zip had the old model and would have
shipped United at 27 while wifiodds.com said 48.

## After it clears

The site describes the store version as 1.5.1 in a few places. Tell me when it is approved and I
will update those and the roadmap in one pass.
