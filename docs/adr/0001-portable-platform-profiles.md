# 0001: Portable platform profiles

- Status: Accepted
- Date: 2026-07-27

## Context

The workshop must be fully developed and tested in `tkubica12` today, while future student delivery may use a dedicated GitHub Enterprise organization with stronger isolation and policy controls.

## Decision drivers

- Avoid blocking content development on enterprise procurement.
- Preserve one learner journey across environments.
- Make capability gaps honest and visible.
- Prevent tenant-specific values from spreading through content and automation.

## Options considered

1. Wait for the enterprise organization.
2. Maintain separate personal and enterprise workshop variants.
3. Use one profile-driven implementation with capability checks and fallbacks.

## Decision

Use JSON platform profiles. The sandbox profile targets `tkubica12`; the enterprise example leaves organization, teams, policies, and station isolation configurable. Content describes concepts once and labels live, demonstrated, and simulated states.

## Consequences

Provisioning and guides must resolve profile values at runtime. Enterprise-only controls cannot be represented as active in the sandbox. Profile validation becomes a release gate.

## Validation

Render and test a complete station with the sandbox profile. Verify that the enterprise example contains no hidden tenant dependency.

## Assumptions

Student stations will use GitHub.com rather than GitHub Enterprise Server.

## Revisit triggers

Adoption of Enterprise Managed Users, GitHub Enterprise Server, mandatory data residency, or a station identity model that cannot use repository-per-team isolation.
