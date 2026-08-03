// mutation-matrix.mjs — R23 binding addition #6: prove every honesty gate can
// FAIL. Runs phase2-e2e.mjs once per named mutation (E2E_MUT) with a focused
// E2E_ONLY case filter, and requires all three of:
//   (1) "MUTATION LANDED <name>" on stderr — the anchor still exists and the
//       regression was applied to the temp copy (a silently unapplied mutation
//       is a false pass; this project has been bitten by exactly that);
//   (2) a NONZERO gate exit;
//   (3) the FAIL line names the EXPECTED case — the right assertion caught it,
//       not an unrelated breakage.
// A mutation whose gate stays green is a broken instrument → this matrix exits 1.
// The CLEAN full run is phase2-e2e.mjs with no env. Release shape:
//     node test/phase2-e2e.mjs && node test/mutation-matrix.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "phase2-e2e.mjs");
const FIRST_RUN_GATE = join(HERE, "first-run-coverage-e2e.mjs");

// mutation → the focused case filter, and the case whose FAIL must name it.
const MATRIX = {
  "bug3-loading":           { only: "navan-loading-then-terminal", expect: "navan-loading-then-terminal" },
  "missing-conf-eligible":  { only: "united-strip-lowgrade|navan-strip-missing-conf", expect: "united-strip-lowgrade" },
  "false-confirm-token":    { only: "SFO-DEN-positive", expect: "SFO-DEN-positive" },
  "b-unconfirmed-collapse": { only: "guard-popup-state-matrix", expect: "guard-popup-state-matrix" },
  "c-outage-collapse":      { only: "guard-popup-state-matrix", expect: "guard-popup-state-matrix" },
  "leak-best-ring":         { only: "united-decision-strip-close", expect: "united-decision-strip-close" },
  "rescue-suppress":        { only: "guard-pure-precedence", expect: "guard-pure-precedence" },
  "updated-today":          { only: "SFO-DEN-positive", expect: "SFO-DEN-positive" },
  "low-contrast":           { only: "visual-contrast-geometry", expect: "visual-contrast-geometry" },
  // Codex round 26
  "mixed-auto-sort":        { only: "navan-preserves-host-order", expect: "navan-preserves-host-order" },
  "settings-off-still-sorts": { only: "united-autosort-off-respected", expect: "united-autosort-off-respected" },
  "unlabelled-badge":       { only: "row-metrics-labelled", expect: "row-metrics-labelled" },
  "popup-first-row-crown":  { only: "popup-ranked-history-no-crown", expect: "popup-ranked-history-no-crown" },
  "merged-metric-provenance": { only: "row-metrics-labelled", expect: "row-metrics-labelled" },
  "alaska-united-action":   { only: "alaska-no-united-action", expect: "alaska-no-united-action" },
  "guard-span-control":     { only: "guard-keyboard-roundtrip", expect: "guard-keyboard-roundtrip" },
  "guard-add-no-rollback":  { only: "guard-add-failure-rolls-back", expect: "guard-add-failure-rolls-back" },
  "gold-policy-claim":      { only: "guard-alternative-evidence", expect: "guard-alternative-evidence" },
  // "fleet-as-probability" is intentionally ABSENT. Its target state cannot
  // render on any currently supported host (see the note in phase2-e2e.mjs),
  // so no assertion could catch it. Listing it here would manufacture a green
  // that means nothing — the exact false-pass this matrix exists to prevent.
  "zero-for-unknown":       { only: "row-metrics-no-history", expect: "row-metrics-no-history" },
  "refusal-claims-unsorted": { only: "refusal-note-matches-sort-state", expect: "refusal-note-matches-sort-state" },
  "gf-setting-claims-reorder": { only: "popup-settings-truthful", expect: "popup-settings-truthful" },
  "resolved-only-denominator": { only: "airline-data-parity", expect: "airline-data-parity" },
  "first-run-opens-on-update": { gate: FIRST_RUN_GATE, only: "first-run-coverage", expect: "first-run-coverage" },
  "first-run-no-permission-request": { gate: FIRST_RUN_GATE, only: "first-run-coverage", expect: "first-run-coverage" },
  "first-run-add-tabs-permission": { gate: FIRST_RUN_GATE, only: "first-run-coverage", expect: "first-run-coverage" },
};
const CONTROLS_EXPECTED = 25;

// Owner ruling, 3 Aug 2026: keep these honest-degradation states, but never
// manufacture a green mutation result for branches no supported host can
// render. The gate names the states, validates their production definitions and
// validates the excluded mutation's live anchor on every run.
const UNTESTABLE = {
  "fleet-as-probability": {
    states: ["fleet", "announced", "notinfleet", "nofleet"],
    anchor: 'if (entry.nextGenShare > 0) return { k: "fleet", value: share === 0 ? "<1%" : share + "%" };',
    reason: "no currently supported host reaches metricsGroup's non-instrumented row path",
  },
};
const UNTESTABLE_MUTATIONS_EXPECTED = 1;
const UNTESTABLE_STATES_EXPECTED = 4;

let broken = 0;
const rows = [];
const contentSource = readFileSync(join(HERE, "..", "extension", "content.js"), "utf8");
const untestableEntries = Object.entries(UNTESTABLE);
const untestableStates = [...new Set(untestableEntries.flatMap(([, v]) => v.states))];
if (untestableEntries.length !== UNTESTABLE_MUTATIONS_EXPECTED ||
    untestableStates.length !== UNTESTABLE_STATES_EXPECTED ||
    Object.keys(MATRIX).some((name) => Object.prototype.hasOwnProperty.call(UNTESTABLE, name))) {
  broken++;
  process.stderr.write("UNTESTABLE REGISTRY BROKEN: count/state overlap mismatch\n");
}
for (const [name, item] of untestableEntries) {
  const statesDefined = item.states.every((state) =>
    new RegExp("^\\s*" + state + "\\s*:", "m").test(contentSource));
  const anchorLive = contentSource.includes(item.anchor);
  if (!statesDefined || !anchorLive) broken++;
  process.stderr.write(`UNTESTABLE ${name} · states=${item.states.join(",")} · ` +
    `definitions=${statesDefined ? "live" : "MISSING"} anchor=${anchorLive ? "live" : "MISSING"} · ${item.reason}\n`);
}
for (const [name, m] of Object.entries(MATRIX)) {
  process.stderr.write(`\n══ mutation ${name} ══\n`);
  const r = spawnSync(process.execPath, [m.gate || GATE], {
    env: { ...process.env, E2E_MUT: name, E2E_ONLY: m.only },
    encoding: "utf8", timeout: 10 * 60 * 1000,
  });
  const err = (r.stderr || "") + (r.stdout || "");
  const landed = err.includes("MUTATION LANDED " + name);
  const gateFailed = r.status !== 0;
  const namedCase = err.includes(m.expect + " FAILED:") || err.includes(m.expect + " panel MISSING");
  const ok = landed && gateFailed && namedCase;
  rows.push({ name, landed, exit: r.status, namedCase, ok });
  process.stderr.write(`   landed=${landed} exit=${r.status} namedExpectedCase=${namedCase} → ` +
    (ok ? "OK (gate caught it)\n" : "BROKEN INSTRUMENT\n"));
  if (!ok) broken++;
}
process.stderr.write("\nMUTATION MATRIX: " +
  (broken ? broken + " mutation(s) NOT caught — instrument broken" : "all " + rows.length + " mutations caught") + "\n");
if (rows.length !== CONTROLS_EXPECTED) {
  broken++;
  process.stderr.write(`CONTROL COUNT MISMATCH: expected ${CONTROLS_EXPECTED}, observed ${rows.length}; a named mutation is missing\n`);
} else {
  process.stderr.write(`CONTROL COUNT: expected ${CONTROLS_EXPECTED}, observed ${rows.length}\n`);
}
process.stderr.write(rows.map((r) => `${r.ok ? "OK " : "BAD"} ${r.name} exit=${r.exit}`).join("\n") + "\n");
if (broken) process.stderr.write("A surprising result is a claim about the instrument until proven otherwise. Before filing a defect, prove the instrument is sound — with a control that is known-good, not with a second run.\n");
process.exit(broken ? 1 : 0);
