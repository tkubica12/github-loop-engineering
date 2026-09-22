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

The author-checkout runner hashes the station against a setup baseline outside
the proposal directory, checks required test bytes, and executes trusted
unit/HTTP tests against a fresh copy of the proposed inventory implementation.
Both complete test processes must succeed, including learner regression tests.
Skipped, todo and cancelled learner tests block verification and remove any
previous handoff, even when the test process exits successfully. Run `npm test`
from the station directory for the portable direct-test command.
The checker also compares execution-tree and proposal digests before and after
the processes; any changed test, source or extra output blocks the handoff.
A successful verification persists a revision-bound `lab02-handoff.json` receipt
under `.workshop/lab-verification/` for the capstone.

Do not edit the author-checkout verifier, its baseline or receipts. This is an
enforced file-scope check within the local exercise, not OS isolation: a malicious
process with the same filesystem permissions could tamper with the checker.
Real deployments need a separately trusted CI checkout and protected controls.
