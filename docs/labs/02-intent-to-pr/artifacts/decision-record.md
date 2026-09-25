# ADR: Select substitutes deterministically

- **Status:** Proposed
- **Decision owner:** API owner
- **Decision deadline:** Before agent delegation

## Context

Several synthetic products may share a category. An agent must not invent ranking policy or make the API response vary between runs.

## Decision

Filter to products in the requested product's category with enough stock for the
requested quantity, exclude the requested SKU, sort by SKU, and return the first
match. Omit the suggestion when no candidate qualifies.

## Consequences

- Tests and demonstrations are reproducible.
- The rule is intentionally simple and is not a recommendation model.
- A future ranking policy requires a new decision and acceptance criteria.

## Alternatives not selected

- Highest stock first: exposes an unapproved business rule.
- Random choice: prevents deterministic proof.
- Cross-category choice: changes product policy.
