import { mkdirSync, writeFileSync } from "node:fs";

const commit = process.env.EVIDENCE_SHA;
if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
  throw new Error("EVIDENCE_SHA must be a full commit SHA");
}

mkdirSync("evidence", { recursive: true });
writeFileSync("evidence/manifest.json", `${JSON.stringify({
  schema: "trusted-delivery-manifest/v1",
  commit,
  workflowCommit: process.env.GITHUB_SHA,
  repository: process.env.GITHUB_REPOSITORY,
  workflow: process.env.GITHUB_WORKFLOW,
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT
}, null, 2)}\n`);
