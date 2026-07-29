# Phase 2 — browser E2E (extension loaded, real tracker, fixtured united.com)

Run: 2026-07-29T17:04:44.280Z
Service worker: chrome-extension://oiihcooamibbaoakhnmedaijgbopfmpe/bg.js
Console errors during run: none

## LAX→EWR — LAX-EWR-contradiction
Panel rendered: **yes** · badges on page: `96%`

Checks: `{"hasEmptyState":true,"hasConnection":true,"connectionPct":"96"}`

Panel text as rendered:
```
🛰️ LAX→EWR · Aug 28
↻ ▾
No Starlink history on this route yet.
via MCI (connection)
96%
Tail assignments publish ~48h out — firm ✓s appear closer to Aug 28.
full plan ↗ · tracker ↗
```
Screenshot: `out/shots/LAX-EWR-contradiction.png`

## SFO→DEN — SFO-DEN-positive
Panel rendered: **yes** · badges on page: `★ 🛰️ 68%` `🛰️ 41%` `68%` `41%` `40%` `30%` `30%` `96%`

Checks: `{"listsUA1596":true,"notEmpty":true}`

Panel text as rendered:
```
🛰️ SFO→DEN · Aug 28
↻ ▾
⭐ UA1596 · 8:30 a.m.
68%
UA1214 · 11:05 a.m.
41%
UA2019 · not in results
40%
UA1758 · not in results
30%
UA540 · not in results
30%
⇅ Sort page by Starlink odds
auto-sort by odds when the page loads
keep sorted when the page updates
via MSO (connection)
96%
Tail assignments publish ~48h out — firm ✓s appear closer to Aug 28.
full plan ↗ · tracker ↗
```
Screenshot: `out/shots/SFO-DEN-positive.png`
