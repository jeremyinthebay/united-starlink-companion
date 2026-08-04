#!/bin/sh
# Healthy and failing controls for the shared driver-lock git hooks.
set -eu

SOURCE_REPO=$(cd "$(dirname "$0")/.." && pwd)
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wo-driver-lock.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM
CONTROL_REPO="$TMP_ROOT/repo"
LOCK="$TMP_ROOT/.driver-lock"
mkdir -p "$CONTROL_REPO/test"
cp "$SOURCE_REPO/build-driver-lock-check.sh" "$CONTROL_REPO/"
cp "$SOURCE_REPO/install-driver-lock-hooks.sh" "$CONTROL_REPO/"
git -C "$CONTROL_REPO" init -q

write_lock() {
  HOLDER=$1
  PID_VALUE=$2
  EXPIRES_VALUE=$3
  {
    echo "driver=$HOLDER"
    echo "pid=$PID_VALUE"
    echo "host=control"
    echo "claimed_at=2026-08-03T00:00:00Z"
    echo "expires_at=2099-01-01T00:00:00Z"
    echo "expires_epoch=$EXPIRES_VALUE"
    echo "note=driver-lock control"
  } > "$LOCK"
}

run_check() {
  DRIVER_VALUE=$1
  shift
  WIFIODDS_DRIVER_ID="$DRIVER_VALUE" WIFIODDS_DRIVER_LOCK_FILE="$LOCK" "$@" > "$TMP_ROOT/out" 2>&1
}

assert_allow() {
  NAME=$1
  DRIVER_VALUE=$2
  shift 2
  if run_check "$DRIVER_VALUE" "$@"; then
    echo "PASS allow: $NAME"
  else
    echo "FAIL allow: $NAME" >&2
    sed 's/^/  /' "$TMP_ROOT/out" >&2
    exit 1
  fi
}

assert_block() {
  NAME=$1
  DRIVER_VALUE=$2
  shift 2
  if run_check "$DRIVER_VALUE" "$@"; then
    echo "FAIL block: $NAME unexpectedly allowed" >&2
    sed 's/^/  /' "$TMP_ROOT/out" >&2
    exit 1
  fi
  grep -Fq "GIT WRITE BLOCKED" "$TMP_ROOT/out" || {
    echo "FAIL block: $NAME failed without the lock diagnostic" >&2
    sed 's/^/  /' "$TMP_ROOT/out" >&2
    exit 1
  }
  echo "PASS block: $NAME"
}

rm -f "$LOCK"
assert_allow "missing lock fails open" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-commit

echo "not a lock" > "$LOCK"
assert_allow "corrupt lock fails open" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-push

NOW=$(date +%s)
write_lock claude-driver 0 "$((NOW - 1))"
assert_allow "expired lock fails open" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-commit

write_lock claude-driver 999999 "$((NOW + 600))"
assert_allow "dead holder pid fails open" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-push

write_lock codex-builder 0 "$((NOW + 600))"
assert_allow "holder is allowed" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-commit

write_lock claude-driver 0 "$((NOW + 600))"
assert_block "different live holder" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-push
assert_block "missing driver identity" "" sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-commit

write_lock claude-driver $$ "$((NOW + 600))"
assert_block "different live process holder" codex-builder sh "$CONTROL_REPO/build-driver-lock-check.sh" pre-commit

sh "$CONTROL_REPO/install-driver-lock-hooks.sh" > "$TMP_ROOT/install-out"
for HOOK_NAME in pre-commit pre-push; do
  HOOK=$(git -C "$CONTROL_REPO" rev-parse --git-path "hooks/$HOOK_NAME")
  [ -x "$CONTROL_REPO/$HOOK" ] || { echo "FAIL install: $HOOK_NAME is missing" >&2; exit 1; }
  write_lock claude-driver 0 "$((NOW + 600))"
  assert_block "$HOOK_NAME installed failing control" codex-builder "$CONTROL_REPO/$HOOK"
  write_lock codex-builder 0 "$((NOW + 600))"
  assert_allow "$HOOK_NAME installed healthy control" codex-builder "$CONTROL_REPO/$HOOK"
done

echo "PASS: driver-lock hooks match relay absence, corruption, TTL and pid semantics."
