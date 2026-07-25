# SURFACES.md — where WiFi Odds shows up, in priority order

The product thesis in one line: **the ConnectScore has to appear where the flight
is chosen, not where it is flown.** That means booking surfaces, ranked by how
many flight decisions pass through them — not by how easy they are to build.

Owner's direction: *"nail corporate and personal booking systems, full list, most
popular to least."* This file is that list. It is the roadmap, and it is also the
honest record of what is shipped versus what is a guess.

**Status legend** — `SHIPPED` · `THIS RELEASE` · `PLANNED` (committed, phased)
· `SPIKE` (needs a feasibility probe before it can be estimated) · `BLOCKED`
(cannot be done as an extension) · `SKIP` (deliberately not doing it).

**DOM difficulty** is the honest engineering read, 1–5:

| | meaning |
|---|---|
| 1 | stable text/ARIA anchors, one page shape, flight numbers visible |
| 2 | obfuscated or rotating classes, but ARIA/text anchors hold |
| 3 | virtualized list, SPA route changes, or carrier-only rows (no flight numbers) |
| 4 | multiple coexisting UIs, or content inside iframes |
| 5 | no web surface at all, or actively hostile to injection |

Anything ≥3 must ship its selectors through the **remote selector manifest**
(`wifiodds.com/assets/selectors.json`) so breakage is a JSON deploy, not a store
review.

---

## Consumer surfaces

| # | Surface | Est. reach | DOM | Status | Phase |
|---|---|---|---|---|---|
| 1 | **Google Flights** (`google.com/travel/flights`) | ~⅓ of all US flight research starts here; by far the largest single surface | 3 | **THIS RELEASE** | 2.0 |
| 2 | **Expedia** (`expedia.com`) | Largest US OTA by flight volume; Vrbo/Hotels.com share the platform, so one integration may cover three brands | 3 | PLANNED | 2.1 |
| 3 | **Kayak** (`kayak.com`) | Meta-search, high intent per visit, smaller absolute traffic than GF | 2 | PLANNED | 2.1 |
| 4 | **Booking.com Flights** (`booking.com/flights`) | Enormous globally, still small in US flights specifically; matters most for the EU carriers (airBaltic, SAS, AF, BA) | 3 | PLANNED | 2.2 |
| 5 | **Priceline** (`priceline.com`) | Mid-size US OTA; shares Booking Holdings tech, so partly a re-skin of #4 | 3 | PLANNED | 2.2 |
| 6 | **Chase Travel** (`chase.com` / `travel.chase.com`) | Highest-value audience in the list — points bookers optimizing exactly this kind of trade-off. Small traffic, huge intent | 3 | PLANNED | 2.2 |
| 7 | **Amex Travel** (`americanexpress.com/travel`) | Same audience as #6, similar size; heavy auth-walled SPA | 4 | SPIKE | 2.5 |
| 8 | **Capital One Travel** (`travel.capitalone.com`) | Smaller than #6/#7 but the most modern stack of the three, and its own price-prediction UI is a natural neighbour for a ConnectScore chip | 3 | SPIKE | 2.5 |
| 9 | **Hopper** | Large and growing, **app-only** — no bookable web surface to inject into | 5 | **BLOCKED** | API / partnership only |

### Airline direct

| # | Surface | Est. reach | DOM | Status | Phase |
|---|---|---|---|---|---|
| 1 | **united.com** | Largest instrumented carrier: 481/1807 Starlink, live per-flight odds | 1 | **SHIPPED** | 1.0 |
| 2 | **alaskaair.com** | 99/350 and installing fast; live per-flight odds | 2 | **SHIPPED** (opt-in) | 1.6 |
| 3 | **aa.com** | Biggest US carrier by passengers, but AA has **no flying Starlink today** — a chip there would score its Viasat fleet only | 2 | PLANNED | when Airbus Starlink installs begin, **Q1 2027** |
| 4 | **delta.com** | Huge reach, zero LEO in the air until Amazon Leo lands from 2028 | 2 | **SKIP** — coarse popup score only | — |
| 5 | **hawaiianairlines.com** | Best Starlink odds of any US carrier (42/61) but a small booking surface, and its tracker publishes **no per-flight data** (probe transcript in `extension/bg.js`) — a dedicated overlay could only repeat the coarse score | 2 | SKIP this pass — HA reaches users via Google Flights + the popup | revisit if upstream adds per-flight |

---

## Corporate / managed travel

Corporate is where the *decision* is most constrained and a WiFi signal is worth
the most: the traveller often cannot pick freely, so knowing which allowed
itinerary has usable internet is the entire value. It is also the hardest DOM
work in the project.

| # | Surface | Est. reach | DOM | Status | Phase |
|---|---|---|---|---|---|
| 1 | **SAP Concur** | **The biggest single prize in this file** — the default managed-travel tool at a majority of large enterprises | 4 — two coexisting UIs (classic and the newer booking flow) plus **iframed** supplier content; needs a per-UI selector set and iframe-aware injection | PLANNED | **2.5** |
| 2 | **Amex GBT / Egencia** | Largest TMC by managed volume; Egencia is the self-service front end GBT is consolidating onto | 4 | SPIKE | 2.5 |
| 3 | **Navan** | Fast-growing mid-market default; already the third surface we ever shipped | 2 | **SHIPPED** (UA-only on purpose — Navan is multi-carrier and mixed matching regressed United) | 1.3 |
| 4 | **TravelPerk** | Strong in EU mid-market — pairs naturally with the EU Starlink carriers | 2 | PLANNED | 3.0 |
| 5 | **Spotnana** | Small direct reach, but it is the booking *engine* behind several other brands, so one integration leaks value into all of them | 3 | SPIKE | 3.0 |
| 6 | **Deem** | Mid-size, legacy-ish stack; often surfaced inside other tools | 3 | SPIKE | 3.0 |
| 7 | **Ramp Travel** | Small but fast-growing; Ramp's spend audience overlaps ours | 2 | PLANNED | 3.0 |
| 8 | **Brex Travel** | Smallest here; Spotnana-powered, so mostly free once #5 lands | 3 | PLANNED | 3.0 |

---

## Notes that change decisions

**Google Flights — Martin Amps' extension.** Martin Amps ships a **UA-only**
Google Flights Starlink indicator; it is currently **dormant**. Ours is a
**multi-airline ConnectScore across 18 carriers** with live per-flight odds on
United and Alaska — a different product that coexists with his rather than
competing. **Still offer collaboration in outreach.** He owns real data and real
distribution, and "we both built the same chip on the same page" is a better
opening than a cold pitch.

**Airline-direct overlays are the least valuable per hour of work.** A traveller
already on `united.com` has mostly decided. Meta-search and corporate tools are
where the choice is still open, which is why Google Flights outranks every
airline site including our two best-instrumented ones.

**A coarse chip is not a consolation prize.** Fourteen of the eighteen carriers
have no per-flight API anywhere, and the static ConnectScore is the only honest
answer for them. Every surface below rank 3 should ship Tier 1 (carrier-level
score) first and treat Tier 2 (live per-flight odds) as a bonus that appears when
a UA/AS flight number happens to be visible.

**Never inject into checkout, payment, or auth pages.** This is a hard rule, not
a preference — it applies to every row in both tables, and it is why the Google
Flights work gates on the path on *every* pass rather than only at injection
(these are all SPAs; the path changes under you without a reload).

**Anything at DOM difficulty ≥3 must land its selectors in the remote manifest
before it ships.** Otherwise the first redesign takes the feature down until a
store review clears, which on a Chrome extension can be days.
