#!/bin/sh
# Negative controls for build-release-history-verify.mjs. A clean pass alone is
# not evidence: each named corruption must exit nonzero through its intended
# branch, and the asserted count prevents a control from disappearing silently.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERIFY="$ROOT/build-release-history-verify.mjs"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

BASE_MANIFEST="$ROOT/extension/manifest.json"
BASE_CHANGELOG="$ROOT/CHANGELOG.md"
VERSION=$(node -e "console.log(require('$BASE_MANIFEST').version)")
IFS=. read -r MAJOR MINOR PATCH <<EOF
$VERSION
EOF
NEXT_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
ORDER_VERSION="$MAJOR.$((MINOR + 1)).0"

PASS=0
FAILED=0
CONTROLS_EXPECTED=5

run_control() {
  label=$1
  expected_exit=$2
  expected_text=$3
  manifest=$4
  changelog=$5
  output="$TMP/$label.out"
  set +e
  node "$VERIFY" --manifest "$manifest" --changelog "$changelog" >"$output" 2>&1
  status=$?
  set -e
  if [ "$status" = "$expected_exit" ] && grep -qF "$expected_text" "$output"; then
    echo "CONTROL PASS: $label -> exit $status · $expected_text"
    PASS=$((PASS + 1))
  else
    echo "CONTROL FAILED: $label -> exit $status (expected $expected_exit)"
    echo "  expected text: $expected_text"
    sed 's/^/  | /' "$output"
    FAILED=$((FAILED + 1))
  fi
}

cp "$BASE_MANIFEST" "$TMP/manifest-clean.json"
cp "$BASE_CHANGELOG" "$TMP/changelog-clean.md"
run_control baseline 0 "release-history OK" \
  "$TMP/manifest-clean.json" "$TMP/changelog-clean.md"

sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEXT_VERSION\"/" \
  "$BASE_MANIFEST" > "$TMP/manifest-drift.json"
run_control manifest-drift 1 \
  "manifest version $NEXT_VERSION does not match top changelog release $VERSION" \
  "$TMP/manifest-drift.json" "$TMP/changelog-clean.md"

cp "$BASE_CHANGELOG" "$TMP/changelog-duplicate.md"
printf '\n## [%s] - 2026-01-01\n' "$VERSION" >> "$TMP/changelog-duplicate.md"
run_control duplicate-release 1 "duplicate release heading $VERSION" \
  "$TMP/manifest-clean.json" "$TMP/changelog-duplicate.md"

sed "s/## \[2\.2\.0\] - 2026-07-31/## [$ORDER_VERSION] - 2026-07-31/" \
  "$BASE_CHANGELOG" > "$TMP/changelog-order.md"
run_control release-order 1 \
  "release headings are not newest-first: $VERSION must be newer than $ORDER_VERSION" \
  "$TMP/manifest-clean.json" "$TMP/changelog-order.md"

awk '/^## \[2\.0\.0\]/{exit} {print}' "$BASE_CHANGELOG" > "$TMP/changelog-no-backfill.md"
run_control missing-backfill 1 "release history must remain backfilled through 2.0.0" \
  "$TMP/manifest-clean.json" "$TMP/changelog-no-backfill.md"

OBSERVED=$((PASS + FAILED))
if [ "$OBSERVED" != "$CONTROLS_EXPECTED" ]; then
  echo "CONTROL COUNT MISMATCH: expected $CONTROLS_EXPECTED, observed $OBSERVED"
  exit 1
fi
echo "CONTROL COUNT: expected $CONTROLS_EXPECTED, observed $OBSERVED"
[ "$FAILED" = 0 ] || { echo "release-history controls FAILED: $FAILED"; exit 1; }
echo "release-history controls OK · $PASS/$CONTROLS_EXPECTED behaved in the intended direction"
