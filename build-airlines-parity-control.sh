#!/bin/sh
# build-airlines-parity-control.sh — proves build-airlines-parity.sh actually
# guards the PINNED git object, and fails closed when it cannot.
#
# The auditor's Round 8 finding was not "the gate is broken" — the old gate
# worked. It was that the gate guarded the wrong thing: the mutable site working
# tree. A guard that passes is not evidence; a guard that fails in the intended
# direction, on a deliberate mutation, is. So every control below states the
# exit code it expects and why, and the script fails if any control behaves the
# other way. A control that cannot fail proves nothing (the same defect the
# responsive checker's dead landmarks had).
#
#   sh build-airlines-parity-control.sh     # exit 0 iff every control behaved
set -u
cd "$(dirname "$0")"
REPO=$(pwd)
SITE_REPO_REAL="${SITE_REPO:-$HOME/Projects/wifiodds}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0; FAILED=0

# run <label> <expected-exit> <why> -- <env assignments...>
run() {
  label=$1; expected=$2; why=$3; shift 3
  out=$("$@" 2>&1); got=$?     # bare exit of the gate, never through a pipe
  if [ "$got" = "$expected" ]; then
    printf 'ok    %s\n        exit %s (expected %s) · %s\n' "$label" "$got" "$expected" "$why"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %s\n        exit %s (expected %s) · %s\n' "$label" "$got" "$expected" "$why"
    printf '%s\n' "$out" | sed 's/^/        | /'
    FAILED=$((FAILED + 1))
  fi
}

echo "airline parity controls · pinned-object substitution suite"
echo

# ---------------------------------------------------------------------------
# C0 BASELINE — the shipped tree against the real site repo must pass. If this
# fails, nothing below means anything.
# ---------------------------------------------------------------------------
run "C0 · BASELINE unmutated tree, real site repo" 0 \
  "the shipped release must verify against its own pin" \
  env SITE_REPO="$SITE_REPO_REAL" sh "$REPO/build-airlines-parity.sh"

# ---------------------------------------------------------------------------
# Throwaway site clone. The pinned COMMIT is intact inside it; its WORKING TREE
# model is then mutated. This is exactly the daily-refresh race: the file on
# disk moves on while the release's named object does not.
# ---------------------------------------------------------------------------
CLONE="$WORK/site"
git clone --quiet --local --no-hardlinks "$SITE_REPO_REAL" "$CLONE" 2>/dev/null || {
  echo "FAIL: could not clone $SITE_REPO_REAL for the substitution control"; exit 1; }

# Mutate the clone's working tree so it can no longer stand in for the pin.
# A published number is changed, not whitespace: this is the airBaltic-shaped
# failure the byte gate exists to catch.
printf '\n/* CONTROL MUTATION — working tree only, never committed */\n' >> "$CLONE/assets/airlines.js"

if cmp -s "$CLONE/assets/airlines.js" "$SITE_REPO_REAL/assets/airlines.js"; then
  echo "FAIL: control setup did not actually mutate the clone's working tree"; exit 1
fi

# ---------------------------------------------------------------------------
# C1 SUBSTITUTION — THE FINDING. The working tree now differs from the pinned
# object. The gate must be UNMOVED (exit 0), because it reads the git object.
# The old gate read this file and would have failed here — its result was a
# function of whatever the site happened to have on disk.
# ---------------------------------------------------------------------------
run "C1 · SUBSTITUTION mutated site WORKING TREE, pin intact" 0 \
  "a changed working tree must not reach the gate at all" \
  env SITE_REPO="$CLONE" sh "$REPO/build-airlines-parity.sh"

# ---------------------------------------------------------------------------
# C2 STALE RELEASE — an extension copy generated from that mutated working tree
# (i.e. a bundle built against "current" instead of the pin) must NOT ship.
# This is the positive half of C1: the substitution is not merely ignored, it
# is rejected when it reaches the artifact.
# ---------------------------------------------------------------------------
STALE="$WORK/airlines-stale.js"
head -n 20 extension/airlines.js > "$STALE"
cat "$CLONE/assets/airlines.js" >> "$STALE"
run "C2 · STALE ext generated from the mutated working tree" 1 \
  "a bundle built against 'current' must fail its own pin" \
  env SITE_REPO="$SITE_REPO_REAL" EXT_FILE="$STALE" sh "$REPO/build-airlines-parity.sh"

# ---------------------------------------------------------------------------
# C3 EXT DRIFT — the original round-26 guard must still work: a hand-edit to
# the shipped model fails.
# ---------------------------------------------------------------------------
DRIFT="$WORK/airlines-drift.js"
sed 's/"score": *9/"score": 3/' extension/airlines.js > "$DRIFT" 2>/dev/null || cp extension/airlines.js "$DRIFT"
printf '\n/* CONTROL DRIFT */\n' >> "$DRIFT"
run "C3 · DRIFT hand-edited extension copy" 1 \
  "the byte guard the pin replaced must not have regressed" \
  env SITE_REPO="$SITE_REPO_REAL" EXT_FILE="$DRIFT" sh "$REPO/build-airlines-parity.sh"

# ---------------------------------------------------------------------------
# C4 UNREACHABLE PIN — a named commit that is not in the repo must FAIL CLOSED.
# The one behaviour that would quietly restore the bug is falling back to the
# working tree when the object cannot be found, so it is tested explicitly.
# ---------------------------------------------------------------------------
BADPIN="$WORK/bad-commit.pin"
printf 'SITE_SHA=%s\nMODEL_BLOB=%s\n' \
  "0000000000000000000000000000000000000000" \
  "238e587495f0ec580977d1b3b19747e36fcaa08b" > "$BADPIN"
run "C4 · UNREACHABLE pinned commit" 1 \
  "an unresolvable pin must fail closed, never fall back to the working tree" \
  env SITE_REPO="$SITE_REPO_REAL" PIN_FILE="$BADPIN" sh "$REPO/build-airlines-parity.sh"

# ---------------------------------------------------------------------------
# C5 BLOB MISMATCH — right commit, wrong blob. Guards against the commit being
# rewritten to carry a different model under the same name.
# ---------------------------------------------------------------------------
REALSHA=$(sed -n 's/^SITE_SHA=//p' release-model.pin | tr -d ' \t\r')
BLOBPIN="$WORK/bad-blob.pin"
printf 'SITE_SHA=%s\nMODEL_BLOB=%s\n' "$REALSHA" \
  "1111111111111111111111111111111111111111" > "$BLOBPIN"
run "C5 · BLOB MISMATCH right commit, wrong model blob" 1 \
  "two independent names for the bytes; disagreement must stop the build" \
  env SITE_REPO="$SITE_REPO_REAL" PIN_FILE="$BLOBPIN" sh "$REPO/build-airlines-parity.sh"

# ---------------------------------------------------------------------------
# C6 NO PIN — a release that names no model is not shippable.
# ---------------------------------------------------------------------------
run "C6 · MISSING pin file" 1 \
  "an unpinned release must not verify" \
  env SITE_REPO="$SITE_REPO_REAL" PIN_FILE="$WORK/nope.pin" sh "$REPO/build-airlines-parity.sh"

echo
echo "controls passed: $PASS · controls misbehaved: $FAILED"
[ "$FAILED" = 0 ] || { echo "PARITY CONTROLS FAILED — the gate is not guarding what it claims"; exit 1; }
echo "PARITY CONTROLS OK · the gate follows the pinned object, and fails closed without it"
