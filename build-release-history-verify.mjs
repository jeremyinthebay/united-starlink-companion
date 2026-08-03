#!/usr/bin/env node
// build-release-history-verify.mjs — deterministic manifest/changelog binding.
//
// A release version previously lived in the manifest, package filenames, store
// copy and website prose with no repository-owned history tying them together.
// This gate makes the first released CHANGELOG entry authoritative for the
// source tree: it must equal manifest.version, carry a real date, remain unique
// and descend monotonically through the required 2.0.0 backfill.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write("FAIL: release-history: " + message + "\n");
  process.exit(1);
}

function pathsFromArgs(argv) {
  const out = {
    manifest: join(ROOT, "extension", "manifest.json"),
    changelog: join(ROOT, "CHANGELOG.md"),
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key !== "--manifest" && key !== "--changelog") {
      fail("unknown argument " + key);
    }
    if (!argv[i + 1]) fail(key + " requires a path");
    out[key.slice(2)] = resolve(argv[++i]);
  }
  return out;
}

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail("cannot read " + label + " at " + path + ": " + error.message);
  }
}

function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parts = value.split("-").map(Number);
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === parts[0] &&
    parsed.getUTCMonth() + 1 === parts[1] &&
    parsed.getUTCDate() === parts[2];
}

function semverParts(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value || "")) return null;
  return value.split(".").map(Number);
}

function compareSemver(a, b) {
  const av = semverParts(a);
  const bv = semverParts(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return av[i] - bv[i];
  }
  return 0;
}

const paths = pathsFromArgs(process.argv.slice(2));
let manifest;
try {
  manifest = JSON.parse(read(paths.manifest, "manifest"));
} catch (error) {
  fail("manifest is not valid JSON: " + error.message);
}

if (!semverParts(manifest.version)) {
  fail("manifest.version must be a three-part semantic version");
}

const changelog = read(paths.changelog, "changelog");
const levelTwo = changelog.split(/\r?\n/).filter((line) => /^##\s/.test(line));
if (!levelTwo.length) fail("CHANGELOG has no level-two release headings");

const heading = /^## \[(Unreleased|\d+\.\d+\.\d+)\](?: - (\d{4}-\d{2}-\d{2}))?$/;
const parsed = levelTwo.map((line) => {
  const match = heading.exec(line);
  if (!match) fail("malformed release heading: " + line);
  return { name: match[1], date: match[2] || "" };
});

if (parsed[0].name !== "Unreleased" || parsed[0].date) {
  fail("the first level-two heading must be undated [Unreleased]");
}
if (parsed.filter((entry) => entry.name === "Unreleased").length !== 1) {
  fail("CHANGELOG must contain exactly one [Unreleased] heading");
}

const releases = parsed.slice(1);
if (!releases.length) fail("CHANGELOG has no released versions");

const seen = new Set();
for (let i = 0; i < releases.length; i++) {
  const release = releases[i];
  if (release.name === "Unreleased") fail("[Unreleased] may appear only once at the top");
  if (seen.has(release.name)) fail("duplicate release heading " + release.name);
  seen.add(release.name);
  if (!realDate(release.date)) {
    fail("release " + release.name + " must carry a real YYYY-MM-DD date");
  }
  if (i > 0 && compareSemver(releases[i - 1].name, release.name) <= 0) {
    fail("release headings are not newest-first: " + releases[i - 1].name +
      " must be newer than " + release.name);
  }
}

if (!seen.has("2.0.0")) {
  fail("release history must remain backfilled through 2.0.0");
}
if (releases[0].name !== manifest.version) {
  fail("manifest version " + manifest.version +
    " does not match top changelog release " + releases[0].name);
}

process.stdout.write("release-history OK · manifest " + manifest.version +
  " == top changelog release " + releases[0].name + " · " + releases.length +
  " releases · backfilled through 2.0.0\n");
