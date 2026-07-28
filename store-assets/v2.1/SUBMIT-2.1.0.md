# Chrome Web Store submission · v2.1.0

Everything needed to submit, in order. Built 28 Jul 2026.

**Package:** `store-assets/v2.1/wifi-odds-2.1.0.zip` (77 KB, 11 files)
**Branch:** `v2.1-rebrand`, cut from `main` (the 2.0.0 the store approved 28 Jul)
**Screenshots:** `store-1-popup.png`, `store-2-badges.png` (1280×800, from the real UI)

---

## ⚠️ Read this first: two decisions are yours

### 1. This package deliberately EXCLUDES the adapter refactor

There are two lines of work in this repo:

| Branch | Contains | Reviewed? |
| --- | --- | --- |
| `main` | v2.0.0 — what the store serves now | ✅ approved 28 Jul |
| `v2.1-adapters` | adapter-registry refactor, 806 insertions across 7 files | ❌ never |
| **`v2.1-rebrand`** | **main + the design rebrand only** | **this submission** |

`store-assets/RESUBMIT-after-keyword-spam-rejection.md` warned against bundling the unreviewed
adapter work into an unrelated review, and that reasoning still holds. A design rebrand is easy for
a reviewer to assess; 806 lines of changed request-handling logic is not. **If you would rather
ship the adapter work now, say so and I will rebuild from `v2.1-adapters` — but it is a bigger
review surface on an item that has been rejected once.**

### 2. The site says Guardian is unreleased. It is not.

The Tail-swap Guardian is **fully implemented and shipping in the store build today**: a state
machine in `bg.js` (trip registration, per-trip history, swap detection, budget cap), the UI in
`popup.html`, and the `alarms` + `notifications` permissions in the manifest. It is visible in the
popup screenshot.

wifiodds.com currently states it is "Built, unreleased · In no store build yet. Do not claim it."
**That is wrong and understates the product.** Two consequences:

- The store description below may legitimately mention it. I have included one restrained line.
- The website copy needs correcting when the site redesign ships. Logged.

If you would rather leave Guardian out of the listing entirely until you have used it yourself,
delete that one line — nothing else depends on it.

---

## What changed in 2.1.0

Design only. No functional change, no new permissions, no new hosts.

- Popup restyled to the wifiodds.com system: `#050505` ground, Inter, cyan→violet ramp,
  gradient wordmark and buttons.
- Injected badges recoloured for light host pages. The site's `#29d8ff` / `#926cff` are built for a
  black ground and cannot carry white text on white, so the badges use the dark-host variants of
  the same ramp: `#006a80` cyan, `#5940ac` violet. Green `#08783f` is reserved for **confirmed**
  equipment and grey `#656b76` for **unknown**, which is never rendered as a zero.
- Sort button and Google Flights chip moved onto the same ramp.
- Manifest summary rewritten to remove a three-brand list (see below).

**Not included:** the injected badge's *structure* still matches 2.0.0 (a solid pill). Codex's
concept restructures it into a white surface with a gradient status dot and separate label/value
spans, which requires changing badge markup inside `content.js`. That is a functional change and
belongs in its own version after real testing against a live booking page.

---

## Manifest summary — changed, and why

Was:

```
WiFi odds per flight while you book. Starlink, Leo and Viasat badges plus one-click sort on united.com and Navan. Unofficial.
```

Now:

```
See the odds your flight has next-generation WiFi, right in your search results. One-click sort by odds. Unofficial.
```

116 chars, under the 132 limit. The old line named three systems in a row. Google did not cite it,
but the item was rejected once for a brand roll-call and this is the same shape — not worth
re-testing the classifier on a second submission.

---

## Store listing description — paste this

```
Every flight in your search results gets a WiFi odds badge, so you can see which aircraft is likely to have next-generation satellite WiFi before you book.

WHAT IT DOES

Odds badge on every result — how often that flight number actually draws a next-generation-equipped aircraft, colour-coded so you can scan a page at a glance.

A checkmark when the aircraft is already confirmed. Tail assignments publish about 48 hours out, so the badge firms up as your departure gets closer.

One-click sort — reorders results best-odds-first wherever the site allows it, with prices and times intact.

Floating route panel — the top flights with times, click to jump to one on the page. Flips itself to the return route on the return leg.

An 18-airline scorecard in the popup, on any page: the odds of a next-generation aircraft today, and what the rest of each fleet actually runs.

A booking-to-boarding watch for a flight you have booked, so a change of aircraft after you book does not go unnoticed.

WHERE IT WORKS

united.com and Navan for corporate bookings, automatically. alaskaair.com and Google Flights ship in this version behind an optional permission you grant yourself. More sites are being added.

ABOUT THE ODDS

Route-level statistics come from the public API of unitedstarlinktracker.com, an independent community tracker that verifies each aircraft against the airline's own published amenities. Full method: https://wifiodds.com/methodology/

These are historical estimates over a route, not a guarantee about your aircraft. Equipment changes right up until departure, so check again about 48 hours before you fly.

PRIVACY

No data collection. No analytics. No accounts. Nothing leaves your device except the route lookup to that public API.

Open source: github.com/jeremyinthebay/united-starlink-companion

Unofficial. Not affiliated with or endorsed by any airline, satellite operator or data provider.
```

**Checked before writing:** no brand roll-call anywhere · one attribution mention (your standing
instruction on credit to @martinamps) · the four booking surfaces stated accurately, not "most
sites" · the not-a-guarantee caveat retained · generic disclaimer, no brand list · every claimed
feature verified present in this package.

---

## Submission steps

1. Chrome Web Store Developer Dashboard → the item (`ojpladpffbibebedfbcgbhckajbnijec`).
2. **Package** → upload `wifi-odds-2.1.0.zip`.
3. **Store listing** → replace Description with the block above.
4. Replace screenshots with `store-1-popup.png` and `store-2-badges.png`.
5. **Privacy practices** → unchanged from 2.0.0. No new permissions, so no new justifications.
6. Save draft → **Submit for review**.

Expect roughly the same review time 2.0.0 took. Nothing here touches permissions or data handling,
which is where the slow reviews come from.

---

## Verified before packaging

- `manifest.json` parses; version 2.1.0; description 116 chars.
- Popup renders on `#050505` with Inter and the gradient wordmark (screenshotted from the real file).
- Injected badges render white-on-colour on a light host, from the real `content.css`.
- Zip contains 11 files, no `.DS_Store`, no source maps, no branch-only files.
- No old-brand colours (`#0033A0`, `#0B8A47`, `#64748B`, `#1D4ED8`, `#C2410C`, `#DC2626`) remain.

## Not verified — and how you would

The extension has **not** been loaded unpacked in Chrome against a live united.com results page in
this pass. Rendering was verified from the real CSS in a browser, which catches colour and contrast
but not injection behaviour on the live DOM. Before submitting, worth 5 minutes:
`chrome://extensions` → Developer mode → Load unpacked → `extension/` → search a DEN-ORD date on
united.com and confirm badges appear and the sort button works.
