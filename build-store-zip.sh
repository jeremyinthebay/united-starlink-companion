#!/bin/sh
# build-store-zip.sh — build the Chrome Web Store package from the EXACT committed
# tree, never the working tree. git archive reads committed blobs, so uncommitted
# edits (e.g. work-in-progress icons) can never leak into a release. Then it
# unpacks the zip and verifies it (Codex #6: verify against the unpacked zip).
set -e
VER=$(node -e "console.log(require('./extension/manifest.json').version)")
SHA=$(git rev-parse --short HEAD)
OUT="dist/wifiodds-v${VER}.zip"
mkdir -p dist
rm -f "$OUT"
git archive --format=zip -o "$OUT" HEAD:extension
echo "built $OUT from commit $SHA"

# verify against the unpacked zip
TMP=$(mktemp -d)
unzip -q "$OUT" -d "$TMP"
PKGVER=$(node -e "console.log(require('$TMP/manifest.json').version)")
[ "$PKGVER" = "$VER" ] || { echo "FAIL: manifest version $PKGVER != $VER"; exit 1; }
node --check "$TMP/bg.js"
node --check "$TMP/content.js"
node --check "$TMP/popup.js"
# manifest must sit at the zip root, and no dot-junk may ship
[ -f "$TMP/manifest.json" ] || { echo "FAIL: manifest.json not at zip root"; exit 1; }
if find "$TMP" -name '.DS_Store' | grep -q .; then echo "FAIL: .DS_Store in package"; exit 1; fi
echo "package OK · v$VER · sha256 $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
rm -rf "$TMP"
