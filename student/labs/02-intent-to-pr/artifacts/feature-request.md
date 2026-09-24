TITLE
[Reservation] Suggest an available substitute when stock is zero

OUTCOME
A pharmacist handling a synthetic reservation can immediately see one available
item in the same category when the requested item is out of stock. This is a
nonclinical inventory suggestion for a human to evaluate, not medical advice.

ACCEPTANCE CRITERIA
- Given MED-003 has zero stock and MED-004 is available in the same category,
  when POST /reservations requests one MED-003, then the service returns 409
  with error, available, and a suggestion containing sku, name, and available.
- A candidate is eligible only when its stock can satisfy the requested quantity;
  if no same-category candidate qualifies, omit suggestion.
- Given an unknown SKU, the service still returns 404 without a suggestion.
- Given an in-stock SKU, reservation behavior and remaining stock are unchanged.
- A suggestion never creates a reservation or changes stock.
- The implementation is deterministic and covered by node:test.

CONSTRAINTS
- Keep the service dependency-free.
- Use synthetic data only.
- Do not change workflow permissions or ownership.
- Prefer the smallest reviewable change.
- Authorized proposal files: src/inventory.mjs and optional new
  test/suggestion.test.mjs. Keep the server, workflows, dependencies and all
  existing required tests unchanged. Acceptance evidence is the green
  GitHub Actions check on the pull request, not a summary printed by the worker.

RISK
Medium - API response behavior
