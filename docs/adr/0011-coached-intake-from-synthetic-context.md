# 0011: Coached intake from synthetic organizational context

- Status: Accepted
- Date: 2026-09-22

## Context

Lab 2 previously started from a finished business requirement. Real intake
starts earlier: a need is scattered across chat, tickets, and email, mixed with
duplicates of planned work, unrelated complaints, and conflicting proposals.
The workshop wanted attendees to practice separating need from noise, and to
see a custom agent used as a bounded coach rather than an answer generator.
The idea is inspired by public agentic SDLC hackathon material; no text,
artifacts, branding, or cloud-service dependency is taken from it.

## Decision drivers

- Keep the Lab 2 outcome, time box, and downstream chain unchanged.
- Work in the sandbox profile without an organizational data connector.
- Do not ship an answer key the coach or an attendee could read early.
- Treat organizational content as untrusted input, as the repository rules
  require for issue and pull request content.
- Keep station differences in configuration and templates, not duplicated labs.

## Options considered

1. Put the context and an answer key in the lab `artifacts\` folder: simple,
   but the coach could read the answer and attendees would skip the reasoning.
2. Use a live organizational data connector: realistic, but enterprise-only,
   not synthetic, and unavailable in the sandbox profile.
3. Ship synthetic context and a read-only coaching agent in the station
   template, keep the confirmed requirement only in the lab guide, and compare
   after the attendee confirms their own draft.

## Decision

Use option 3. The station template carries `context/intake/` (a synthetic team chat
thread, ticket digest, and stakeholder email) and
`.github/agents/requirement-refiner.agent.md`. The agent has only the `read` and
`search` tool aliases, is excluded from automatic model selection, asks one
question at a time, and drafts a requirement only after a message starting with
`CONFIRMED:`. Anything the person did not confirm is marked `NOT CONFIRMED`.
The confirmed requirement stays in the lab `artifacts\` folder, outside the
station repository. No answer key exists in the station repository or anywhere
the coach can read; station-wide instructions state only general invariants.

The station also gains path-scoped `.github/instructions/*.instructions.md`
files and a synthetic backlog seeded by `workshop.mjs seed`. Seeding is a dry
run by default, identifies prior items by a hidden marker or exact title, and
with `--apply` creates only missing labels and issues. It refuses to apply
offline, against an unreadable repository, for a profile without remote
seeding, for any repository other than the requested station, or when the
station's committed ownership marker does not match. Seeding has its own
profile flag, so enterprise stations provisioned by organization owners still
receive the synthetic backlog.

## Consequences

- Lab 2 grows from 25 to 30 minutes by shortening the See segment to 15.
- Facilitators must seed backlogs and verify custom agent visibility before
  delivery; the operator guide carries a pre-event checklist.
- Custom agent availability depends on the attendee's Copilot surface and
  policy. A paired fallback with the same questions preserves the outcome.
- The coach can still be prompted off-script. Its tool list, not its prose,
  is the enforced boundary, and the comparison step exposes drift.

## Validation

- `tests\platform.test.mjs` checks backlog plan idempotence, dry-run and
  unsafe-apply refusal, and consistency between the agent, instructions,
  CODEOWNERS, context, and backlog. It also asserts the station contains no
  confirmed requirement and the agent file contains no solution terms.
- Custom agent and path-scoped instruction behavior was checked against
  first-party GitHub documentation on 2026-09-22.

## Assumptions

- Copilot CLI and VS Code continue to load repository custom agents from
  `.github/agents/` and honor the `tools` list.
- Attendees run Step 1 in an interactive surface, not as a cloud agent task.

## Revisit triggers

- Custom agent frontmatter, tool aliases, or selection behavior changes.
- A sanctioned synthetic organizational data connector becomes available in
  both profiles.
- Educator review shows the intake consistently exceeds its time box.
