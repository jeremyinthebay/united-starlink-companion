# Phase 1 — API route matrix

Run: 2026-07-29T17:01:16.780Z · throttle 1300ms · 17 routes · 72 requests
Roster: 485 equipped tails, updated 2026-07-29

Findings: 4 MEDIUM · 4 INFO

## Findings

### [MEDIUM] DISPLAY-CONTRADICTION — SFO→EWR
Panel prints "No Starlink history on this route yet." and then renders a connection row "GEG+ORD (connection) 55%" directly beneath it. The empty-state copy contradicts the Starlink connection shown on the next line; a reader is told "no history" above a 55% option.
`{"via":["GEG","ORD"],"joint":55}`

### [MEDIUM] DISPLAY-CONTRADICTION — EWR→SFO
Panel prints "No Starlink history on this route yet." and then renders a connection row "MCI+LAX (connection) 49%" directly beneath it. The empty-state copy contradicts the Starlink connection shown on the next line; a reader is told "no history" above a 49% option.
`{"via":["MCI","LAX"],"joint":49}`

### [MEDIUM] DISPLAY-CONTRADICTION — LAX→EWR
Panel prints "No Starlink history on this route yet." and then renders a connection row "MCI (connection) 96%" directly beneath it. The empty-state copy contradicts the Starlink connection shown on the next line; a reader is told "no history" above a 96% option.
`{"via":["MCI"],"joint":96}`

### [MEDIUM] DISPLAY-CONTRADICTION — SFO→BOS
Panel prints "No Starlink history on this route yet." and then renders a connection row "GEG+ORD (connection) 73%" directly beneath it. The empty-state copy contradicts the Starlink connection shown on the next line; a reader is told "no history" above a 73% option.
`{"via":["GEG","ORD"],"joint":73}`

### [INFO] EMPTY-BOTH — JFK→LAX
No direct history and no connection ≥50%. Panel shows "No Starlink history on this route yet." — accurate.

### [INFO] EMPTY-BOTH — SFO→LHR
No direct history and no connection ≥50%. Panel shows "No Starlink history on this route yet." — accurate.

### [INFO] EMPTY-BOTH — DEN→ASE
No direct history and no connection ≥50%. Panel shows "No Starlink history on this route yet." — accurate.

### [INFO] HINT-SURPRISE — DEN→ASE
Hinted narrowbody but panel is empty (no direct history, no connection).

## Route matrix

plan = /api/plan-route HTTP status · conn = full-coverage connection row the panel appends · ⚠ = empty-state copy shown above a real connection

| Route | Hint | Direct | plan | Panel would display | Connection row | ⚠ |
|---|---|---:|---:|---|---|:--:|
| SFO→DEN | narrowbody | 5 | 200 | UA1596 68%, UA1214 41%, UA2019 40%, UA1758 30%, U… | MSO 96% |  |
| DEN→SFO | narrowbody | 7 | 200 | UA1812 63%, UA1561 51%, UA1007 46%, UA2123 45%, U… | SUN 98% |  |
| DEN→ORD | narrowbody | 9 | 200 | UA2085 61%, UA2315 58%, UA2329 56%, UA1377 51%, U… | MTJ 96% |  |
| ORD→EWR | narrowbody | 7 | 200 | UA2329 56%, UA534 53%, UA485 47%, UA2295 43%, UA1… | RDU 97% |  |
| IAH→DEN | narrowbody | 7 | 200 | UA2643 62%, UA2339 43%, UA1450 40%, UA484 36%, UA… | LIT 97% |  |
| LGA→ORD | narrowbody | 12 | 200 | UA1098 69%, UA2446 64%, UA623 50%, UA1830 49%, UA… | IAD+YYZ 97% |  |
| DEN→LAS | narrowbody | 5 | 200 | UA526 66%, UA2338 63%, UA655 57%, UA716 33%, UA23… | — |  |
| IAD→ORD | narrowbody | 5 | 200 | UA1775 76%, UA1252 47%, UA2497 40%, UA1393 2%, UA… | RDU 96% |  |
| SFO→EWR | widebody | 0 | 200 | No Starlink history on this route yet. | GEG+ORD 55% | ⚠ |
| EWR→SFO | widebody | 0 | 200 | No Starlink history on this route yet. | MCI+LAX 49% | ⚠ |
| LAX→EWR | widebody | 0 | 200 | No Starlink history on this route yet. | MCI 96% | ⚠ |
| SFO→BOS | widebody | 0 | 200 | No Starlink history on this route yet. | GEG+ORD 73% | ⚠ |
| JFK→LAX | widebody | 0 | 200 | No Starlink history on this route yet. | — |  |
| SFO→LHR | widebody | 0 | 200 | No Starlink history on this route yet. | — |  |
| EWR→LHR | widebody | 1 | 200 | UA14 12% | — |  |
| DEN→ASE | narrowbody | 0 | 200 | No Starlink history on this route yet. | — |  |
| ORD→MSN | narrowbody | 1 | 200 | UA630 42% | — |  |

## Endpoint parity (route-table % vs predict-flight %)

| Flight | route-table | predict-flight | Δ |
|---|---:|---:|---:|
| UA1596 | 68% | 68% | 0 |
| UA1214 | 41% | 41% | 0 |
| UA2019 | 40% | 40% | 0 |
| UA1812 | 63% | 63% | 0 |
| UA1561 | 51% | 51% | 0 |
| UA1007 | 46% | 46% | 0 |
| UA2085 | 61% | 61% | 0 |
| UA2315 | 58% | 58% | 0 |
| UA2329 | 56% | 56% | 0 |
| UA2329 | 56% | 56% | 0 |
| UA534 | 53% | 53% | 0 |
| UA485 | 47% | 47% | 0 |
| UA2643 | 62% | 62% | 0 |
| UA2339 | 43% | 43% | 0 |
| UA1450 | 40% | 40% | 0 |
| UA1098 | 69% | 69% | 0 |
| UA2446 | 64% | 64% | 0 |
| UA623 | 50% | 50% | 0 |
| UA526 | 66% | 66% | 0 |
| UA2338 | 63% | 63% | 0 |
| UA655 | 57% | 57% | 0 |
| UA1775 | 76% | 76% | 0 |
| UA1252 | 47% | 47% | 0 |
| UA2497 | 40% | 40% | 0 |
| UA14 | 12% | 12% | 0 |
| UA630 | 42% | 42% | 0 |

## check-flight sample (vs our roster)

| Flight | Date | Status | Tail | In our roster? | predict-flight |
|---|---|---|---|---|---:|
| UA1 | 2026-07-31 | no | N81107 | no | 0% |
| UA1 | 2026-08-01 | early | — | — | 0% |
| UA2402 | 2026-07-31 | early | — | — | 16% |
| UA2402 | 2026-08-01 | early | — | — | 16% |
| UA1596 | 2026-07-31 | yes | N73275 | yes | 68% |
| UA1596 | 2026-08-01 | early | — | — | 68% |
| UA2019 | 2026-07-31 | early | — | — | 40% |
| UA2019 | 2026-08-01 | early | — | — | 40% |
| UA5693 | 2026-07-31 | yes | N85369 | yes | 99% |
| UA5693 | 2026-08-01 | early | — | — | 99% |
