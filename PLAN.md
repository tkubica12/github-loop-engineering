# Loop Engineering with GitHub - Delivery Roadmap

## 1. Purpose and central proposition

This repository prepares two public, audience-neutral GitHub learning experiences built on one synthetic pharmacy stock and reservation service:

1. the full-day **Loop Engineering with GitHub** technical workshop defined in `AGENDA.md`;
2. the separate one-hour showcase, **GitHub Beyond Coding: The Agentic Engineering Loop**.

The central proposition is:

> Use GitHub Copilot as the primary worker and GitHub as the governed system of record for a bounded loop: intake, delegation, action, verification, persistence, and an accountable next decision.

The operating lifecycle is `Intake -> Delegate -> Act -> Verify -> Persist -> Decide`, with retry, wait, escalate, no-op, and verified exit as explicit paths. The inner change story remains `Intent -> Propose -> Prove -> Approve -> Release -> Improve`. Prompt, context, harness, and loop are complementary layers: repository instructions are not run state, a worktree is not a security boundary, and per-run output caps do not deduplicate later runs.

GitHub Copilot is the primary coding harness in every required demonstration and lab. Optional external harnesses may be discussed conceptually, but they are not required to run the day and must still land work through GitHub issues, branches, pull requests, checks, reviews, and deployment records. Azure DevOps migration is a workshop topic, not an assumed starting condition for every delivery.

## 2. Attention-aware workshop design

### Design for the real audience curve

| Time window | Expected audience condition | Design response |
| --- | --- | --- |
| First 10% | Some participants may arrive late. | Open with concise framing and a visual platform map; avoid placing the only critical demonstration in the first few minutes. |
| 10-25% | Highest combined manager and technical attention. | Deliver the strategic thesis and GitHub Agentic Workflows. |
| 25-60% | Strong working attention before lunch. | Explain how issues, specifications, Copilot, pull requests, governance, and migration make the vision practical. |
| Lunch boundary | Some managers may leave. | Complete all essential strategic, governance, and migration messages before lunch. |
| 60-80% | Primarily technical audience. | Go deeper into CI/CD, security, identity, environments, and implementation patterns. |
| After afternoon break | Attendance and energy may fall. | Introduce no essential strategic proposition. Use a technical capstone that integrates concepts already presented. |

### Show the destination, then unpack it

A purely foundational progression would delay the most distinctive content until the weakest attention window. A purely excitement-driven order would feel chaotic. Use this balance:

1. **Executive platform briefing:** Present the complete map and strategic messages.
2. **Bounded continuous AI:** Show the differentiated destination and the compact operating contract before the first break.
3. **Intent-to-change workflow:** Explain the GitHub artifacts on which humans and agents operate.
4. **Enterprise operating model:** Establish governance, harness choice, ownership, and migration.
5. **Trusted delivery:** Deep dive into deterministic controls, security, and release evidence.
6. **Capstone:** Reassemble the full human-agent delivery loop.

### Chapter rhythm

Use a repeated **see it - work with it - connect it** pattern:

1. **See it:** Demonstrate the complete outcome, including advanced or permission-sensitive scenarios that should not be rebuilt live.
2. **Work with it:** Let participants make one meaningful change or decision in their prepared station repository.
3. **Connect it:** Discuss architecture, controls, tradeoffs, and adoption.

### Recommended content balance

| Activity | Approximate share | Purpose |
| --- | ---: | --- |
| Technical demonstration and explanation | 40% | Establish the art of the possible and show complete platform experiences. |
| Guided hands-on work | 35% | Build direct experience without letting setup dominate. |
| Architecture and adoption discussion | 25% | Connect capabilities to engineering governance, migration, and operating model decisions. |

Hands-on segments are guided, not open-ended. Participants should use prepared station repositories and platform evidence rather than spend workshop time installing tools or debugging account setup.

## 3. Narrative for the day

```text
Business intent
  -> GitHub Issues, Projects, specifications, decisions, and context
  -> Human developers and coding harnesses, with Copilot primary
  -> GitHub pull requests
  -> Deterministic CI/CD, security gates, and Agentic Workflows
  -> Governed software delivery
```

Keep four durable artifacts visible all day: issue, pull request, workflow run, and deployment or security record. Chat transcripts are not the system of record.

## 4. Detailed schedule

| Time | Duration | Session |
| --- | ---: | --- |
| 09:00-09:30 | 30 min | Executive platform briefing |
| 09:30-10:20 | 50 min | Chapter 1: Bounded continuous AI with GitHub Agentic Workflows |
| 10:20-10:35 | 15 min | Break |
| 10:35-11:35 | 60 min | Chapter 2: From intent to a verified handoff |
| 11:35-12:30 | 55 min | Chapter 3: GitHub Enterprise operating model |
| 12:30-13:15 | 45 min | Lunch |
| 13:15-14:35 | 80 min | Chapter 4: Trusted delivery with CI/CD and DevSecOps |
| 14:35-14:50 | 15 min | Break |
| 14:50-15:50 | 60 min | Chapter 5: Capstone: the governed human-agent delivery loop |
| 15:50-16:30 | 40 min | Adoption roadmap and discussion |

## 5. Chapter roadmaps

### Executive platform briefing - 09:00 to 09:30

- **Outcome:** Participants understand GitHub as the durable control plane for human and agent work, not just a code host.
- **Demonstrate:** The complete map: prompt, context, harness, loop, evidence, and stop condition.
- **Hands-on:** None; this protects the highest-attention strategic window.
- **Connect:** Copilot as primary worker, GitHub artifacts as durable record, deterministic controls as non-negotiable, and Azure DevOps migration as an incremental path.

### Chapter 1: Bounded continuous AI - 09:30 to 10:20

- **Outcome:** Participants can explain how an agentic workflow is bounded by trigger, tools, permissions, network, budget, safe outputs, and human review.
- **Demonstrate:** A repository workflow that reports or triages through constrained output, followed by inspection of the generated lock workflow and Actions boundary.
- **Lab:** `student\labs\01-agentic-workflow\index.html` narrows `repository-pulse` to issue review only and proves the change through a green compile check in the station repository.
- **Connect:** GitHub Agentic Workflows are public preview; they complement CI/CD and should start with comments, reports, or draft pull requests rather than autonomous high-impact changes.

### Chapter 2: From intent to a verified handoff - 10:35 to 11:35

- **Outcome:** A business request becomes a structured issue, lightweight specification, bounded implementation proposal, and reviewable pull request.
- **Demonstrate:** Issue intake, Project context, specification, architecture decision, Copilot-assisted plan, linked pull request, tests, and review.
- **Lab:** `student\labs\02-intent-to-pr\index.html` turns a stock suggestion requirement into a merged change judged by deterministic acceptance checks.
- **Connect:** Pull requests are the common control point for human- and agent-authored work; a proposal remains untrusted until scope, diff, tests, and review are clear.

### Chapter 3: GitHub Enterprise operating model - 11:35 to 12:30

- **Outcome:** Participants can place the same station workflow into a scalable model for ownership, policy, budgets, identity, and migration waves.
- **Demonstrate:** Teams, CODEOWNERS, rulesets or branch protection, required review, reusable workflows, Projects, and links from work item to evidence.
- **Lab:** `student\labs\03-operating-model\index.html` makes workflow ownership visible, shows a protected-branch rejection, and records governance decisions.
- **Connect:** Harness and model choice can vary, but controls should converge on GitHub artifacts, explicit ownership, least privilege, and measurable migration exit criteria.

### Chapter 4: Trusted delivery with CI/CD and DevSecOps - 13:15 to 14:35

- **Outcome:** Participants see that deterministic automation remains the authority for build, test, security, packaging, deployment approval, and release evidence.
- **Demonstrate:** Live trusted-delivery path with GitHub Actions, dependency or code security signal, Secret Protection where available, environment approval, and OIDC deployment boundary. If a capability is unavailable, label the fallback as captured evidence or simulation.
- **Lab:** `student\labs\04-trusted-delivery\index.html` hardens a workflow against untrusted pull request input and reads native security evidence.
- **Connect:** Agentic investigation may authorize one bounded repair attempt; it never grants merge or release authority. MDASH remains an optional, clearly labelled preview discussion, not a dependency.

### Chapter 5: Capstone: governed human-agent delivery loop - 14:50 to 15:50

- **Outcome:** Participants make an accountable next decision from the evidence produced during the day.
- **Demonstrate:** Prior-state read-back, accepted evidence, failure or no-op decision, and escalation boundary.
- **Lab:** `student\labs\05-capstone\index.html` produces a release decision bound to one revision, naming evidence, defects, and the owner of the next action.
- **Connect:** Continuity requires stable work identity, persisted state, external verification, and a justified next decision; a per-run cap is not enough.

### Adoption roadmap and discussion - 15:50 to 16:30

- **Outcome:** Participants leave with candidate pilots and success measures.
- **Discuss:** Business value, repository quality, test speed, reversibility, data sensitivity, regulatory impact, owning team readiness, and fit for repeated bounded automation.
- **Outputs:** A small set of candidate pilots, governance owners, prerequisites, unresolved decisions, and four-to-eight-week measures for accepted outcomes, human attention saved, duplicate avoidance, failure handling, and cost.

## 6. Shared pharmacy storyline and lab model

The fictional **Pharmacy Stock and Reservation Service** stays small enough for a live room and realistic enough to exercise APIs, tests, dependency and code scanning, ownership, delivery evidence, and operational maintenance. Use only synthetic products, stores, personas, and transactions.

Attendee labs now run in each participant's GitHub station repository. Each lab is one directory containing `index.html` and an `artifacts\` folder. Verification is GitHub's own evidence: a green check, a required review, a rejected push, a security signal, a deployment or environment record, or a published issue. Do not add local pass/fail runners or metadata manifests to the learner path.

Current lab index: `student\labs\index.html`. Current labs: `01-agentic-workflow`, `02-intent-to-pr`, `03-operating-model`, `04-trusted-delivery`, and `05-capstone`.

## 7. Environment preparation

Complete before delivery:

- prepare station repositories with the pharmacy service, tests, workflows, CODEOWNERS, issues, Project view, and lab artifacts;
- confirm every participant can sign in, open the assigned station repository, and create a branch;
- confirm default branch protection or rulesets, required checks, required review, Actions availability, and runner capacity;
- identify which stations can use Agentic Workflows public preview, Copilot coding agent, code scanning, Secret Protection, environments, and deployment records;
- prepare explicit fallbacks for unavailable previews, entitlements, security products, queues, or deployment targets;
- restore instructor dependencies from approved feeds and run repository validation;
- keep a clean instructor station repository for live fallback.

The Copilot coding agent requires the appropriate entitlement and repository policy. GitHub Agentic Workflows are public preview. Enterprise station provisioning is represented by configuration contracts and preparation guidance; automated enterprise organization rollout is not implemented here.

## 8. Demonstration reliability and fallbacks

| Scenario | Primary demonstration | Prepared fallback |
| --- | --- | --- |
| Copilot or coding harness access fails | Live Copilot plan or change | Continue from a prepared branch; participants inspect the diff, pull request, and evidence. |
| Agentic Workflow preview is unavailable or changes | Live compile and run | Inspect the Markdown source, generated lock workflow, permissions, and a labelled captured result. |
| Actions queue is slow | Live workflow run | Open a completed run from the same prepared path and inspect logs and checks. |
| Security feature is unavailable | Live native security signal | Use labelled captured evidence or a safe synthetic exercise; do not present it as fresh platform enforcement. |
| Azure deployment target is unavailable | OIDC deployment to test environment | Show workflow, environment approval, identity boundary, and captured successful deployment evidence. |
| Participant setup is incomplete | Individual station work | Pair participants or use the instructor station while keeping the evidence boundary visible. |

Fallbacks must preserve the technical insight. They may show captured evidence, but they must not claim a simulation or old run is a live control for a participant's current station revision.

## 9. Portable delivery profiles

Develop and validate one implementation with two profiles:

| Profile | Purpose | Boundary |
| --- | --- | --- |
| Sandbox | Public GitHub delivery without assuming enterprise licensing, managed users, or dedicated organization policy. | Enterprise-only controls are live where public repositories support them; otherwise they are teacher demonstrations or labelled simulations. |
| Future enterprise organization | Repository-per-team stations with centrally governed teams, rulesets, security features, Actions policy, environments, identity, and cleanup. | Configuration is present as a contract; organization provisioning remains a future implementation step. |

Source profiles live under `platform\profiles\`. Keep organization names, repository prefixes, teams, environments, and feature flags configurable. Remote creation must be explicit; destructive cleanup must target only resources carrying the workshop identifier.

## 10. One-hour side experience

Deliver **GitHub Beyond Coding: The Agentic Engineering Loop** as a separate fast-paced showcase using the same pharmacy scenario and control-plane language.

The story is:

1. a bounded workflow or prepared signal identifies a product or security need;
2. a human turns it into a complete issue contract;
3. GitHub Copilot proposes a pull request;
4. deterministic checks, native security evidence, and human review challenge the proposal;
5. a code owner approves only after evidence is complete;
6. governed deployment uses provenance, environment approval, and federated identity;
7. a repository pulse proposes the next improvement through safe output;
8. live continuation is demonstrated separately with `teacher\demos\security-remediation\scripts\verify-continuation.mjs`, or explicitly not claimed when the live proof is unavailable.

Primary assets:

- `docs\slides\agentic-engineering-loop.html`
- `docs\guides\agentic-engineering-loop.html`
- `teacher\demos\agentic-engineering-loop\operator-guide.html`
- `teacher\demos\agentic-engineering-loop\control-room.html`

Keep mission-control and controller exercises visibly labelled as simulations. The one-hour showcase is not a compressed lab; it is a coherent story with a payoff in the first ten minutes and no hidden reliance on private engagement-specific evidence.

## 11. Open decisions to confirm before delivery

- Participant count, role mix, and expected attendance pattern.
- Station profile: sandbox or future enterprise organization.
- Whether Agentic Workflows public preview may be used live.
- Whether Copilot coding agent entitlement is available for presenters and participants.
- Which security capabilities are enabled live: code scanning, Secret Protection, dependency review, and environment approvals.
- Whether an Azure test deployment target is available, or whether deployment is shown through labelled evidence.
- Current Azure DevOps migration interests: repositories, pipelines, packages, work items, identities, and coexistence requirements.
- Runner capacity, network policy, and any restrictions on hosted runners or outbound access.
- Who owns stop, escalation, merge, release, and cleanup decisions during the event.

## 12. Public research references

Revalidate product status shortly before delivery because several capabilities are preview, entitlement-dependent, or policy-dependent.

### GitHub Agentic Workflows

- [GitHub Agentic Workflows is now in public preview](https://github.blog/changelog/2026-06-11-github-agentic-workflows-is-now-in-public-preview/)
- [Automate repository tasks with GitHub Agentic Workflows](https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/)
- [GitHub Agentic Workflows repository and documentation](https://github.com/github/gh-aw)
- [gh-aw engine reference](https://github.github.com/gh-aw/reference/engines/)
- [gh-aw authentication reference](https://github.github.com/gh-aw/reference/auth/)

### Coding agents and harness boundaries

- [Claude and Codex coding agents public preview on GitHub](https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github/)
- [About GitHub Copilot coding agent](https://docs.github.com/en/copilot/concepts/coding-agent/about-coding-agent)

### Migration and delivery

- [Understand migrations from Azure DevOps to GitHub](https://docs.github.com/en/migrations/using-github-enterprise-importer/migrating-from-azure-devops-to-github-enterprise-cloud/overview-of-a-migration-from-azure-devops-to-github-enterprise-cloud)
- [Migrate from Azure DevOps with GitHub Actions Importer](https://docs.github.com/en/actions/migrating-to-github-actions/automated-migrations/migrating-from-azure-devops-with-github-actions-importer)
- [Configuring OpenID Connect in Azure](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-azure)

### Security and preview scanning

- [GitHub code scanning](https://docs.github.com/en/code-security/code-scanning)
- [GitHub Secret Protection](https://docs.github.com/en/code-security/secret-scanning)
- [Codename MDASH overview](https://learn.microsoft.com/en-us/security-exposure-management/ai-code-security-overview)
