---
applyTo: "test/**/*.mjs"
---

# Test rules

- Use `node:test` and `node:assert/strict`; add no test dependencies.
- Create a fresh inventory with `createInventory()` in each test so tests stay independent.
- Assert observable behavior: status codes, response fields, and stock before and after.
- Keep tests deterministic and offline: no network, timers, or random data.
- Never delete, skip, or weaken an existing test to make a change pass. A red test is evidence to report, not an obstacle to remove.
