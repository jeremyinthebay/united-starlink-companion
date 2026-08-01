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

# The exact committed manifest description — the one string every store-copy surface must quote.
DESC=$(git show HEAD:extension/manifest.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).description))")

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

# 3b. the SUBMIT copy INSIDE the committed bundle (what the operator actually uploads) must be the
#     exact committed source AND pass the copy checks itself (round 21 P2). Checking only the repo
#     source is not enough: a bundle whose SUBMIT drifts from source would sail through.
BSUBMIT=$(find "$TMP/b" -name "SUBMIT-${VER}.md" | head -1)
if [ -n "$BSUBMIT" ]; then
  git show "HEAD:store-assets/${ADIR}/SUBMIT-${VER}.md" > "$TMP/submit.head"
  cmp -s "$BSUBMIT" "$TMP/submit.head" || { echo "FAIL: SUBMIT-${VER}.md inside the committed bundle differs byte-for-byte from the committed source"; FAIL=1; }
  BS=$(cat "$BSUBMIT")
  printf '%s' "$BS" | grep -qF "$DESC" || { echo "FAIL: bundled SUBMIT-${VER}.md does not quote the exact manifest description"; FAIL=1; }
  # The rounds-20/21/22 check forbade EVERY default-auto-sort claim, because in
  # v2.2 any such claim was false. In 3.0 single-carrier auto-sort is real, so
  # that check would now block truthful copy — the same class of failure in the
  # opposite direction. It is replaced by 3b-ii, which pins copy to BEHAVIOUR:
  # the mixed-carrier default must still never be advertised as automatic.
  if printf '%s' "$BS" | grep -qiE "sorts mixed-carrier|automatically (sorts|reorders) (all|every|mixed)"; then
    echo "FAIL: bundled SUBMIT-${VER}.md claims automatic sorting on mixed-carrier pages"; FAIL=1
  fi
  printf '%s' "$BS" | grep -qi "prioritize\|move scored" || { echo "FAIL: bundled SUBMIT-${VER}.md does not describe the explicit mixed-carrier action"; FAIL=1; }
  # 3b-ii. SORT DISCLOSURE (Codex round 26, assertion 6). v3.0 sorts single-carrier
  #        pages automatically, so the retired v2.2 sentences are now FALSE and must
  #        never ship; and the copy must carry both the automatic behaviour and the
  #        "unknown, not worse" limitation. Three rounds were spent on copy drifting
  #        from behaviour — this is the assertion that stops a fourth.
  if printf '%s' "$BS" | grep -qiE "no automatic reordering|booking site's own order is preserved until|only when you ask|one-click sort"; then
    echo "FAIL: bundled SUBMIT-${VER}.md still carries a retired no-automatic-reordering claim"; FAIL=1
  fi
  printf '%s' "$BS" | grep -qi "automatically sorts" || { echo "FAIL: bundled SUBMIT-${VER}.md does not disclose automatic sorting"; FAIL=1; }
  printf '%s' "$BS" | grep -qi "not lower\|unknown, not worse" || { echo "FAIL: bundled SUBMIT-${VER}.md does not state that unscored airlines are unknown, not worse"; FAIL=1; }
  printf '%s' "$BS" | grep -qi "turned off in Settings" || { echo "FAIL: bundled SUBMIT-${VER}.md does not say sorting can be turned off"; FAIL=1; }
  # 3c. STALE VERSION COPY (R23 Answer 2): the bundled copy must name the shipped version and must
  #     not present any pre-3.0 public version (2.2.0, or the never-public 2.3 / 2.4 intermediates)
  #     as current. Historical references are not needed in this doc, so any hit is a failure.
  printf '%s' "$BS" | grep -qF "v${VER}" || { echo "FAIL: bundled SUBMIT-${VER}.md never names v${VER}"; FAIL=1; }
  if printf '%s' "$BS" | grep -qE '\b2\.2\.0\b|\bv2\.2\b|\bv2\.3\b|\bv2\.4\b|\b2\.3\.[0-9]\b|\b2\.4\.[0-9]\b'; then
    echo "FAIL: bundled SUBMIT-${VER}.md carries stale pre-3.0 version copy"; FAIL=1
  fi
else
  echo "FAIL: committed bundle has no SUBMIT-${VER}.md"; FAIL=1
fi
rm -rf "$TMP"

# 4. the repository SUBMIT SOURCE must also match the shipped product (round 20 P1).
SUBMIT=$(git show "HEAD:store-assets/${ADIR}/SUBMIT-${VER}.md")
printf '%s' "$SUBMIT" | grep -qF "$DESC" || { echo "FAIL: SUBMIT-${VER}.md does not quote the exact committed manifest description"; FAIL=1; }
if printf '%s' "$SUBMIT" | grep -qiE "sorts mixed-carrier|automatically (sorts|reorders) (all|every|mixed)"; then
  echo "FAIL: SUBMIT-${VER}.md claims automatic sorting on mixed-carrier pages"; FAIL=1
fi
if printf '%s' "$SUBMIT" | grep -qiE "no automatic reordering|booking site's own order is preserved until|only when you ask|one-click sort"; then
  echo "FAIL: SUBMIT-${VER}.md still carries a retired no-automatic-reordering claim"; FAIL=1
fi
printf '%s' "$SUBMIT" | grep -qi "automatically sorts" || { echo "FAIL: SUBMIT-${VER}.md does not disclose automatic sorting"; FAIL=1; }
printf '%s' "$SUBMIT" | grep -qi "not lower\|unknown, not worse" || { echo "FAIL: SUBMIT-${VER}.md does not state that unscored airlines are unknown, not worse"; FAIL=1; }
printf '%s' "$SUBMIT" | grep -qi "turned off in Settings" || { echo "FAIL: SUBMIT-${VER}.md does not say sorting can be turned off"; FAIL=1; }
printf '%s' "$SUBMIT" | grep -qi "prioritize\|move scored" || { echo "FAIL: SUBMIT-${VER}.md does not describe the explicit mixed-carrier action"; FAIL=1; }
# 4b. stale version copy in the SOURCE, same rule as 3c.
printf '%s' "$SUBMIT" | grep -qF "v${VER}" || { echo "FAIL: SUBMIT-${VER}.md never names v${VER}"; FAIL=1; }
if printf '%s' "$SUBMIT" | grep -qE '\b2\.2\.0\b|\bv2\.2\b|\bv2\.3\b|\bv2\.4\b|\b2\.3\.[0-9]\b|\b2\.4\.[0-9]\b'; then
  echo "FAIL: SUBMIT-${VER}.md carries stale pre-3.0 version copy"; FAIL=1
fi

[ "$FAIL" = 0 ] && echo "store-verify OK · committed artifacts == HEAD:extension · bundle embeds them · store copy matches the shipped product (v${VER})" || { echo "store-verify FAILED — do not upload"; exit 1; }
