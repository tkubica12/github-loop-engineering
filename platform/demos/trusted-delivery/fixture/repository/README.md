# Synthetic pharmacy delivery

A disposable test service for inspecting one change through GitHub pull requests, deterministic checks, release artifacts, and Azure OIDC.

```text
npm ci
npm test
npm start
```

Open `http://localhost:3000/health`. `GET /stock` returns synthetic MED-001 through MED-004. `POST /reservations` accepts `sku` and `quantity` (1-5). Requesting MED-003 returns 409 with a suggested MED-004; it does not reserve the alternative.

Inspect `.github/workflows/ci.yml` for the check and `.github/workflows/release.yml` for the exact-main-SHA release boundary. The `demo/reservation-zero-boundary` pull request intentionally exposes a zero-quantity regression.

This sandbox uses operator dispatch, not enforced independent approval. All stock is in memory and resets on restart. Category matching is an engineering example, not clinical equivalence.
