# Substitute suggestion specification

## User outcome

When a requested medicine is unavailable, the caller receives one deterministic in-stock alternative that a human may accept or reject.

This workshop contract is a synthetic, nonclinical inventory exercise. A suggestion is not medical advice and never authorizes substitution.

## Observable contract

- `POST /reservations` keeps returning HTTP 409 for an unavailable requested SKU.
- The response adds `suggestion` with only `sku`, `name`, and `available`.
- A candidate must have enough stock for the requested quantity.
- `MED-003` resolves to the first eligible item in the same category, ordered by SKU.
- If no same-category candidate can satisfy the quantity, omit `suggestion`.
- Existing successful reservations and unknown-SKU responses do not change.
- Returning a suggestion does not reserve it or change any stock.

## Constraints and non-goals

- All data is synthetic.
- Do not add a package or expose internal category, stock, patient, or pharmacy data.
- Do not automatically substitute or create a reservation.
- A product owner must confirm whether one suggestion is sufficient.

## Proof

Implement the feature in `src/inventory.mjs`. Add optional learner regression coverage in
the new `test/suggestion.test.mjs`. These are the only authorized proposal files.
Keep the server, workflows, dependencies, existing tests and
`test/suggestion.acceptance.test.mjs` unchanged. The original HTTP feature remains
part of acceptance; test-only changes cannot satisfy it.

Acceptance evidence is the green GitHub Actions **Test service** check on the pull request,
which runs `npm test` from a fresh checkout of the proposed head. Run `npm test`
from the station directory for the same direct-test command locally. The check
does not detect skipped, todo or cancelled tests, so reviewers reject them in
the diff. A green summary printed by the worker never replaces the check.

The merged revision is the handoff that the capstone consumes. Human review
confirms that the diff stays within the authorized files; the check alone does
not prove scope.
