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


---

# The reverse-engineering ladder

*The runbook for the next time united.com, alaskaair.com, a tracker page or Google Flights changes
shape. Written down because the daily refresh and every booking-page overlay depend on someone
else's HTML, and that is our single point of failure.*

## The doctrine

**Engineer tolerance around upstream. Do not fight it.**

We have no agreement with any of these sites and no notice when they change. Every hour spent
making a scraper *exactly* match today's markup is an hour spent on something that expires without
warning; every hour spent making it *survive* a change we have not seen yet keeps paying. So the
question at each rung is never "can I make this work today" — it is **"what does this cost me the
next time they redesign?"**

Three practical forms of that:

- **Remote selector manifests.** Anything fragile ships its selectors through
  `wifiodds.com/assets/selectors.json`, never hardcoded in a release. Breakage then costs a JSON
  deploy, not a store review — the difference between a two-hour fix and a two-week one. (SURFACES.md
  already makes this mandatory for any surface at DOM difficulty ≥3.)
- **Runtime re-derivation.** Never pin a token, a build hash, a CSRF value or an API version into
  code. Fetch the page and parse it out on every run, and fail loudly if the parse comes back empty.
  A value that was correct at release is a time bomb with a release-shaped fuse.
- **Graceful degradation.** A missing selector must degrade to *no badge*, never to a wrong badge and
  never to a broken host page. We are a guest on someone else's booking flow. The worst outcome is
  not "our feature is missing" — it is "their page is broken and we did it".

## The ladder — climb it in order, stop at the first rung that works

Each rung is roughly 10× the effort of the one above it. Almost every problem we have actually had
was solved on rung 1 or 2 by someone who was mentally already on rung 4.

**1. Observe before theorising.** Open DevTools → Network, do the thing by hand, and read what the
page actually asks for. Most "scraping" problems are not scraping problems: the page is rendering
from a **private JSON endpoint** that is far more stable than the DOM around it, and hitting that
directly deletes the whole problem. Check this every single time before touching a selector —
the trackers' own `/api/check-flight` is exactly this pattern, and it is why our updater reads
server-rendered pages with a cache-buster instead of driving a browser. Record the request: method,
URL, headers that actually matter, and the minimum body that still works.

**2. Anchor on semantics, never on classes.** When the DOM is genuinely the only surface, match on
things a redesign is unlikely to change and a build tool cannot mangle:
`[role=…]`, `aria-label`, visible text, `data-*` attributes with meaningful names, the flight number
itself. Hashed class names (`.css-1x9f3k`) and long descendant chains are the two most expensive
things you can depend on — they change on a deploy nobody announced, and they change *silently*.
Prefer "the element whose text matches `/^UA ?\d{1,4}$/`" over any path through a wrapper `<div>`.
Write the selector so it either finds the right node or finds nothing.

**3. Remote-patch instead of releasing.** Once a fragile selector exists, it belongs in the manifest
with a version and a fallback list, so a break is fixed by editing JSON and pushing. Ship the
fallbacks *before* they are needed: `[primary, semantic, text-match]`, tried in order, with the first
success winning. This is the rung that converts "the extension is broken and there is nothing users
can do" into "it was broken for forty minutes".

**4. Degrade silently, and say so out loud where we can be heard.** If every rung above fails, show
nothing on the host page — no badge, no error, no console spew that makes their support team think
their own site is broken. Failures go somewhere *we* look: a counter, a log line, the watchdog. The
user gets a page that works exactly as it did before we were installed.

## The two rules that follow from all of it

- **Never verify with a status code.** Grep the response body for a value you expect to have
  changed. A 200 with an empty body, a 200 from a cache, and a 200 from a healthy service are
  indistinguishable — this project has already been burned by all three. The updater's own
  verification step (above) does this correctly: it re-fetches and greps for the new `updated` date
  before it commits.
- **Write down the dead ends.** When a rung fails, put *why* in this file. The failed approach is
  worth more than the successful one, because the next person's instinct will be to try it again.

*A worked example of the doctrine, from the tracker survey (`martinamps-learnings.md` §2-A/2-B):
faced with an obfuscated JS crypto VM, the cheapest durable answer was not to reimplement the
crypto — it was to run the vendor's own script in a stubbed sandbox and let it sign the requests.
Reimplementation breaks on key rotation; the sandbox does not. Same instinct as parsing a CSRF token
out of live HTML on every run rather than pinning it: let upstream keep being the source of truth for
the part that changes, and own only the part that does not.*
