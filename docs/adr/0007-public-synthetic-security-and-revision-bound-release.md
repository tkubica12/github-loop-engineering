# 0007: Public synthetic security evidence and revision-bound release

- Status: Accepted
- Date: 2026-09-05

## Context

The personal private sandbox does not provide the licensed native code-scanning experience required by the workshop. The user explicitly approved a separate public repository containing only a synthetic miniapp, its tests and workflows.

The existing private deployment proves OIDC and deterministic packaging, but it cannot prove that a different public security-remediation commit was deployed.

## Decision drivers

- Produce a real CodeQL alert and fixed state, not invented SARIF or a screenshot simulation.
- Publish no private workshop history, customer data, tenant identifiers or credentials.
- Demonstrate actual human authorization and approval through GitHub records.
- Keep the application revision distinct from later workflow-definition changes.

## Options considered

| Option | Tradeoff |
| --- | --- |
| Keep only a local policy exercise | No native code-scanning evidence |
| Enable private code scanning | Requires a license not currently available in the personal sandbox |
| Isolated public synthetic repository | Native evidence without exposing private authoring material |

## Decision

Use the explicitly approved public synthetic repository. Seed only an allowlisted source set with a loopback-only path-traversal exercise and no deployment workflow. Native CodeQL produces the finding; Copilot proposes the bounded fix; a human authorizes CI, approves the final head and permits merge. Retain the finding, review and fixed-alert records.

Do not deploy the starter. Release only the reviewed merged application revision after native security evidence passes and the target environment's human gate is satisfied.

Name revision identities separately: PR head H, test-merge revision P, merged application M, and release-workflow definition R. A workflow added after the application fix may run at R while packaging M. Any verifier supporting that arrangement must establish the target from the checked artifact manifest and trusted workflow configuration, not assume R equals M or accept unrelated historical deployment evidence.

## Consequences

The public repository is an isolated teaching artifact, not a production pharmacy service. CodeQL can miss semantically equivalent expressions; the actual analysis and data flow must be inspected. The local exercise probes only its own harmless manifest.

Captured JSON is a recorded observation, not a cryptographic attestation. Fresh live claims require a new read-only collection; imported fixtures never authorize them.

## Validation

Native analysis `1729751492` reported `js/path-injection`. Human review `5122408217` approved PR head `2d84da4ce6cb30f846032e3d497c36b477eaf6c2` before merge `dc4b2708ec2e55bb5652c2c56c8bbf640646043c`. Analysis `1729884031` reported no remaining result and alert #1 became fixed.

The local starter/solution rehearsal confirms approved export behavior and rejection of traversal, encoding edge cases and unknown names without probing real files. Release evidence is a separate required gate.

## Assumptions

Public-repository code scanning remains available for the prepared account. No inference credential is copied from the private sandbox. Per-run Copilot access and the imported OpenCode sample need their own capability checks.

## Revisit triggers

Availability of a licensed private enterprise environment, a change to public-release consent, modified scanner behavior, or a different identity/release-workflow design.
