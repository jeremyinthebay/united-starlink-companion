# Phase 2 — browser E2E (extension loaded, real tracker, fixtured united.com)

Run: 2026-07-29T19:04:02.645Z
Service worker: chrome-extension://oiihcooamibbaoakhnmedaijgbopfmpe/bg.js
Console errors during run: none

## LAX→EWR — LAX-EWR-empty-with-connection
Panel rendered: **yes** · badges on page: `96%`

Checks: `{"newEmptyCopy":true,"oldContradictionGone":true,"connectionLabelled":true,"connectionPctShown":true}`

Panel text as rendered:
```
🛰️ LAX→EWR · Aug 28
↻ ▾
No direct-flight Starlink history yet. Connection estimate below.
via MCI · all-legs estimate
96%
Tail assignments publish ~48h out — firm ✓s appear closer to Aug 28.
wifiodds.com ↗
```
Screenshot: `out/shots/LAX-EWR-empty-with-connection.png`

## SFO→DEN — SFO-DEN-positive
Panel rendered: **yes** · badges on page: `★ 🛰️ 68%` `🛰️ 41%` `68%` `41%` `40%` `30%` `30%` `96%`

Checks: `{"listsUA1596":true,"noEmptyCopy":true}`

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
auto-sort by odds when the page loads
keep sorted when the page updates
via MSO · all-legs estimate
96%
Tail assignments publish ~48h out — firm ✓s appear closer to Aug 28.
wifiodds.com ↗
```
Screenshot: `out/shots/SFO-DEN-positive.png`

## SFO→SIN — united-fallback-real-odds
Panel rendered: **yes** · badges on page: `★ 🛰️ 68%` `🛰️ 16%` `68%` `16%`

Checks: `{"ua2402RealOdds":true,"ua1596RealOdds":true,"panelListsFlights":true,"noEmptyStateContradiction":true,"noBareNa":true}`

Panel text as rendered:
```
🛰️ SFO→SIN · Aug 28
↻ ▾
⭐ UA1596 · 10:30 a.m.
68%
UA2402 · 2:15 p.m.
16%
Flights in these results · per-flight odds (no Starlink route history yet)
auto-sort by odds when the page loads
keep sorted when the page updates
Tail assignments publish ~48h out — firm ✓s appear closer to Aug 28.
wifiodds.com ↗
```
Screenshot: `out/shots/united-fallback-real-odds.png`

## DEN→SFO — united-outage-unavailable
Panel rendered: **yes** · badges on page: none

Checks: `{"saysUnavailable":true,"notFalseAbsence":true}`

Panel text as rendered:
```
🛰️ DEN→SFO · Aug 28
↻ ▾
Direct-flight history unavailable right now.
Tail assignments publish ~48h out — firm ✓s appear closer to Aug 28.
wifiodds.com ↗
```
Screenshot: `out/shots/united-outage-unavailable.png`
