#!/bin/sh
# build-store-zip.sh — build the Chrome Web Store package from the EXACT committed
# tree, never the working tree. git archive reads committed blobs, so uncommitted
# edits (e.g. work-in-progress icons) can never leak into a release.
#
# CONTENT IDENTITY, not byte reproducibility (Codex P2-01): a ZIP carries build-
# time timestamps, so two archives of the same commit differ byte-for-byte. What
# IS deterministic and audit-worthy is the per-file content. This script emits a
# per-file sha256 manifest and verifies the unpacked package against it. The
# claim is "the unpacked files are exactly the committed tree", provable by
# recomputing the manifest — not "the .zip is byte-identical across builds".
set -e
VER=$(node -e "console.log(require('./extension/manifest.json').version)")
SHA=$(git rev-parse --short HEAD)
OUT="dist/wifiodds-v${VER}.zip"
MAN="dist/wifiodds-v${VER}.files.sha256"
mkdir -p dist
rm -f "$OUT" "$MAN"
git archive --format=zip -o "$OUT" HEAD:extension
echo "built $OUT from commit $SHA"

# unpack and verify
TMP=$(mktemp -d)
unzip -q "$OUT" -d "$TMP"
PKGVER=$(node -e "console.log(require('$TMP/manifest.json').version)")
[ "$PKGVER" = "$VER" ] || { echo "FAIL: manifest version $PKGVER != $VER"; exit 1; }
node --check "$TMP/bg.js"
node --check "$TMP/content.js"
node --check "$TMP/popup.js"
node --check "$TMP/coverage.js"
[ -f "$TMP/manifest.json" ] || { echo "FAIL: manifest.json not at zip root"; exit 1; }
# Chrome Web Store rejects a manifest description over 132 chars — guard it so a
# too-long description can never ship again (it blocked the first v2.2 upload).
DLEN=$(node -e "process.stdout.write(String(require('$TMP/manifest.json').description.length))")
[ "$DLEN" -le 132 ] || { echo "FAIL: manifest description is $DLEN chars (Chrome limit 132)"; exit 1; }
if find "$TMP" -name '.DS_Store' | grep -q .; then echo "FAIL: .DS_Store in package"; exit 1; fi

# per-file content manifest, committed alongside the zip
( cd "$TMP" && find . -type f | sort | while read -r f; do
    printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "${f#./}"
  done ) > "$MAN"

# cross-check: the manifest must equal git's own blob content for HEAD:extension
FAIL=0
while read -r hash path; do
  gitblob=$(git cat-file blob "HEAD:extension/$path" | shasum -a 256 | cut -d' ' -f1)
  if [ "$hash" != "$gitblob" ]; then echo "FAIL: $path differs from committed blob"; FAIL=1; fi
done < "$MAN"
[ "$FAIL" = 0 ] || exit 1

echo "package OK · v$VER · content identity verified against HEAD:extension"
echo "  zip     $(shasum -a 256 "$OUT" | cut -d' ' -f1)  (timestamp-bearing, not reproducible)"
echo "  files   $MAN  ($(wc -l < "$MAN" | tr -d ' ') files, each == committed blob)"
rm -rf "$TMP"
