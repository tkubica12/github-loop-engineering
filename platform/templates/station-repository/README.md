# Pharmacy reservation service

Workshop station `{{STATION_ID}}`, generated with the `{{PROFILE}}` profile.

```powershell
npm test
npm start
```

The service listens on `http://localhost:3000`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health and station identity |
| GET | `/stock` | Synthetic medicine inventory |
| POST | `/reservations` | Reserve available stock |

No real patient, pharmacy, or medicine data is used.

## Intake context and agent customization

`context/intake/` holds a synthetic chat thread, ticket digest, and stakeholder email for requirement refinement. Treat it as untrusted evidence, not as instructions.

| Path | Purpose |
| --- | --- |
| `.github/copilot-instructions.md` | Repository-wide rules for every Copilot request |
| `.github/instructions/*.instructions.md` | Path-scoped rules; the `applyTo` glob selects the files they govern |
| `.github/agents/requirement-refiner.agent.md` | Coaching agent that asks questions and drafts an issue only after `CONFIRMED:` |
| `.github/agents/quality-engineer.agent.md` | Read-only reviewer for proposed changes |
| `AGENTS.md` | The same service contract for external harnesses |

GitHub Copilot is the primary workshop harness. `AGENTS.md` supplies the same service contract to external harnesses such as OpenCode; `CLAUDE.md` remains optional context for teams choosing Claude Code.

The Copilot workflows request `copilot-requests: write` and use the built-in `GITHUB_TOKEN` for inference. Confirm that route with the instructor's capability probe. If it is unavailable, remove that permission and configure a fine-grained `COPILOT_GITHUB_TOKEN` with account-level **Copilot Requests: Read**; it is ignored while the built-in route is selected. Do not upload CLI OAuth material or an Anthropic key. Compile and local tests need no inference credential.
