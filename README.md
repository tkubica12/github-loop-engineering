# Loop Engineering with GitHub

A portable, customer-neutral workshop package. Business intent becomes a verified outcome through a bounded loop that reads prior state, checks its work, and stops explicitly. GitHub is the durable governance layer; GitHub Copilot is the primary worker. The scenario is a synthetic pharmacy stock and reservation service.

Everything attendees and presenters read is HTML. Start here:

| Material | Audience |
| --- | --- |
| [Workshop hub](docs/index.html) | Everyone — start here |
| [Full-day agenda](AGENDA.md) | Planning |
| [Full-day guide](docs/guides/full-day.html) | Attendees — the day's narrative |
| [The five labs](student/labs/index.html) | Attendees — hands-on |
| [Loop Engineering reference](docs/guides/loop-engineering.html) | Concepts, contract and stop paths |
| [Platform architecture](docs/guides/platform-architecture.html) | Architects |
| [One-hour showcase](docs/slides/agentic-engineering-loop.html) | Separate 60-minute session |
| [One-hour operator guide](teacher/demos/agentic-engineering-loop/operator-guide.html) | Presenters |
| [Full-day operator guide](teacher/demos/full-day/operator-guide.html) | Presenters |

Labs are performed in each attendee's own GitHub station repository. Verification is the platform's own evidence — a green check, a required review, a rejected push, a published issue. There is no lab runner to install.

## Run the materials locally

```powershell
npm ci
npm run serve     # then open http://localhost:4173/docs/
```

Port busy? `$env:PORT=4174; npm run serve`

## Check the materials

```powershell
npm test                  # materials integrity and lab artifacts
npm run validate          # HTML structure, local references, profiles
npm run validate:html     # six palettes, offline, responsive, no-JS
npm run capture           # regenerate source-bound screenshots (needs Playwright)
```

Screenshots live in `docs/assets/screenshots/`; they are local captures, not GitHub or Azure evidence.

## Station repositories

```powershell
node platform/scripts/workshop.mjs plan --profile sandbox --station demo01
```

Seed each created station with the synthetic backlog that Lab 2 treats as noise. The default is a dry run that reads existing issues; `--apply` creates only missing labels and issues and never edits or deletes anything:

```powershell
npm run seed:station
node platform/scripts/workshop.mjs seed --profile sandbox --station demo01 --apply
```

The facilitator pre-event checklist is in the [full-day operator guide](teacher/demos/full-day/operator-guide.html#pre-event-checklist).

The `sandbox` profile needs no enterprise organization. `platform/profiles/enterprise.example.json` is the configuration contract for a future dedicated organization; its provisioning stays disabled until that organization exists.

## Contributing

The materials use the vendored `html-docs` design system in `docs/assets/html-docs/` — never edit those files. After changing any material, run `node docs/assets/html-docs/sync-head.js <file>` and re-validate.

See [AGENTS.md](AGENTS.md) for implementation standards and [PLAN.md](PLAN.md) for delivery scope.
