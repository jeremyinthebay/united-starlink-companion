#!/bin/sh
# Install the shared driver-lock check on both git write paths.
#
#   sh install-driver-lock-hooks.sh              # install/update
#   sh install-driver-lock-hooks.sh --uninstall  # remove managed hooks
set -eu

REPO=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
HOOK_DIR=$(git rev-parse --git-path hooks)
case "$HOOK_DIR" in
  /*) ;;
  *) HOOK_DIR="$REPO/$HOOK_DIR" ;;
esac
MARKER="# Managed by install-driver-lock-hooks.sh"

managed_or_absent() {
  TARGET=$1
  [ ! -e "$TARGET" ] || grep -Fq "$MARKER" "$TARGET"
}

remove_managed() {
  TARGET=$1
  if [ -f "$TARGET" ] && grep -Fq "$MARKER" "$TARGET"; then
    rm -f "$TARGET"
    echo "removed $TARGET"
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_managed "$HOOK_DIR/pre-commit"
  remove_managed "$HOOK_DIR/pre-push"
  exit 0
fi

mkdir -p "$HOOK_DIR"
for NAME in pre-commit pre-push; do
  TARGET="$HOOK_DIR/$NAME"
  if ! managed_or_absent "$TARGET"; then
    echo "REFUSED — $TARGET already exists and is not managed by this installer." >&2
    echo "Preserve or compose that hook manually; nothing was overwritten." >&2
    exit 1
  fi
done

for NAME in pre-commit pre-push; do
  TARGET="$HOOK_DIR/$NAME"
  {
    echo '#!/bin/sh'
    echo "$MARKER"
    echo 'REPO=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0'
    printf 'exec sh "$REPO/build-driver-lock-check.sh" "%s"\n' "$NAME"
  } > "$TARGET"
  chmod +x "$TARGET"
  echo "installed $TARGET"
done

echo "Both git write paths now enforce the shared WiFi Odds driver lock."
