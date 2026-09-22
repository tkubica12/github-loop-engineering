# Workshop repository instructions

Follow `AGENTS.md`.

- Preserve the two-profile architecture: the `sandbox` profile must work without a dedicated enterprise organization, while the enterprise profile remains configurable.
- Keep attendee-facing material self-contained HTML with shared assets under `docs/assets/`.
- Use only synthetic pharmacy data.
- Keep deterministic quality and deployment controls separate from reasoning-based automation.
- Label preview, enterprise-only, and simulated experiences honestly.
- Run `npm test` and validate Agentic Workflow sources after changes.
