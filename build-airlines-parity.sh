#!/bin/sh
# build-airlines-parity.sh — regenerate + verify extension/airlines.js against the
# SITE's assets/airlines.js AT A PINNED COMMIT, which is the canonical model.
#
# WHY THE PIN (owner ruling, 1 Aug 2026, option (b)). This gate used to read
# $HOME/Projects/wifiodds/assets/airlines.js — the live working tree. The site
# model refreshes daily and the Web Store upload is a manual step, so a bundle
# could be verified green in the morning and uploaded stale in the afternoon
# without the gate ever noticing: the file it compared against had moved too.
# The gate now resolves the model from the git object named in release-model.pin.
# A commit id cannot drift underneath a release.
#
# WHY THE BYTE COMPARISON (Codex round 26, P1). The extension copy once claimed
# in its own header to be "byte-identical apart from this paragraph". It was not:
# 618 lines stale, and it still divided segmented fleets by RESOLVED aircraft
# only, while the site uses the whole fleet (round-18 P0-02 lower-bound ruling).
# airBaltic read 100 in the extension against the site's 51 — a fleetwide claim
# on a fleet with 27 unresolved tails, the "unknown is not zero" failure this
# project has shipped once already. A prose promise of parity is not a mechanism.
#
#   sh build-airlines-parity.sh            # verify only; exit 1 on drift
#   sh build-airlines-parity.sh --write    # regenerate from the PINNED object
#
# The header is a fixed line count so the comparison stays a plain tail.
# Overrides, used by build-airlines-parity-control.sh only:
#   SITE_REPO=<path>  which clone to resolve the pinned object out of
#   PIN_FILE=<path>   which pin to read
#   EXT_FILE=<path>   which extension copy to check
set -eu
cd "$(dirname "$0")"

SITE_REPO="${SITE_REPO:-$HOME/Projects/wifiodds}"
PIN_FILE="${PIN_FILE:-release-model.pin}"
EXT="${EXT_FILE:-extension/airlines.js}"
HEADER_LINES=20

# ---- resolve the pin -------------------------------------------------------
[ -f "$PIN_FILE" ] || { echo "FAIL: no pin file at $PIN_FILE — a release with no named model is not shippable"; exit 1; }
SITE_SHA=$(sed -n 's/^SITE_SHA=//p' "$PIN_FILE" | tr -d ' \t\r')
MODEL_BLOB=$(sed -n 's/^MODEL_BLOB=//p' "$PIN_FILE" | tr -d ' \t\r')
[ -n "$SITE_SHA" ] || { echo "FAIL: $PIN_FILE names no SITE_SHA"; exit 1; }
[ -n "$MODEL_BLOB" ] || { echo "FAIL: $PIN_FILE names no MODEL_BLOB"; exit 1; }
[ -d "$SITE_REPO/.git" ] || { echo "FAIL: no site git repo at $SITE_REPO — cannot resolve the pinned object"; exit 1; }

# Fail CLOSED if the named commit is not present. An unreachable pin must never
# fall back to the working tree; that fallback is the whole bug being fixed.
PINNED=$(mktemp)
trap 'rm -f "$PINNED"' EXIT
if ! git -C "$SITE_REPO" cat-file -e "$SITE_SHA^{commit}" 2>/dev/null; then
  echo "FAIL: pinned site commit $SITE_SHA is not in $SITE_REPO — fetch it; do NOT repin to make this pass"; exit 1
fi
if ! git -C "$SITE_REPO" show "$SITE_SHA:assets/airlines.js" > "$PINNED" 2>/dev/null; then
  echo "FAIL: $SITE_SHA has no assets/airlines.js"; exit 1
fi

# Second, independent name for the same bytes. If the commit were rewritten to
# carry a different model, the blob id would not match and this stops.
GOT_BLOB=$(git -C "$SITE_REPO" rev-parse "$SITE_SHA:assets/airlines.js")
[ "$GOT_BLOB" = "$MODEL_BLOB" ] || {
  echo "FAIL: $SITE_SHA:assets/airlines.js is blob $GOT_BLOB but the pin names $MODEL_BLOB"
  echo "      the named commit no longer carries the model this release was built from"; exit 1; }

# ---- the generated provenance header (carries the pin, so the shipped file
#      itself names the commit it came from; the auditor found that missing) --
header() {
  cat <<EOF
/* airlines.js — THE EXTENSION COPY. Generated; do not hand-edit.
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything below this header is the VERBATIM bytes of the site repository's
 * \`assets/airlines.js\` AS OF THE PINNED COMMIT NAMED BELOW — not whatever
 * happened to sit in a working tree at build time. Regenerate and verify with
 * \`sh build-airlines-parity.sh [--write]\`; the release gate runs the same
 * comparison, so drift fails a build instead of surviving in a comment.
 *
 * PINNED SITE COMMIT: $SITE_SHA
 * PINNED MODEL BLOB:  $MODEL_BLOB
 *
 * The site model refreshes daily while the Web Store upload is Jeremy's manual
 * step, so a bundle checked against "the current file" can age between build
 * and upload with the gate still green — the thing it compared against moved
 * too. Owner ruling 1 Aug 2026, option (b): the release names its commit and
 * the gate checks that git object. A promise of parity that nothing executes
 * is not parity; a parity check against a file that can change underneath it
 * is not a pin.
 * ═══════════════════════════════════════════════════════════════════════════
 */
EOF
}

if [ "${1:-}" = "--write" ]; then
  TMP=$(mktemp)
  header > "$TMP"
  cat "$PINNED" >> "$TMP"
  mv "$TMP" "$EXT"
  echo "regenerated $EXT from $SITE_REPO @ $SITE_SHA (blob $MODEL_BLOB)"
fi

FAIL=0

# 1. the generated header must be exactly HEADER_LINES long and match — which
#    now means the shipped file's recorded pin must match the pin file.
GOT_HEAD=$(head -n "$HEADER_LINES" "$EXT")
[ "$GOT_HEAD" = "$(header)" ] || { echo "FAIL: $EXT header is not the generated provenance block for pin $SITE_SHA (run --write)"; FAIL=1; }

# 2. every byte after the header must equal the PINNED object.
if ! tail -n +$((HEADER_LINES + 1)) "$EXT" | cmp -s - "$PINNED"; then
  echo "FAIL: $EXT body differs from $SITE_SHA:assets/airlines.js (run --write, then re-run the gates)"; FAIL=1
fi

# Deliberately DO NOT exit here on byte drift. The semantic check below must
# still run so the failure NAMES the airline whose published number moved —
# "bytes differ" alone would not tell anyone that airBaltic just claimed 100%
# on a fleet with 27 unresolved tails (Codex round 26 asked for exactly this).

# 3. semantic parity across ALL airlines, on the fields the surfaces read. Byte
#    equality should make this redundant, and that is the point: it is a control.
#    If these ever disagree while the bytes match, the loader is at fault.
#    Loads the PINNED object too — a semantic check against the working tree
#    would reintroduce the drift the byte check just closed.
PINNED_JS="$PINNED.js"
cp "$PINNED" "$PINNED_JS"
trap 'rm -f "$PINNED" "$PINNED_JS"' EXIT

EXT_ABS=$(cd "$(dirname "$EXT")" && pwd)/$(basename "$EXT")
EXT_JS="$EXT_ABS" SITE_JS="$PINNED_JS" node -e '
const ext = require(process.env.EXT_JS);
const site = require(process.env.SITE_JS);
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
echo "airline parity OK · extension/airlines.js is byte-identical to $SITE_SHA:assets/airlines.js below its header"
