# 0003: Static self-contained attendee content

- Status: Accepted
- Date: 2026-07-27

## Context

Live delivery may face restricted networks, unavailable package registries, or GitHub preview latency. Slides, guides, and fallback visuals must remain reliable.

## Decision drivers

- Offline availability.
- Near-zero setup and fast recovery.
- Accessibility and presenter control.
- Easy hosting from any local HTTP server.

## Options considered

1. Hosted slide and documentation services.
2. A framework-based documentation application.
3. Plain HTML, CSS, and JavaScript with repository-local assets.

## Decision

Use self-contained static HTML and shared repository-local assets. Use a dependency-free Node.js server only for local preview.

## Consequences

Content validation is custom and interaction code must stay small. There is no build step or runtime CDN dependency.

## Validation

Serve the repository locally, navigate every internal link, operate the hub and five lab Slides modes by keyboard, switch themes, and verify that local source-based fallbacks remain readable with network access disabled. The separate mission-control experience was retired by [ADR 0012](0012-one-full-day-html-journey.md).

## Assumptions

The presenter has a modern Chromium, Firefox, or Safari browser and Node.js 20 or newer.

## Revisit triggers

The experience requires state or collaboration that cannot be maintained responsibly in static files.
