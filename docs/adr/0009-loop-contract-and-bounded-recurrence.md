# 0009: Loop contract and bounded recurrence

- Status: Accepted
- Date: 2026-09-15

## Context

The full day is **Loop Engineering with GitHub**. The separate **GitHub Beyond
Coding: The Agentic Engineering Loop** showcase retains its identity and URLs.
ADRs [0002](0002-durable-artifact-agent-loop.md) and
[0004](0004-executable-journeys-and-evidence-boundaries.md) already establish
durable collaboration artifacts, independent verification and honest evidence
boundaries. A follow-up issue alone does not establish that a later worker read
the previous result or avoided repeating accepted work.

## Decision drivers

- Preserve the five chapters, the pharmacy scenario and the existing timeboxes.
- Keep GitHub as the durable governance platform and Copilot as the primary worker.
- Teach one useful continuation rather than build an autonomous delivery platform.
- Preserve an account-free sandbox path and configurable enterprise identities.
- Distinguish contract, context, operational state and external evidence.

## Options considered

1. Rename the material only, with no claim of executed recurrence.
2. Add one bounded continuation, trusted verification, state read-back, no-op
   and explicit escalation to the existing experience.
3. Introduce a general-purpose agent fleet, memory service and automated delivery.

## Decision

Choose option 2. Teach `Intake -> Delegate -> Act -> Verify -> Persist -> Decide`.
The existing intent/proposal/proof/approval/release story remains inside this
operating model. Prompt, context, harness and loop are complementary layers.

Use [the versioned contract](../../templates/loop-contract.json) as the shared
teaching policy. Keep the reusable pure state controller in the station template
so local labs and demonstrations use the same implementation. Runtime identity
includes profile, station, repository and objective; application observations
and workflow revisions are not new task identities. Allow two worker attempts
total by default, initial plus one evidence-authorized repair. Persist the
reservation before execution. Invalid evidence, waiting-human, exhausted limits,
accepted duplicate input and actionable task failures are distinct decisions.

Use owned JSON for account-free execution and a marked GitHub issue/comment for
the optional live adapter. Serialize configured processing and reconcile
publication effects on resume; do not promise general distributed exactly-once
execution. A cache is not authoritative state. Every restriction identifies its
enforcing component and the human who can authorize the next action.

The canonical continuation is the recorded source-based export-maintenance
recommendation: add regression coverage for malformed percent encoding without
changing production behavior. A new local agent execution consuming that retained
recommendation is a **local continuation**, not a new GitHub Actions run, review,
merge or release. Deterministic capstone transitions are explicitly simulated
and are not agent execution.

Preserve historical evidence-chain completeness. Add a separate continuation
verdict requiring actual prior-state consumption and trusted verification;
the existence of a follow-up issue cannot satisfy that verdict. Retained public
release artifacts expired on 2026-09-12 and the Azure app was removed. Historical
records remain historical and cannot establish current live readiness.

## Consequences

The common learner path requires no enterprise organization, model credential
or new cloud resource. Human product judgment, review and release authority
remain outside worker authority. Root scheduled maintainer reporting and manual
station workflows keep their deliberate cadence and evidence-path differences.
Existing inference/detection budgets and usage state are preserved.

The new continuation replaces repeated artifact-tour time. It does not extend
the day or require additional live inference on stage. OpenCode remains optional
and experimental; no fresh credentialed run is part of this decision.

## Validation

Behavioral checks must exercise fresh-process read-back, accepted replay without
new attempts or duplicate outputs, exact failing-check repair, waiting-human,
invalid/stale evidence, persistent limits, station isolation and owned recovery.
Full lab verification requires process success and trusted-test/scope integrity.
The capstone separately reports automatic fixture consistency, human review and
recurrence decisions.

Integrated acceptance includes repository tests, pinned Agentic Workflow
compilation/validation, browser and screenshot checks, clean-room local
rehearsals, and fresh-context student, teacher, educator and technical review.
Automated command latency is not measured classroom timing.

On 2026-09-15, a fresh local Copilot worker consumed the reserved work state and
the retained maintenance recommendation, then proposed one regression test for
`GET /exports/%`. The original suite and the suite with the proposal passed;
independent status-code and response-body mutations both failed the new test.
That recorded source-bound receipt was removed before public publication because
it embedded a non-neutral absolute local working directory in its evidence chain.
The continuation is now demonstrated live by running
`node platform\demos\security-remediation\scripts\verify-continuation.mjs` and
reading the verifier's current result. This is local deterministic verification,
not a fresh GitHub run or post-deployment monitoring.

## Assumptions

- Local implementation is authorized; commits, publishing, remote dispatch,
  new resources and changed permissions are not.
- Recorded continuation evidence is not retained; the live verifier remains available.
- A local edit-scope convention is not OS isolation against a malicious process.
- Enterprise live capability checks remain necessary before native delivery.

## Revisit triggers

Revisit if live GitHub recurrence is separately authorized, the pinned compiler
cannot support the smallest adapter, more than one domain task requires a
different state model, or rehearsal demonstrates that the continuation displaces
the core hands-on outcome. Introduce broader infrastructure only with a new ADR.
