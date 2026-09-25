# 0002: Durable GitHub artifacts as the agent coordination plane

- Status: Accepted
- Date: 2026-07-27

## Context

The experiences must show multiple coding agents and people collaborating without making proprietary chat history the engineering system of record.

## Decision drivers

- Reviewability and auditability.
- Compatibility with Copilot, Claude, Codex, Cursor, and future harnesses.
- Deterministic controls around probabilistic work.
- A credible enterprise operating model.

## Options considered

1. Coordinate primarily through IDE chat.
2. Build a custom multi-agent orchestrator.
3. Coordinate through issues, pull requests, checks, reviews, deployments, and follow-up work.

## Decision

GitHub-native artifacts carry intent, proposals, evidence, approval, release, and continuous maintenance. Agent-specific sessions may assist, but they are not the system of record.

## Consequences

Agents remain replaceable. Work is inspectable by humans and automation. Acceptance criteria and repository context quality become critical. The demo must show artifacts changing state, not only agents producing code.

## Validation

The artifact chain must be understandable in the full-day opening demonstration and capstone by following the issue, pull request, checks, review, release decision, and repository pulse. The former one-hour story was retired by [ADR 0012](0012-one-full-day-html-journey.md).

## Assumptions

All participating harnesses can create or update GitHub artifacts directly or through a human.

## Revisit triggers

A required engineering control cannot be represented or linked through GitHub artifacts.
