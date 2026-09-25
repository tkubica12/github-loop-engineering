# Repository rules

## Purpose

This repository authors one full-day technical workshop, **Loop Engineering with GitHub**, defined in `AGENDA.md`. Its progressive scenario is a synthetic pharmacy stock and reservation service.

The workshop presents GitHub as an orchestration layer for people, coding agents, deterministic automation, security, and delivery governance. Optimize for attendee learning, live-delivery reliability, and credible enterprise adoption — not feature count.

The material is **customer-neutral**. Use no company, tenant, or customer names anywhere, including identifiers, URLs, and recorded evidence. Use synthetic data only.

## Learning design

Each full-day chapter follows one rhythm:

1. **See it** — demonstrate a polished end-to-end outcome.
2. **Work with it** — guide one meaningful hands-on outcome.
3. **Connect it** — explain the architecture, controls, tradeoffs, and adoption path.

Put the strongest platform message and the complete engineering loop before the first break. Keep one progressive story. Prefer depth on critical outcomes over shallow coverage. Give every chapter a clear outcome and transition. Design for recovery margin, and move optional depth into explicit extensions.

## Platform profiles

Everything works in two profiles without changing learner-facing concepts.

- **Sandbox** — public GitHub, no enterprise licensing, policies, managed users, or dedicated organization. Where a capability cannot be exercised, use a clearly labeled simulation or teacher demonstration.
- **Station** — a future dedicated enterprise organization with one isolated repository per station or team, centrally governed.

Implement profile differences through configuration, not duplicated content. Never hard-code an organization, tenant, subscription, or identity model. Every enterprise-only or preview capability needs a capability check, a sandbox-compatible path, an explicit limitation statement, and a supported live fallback.

## Product accuracy

Prefer current first-party GitHub documentation. Record the validation date for time-sensitive claims. Distinguish generally available, public preview, and conceptual capabilities. Do not imply that all coding agents share permissions, interfaces, or availability. Separate GitHub-native capabilities from external harnesses. Treat agent output as untrusted until deterministic checks and required human controls pass.

**Never represent a simulation or a recording as a live platform control.**

## Repository layout

```text
docs/                    index.html (agenda, opening demo, Slides), labs/, assets/, adr/
docs/labs/               one directory per lab: index.html plus artifacts/
platform/demos/          demo source, fixtures, automation, operator notes
platform/                profiles/, scripts/, templates/
templates/               reusable authoring templates
tests/                   materials integrity checks
```

Root files: `README.md` (short navigation), `PLAN.md` (delivery roadmap), `AGENDA.md` (full-day intent and schedule), `AGENTS.md` (these rules).

## Attendee-facing content

HTML is the source format for presentations, lab instructions, reference documentation, and architecture explanations. `docs/index.html` is the sole attendee entry point; each of the five linked labs combines reading and presentation modes in its own HTML. Do not use Markdown as the primary attendee experience or create parallel slide decks and guides.

- Use the vendored `html-docs` system in `docs/assets/html-docs/`. **Never edit vendored runtime files** — they are SHA-pinned.
- Synchronize canonical head blocks with `node docs/assets/html-docs/sync-head.js <file>`.
- Give each material a stable, unique `doc-id`.
- Support light and dark modes and the blue, orange, and green accents. Warnings use text labels, not independent color palettes.
- No Unicode emoji. Meet accessible contrast, keyboard navigation, visible focus, semantic HTML, and reduced-motion expectations.
- Keep runtime dependencies vendored. Never depend on a CDN.
- Wrap code blocks as `<div class="code"><pre><code>` so they scroll instead of overflowing. Prefer `<dl>` over wide tables.

### Slides

Slides are speaking aids. One idea per slide, sparse text, progressive disclosure. Article slides stay within 45 words and three points of at most ten words. Keep full procedures in the reading view of the same HTML file. Preserve full-screen, keyboard, and deep-link behavior.

### Guides

Address the reader directly: "Open", "Run", "Verify". Never use third-person classroom narration. Use progressive disclosure, stable anchors, copyable commands, expected results, checkpoints, and cleanup. Explain whether each action is a live platform operation or a labeled substitute.

## Attendee labs

Each lab is **one directory**: `index.html` plus an `artifacts/` folder holding only what the attendee opens, copies, or completes. Do not add lab metadata files, shared runners, or generated fixtures.

Labs are performed in the attendee's own station repository on GitHub. **Verification is the platform's own evidence** — a green check, a required review, a rejected push, or a published issue. Never ship a script that prints a pass result to the attendee.

Every lab states its outcome and time, prerequisites and access path, prepared starting state, numbered steps, observable expected results, troubleshooting tied to symptoms, a recovery path including a reference artifact for attendees who run out of time, and optional extensions kept separate from the core path.

## Facilitator demonstrations

Every demonstration is self-contained, repeatable from a clean documented start, automated and idempotent where GitHub permits, and safe with synthetic data. Each provides an executable preflight, non-interactive lifecycle automation, an operator flow with timing and expected visible states, recovery instructions, and pre-captured evidence for network-, quota-, or permission-sensitive steps.

The opening demonstration needs a rehearsed instructor station, a credible payoff in the first 30 minutes, and an honestly labelled source-based fallback when the live chain is unavailable.

## GitHub automation

Use least-privilege `GITHUB_TOKEN` permissions and pin third-party actions to immutable commit SHAs. Prefer OpenID Connect over long-lived credentials. Keep deterministic gates separate from reasoning-based automation. Treat issue, pull request, and review content as untrusted input. Prevent untrusted pull-request code from gaining write tokens or protected secrets. Require explicit human approval for material code changes and production deployment. Make concurrency, timeout, and cost boundaries explicit.

**Never commit credentials, customer data, personal access tokens, or tenant-specific identifiers.** Provisioning scripts support dry-run before destructive operations, and cleanup targets only resources carrying the workshop identifier.

## Architecture decisions

Record significant decisions about content architecture, station isolation, workflow security, identity, deployment, or portability as ADRs in `docs/adr/`, named `NNNN-kebab-case-title.md`, starting from `templates/adr-template.md`. Mark superseded decisions and link both records; do not erase decision history. Skip ADRs for routine implementation details.

## Validation

```powershell
npm test                  # materials integrity and lab artifacts
npm run validate          # HTML structure, local references, profiles
npm run validate:html     # six palettes, offline, responsive, no-JS
npm run validate:workflows
npm run capture           # regenerate source-bound screenshots
```

Verify attendee-visible outcomes and the operator path, not only file existence. After changing any material, re-run `validate:html`; after changing a captured page, re-run `capture`.

## Review gates

Run independent, fresh-context reviews at deliverable boundaries, inspecting real artifacts and validation evidence.

- **Educator review** — objective alignment, pacing, cognitive load, hands-on value.
- **Student test** — follow only the attendee guide and execute every step.
- **Teacher test** — run the exact presentation path and verify visible states and cleanup.
- **Critical technical review** — privilege boundaries, untrusted input, action pinning, cleanup scope, portability, and honest labeling of simulations.

Iterate until no blocking or material finding remains.

## Definition of done

A deliverable is complete when it follows this structure and the HTML policy, both profiles share one configurable implementation, product states and limitations are accurate and visible, content is polished and cross-linked, automation and the exact user journey pass from a clean start, no secrets or customer names are present, significant decisions have an ADR, and relevant reviews report no blocking findings.
