#!/bin/sh
# Regression controls for the structural screenshot-provenance gate.
# Every failure control checks both the non-zero status and the exact branch
# message so an unrelated failure cannot masquerade as coverage.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
EXPECTED_FAIL="FAIL: bundled screenshot provenance block differs byte-for-byte from committed literal"
EXPECTED_OK="store-verify OK · committed artifacts == HEAD:extension · bundle embeds them · store copy matches the shipped product (v3.0.0)"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

run_verify() {
  repo=$1
  output_file=$2
  set +e
  (cd "$repo" && sh build-store-verify.sh) >"$output_file" 2>&1
  status=$?
  set -e
  return "$status"
}

assert_clean_pass() {
  output_file="$TMP_ROOT/clean.out"
  if ! run_verify "$ROOT" "$output_file"; then
    cat "$output_file"
    echo "CONTROL FAILED: clean verifier did not exit 0"
    exit 1
  fi
  grep -qFx "$EXPECTED_OK" "$output_file" || {
    cat "$output_file"
    echo "CONTROL FAILED: clean verifier omitted its exact success message"
    exit 1
  }
  echo "CONTROL PASS: clean committed bundle"
}

mutate_checklist() {
  repo=$1
  mode=$2
  version=$(node -e "console.log(require('$repo/extension/manifest.json').version)")
  bundle="$repo/dist/wifiodds-v${version}-store-bundle.zip"
  unpack=$(mktemp -d "$TMP_ROOT/unpack.XXXXXX")
  unzip -q "$bundle" -d "$unpack"
  checklist=$(find "$unpack" -name UPLOAD-CHECKLIST.txt -type f | head -1)
  case "$mode" in
    overclaim)
      # Leave the honest 1 Aug text untouched and add the independently
      # demonstrated bypass wording inside the provenance block.
      sed -i '' '/retained unchanged across the later model refresh/a\
    These images come straight out of the 603c15e build.' "$checklist"
      ;;
    honest-block-drift)
      sed -i '' 's/taken 1 Aug/taken 2 Aug/' "$checklist"
      ;;
    *) echo "unknown mutation: $mode"; exit 2 ;;
  esac
  top=$(find "$unpack" -mindepth 1 -maxdepth 1 -type d | head -1)
  rm -f "$bundle"
  (cd "$unpack" && zip -r -X "$bundle" "$(basename "$top")" >/dev/null)
  (cd "$repo" && git add "dist/$(basename "$bundle")" &&
    git -c user.name='WiFi Odds provenance control' -c user.email='control@invalid' \
      commit -q -m "control: $mode")
}

assert_named_failure() {
  mode=$1
  repo="$TMP_ROOT/$mode"
  git clone -q --no-local "$ROOT" "$repo"
  mutate_checklist "$repo" "$mode"
  output_file="$TMP_ROOT/$mode.out"
  if run_verify "$repo" "$output_file"; then
    cat "$output_file"
    echo "CONTROL FAILED: $mode unexpectedly exited 0"
    exit 1
  fi
  grep -qFx "$EXPECTED_FAIL" "$output_file" || {
    cat "$output_file"
    echo "CONTROL FAILED: $mode did not reach the intended provenance branch"
    exit 1
  }
  echo "CONTROL PASS: $mode -> $EXPECTED_FAIL"
}

assert_clean_pass
assert_named_failure overclaim
assert_named_failure honest-block-drift
