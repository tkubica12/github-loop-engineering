# 0005: Copilot primary, OpenCode as an external harness

- Status: Accepted
- Date: 2026-09-05
- Authentication choice superseded by [0006](0006-native-workflow-token-after-capability-probe.md); the harness choice is unchanged.

## Context

Demonstrations must run through the available GitHub platform without requiring an Anthropic account. The audience should also see that GitHub's collaboration and delivery controls are not tied to one coding harness.

## Decision drivers

- Make GitHub Copilot the primary executable path.
- Demonstrate a second harness without introducing an Anthropic dependency.
- Preserve the same synthetic service, issues, pull requests, checks, and release boundaries.
- Distinguish officially supported engines from experimental integration samples.

## Options considered

| Option | Tradeoff |
| --- | --- |
| Claude-first demonstrations | Requires unavailable provider access |
| Copilot only | Reliable primary path, but does not demonstrate external-harness choice |
| Copilot plus a bounded OpenCode scene | Shows GitHub-native assistance and a shared collaboration contract |

## Decision

Use GitHub Copilot for primary coding and Agentic Workflow demonstrations. Use local OpenCode for a bounded second-harness scene on the same repository. Explain Claude Code as a supported alternative, without running it or requiring its credentials.

Use `COPILOT_GITHUB_TOKEN` with the documented fine-grained Copilot Requests account permission for personal-repository inference. Do not copy CLI OAuth sessions into automation secrets. The organization Actions-token path is separate and requires an eligible organization billing configuration.

Treat the OpenCode gh-aw integration as an optional imported sample, not an officially supported built-in engine or a guaranteed public-preview service. Pin any experimental definition and validate it before presentation. Local OpenCode remains the fallback.

## Consequences

The deterministic local core remains account-free. Live Copilot inference and local OpenCode authentication need explicit capability checks. No Anthropic key is required by the workshop workflows.

## Validation

Compile all four main workflow sources, run the lab journey and browser checks, and require fresh review of the revised learner path. Mark model execution as unverified until an authenticated run produces inspectable output.

## Assumptions

First-party gh-aw engine and authentication documentation was checked on 5 September 2026. It describes OpenCode integrations as samples without a compatibility or maintenance commitment.

## Revisit triggers

Revisit when an owner-maintained OpenCode engine has verified support, the preview contract changes, or a dedicated organization enables centralized Copilot inference billing.

Sources: [gh-aw engines](https://github.github.com/gh-aw/reference/engines/), [authentication](https://github.github.com/gh-aw/reference/auth/), [OpenCode providers](https://opencode.ai/docs/providers/).
