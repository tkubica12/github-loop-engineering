import { workId, reconcileLoop, validateLoopState } from "./loop-state.mjs";

export const issueMarker = (identity) => `<!-- workshop-loop:${workId(identity)} -->`;

/** Read-only planning adapter over a complete, freshly retrieved issue list. Never calls GitHub. */
export function reconcileMarkedIssue({ identity, issues, complete, expectedBot = "github-actions[bot]", input }) {
  if (complete !== true || !Array.isArray(issues)) throw new Error("Missing or truncated issue reconciliation evidence");
  const marker = issueMarker(identity);
  const candidates = issues.filter((issue) => !issue.pull_request && issue.body?.includes(marker));
  if (candidates.length > 1) throw new Error("Ambiguous owned issue marker; owner reconciliation required");
  const existing = candidates[0];
  let prior = null;
  if (existing) {
    if (existing.user?.login !== expectedBot || existing.user?.type !== "Bot") {
      throw new Error("Owned marker is not authored by the configured bot");
    }
    const encoded = /<!-- workshop-loop-state:([A-Za-z0-9+/=]+) -->/.exec(existing.body)?.[1];
    if (!encoded) throw new Error("Marked issue has no durable work state");
    prior = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (workId(prior.identity) !== workId(identity)) throw new Error("Marked state identity mismatch");
    validateLoopState(prior, identity);
    if (existing.state === "closed" && prior.status !== "accepted") {
      return { state: prior, decision: "waiting-human", dispatch: false, reason: "Owner closed unfinished work; do not reopen automatically", publication: "none", issueNumber: existing.number };
    }
  }
  const result = reconcileLoop(prior, input);
  return { ...result, publication: result.state === null || result.decision === "no-op" || result.decision === "waiting-human" ? "none" : existing ? "update-owned" : "create-owned",
    issueNumber: existing?.number ?? null, marker };
}

export function markedIssueBody(identity, state, summary) {
  validateLoopState(state, identity);
  return `${summary}\n\n${issueMarker(identity)}\n<!-- workshop-loop-state:${Buffer.from(JSON.stringify(state)).toString("base64")} -->`;
}
