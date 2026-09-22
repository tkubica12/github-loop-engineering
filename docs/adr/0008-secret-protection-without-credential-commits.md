# 0008: Demonstrate Secret Protection without credential commits

- Status: Accepted
- Date: 2026-09-06

## Context

Chapter 4 needs genuine Secret Protection evidence alongside CodeQL and governed delivery. Real credentials are prohibited. The public synthetic repository already has secret scanning and repository push protection enabled.

## Decision drivers

- Demonstrate an actual GitHub control rather than a fabricated local scanner result.
- Never create a real credential, commit a sample, change a protected branch, or bypass protection.
- Keep the same outcome available in public sandbox and suitably licensed private enterprise repositories.
- Finish within a five-minute teaching segment, with recorded fallback.

## Options considered

1. Mint and revoke a disposable credential: rejected because it still handles a real credential.
2. Commit an inactive sample and test a Git push: unnecessary history manipulation for the learning objective.
3. Use a local pattern match: useful only as an explicitly simulated exercise, not native enforcement.
4. Exercise the protected GitHub REST blob endpoint with GitHub Skills' documented inactive sample: selected.

## Decision

Fetch the inactive sample from a pinned first-party lesson, verify its source identity, and reconstruct it only in memory. Attempt a blob write, require a semantically identified native rejection, then verify acceptance of a credential-free runtime reference. Compare the default-branch SHA before and after.

Do not call bypass endpoints or change repository settings. Redact the inactive value and bypass identifiers from output. A capability failure is a stop condition. Captured evidence is historical, never proof of a fresh live operation.

## Consequences

The scene proves REST API enforcement, not a command-line Git push or an audit-log event. The clean positive-control request creates an unreferenced Git object, not a commit. Reset needs no branch cleanup. Pattern availability and API access still require preflight.

## Validation

On 6 September 2026 the protected blob endpoint returned HTTP 422 with native secret-scanning metadata for the official inactive sample; the default branch was unchanged. The current GitHub REST guide describes HTTP 409, so classification requires native secret metadata rather than relying on one status code.

Source: [GitHub Skills lesson at 77045e0](https://github.com/skills/introduction-to-secret-scanning/blob/77045e069f9deda2beba27990d65899c4ee4b221/.github/steps/3-enable-push-protection.md). Control: [GitHub push protection from the REST API](https://docs.github.com/en/code-security/concepts/secret-security/push-protection-from-the-rest-api).

## Assumptions

The first-party lesson continues to identify the pinned sample as inactive. Repository administration visibility and blob-write access are available. Private stations have the appropriate Secret Protection capability; no license or policy is enabled implicitly.

## Revisit triggers

- GitHub stops recognizing the inactive learning sample.
- The protected REST endpoint or its response contract changes.
- The workshop needs a separate, explicitly approved delegated-bypass exercise.
