# 0004: Executable journeys with explicit evidence boundaries

- Status: Accepted
- Date: 2026-09-05

## Context

The same pharmacy change must be teachable without model credentials and demonstrable on GitHub and Azure. A synthetic workflow record explains a control but does not prove that the control ran.

## Decision drivers

- Show a visible business outcome, not just files or generated prose.
- Rehearse from clean state without participant-account provisioning.
- Keep preview latency and cloud permissions off the local core path.
- Distinguish deterministic checks, agent advice, and human release authority.

## Options considered

| Option | Tradeoff |
| --- | --- |
| Synthetic evidence only | Reliable explanation, no proof of execution |
| Live services only | Authentic, but credentials and queues can stop the lesson |
| Executable local core plus isolated live demonstration | Authentic local behavior, optional live proof, explicit limits |

## Decision

Use the third option. Run the starter and solution through the real HTTP service and browser. Keep acceptance checks independent of the proposed implementation. Show a 409 response, an optional suggestion, unchanged stock, and a separately requested reservation.

Capture real browser states in `docs/assets/screenshots/` with source identity and capture metadata. Label them local and synthetic. Keep illustrative GitHub records in the existing explicitly simulated bundle; do not upgrade their status because local tests pass.

Rehearse live delivery in an isolated private repository and tagged Azure test resources. Bind evidence to the actual commit and workflow run. The personal sandbox's operator dispatch is not a protected independent environment approval. Production controls remain a separate enterprise capability.

## Consequences

The core path needs Node.js, not an AI subscription. Browser rehearsal adds a development-only Playwright dependency; the service and attendee pages remain self-contained. An instructor can explain the same contract using live artifacts or a clearly identified fallback.

There is more than one evidence source. Every handoff must state whether it is a local execution, a GitHub run, an Azure observation, or a synthetic illustration.

## Validation

Run `npm test`, `npm run validate:workflows`, and `npm run test:browser`. Recreate screenshots with `npm run capture`. Execute the separate delivery operator path before claiming live cloud readiness; local tests alone do not establish it.

## Assumptions

All products and stock are synthetic. Category matching demonstrates deterministic API behavior, not clinical equivalence. The authoring checkout is not a disposable lab station.

## Revisit triggers

Revisit when a dedicated enterprise organization, participant identity model, or protected deployment environment becomes available. Recheck the actual GitHub OIDC subject whenever a delivery repository is created, renamed, or transferred.
