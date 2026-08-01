# dev/ — the reload bridge. NOTHING HERE SHIPS.

Chrome pins an unpacked extension's code at load time. A new tab does not re-read it, and
`chrome://extensions` is unreachable to an agent driving the browser, so every code change used to
need a human to click the reload arrow. That cost three interruptions in one night and, worse, it
silently invalidates screenshots: the browser keeps rendering an older build while the repo has
moved on, and nothing on screen says so.

## Why this is a SEPARATE extension, not a flag inside the product

The obvious design — a WebSocket or localhost poll inside `extension/bg.js`, gated by a dev flag —
is wrong here, and the reason is worth writing down so nobody "simplifies" it back:

**Any network access needs `host_permissions` declared in `manifest.json`, and that manifest ships.**
A store listing carrying `http://127.0.0.1/*` is a privacy red flag, a review risk, and a promise
the product does not need to make. A dev flag in code does not help, because the permission is
declared in data, not code.

So the bridge is a second, tiny, unpacked extension that never goes near the store ZIP. It holds the
`management` permission and the localhost permission. The product extension is untouched: the diff
across `extension/` for this feature is empty, which is the property that makes it safe.

## One-time setup

1. Start the server (leave it running):

       node ~/Projects/united-starlink-companion/dev/reload-server.mjs

2. In Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** →
   `~/Projects/united-starlink-companion/dev/reloader-extension`

   It appears as **WiFi Odds dev reloader**. Load it once and never touch it again.

## Using it

From any shell:

    curl -s -X POST localhost:8391/reload

The reloader wakes, finds every *development-installed* extension whose name matches
`WiFi Odds for Flights`, and disables then re-enables it, which makes Chrome re-read the code from
disk. Reload the page under test and you are on current code.

`curl -s localhost:8391/status` reports the last reload and whether the reloader has checked in.

## How it stays alive

MV3 service workers idle out after about 30 seconds, so a polling loop would die between reloads.
The reloader instead holds a **long poll**: it issues a fetch the server does not answer for up to
25 seconds. A pending fetch keeps the worker alive; when the server answers, either with "reload" or
with a timeout, the worker acts and immediately re-issues. That is why the request appears to hang.
It is supposed to.

## The safety property, and how it is enforced

`build-store-zip.sh` builds the package from `git ls-tree HEAD:extension`, so anything outside
`extension/` is structurally incapable of shipping. That is the primary guarantee.

On top of it the packaging gate now asserts, against the PACKAGED bytes rather than the source tree,
that the shipped manifest declares no `management` permission and no loopback host permission, and
that no shipped file mentions `127.0.0.1` or `localhost`. Both controls are proved to fail on a
deliberate bad input, because a guard nobody has watched fail is not a guard.
