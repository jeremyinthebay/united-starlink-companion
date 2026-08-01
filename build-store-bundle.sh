#!/bin/sh
# build-store-bundle.sh — assemble the Chrome Web Store handoff bundle with an
# EXACT allowlist. Fixes Codex P1-04: `zip` appends to an existing archive, so an
# old build's screenshots survived; this always builds from a clean staging dir
# and then verifies the packed contents against a whitelist (fails on any extra
# file, and on any store screenshot that is not 1280×800).
set -e
VER=$(node -e "console.log(require('./extension/manifest.json').version)")
ADIR=v$(printf '%s' "$VER" | cut -d. -f1,2)   # asset folder is major.minor, e.g. v2.2
STAGE=$(mktemp -d)/wifiodds-v${VER}-store-bundle
OUT="dist/wifiodds-v${VER}-store-bundle.zip"

# Always rebuild the upload package first. The bundle must never wrap whichever
# package happened to be left in dist/ by an earlier build.
sh ./build-store-zip.sh

mkdir -p "$STAGE/store-screenshots" "$STAGE/promo-tiles" dist
cp "dist/wifiodds-v${VER}.zip" "$STAGE/wifi-odds-extension-${VER}.zip"
cp "dist/wifiodds-v${VER}.files.sha256" "$STAGE/"
cp "store-assets/${ADIR}/SUBMIT-${VER}.md" "$STAGE/"

# EXACTLY the four cleared real-site screenshots, captured 1 Aug 2026 and
# retained unchanged across the later model refresh. Never a mocked-up backdrop.
# Owner ruling 1 Aug 2026: reuse these files; do not recapture them.
cp "store-assets/${ADIR}/real/store-1-united-1280x800.png"        "$STAGE/store-screenshots/"
cp "store-assets/${ADIR}/real/store-2-googleflights-1280x800.png" "$STAGE/store-screenshots/"
cp "store-assets/${ADIR}/real/store-3-alaska-1280x800.png"        "$STAGE/store-screenshots/"
cp "store-assets/${ADIR}/real/store-4-navan-1280x800.png"         "$STAGE/store-screenshots/"
# Brand tiles (not version-specific).
cp store-assets/v2.1/promo-marquee-1400x560.png store-assets/v2.1/promo-small-440x280.png store-assets/v2.1/store-icon-128.png "$STAGE/promo-tiles/"

cat > "$STAGE/UPLOAD-CHECKLIST.txt" <<EOF
WiFi Odds v${VER} — Chrome Web Store upload set (exact)
  Package:      wifi-odds-extension-${VER}.zip
  Screenshots:  store-screenshots/store-1-united-1280x800.png          (1st)
                store-screenshots/store-2-googleflights-1280x800.png   (2nd)
                store-screenshots/store-3-alaska-1280x800.png          (3rd)
                store-screenshots/store-4-navan-1280x800.png           (4th)
  Screenshot provenance: real-site captures of extension 3.0.0, taken 1 Aug
    2026 and retained unchanged across the later model refresh. Never mocked up.
  Promo tile:   promo-tiles/promo-marquee-1400x560.png
  Small tile:   promo-tiles/promo-small-440x280.png
  Icon:         promo-tiles/store-icon-128.png
  Field copy + privacy disclosure: SUBMIT-${VER}.md
Do NOT upload anything not listed here.
EOF

rm -f "$OUT"
( cd "$(dirname "$STAGE")" && zip -r -X "$OLDPWD/$OUT" "$(basename "$STAGE")" >/dev/null )
echo "built $OUT"

# ── verify packed contents against the allowlist ──────────────────────────────
TMP=$(mktemp -d); unzip -q "$OUT" -d "$TMP"; B="$TMP/$(basename "$STAGE")"
ALLOW="wifi-odds-extension-${VER}.zip
wifiodds-v${VER}.files.sha256
SUBMIT-${VER}.md
UPLOAD-CHECKLIST.txt
store-screenshots/store-1-united-1280x800.png
store-screenshots/store-2-googleflights-1280x800.png
store-screenshots/store-3-alaska-1280x800.png
store-screenshots/store-4-navan-1280x800.png
promo-tiles/promo-marquee-1400x560.png
promo-tiles/promo-small-440x280.png
promo-tiles/store-icon-128.png"
GOT=$(cd "$B" && find . -type f | sed 's#^\./##' | sort)
if [ "$(printf '%s\n' "$ALLOW" | sort)" != "$GOT" ]; then
  echo "FAIL: bundle contents do not match the allowlist:"; printf '%s\n' "$GOT"; exit 1
fi
# store screenshots must be exactly 1280×800.
for png in "$B"/store-screenshots/*.png; do
  W=$(sips -g pixelWidth "$png" | awk '/pixelWidth/{print $2}')
  Hh=$(sips -g pixelHeight "$png" | awk '/pixelHeight/{print $2}')
  [ "$W" = "1280" ] && [ "$Hh" = "800" ] || { echo "FAIL: $(basename "$png") is ${W}x${Hh}, not 1280x800"; exit 1; }
done
echo "bundle OK · allowlist matched · 4 store screenshots 1280x800 · sha256 $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
rm -rf "$TMP"
