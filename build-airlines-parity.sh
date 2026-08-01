#!/bin/sh
# build-airlines-parity.sh — regenerate + verify extension/airlines.js against the
# SITE's assets/airlines.js, which is the canonical model.
#
# WHY (Codex round 26, P1). The extension copy claimed in its own header to be
# "byte-identical apart from this paragraph". It was not: it was 618 lines stale
# and still divided segmented fleets by RESOLVED aircraft only, while the site
# uses the whole fleet (the round-18 P0-02 lower-bound ruling). Eight of eighteen
# airlines disagreed. airBaltic read 100 in the extension against the site's 51 —
# a fleetwide claim on a fleet with 27 unresolved tails, which is precisely the
# "unknown is not zero" failure this project has shipped once already.
#
# A prose promise of parity is not a mechanism. So the extension file is now
# EXACTLY a fixed provenance header followed by the site file's verbatim bytes,
# and parity is a byte comparison any caller can run:
#
#   sh build-airlines-parity.sh            # verify only; exit 1 on drift
#   sh build-airlines-parity.sh --write    # regenerate from the site, then verify
#
# The header is deliberately a fixed line count so the comparison is a plain
# tail. If the site file is unreachable this exits nonzero rather than passing.
set -eu
cd "$(dirname "$0")"
SITE="$HOME/Projects/wifiodds/assets/airlines.js"
EXT="extension/airlines.js"
HEADER_LINES=14

[ -f "$SITE" ] || { echo "FAIL: canonical site file not found at $SITE"; exit 1; }

header() {
  cat <<'EOF'
/* airlines.js — THE EXTENSION COPY. Generated; do not hand-edit.
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything below this header is the VERBATIM bytes of the site repository's
 * `assets/airlines.js`, which owns the model. Regenerate and verify with
 * `sh build-airlines-parity.sh [--write]`; the release gate runs the same
 * comparison, so drift fails a build instead of surviving in a comment.
 *
 * This replaces a header that CLAIMED byte-identity while the file was 618
 * lines stale and still divided segmented fleets by resolved aircraft only.
 * That made airBaltic read 100 where the site published its 51 whole-fleet
 * floor, against 27 unresolved tails. Unknown is not zero, and a promise of
 * parity that nothing executes is not parity (Codex round 26, P1).
 * ═══════════════════════════════════════════════════════════════════════════
 */
EOF
}

if [ "${1:-}" = "--write" ]; then
  TMP=$(mktemp)
  header > "$TMP"
  cat "$SITE" >> "$TMP"
  mv "$TMP" "$EXT"
  echo "regenerated $EXT from $SITE"
fi

FAIL=0

# 1. the generated header must be exactly HEADER_LINES long and match.
GOT_HEAD=$(head -n "$HEADER_LINES" "$EXT")
[ "$GOT_HEAD" = "$(header)" ] || { echo "FAIL: $EXT header is not the generated provenance block (run --write)"; FAIL=1; }

# 2. every byte after the header must equal the site file.
if ! tail -n +$((HEADER_LINES + 1)) "$EXT" | cmp -s - "$SITE"; then
  echo "FAIL: $EXT body differs from $SITE (run --write, then re-run the gates)"; FAIL=1
fi

# Deliberately DO NOT exit here on byte drift. The semantic check below must
# still run so the failure NAMES the airline whose published number moved —
# "bytes differ" alone would not tell anyone that airBaltic just claimed 100%
# on a fleet with 27 unresolved tails (Codex round 26 asked for exactly this).

# 3. semantic parity across ALL airlines, on the fields the surfaces read. Byte
#    equality should make this redundant, and that is the point: it is a control.
#    If these ever disagree while the bytes match, the loader is at fault.
node -e '
const ext = require("./extension/airlines.js");
const site = require(process.env.HOME + "/Projects/wifiodds/assets/airlines.js");
const keys = Object.keys(ext.WIFI_AIRLINES);
const FIELDS = ["score","nextGenScore","nextGenShare","nextGenPublished","floor","ceiling",
  "known","unresolved","serviceTier","fleetStatus","coverage","resolvedSubsetScore"];
let bad = 0;
if (keys.length !== Object.keys(site.WIFI_AIRLINES).length) { console.log("FAIL: airline count differs"); bad++; }
for (const k of keys) {
  const a = ext.scoreAirline(k), b = site.scoreAirline(k);
  if (!a || !b) { console.log("FAIL: " + k + " missing on one side"); bad++; continue; }
  for (const f of FIELDS) {
    if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) {
      console.log("FAIL: " + k + "." + f + " ext=" + JSON.stringify(a[f]) + " site=" + JSON.stringify(b[f])); bad++;
    }
  }
}
for (const n of ["WIFI_AIRLINES","scoreAirline","rankAirlines","SCORE_METHOD_LINE","SCORE_CAVEAT"])
  if (ext[n] === undefined) { console.log("FAIL: extension no longer exports " + n); bad++; }
if (bad) process.exit(1);
console.log("semantic parity OK · " + keys.length + " airlines · " + FIELDS.length + " fields each");
' || FAIL=1

[ "$FAIL" = 0 ] || { echo "airline parity FAILED — do not ship"; exit 1; }
echo "airline parity OK · extension/airlines.js is byte-identical to the site model below its header"
