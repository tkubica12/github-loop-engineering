---
applyTo: "src/**/*.mjs"
---

# Service source rules

- Keep `reserve()` responses backward compatible: existing fields keep their names, types, and HTTP status codes. Add fields; do not rename or remove them.
- Change stock only when a reservation succeeds with `201`. Every other path leaves `available` unchanged.
- Keep behavior deterministic: no randomness, clocks, network calls, or environment-dependent ordering.
- Use Node.js built-in modules only and keep inventory data synthetic.
- Keep functions small and pure where possible so `node:test` can exercise them without a server.
