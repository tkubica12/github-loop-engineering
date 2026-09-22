import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";
import { acceptsCheckCommit, assertBranchPolicy, assertDefaultOidc, assertReleaseProvenance } from "../teacher/demos/security-remediation/scripts/azure.mjs";
import { azureMsiInvocation } from "../teacher/demos/trusted-delivery/scripts/lib.mjs";
import { inspectReleaseArtifact } from "../teacher/demos/security-remediation/scripts/release-artifact.mjs";

const demo = join(root, "teacher", "demos", "security-remediation");
const workflow = readFileSync(join(demo, "workflows", "release.yml"), "utf8");
const helper = readFileSync(join(demo, "scripts", "azure.mjs"), "utf8");

test("release workflow gates an explicit merged remediation before packaging", () => {
  assert.match(workflow, /workflow_dispatch:[\s\S]*release_sha:[\s\S]*pr_number:/);
  assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE_SHA" "\$WORKFLOW_SHA"/);
  assert.match(workflow, /pull\.merge_commit_sha !== release/);
  assert.match(workflow, /r\.commit_id === pull\.head\.sha/);
  assert.match(workflow, /CHANGES_REQUESTED", "DISMISSED"/);
  assert.match(workflow, /actions\/workflows\/\$\{workflow\}\/runs\?event=pull_request/);
  assert.doesNotMatch(workflow, /status=completed/);
  assert.match(workflow, /commit\.parents\[0\]\.sha === base && commit\.parents\[1\]\.sha === head/);
  assert.match(workflow, /a\.commit_sha === release[\s\S]*a\.results_count === 0/);
  assert.match(workflow, /code-scanning\/alerts\/1[\s\S]*alert\.state !== "fixed"/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("actual release gate retains pre-merge blockers and rejects newer unfinished checks", () => {
  const functions = workflow.slice(workflow.indexOf("function latestStates("),
    workflow.indexOf("const metadata = await request"));
  const { latestStates, latestPreMergeRun } = new Function(`${functions}
    return { latestStates, latestPreMergeRun };`)();
  const mergedAt = Date.parse("2026-09-05T18:10:34Z");
  const review = { user: { type: "User", login: "reviewer" },
    submitted_at: "2026-09-05T18:09:00Z", state: "CHANGES_REQUESTED" };
  assert.equal(latestStates([review, { ...review, state: "APPROVED",
    submitted_at: "2026-09-05T18:11:00Z" }], mergedAt)[0].state, "CHANGES_REQUESTED");
  assert.throws(() => latestStates([{ ...review, state: "DISMISSED" }], mergedAt), /Dismissed/);
  const good = { id: 1, head_branch: "fix", status: "completed", conclusion: "success",
    created_at: "2026-09-05T18:00:00Z", updated_at: "2026-09-05T18:08:00Z" };
  assert.equal(latestPreMergeRun([good], "fix", mergedAt), good);
  for (const newer of [
    { ...good, id: 2, status: "queued", conclusion: null },
    { ...good, id: 2, conclusion: "failure" },
    { ...good, id: 2, updated_at: "2026-09-05T18:11:00Z" }
  ]) assert.throws(() => latestPreMergeRun([good, newer], "fix", mergedAt), /before merge/);
  assert.equal(latestPreMergeRun([good, { ...good, id: 2, conclusion: "failure",
    created_at: "2026-09-05T18:11:00Z" }], "fix", mergedAt), good);
  assert.match(workflow, /metadata\.topics\.includes\(`run-\$\{workshopRun\}`\)/);
});

test("package is exact, hashed, run-unique, and isolated from Azure credentials", () => {
  const beforeDeploy = workflow.split("  deploy-test:")[0];
  const deploy = workflow.split("  deploy-test:")[1];
  assert.match(beforeDeploy, /git archive "\$RELEASE_SHA" package\.json package-lock\.json src data test/);
  assert.match(beforeDeploy, /find test -name '\*\.test\.mjs'/);
  assert.match(beforeDeploy, /npm ci --ignore-scripts[\s\S]*npm test/);
  assert.match(beforeDeploy, /release-manifest\.json[\s\S]*sourceRepo[\s\S]*workflowSha/);
  assert.match(beforeDeploy, /sha256:\s*\$\{\{ steps\.package\.outputs\.sha256 \}\}/);
  assert.doesNotMatch(beforeDeploy, /id-token:\s*write|AZURE_CLIENT_ID|Azure\/login/);
  assert.match(workflow, /name: release-\$\{\{ github\.run_id \}\}/);
  assert.match(deploy, /environment:[\s\S]*name: test/);
  assert.match(deploy, /EXPECTED_SHA256:\s*\$\{\{ needs\.package\.outputs\.sha256 \}\}/);
  assert.match(deploy, /id-token:\s*write[\s\S]*Azure\/login@7ddb5af1ef8758cf1353cf3b42f940aee27ba21c/);
  assert.doesNotMatch(deploy, /actions\/checkout@|npm (?:ci|test)|git archive/);
});

test("every release action is pinned to an immutable commit", () => {
  const uses = [...workflow.matchAll(/uses:\s*([^\s]+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 6);
  assert.ok(uses.every((value) => /@[0-9a-f]{40}$/.test(value)), uses.join("\n"));
});

test("test-merge gate helper rejects a stale base", () => {
  assert.equal(acceptsCheckCommit({ sha: "head", parents: [] }, "base", "head"), true);
  assert.equal(acceptsCheckCommit({ sha: "merge", parents: [
    { sha: "base" }, { sha: "head" }
  ] }, "base", "head"), true);
  assert.equal(acceptsCheckCommit({ sha: "merge", parents: [
    { sha: "other" }, { sha: "head" }
  ] }, "base", "head"), false);
});

test("Azure helper is bounded to public synthetic F1 resources and exact controls", () => {
  assert.match(helper, /workshop-synthetic-pharmacy/);
  assert.match(helper, /run-\$\{config\.runId\}/);
  assert.match(helper, /environmentName = "test"/);
  assert.match(helper, /reviewer\?\.type === "User"/);
  assert.match(helper, /deployment-branch-policies[\s\S]*name=main/);
  assert.match(helper, /use_immutable_subject !== true/);
  assert.match(helper, /:environment:\$\{environmentName\}/);
  assert.match(helper, /"--role", "Website Contributor"[\s\S]*"--scope", app\.id/);
  assert.match(helper, /"--sku", "F1", "--is-linux"/);
  assert.doesNotMatch(helper, /"--sku", "(?:B|P|S)\d/);
  assert.match(helper, /WorkshopRunId=\$\{config\.runId\}/);
  assert.match(helper, /options\.confirm !== config\.runId/);
  assert.match(helper, /timeout: 900_000/);
  assert.doesNotMatch(helper, /repo", "create"|repo", "delete"|client-secret|AZURE_CLIENT_SECRET/);
});

test("Azure helper defaults to a non-mutating, explicit plan", () => {
  const output = execFileSync(process.execPath, [join(demo, "scripts", "azure.mjs"),
    "plan", "--repo", "example/synthetic", "--run-id", "release-check",
    "--reviewer", "example-user"], { cwd: root, encoding: "utf8" });
  assert.match(output, /PUBLIC synthetic release/);
  assert.match(output, /Linux F1 only/);
  assert.match(output, /requires --apply|Publish: only the reviewed release workflow/);
});

test("shared Azure launcher preserves Windows MSI argv without a command shell", () => {
  const invocation = azureMsiInvocation(
    String.raw`C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`,
    ["group", "show", "--name", "rg-release"]
  );
  assert.equal(invocation.file,
    win32.resolve(String.raw`C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin`, "..", "python.exe"));
  assert.deepEqual(invocation.args,
    ["-IBm", "azure.cli", "group", "show", "--name", "rg-release"]);
});

test("environment setup refuses tag-only branch rules and custom OIDC settings", () => {
  assert.doesNotThrow(() => assertBranchPolicy({ branch_policies: [{ name: "main", type: "branch" }] }));
  assert.throws(() => assertBranchPolicy({ branch_policies: [{ name: "main", type: "tag" }] }), /not a tag/);
  assert.throws(() => assertBranchPolicy({ branch_policies: [{ name: "release/*", type: "branch" }] }));
  assert.throws(() => assertDefaultOidc({ use_default: false, include_claim_keys: ["repository_id"] }), /custom OIDC/);
  const existingBranch = helper.slice(helper.indexOf("function configureEnvironment"), helper.indexOf("function azJson"));
  assert.ok(existingBranch.indexOf("if (existing)") < existingBranch.indexOf('"PUT"'));
  assert.match(existingBranch, /if \(existing\)[\s\S]*environment\(config, reviewer\.id\)[\s\S]*return;/);
});

test("release verification rejects package provenance that differs from independent GitHub facts", () => {
  const config = { releaseSha: "1".repeat(40), prNumber: 2, repository: "example/pharmacy" };
  const selected = { databaseId: 42, headSha: "3".repeat(40) };
  const pull = { merged: true, merge_commit_sha: config.releaseSha,
    head: { sha: "2".repeat(40) }, base: { repo: { full_name: config.repository } } };
  const manifest = { commit: config.releaseSha, runId: "42", sourceRepo: config.repository,
    prNumber: 2, prHead: pull.head.sha, workflowSha: selected.headSha };
  assert.doesNotThrow(() => assertReleaseProvenance({ manifest }, config, pull, selected));
  for (const key of ["commit", "runId", "sourceRepo", "prNumber", "prHead", "workflowSha"]) {
    assert.throws(() => assertReleaseProvenance({ manifest: { ...manifest, [key]: "wrong" } }, config, pull, selected));
  }
});

test("retained real release bytes match the recorded reviewed-source proof without claiming live status", () => {
  const evidence = JSON.parse(readFileSync(join(demo, "evidence", "release.json"), "utf8"));
  const archive = readFileSync(join(demo, "evidence", evidence.artifact.file));
  const proof = inspectReleaseArtifact(archive);
  assert.equal(evidence.liveClaimAllowed, false);
  assert.equal(evidence.freshCollectionResultAtCapture, "COMPLETE");
  assert.equal(archive.length, evidence.artifact.bytes);
  assert.equal(proof.artifactSha256, evidence.artifact.sha256);
  assert.equal(proof.sha256, evidence.artifact.packageSha256);
  assert.deepEqual(proof.manifest, evidence.manifest);
  assert.deepEqual(proof.sourceBlobs, evidence.sourceBlobs);
  assert.equal(proof.manifest.commit, evidence.pullRequest.merge);
  assert.equal(proof.manifest.prHead, evidence.pullRequest.head);
  assert.equal(proof.manifest.workflowSha, evidence.workflow.sourceCommit);
  assert.notEqual(proof.manifest.commit, proof.manifest.workflowSha);
  assert.equal(evidence.runtime.body.commit, proof.manifest.commit);
  assert.equal(evidence.runtime.body.runId, String(evidence.workflow.id));
  assert.equal(evidence.environment.approval, "approved");
  assert.equal(evidence.environment.independentSeparationOfDutiesClaimed, false);
});
