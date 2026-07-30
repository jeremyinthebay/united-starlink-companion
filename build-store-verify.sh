#!/bin/sh
# build-store-verify.sh — FAIL-CLOSED, READ-ONLY release identity + copy gate.
#
# WHY THIS EXISTS (Codex round 20 P2). build-store-zip.sh REGENERATES the upload ZIP and file
# manifest from HEAD on every run, so it can only ever prove "the freshly built archive matches
# HEAD" — it can NEVER detect that the archive ALREADY COMMITTED in HEAD is stale. A one-byte
# committed source change with unchanged committed artifacts sails through it at exit 0.
#
# This gate reads ONLY committed bytes (git show HEAD:...) and writes NOTHING. It fails closed on
# any drift between the committed dist artifacts and HEAD:extension, and on any store-copy claim that
# contradicts the shipped manifest/product. The clean submitted SHA passes with no tracked changes;
# a committed one-byte source mutation with stale artifacts fails.
#
#   sh build-store-verify.sh     # exit 0 = committed artifacts + store copy match the shipped source
set -eu
cd "$(dirname "$0")"
VER=$(node -e "console.log(require('./extension/manifest.json').version)")
ADIR=v$(printf '%s' "$VER" | cut -d. -f1,2)
FAIL=0

# The one source of truth: sha256 of every committed HEAD:extension blob, "hash  path".
EXPECT=$(git ls-tree -r --name-only HEAD:extension | while read -r f; do
  printf '%s  %s\n' "$(git cat-file blob "HEAD:extension/$f" | shasum -a 256 | cut -d' ' -f1)" "$f"
done | sort -k2)

# 1. committed file-hash manifest must already equal HEAD:extension (no regen).
GOT=$(git show "HEAD:dist/wifiodds-v${VER}.files.sha256" | sort -k2)
[ "$EXPECT" = "$GOT" ] || { echo "FAIL: committed dist/wifiodds-v${VER}.files.sha256 != HEAD:extension (stale manifest)"; FAIL=1; }

# 2. the committed upload ZIP's contents must already equal HEAD:extension (no regen).
TMP=$(mktemp -d)
git show "HEAD:dist/wifiodds-v${VER}.zip" > "$TMP/pkg.zip"
unzip -q "$TMP/pkg.zip" -d "$TMP/x"
ZGOT=$(cd "$TMP/x" && find . -type f | sed 's#^\./##' | while read -r f; do
  printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"
done | sort -k2)
[ "$EXPECT" = "$ZGOT" ] || { echo "FAIL: committed dist/wifiodds-v${VER}.zip is not the HEAD:extension tree (stale zip)"; FAIL=1; }

# 3. the committed store bundle must embed that exact committed upload ZIP.
git show "HEAD:dist/wifiodds-v${VER}-store-bundle.zip" > "$TMP/bundle.zip"
unzip -q "$TMP/bundle.zip" -d "$TMP/b"
BZIP=$(find "$TMP/b" -name "wifi-odds-extension-${VER}.zip" | head -1)
if [ -n "$BZIP" ]; then
  BEMBED=$(shasum -a 256 "$BZIP" | cut -d' ' -f1)
  COMMITTED=$(git show "HEAD:dist/wifiodds-v${VER}.zip" | shasum -a 256 | cut -d' ' -f1)
  [ "$BEMBED" = "$COMMITTED" ] || { echo "FAIL: committed bundle embeds a different ZIP than the committed upload ZIP"; FAIL=1; }
else
  echo "FAIL: committed bundle has no wifi-odds-extension-${VER}.zip"; FAIL=1
fi
rm -rf "$TMP"

# 4. store copy must match the shipped product: the SUBMIT doc must quote the EXACT committed manifest
#    description and must NOT claim default auto-sort / pre-checked controls (round 20 P1).
DESC=$(git show HEAD:extension/manifest.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).description))")
SUBMIT=$(git show "HEAD:store-assets/${ADIR}/SUBMIT-${VER}.md")
printf '%s' "$SUBMIT" | grep -qF "$DESC" || { echo "FAIL: SUBMIT-${VER}.md does not quote the exact committed manifest description"; FAIL=1; }
if printf '%s' "$SUBMIT" | grep -qiE "auto-sort defaults on|auto-sorts by odds|defaults on|starts? checked|start checked"; then
  echo "FAIL: SUBMIT-${VER}.md still claims default auto-sort / pre-checked controls"; FAIL=1
fi
printf '%s' "$SUBMIT" | grep -qi "prioritize" || { echo "FAIL: SUBMIT-${VER}.md does not describe the explicit opt-in Prioritize action"; FAIL=1; }

[ "$FAIL" = 0 ] && echo "store-verify OK · committed artifacts == HEAD:extension · bundle embeds them · store copy matches the shipped product (v${VER})" || { echo "store-verify FAILED — do not upload"; exit 1; }
