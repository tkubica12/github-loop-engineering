# 0010: Canonical html-docs materials and document appearance

- Status: Superseded by [0012: One full-day HTML journey](0012-one-full-day-html-journey.md)
- Date: 2026-09-16

## Context

The author requested that workshop HTML follow the updated html-docs skill,
including selectable document-wide colors. The existing materials use shared
workshop-specific styles and a two-theme runtime. They also carry stable links,
tested procedures, recorded evidence and two deliberately slide-first talks.

## Decision drivers

- Preserve the completed Loop Engineering learning journey and evidence claims.
- Use the supplied design system rather than inventing another palette.
- Support reading, presenting, keyboard access and offline use.
- Preserve existing URLs and make preferences local to each document.
- Avoid dependencies or per-document runtime forks.

## Options considered

1. Add an accent toggle to the old layout: retains a divergent design system.
2. Replace content and navigation wholesale: risks losing tested procedures.
3. Adapt the existing content to the canonical components and shared runtime.

## Decision

Use option 3. Vendor the supplied skill assets and MIT license under
`docs/assets/html-docs/` without modifying their code or tokens. A local
CommonJS package boundary lets its Node tools run inside this ES-module
repository without introducing a dependency.

Guides, operator material and the simulated control room become canonical
articles with separately authored concise presentation surfaces. Retain the
two dedicated fixed-stage decks because their speaking sequence intentionally
differs from the detailed procedural guides.

Use the canonical synchronous appearance bootstrap and inline tokens, with a
stable document ID, system theme and blue default accent. Offer orange and green
as alternatives across the entire document. Describe warnings and outcomes with
text instead of a second status-color palette.

Keep old chapter and numeric slide links as aliases. Repository-specific
command copying and alias resolution remain in `docs/assets/materials.js`,
outside the unmodified runtime. The synthetic application's UI remains the
application fixture, not a document converted into presentation cards.

## Consequences

Source HTML remains linked to shared assets. Canonical head blocks must be
synchronized after kit updates. Browser and content checks must target the new
semantic structures rather than legacy CSS selectors.

Single-file exports are generated only from sources; linked sibling documents
and lab repositories do not become part of an export. Runtime licensing must
travel with any redistributed standalone file. Existing local, recorded and
live evidence classes do not change because the page design changes.

## Validation

Check head synchronization, stable IDs and old anchors, all six appearance
combinations, preference persistence, reading/presentation controls, reduced
motion, no-JavaScript readability and viewport fit. Preserve the executable
lab and real local HTTP checks; refresh source-bound screenshots. Validate
standalone outputs in an isolated offline folder when exporting.

## Assumptions

The supplied skill is the author's intended visual system. Reader preferences
are a convenience, not analytics. Existing Node/Playwright tooling is sufficient.

## Revisit triggers

An upstream kit update changes component markup, an accessibility defect needs
a shared upstream correction, or a new experience requires a different reading
and presentation narrative.
