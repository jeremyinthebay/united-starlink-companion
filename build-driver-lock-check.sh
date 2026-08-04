#!/bin/sh
# Enforce the shared WiFi Odds driver lock on git write paths.
#
# The lock is owned by the relay and has one live-holder rule. A missing or
# malformed lock must not take down an unattended refresh, so those cases log
# and allow. A valid, unexpired lock held by another driver blocks.
set -u

ACTION=${1:-git write}
REPO=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
PROJECTS_DIR=$(cd "$REPO/.." 2>/dev/null && pwd)
LOCK=${WIFIODDS_DRIVER_LOCK_FILE:-"$PROJECTS_DIR/wifiodds-relay/exchange/.driver-lock"}
DRIVER=${WIFIODDS_DRIVER_ID:-}

allow() {
  echo "DRIVER LOCK: $1; allowing $ACTION." >&2
  exit 0
}

field() {
  sed -n "s/^$1=//p" "$LOCK" 2>/dev/null | head -1
}

[ -e "$LOCK" ] || allow "no lock file at $LOCK"
[ -f "$LOCK" ] || allow "lock path is not a regular file: $LOCK"
[ -r "$LOCK" ] || allow "lock file is unreadable: $LOCK"

HOLDER=$(field driver)
PID=$(field pid)
EXPIRES_EPOCH=$(field expires_epoch)
CLAIMED_AT=$(field claimed_at)
EXPIRES_AT=$(field expires_at)
NOTE=$(field note)

[ -n "$HOLDER" ] || allow "lock is malformed (missing driver)"
case "$PID" in
  ''|*[!0-9]*) allow "lock is malformed (unparseable pid)" ;;
esac
case "$EXPIRES_EPOCH" in
  ''|*[!0-9]*) allow "lock is malformed (unparseable expires_epoch)" ;;
esac

NOW=$(date +%s 2>/dev/null) || allow "current time could not be read"
case "$NOW" in
  ''|*[!0-9]*) allow "current time was unparseable" ;;
esac

if [ "$NOW" -ge "$EXPIRES_EPOCH" ]; then
  allow "stale lock expired at ${EXPIRES_AT:-epoch $EXPIRES_EPOCH}"
fi

# pid=0 is the relay's normal marker for an agent session with no watchable
# process. Its TTL is the only fence. Any other dead pid makes the lock stale.
if [ "$PID" != 0 ] && ! kill -0 "$PID" 2>/dev/null; then
  allow "stale lock holder pid $PID is not alive"
fi

if [ -n "$DRIVER" ] && [ "$DRIVER" = "$HOLDER" ]; then
  exit 0
fi

echo "" >&2
echo "GIT WRITE BLOCKED — another live WiFi Odds driver holds the lock." >&2
echo "" >&2
echo "  attempted:  $ACTION" >&2
echo "  your id:    ${DRIVER:-<WIFIODDS_DRIVER_ID is not set>}" >&2
echo "  holder:     $HOLDER" >&2
echo "  claimed:    ${CLAIMED_AT:-unknown}" >&2
echo "  expires:    ${EXPIRES_AT:-epoch $EXPIRES_EPOCH}" >&2
echo "  note:       ${NOTE:-none}" >&2
echo "" >&2
echo "Wait for the holder to release the lock, or use the same driver id only if" >&2
echo "you are part of that coordinated run. Nothing was committed or pushed." >&2
exit 1
