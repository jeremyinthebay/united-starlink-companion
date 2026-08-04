# Changelog

All notable changes to the WiFi Odds extension are recorded here. A release date identifies the
immutable source/package release and its Git tag. Chrome Web Store publication is a separate,
owner-controlled event and is stated explicitly for each release.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.1] - 2026-08-03

Chrome Web Store: not uploaded.

### Added

- Local post-flight outcome capture: a traveller can record whether WiFi worked, and the answer
  remains on that device as personal history. Recording an outcome makes no network request.
- A native keyboard-operable Guard button with a 44-pixel target, first-use guidance, and a visible
  error that rolls optimistic state back when a trip cannot be guarded.
- A first-run coverage page that explains all four supported flight-search hosts and offers the
  two optional Alaska and Google Flights grants from explicit user-gesture buttons.
- A local active-page self-test that distinguishes granted host access from a page where supported
  results were actually detected and annotated.
- A one-time explanation beside the first automatic single-carrier reorder, with a direct pointer to Settings.
- Per-figure evidence disclosures now explain what each next-gen, ConnectScore, and itinerary
  figure measures; its tier, source, source date, sample and resolution; and whether it may rank
  flights, airlines or itineraries.

### Fixed

- Removed the popup's unconditional first-row crown; ranked history is no longer presented as a
  recommendation without the injected decision card's full evidence gate.
- Gave per-flight next-gen odds and ConnectScore separate tier, source, and source-date metadata.
- Removed the United-labelled prioritisation action from Alaska's single-carrier results.
- Guardian now captures up to five decision-qualified alternatives from the booking results visible
  when a flight is guarded. Later rescue alerts use only that immutable local snapshot and make no
  fresh route lookup.
- Kept the four future row-degradation states while making their currently untestable status
  explicit and machine-checked in the mutation gate.
- Replaced the popup's ambiguous `ready` and `Fresh result` labels with `access on`, an independent
  active-page health result, and source-date-qualified refetch wording.

## [3.0.0] - 2026-08-02

Chrome Web Store: published 2026-08-02.

### Added

- An evidence-gated Best WiFi choice that recommends only when at least two flights are scored, the
  lead is meaningful, and the tracker supplies decision-grade confidence.
- Labelled next-gen flight odds and streaming-class ConnectScore figures on each supported result.
- Truthful Guardian states for confirmed Starlink, confirmed non-Starlink, an unpublished
  assignment, an unavailable update, and an invalid flight.

### Changed

- Supported single-airline pages sort automatically by historical next-gen odds by default and
  provide a real undo. Mixed-airline pages preserve their host order until the traveller acts.
- Confirmed tail assignments are displayed as separate dated facts instead of being folded into a
  historical probability.

## [2.2.0] - 2026-07-31

Chrome Web Store: published 2026-07-31.

### Added

- Per-flight fallback lookups when route history is missing, so supported rows can still show real
  odds without manufacturing a route-level answer.
- Deterministic API and browser coverage for tracker failures, loading settlement, prioritisation,
  accessibility, and store-package identity.

### Changed

- Mixed-carrier results preserve the booking site's order by default and expose an explicit action
  to move scored United flights first.
- Tracker failures settle as unavailable instead of remaining in a loading state or appearing to
  prove that no history exists.

## [2.1.0] - 2026-07-29

Chrome Web Store: published 2026-07-29.

### Changed

- Restyled the popup and injected badges to the WiFi Odds visual system, with distinct treatments
  for confirmed equipment, measured odds, and unknown results.
- Reworded the manifest summary while keeping the extension's permissions and supported hosts
  unchanged.

## [2.0.0] - 2026-07-28

Chrome Web Store: published 2026-07-28.

### Added

- ConnectScore coverage for 18 airlines in the popup.
- Optional on-page support for alaskaair.com and Google Flights alongside united.com and Navan.
- Runtime permission controls so optional booking sites are enabled only after a user grants access.

### Changed

- Renamed the extension to WiFi Odds for Flights and expanded it from a United-only companion into
  a multi-airline WiFi decision tool.

[Unreleased]: https://github.com/jeremyinthebay/wifiodds-extension/compare/v3.0.1...HEAD
[3.0.1]: https://github.com/jeremyinthebay/wifiodds-extension/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/jeremyinthebay/wifiodds-extension/compare/v2.2.0...v3.0.0
[2.2.0]: https://github.com/jeremyinthebay/wifiodds-extension/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/jeremyinthebay/wifiodds-extension/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/jeremyinthebay/wifiodds-extension/tree/v2.0.0
