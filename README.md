# Loop Engineering with GitHub

A portable, customer-neutral workshop package. Business intent becomes a verified outcome through a bounded loop that reads prior state, checks its work, and stops explicitly. GitHub is the durable governance layer; GitHub Copilot is the primary worker. The scenario is a synthetic pharmacy stock and reservation service.

Start with the single attendee entry point:

| Material | Audience |
| --- | --- |
| [Workshop hub](docs/index.html) | Everyone — start here |
| [Full-day agenda](AGENDA.md) | Planning |
| [Full-day operator guide](platform/demos/full-day/operator-guide.html) | Presenters |

The hub contains the timed agenda and opening ecosystem demonstration, with direct links to five labs under `docs/labs/`. Each lab contains its explanation, step-by-step instructions and a Slides mode in one HTML document. Labs run in each attendee's own GitHub station repository. Verification is the platform's own evidence — a green check, a required review, a rejected push, a published issue. There is no lab runner to install.

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
npm run validate:workflows # Agentic Workflow sources and compiled locks
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

The facilitator pre-event checklist is in the [full-day operator guide](platform/demos/full-day/operator-guide.html#pre-event-checklist).

The `sandbox` profile needs no enterprise organization. `platform/profiles/enterprise.example.json` is the configuration contract for a future dedicated organization; its provisioning stays disabled until that organization exists.

## Contributing

The materials use the vendored `html-docs` design system in `docs/assets/html-docs/` — never edit those files. After changing any material, run `node docs/assets/html-docs/sync-head.js <file>` and re-validate.

See [AGENTS.md](AGENTS.md) for implementation standards and [PLAN.md](PLAN.md) for delivery scope.
