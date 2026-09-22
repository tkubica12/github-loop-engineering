# 0006: Prefer the native workflow token after a capability probe

- Status: Accepted
- Date: 2026-09-05

## Context

The user requested verification of per-run token authentication instead of assuming a stored personal token was necessary. First-party documentation recommends `copilot-requests: write` with organization billing, but repository type alone did not establish the prepared sandbox's capability.

## Decision drivers

- Avoid storing an inference credential when the per-run token works.
- Prove which credential the generated workflow actually binds.
- Keep a separately tested fallback without silently switching credentials.
- Bound both the agent and threat-detection phases.

## Options considered

| Option | Tradeoff |
| --- | --- |
| Always use a PAT for personal repositories | Unnecessary credential lifecycle in the verified sandbox |
| Assume the native token works everywhere | Makes an unsupported billing and policy promise |
| Probe the native token, then select a route explicitly | Evidence-backed default with an explicit fallback |

## Decision

Prefer `copilot-requests: write` and the built-in `GITHUB_TOKEN` for the workshop's primary Copilot sources. Require a successful capability probe in each delivery environment. If it fails, remove that permission and use the separately configured fine-grained `COPILOT_GITHUB_TOKEN`; the compiler ignores that secret while the native route is selected.

This supersedes only the authentication choice in [0005](0005-copilot-primary-and-external-harnesses.md).

## Consequences

The prepared personal sandbox does not need a PAT for the native route. The PAT comparison and imported OpenCode sample remain explicitly selected, separate routes. This does not establish universal personal-repository eligibility or identify which account receives charges.

Detection retains a separate 20 AIC cap with `continue-on-error: false`. Main-agent caps do not describe total inference cost or whole-workflow duration.

## Validation

Run `33968217011` passed agent, detection, and safe-output jobs and created issue `#4`. The emitted workflow binds `COPILOT_GITHUB_TOKEN` to `github.token` in both inference phases and contains no Copilot PAT secret reference.

The separate PAT-backed run `33968216944` created issue `#5`.

## Assumptions

These are observed results from a private demonstration repository that is not published with this material, not a promise for other repositories. The run and issue identifiers are retained for traceability only; they are not publicly resolvable. [GitHub's organization-billing prerequisites](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows#enabling-organization-billing-for-github-agentic-workflows) and [authentication reference](https://github.github.com/gh-aw/reference/auth/) remain required preflight reading.

## Revisit triggers

Repository transfer, Copilot plan or policy changes, compiler upgrades, expired fallback credentials, or any failed authentication probe.
