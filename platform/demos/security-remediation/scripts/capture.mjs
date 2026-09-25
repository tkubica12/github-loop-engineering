import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, runJson, run } from "../../trusted-delivery/scripts/lib.mjs";

const demo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs();
const repository = options.repo;
const prNumber = Number(options.pr);
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository ?? "") || !Number.isSafeInteger(prNumber) || prNumber < 1) {
  throw new Error("Supply --repo OWNER/REPO --pr NUMBER");
}
const metadata = runJson("gh", ["api", `repos/${repository}`]);
assert.equal(metadata.private, false);
assert.ok(metadata.topics.includes("workshop-synthetic-pharmacy"));
const baseline = JSON.parse(readFileSync(options.baseline ?? join(demo, "evidence", "baseline-codeql.json"), "utf8"));
assert.equal(baseline.repository, repository);
const pull = runJson("gh", ["api", `repos/${repository}/pulls/${prNumber}`]);
assert.equal(pull.merged, true, "Capture a completed merge, not an unmerged proposal");
const head = pull.head.sha;
const merge = pull.merge_commit_sha;
const reviews = runJson("gh", ["api", "--paginate", "--slurp",
  `repos/${repository}/pulls/${prNumber}/reviews?per_page=100`]).flat();
const latest = new Map();
for (const review of reviews.filter((review) => ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))) {
  const prior = latest.get(review.user.login);
  if (!prior || review.id > prior.id) latest.set(review.user.login, review);
}
assert.ok(![...latest.values()].some((review) => review.state === "CHANGES_REQUESTED"));
const approval = [...latest.values()].find((review) => review.state === "APPROVED" &&
  review.commit_id === head && review.user.type === "User" && review.user.login !== pull.user.login &&
  Date.parse(review.submitted_at) <= Date.parse(pull.merged_at));
assert.ok(approval, "No actual pre-merge human approval of the final head");
const main = run("gh", ["api", `repos/${repository}/commits/main`, "--jq", ".sha"]).stdout;
if (main !== merge) {
  const comparison = runJson("gh", ["api", `repos/${repository}/compare/${merge}...${main}`]);
  assert.equal(comparison.status, "ahead", "The reviewed merge is not in the current main history");
}
const alerts = baseline.openAlerts.map((item) => {
  const alert = runJson("gh", ["api", `repos/${repository}/code-scanning/alerts/${item.number}`]);
  assert.equal(alert.rule.id, item.rule);
  assert.equal(alert.state, "fixed");
  assert.ok(alert.fixed_at);
  return { number: alert.number, rule: alert.rule.id, url: alert.html_url, state: alert.state, fixedAt: alert.fixed_at };
});
const analyses = runJson("gh", ["api", "--paginate", "--slurp",
  `repos/${repository}/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100`]).flat();
const analysis = analyses.find((item) => item.commit_sha === merge && item.tool?.name === "CodeQL");
assert.ok(analysis && !analysis.error && analysis.results_count === 0, "No clean native main analysis on the merged commit");
const runs = runJson("gh", ["run", "list", "--repo", repository, "--workflow", "codeql.yml", "--commit", merge,
  "--limit", "10", "--json", "databaseId,url,headSha,status,conclusion"]);
const codeqlRun = runs.find((item) => item.headSha === merge && item.status === "completed" && item.conclusion === "success");
assert.ok(codeqlRun);
const qualityRuns = runJson("gh", ["run", "list", "--repo", repository, "--workflow", "quality.yml", "--commit", head,
  "--event", "pull_request", "--limit", "10", "--json", "databaseId,url,headSha,status,conclusion,updatedAt"]);
const quality = qualityRuns[0];
assert.ok(quality?.headSha === head && quality.conclusion === "success");
assert.ok(Date.parse(quality.updatedAt) <= Date.parse(pull.merged_at), "PR quality was not complete before merge");
const prScans = runJson("gh", ["run", "list", "--repo", repository, "--workflow", "codeql.yml", "--commit", head,
  "--event", "pull_request", "--limit", "10", "--json", "databaseId,url,headSha,status,conclusion,updatedAt"]);
const prCodeql = prScans[0];
assert.ok(prCodeql?.headSha === head && prCodeql.conclusion === "success");
assert.ok(Date.parse(prCodeql.updatedAt) <= Date.parse(pull.merged_at));
const executions = [quality, prCodeql].map((item) => {
  const details = runJson("gh", ["api", `repos/${repository}/actions/runs/${item.databaseId}`]);
  assert.equal(details.status, "completed");
  assert.equal(details.conclusion, "success");
  assert.equal(details.head_sha, head);
  assert.equal(details.triggering_actor.type, "User", "Capture requires the actual human-triggered CI run");
  assert.ok(Date.parse(details.run_started_at) <= Date.parse(pull.merged_at));
  return { id: details.id, url: details.html_url, commit: details.head_sha,
    actor: details.actor.login, triggeringActor: details.triggering_actor.login,
    triggeringActorType: details.triggering_actor.type, attempt: details.run_attempt,
    startedAt: details.run_started_at, conclusion: details.conclusion };
});
const changes = runJson("gh", ["api", "--paginate", "--slurp",
  `repos/${repository}/pulls/${prNumber}/files?per_page=100`]).flat();
assert.ok(changes.every((item) => ["src/server.mjs", "test/server.test.mjs", "README.md"].includes(item.filename)));
const capture = {
  kind: "live-codeql-remediation-capture", capturedAt: new Date().toISOString(), repository,
  issue: { number: 1, url: `https://github.com/${repository}/issues/1` },
  baseline, pullRequest: { number: prNumber, url: pull.html_url, author: pull.user.login,
    head, merge, mergedAt: pull.merged_at, files: changes.map((item) => item.filename) },
  humanReview: { id: approval.id, login: approval.user.login, state: approval.state,
    commit: approval.commit_id, submittedAt: approval.submitted_at },
  quality, prCodeql, executions, currentMainAtCapture: main, codeqlRun, analysis: { id: analysis.id, commit: analysis.commit_sha,
    tool: analysis.tool.name, results: analysis.results_count, category: analysis.category },
  alerts, deploymentClaimed: false, enforcedBranchProtectionClaimed: false
};
const output = options.output ? resolve(options.output) : join(demo, "evidence", "remediation.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(capture, null, 2)}\n`, { flag: options.output ? "wx" : "w" });
console.log(`CAPTURED real alert -> Copilot PR -> human approval -> merge -> fixed alert for ${merge}`);
