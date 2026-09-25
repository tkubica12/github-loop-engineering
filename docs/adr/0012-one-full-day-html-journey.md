# 0012: One full-day HTML journey

- Status: Accepted
- Date: 2026-09-25

## Context

The parallel full-day guide, lab index, slide deck, and separate one-hour
showcase made it difficult to find the current workshop path. The five labs
already had reading and presentation views in the same HTML.
This decision supersedes the separate-deck and URL-retention aspects of
[ADR 0010](0010-canonical-html-docs-materials.md), not its shared runtime or
accessibility rules.

## Decision drivers

- One progressive day aligned to `AGENDA.md`, with direct lab access.
- Keep the sandbox path usable without a dedicated enterprise organization.
- Preserve live demonstration materials without presenting archived evidence
  or local reference files as fresh platform controls.
- Avoid parallel copies of explanations and separate presenter decks.

## Options considered

1. Keep the current pages but hide the one-hour navigation: still duplicates
   the day and leaves multiple entry points.
2. Replace the labs with a single large HTML file: loses usable lab anchors
   and obscures the hands-on path.
3. Use one agenda hub and five combined article/presentation labs.

## Decision

Choose option 3. `docs/index.html` is the sole attendee entry point with the
timed agenda, opening GitHub ecosystem demonstration and adoption close.
Each agenda lab link opens its own `docs/labs/<chapter>/index.html`; the same
file holds chapter explanation, steps, recovery and Slides view.
Retire the duplicate guides, decks, lab index and standalone one-hour
showcase. Keep reusable full-day demonstration fixtures and operator paths
under `platform/demos/`; the `showcase-signal` workflow remains part of the
full-day station workflow contract despite its legacy name.

The opening uses an instructor station prepared ahead of the room with a
reservation regression, not the stock-suggestion requirement attendees
discover in Lab 2. If the live chain is unavailable, show local stock tests
and labelled historical security records separately; neither proves a live
release. Lab 1 source-only edits remain in a draft PR until a matching lock
is compiled and validated; preview fallback is source analysis, not a
claimed recorded run. Private sandbox stations without enforceable protection
record that gap and skip the direct-push probe.

## Consequences

Former links to deleted pages need updating. HTML assets remain vendored and
unchanged. The station repository and its deterministic checks remain the
source of attendee evidence; platform profiles are still configuration.
Operator runbooks remain internal rather than alternate attendee guides.

## Validation

Check timed agenda links, reading and Slides mode in all five labs, local
references, actual browser presentation, screenshot provenance and workflow
sources. Rehearse the instructor-station opening and its labelled fallback.

## Assumptions

Attendees receive a station repository URL before the event. The facilitator
can prepare a separate synthetic instructor station.

## Revisit triggers

A chapter cannot fit its presentation and procedure in one accessible HTML,
or a new event with a genuinely different learning objective is approved.
