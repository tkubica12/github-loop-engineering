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

Export contract: only `/exports/stock.json` is permitted. Any other export name,
including encoded traversal input, is rejected before filesystem access.
