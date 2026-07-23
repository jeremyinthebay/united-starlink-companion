# Daily data refresh

`data.json` is rewritten once a day by a scheduled agent (Claude in Cowork on a Mac mini). No API keys — the
tracker's pages are server-rendered, so plain fetches with a cache-buster (`?cb=<random>`) are enough.

## Sources scraped

1. `https://unitedstarlinktracker.com/` — headline: "As of <date>, X of Y United Airlines aircraft (Z%) have
   Starlink WiFi installed, including N in the last 30 days" + Mainline / Express counts.
2. `https://unitedstarlinktracker.com/fleet` — per-type equipped/total (e.g. "61/141 43%" for B737-800) and the
   mainline install pace ("~9.3/week").
3. `https://unitedstarlinktracker.com/check-flight/UA####` — one per tracked flight; each states
   "had Starlink on X of Y recent departures (Z%)" plus recently-seen aircraft.
4. `https://unitedstarlinktracker.com/routes` — optional; 48h Starlink departure counts by route.

## Update rules

- `fleet.*` replaced wholesale from sources 1–2.
- Per flight: `prob` ← check-flight percentage, `obs` ← Y, `conf` = low (<10) / medium (10–15) / high (16+).
- Verdicts recomputed per direction: top prob = `best`; ≥35 = `good`; 20–34 = `ok` (or `risky` if typically a
  737 MAX / A319/A320 / 757 — 0% fleets); <20 = `avoid`.
- `history` gets one appended entry per day `{date, equipped, total, mainline, express}`; never trimmed.
  This array feeds the page's trend chart.
- `confirmed48h` is a dated snapshot; left alone unless fresher tail confirmations are available.

## Verification

The updater validates the JSON parses, then confirms the **live response body** (never just a status code)
contains the new `updated` date before committing.
