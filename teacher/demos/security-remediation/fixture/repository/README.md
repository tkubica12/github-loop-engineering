# Synthetic pharmacy

A small, dependency-free stock and reservation API for an engineering workshop.
All items and stock values are fictional. Category matching is not clinical equivalence.

```text
npm test
npm start
```

The local service binds to `127.0.0.1:3000`.

| Endpoint | Contract |
| --- | --- |
| `GET /health` | Service identity; release identity when packaged |
| `GET /stock` | Current in-memory synthetic stock |
| `POST /reservations` | Reserve quantity 1-5; a 409 suggestion never reserves an alternative |
| `GET /exports/stock.json` | Download the prepared synthetic seed snapshot, not live stock |

**Security exercise:** the starter export handler deliberately trusts a caller-selected
filename. Run it only on loopback with synthetic files. Do not deploy this starter.
Use the actual CodeQL alert and regression tests to remove that trust before release.

The intended fixed contract permits only `stock.json`, rejects other export names,
and never exposes arbitrary files. Model output is a proposal; review and deterministic
evidence remain required.
