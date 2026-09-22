import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";

const demo = join(root, "teacher", "demos", "security-remediation");
test("the security scene reproduces only harmless local exposure and closes it with the reviewed fix", () => {
  const output = execFileSync(process.execPath, [join(demo, "scripts", "rehearse.mjs")],
    { encoding: "utf8", timeout: 60_000 });
  assert.match(output, /PASS starter: harmless app manifest exposure/);
  assert.match(output, /PASS solution: traversal/);
  assert.match(output, /LOCAL ONLY/);
});

test("recorded native CodeQL remediation joins the approved head to its actual merge", () => {
  const evidence = JSON.parse(readFileSync(join(demo, "evidence", "remediation.json"), "utf8"));
  assert.equal(evidence.kind, "live-codeql-remediation-capture");
  assert.equal(evidence.humanReview.state, "APPROVED");
  assert.equal(evidence.humanReview.commit, evidence.pullRequest.head);
  assert.ok(Date.parse(evidence.humanReview.submittedAt) <= Date.parse(evidence.pullRequest.mergedAt));
  assert.equal(evidence.analysis.commit, evidence.pullRequest.merge);
  assert.equal(evidence.analysis.results, 0);
  assert.equal(evidence.prCodeql.headSha, evidence.pullRequest.head);
  assert.equal(evidence.prCodeql.conclusion, "success");
  assert.ok(evidence.executions.every((run) => run.commit === evidence.pullRequest.head &&
    run.triggeringActorType === "User" && run.attempt > 1 && run.conclusion === "success"));
  assert.equal(evidence.alerts[0].rule, "js/path-injection");
  assert.equal(evidence.alerts[0].state, "fixed");
  assert.equal(evidence.deploymentClaimed, false);
  assert.equal(evidence.enforcedBranchProtectionClaimed, false);
});

test("public setup requires explicit public consent and an allowlisted file set", () => {
  const script = readFileSync(join(demo, "scripts", "security.mjs"), "utf8");
  assert.match(script, /options\["allow-public"\]/);
  assert.match(script, /const files = \[/);
  assert.doesNotMatch(script, /cpSync\(.*sourceRoot.*recursive/);
  const plan = execFileSync(process.execPath, [join(demo, "scripts", "security.mjs"),
    "plan", "--repo", "example/synthetic", "--run-id", "local-check"], { encoding: "utf8" });
  assert.match(plan, /only 13 allowlisted/);
  assert.match(plan, /No deployment workflow/);
});
