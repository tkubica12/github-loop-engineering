import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import {
  CAPTURE_SCHEMA,
  LIVE_SOURCE,
  SYNTHETIC_SOURCE,
  prepareArtifactStagingDirectory,
  validateConfig,
  verifyChain,
  liveArtifactFresh
} from "../teacher/demos/agentic-engineering-loop/scripts/live-chain.mjs";

const H = "1111111111111111111111111111111111111111";
const M = "2222222222222222222222222222222222222222";
const OLD = "3333333333333333333333333333333333333333";
const repository = "example/pharmacy";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkspace = join(root, ".workshop", `live-chain-test-${process.pid}`);
const archivePath = join(testWorkspace, "fixture-artifact.zip");
const archiveBytes = Buffer.from("synthetic pharmacy artifact\n");
const archiveSha = createHash("sha256").update(archiveBytes).digest("hex");
mkdirSync(testWorkspace, { recursive: true });
writeFileSync(archivePath, archiveBytes);
after(() => rmSync(testWorkspace, { recursive: true, force: true }));

test("live freshness rejects expired September artifact even when stale metadata says not expired", () => {
  const now = Date.parse("2026-09-15T12:00:00Z");
  assert.equal(liveArtifactFresh({ expired: false, expiresAt: "2026-09-12T19:18:37Z" }, now), false);
  assert.equal(liveArtifactFresh({ expired: false }, now), false);
  assert.equal(liveArtifactFresh({ expired: true, expiresAt: "2026-09-20T00:00:00Z" }, now), false);
  assert.equal(liveArtifactFresh({ expired: false, expiresAt: "2026-09-20T00:00:00Z" }, now), true);
});

test("complete historical handoff never silently upgrades the operational continuation verdict", () => {
  const capture = validCapture();
  const report = verifyChain(capture);
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.loopContinuation.verdict, "NOT_EXECUTED");
  capture.loopContinuation = { verdict: "VERIFIED_LOCAL" };
  assert.equal(verifyChain(capture).loopContinuation.verdict, "NOT_EXECUTED");
  const forged = verifyChain(capture, { continuationReport: { issue: { number: 8 }, verdict: "VERIFIED_LOCAL" } });
  assert.equal(forged.status, "COMPLETE");
  assert.equal(forged.loopContinuation.verdict, "BLOCKED");
  capture.facts.health.httpStatus = 404;
  assert.equal(verifyChain(capture).status, "BLOCKED");
});

function config() {
  return {
    schemaVersion: 1,
    repository,
    issueNumber: 2,
    pullRequestNumber: 3,
    agentLogins: ["copilot-swe-agent[bot]"],
    requiredChecks: ["CI / test", "Security / dependency review"],
    workflows: {
      build: { runId: 410, name: "Build", path: ".github/workflows/build.yml" },
      release: { runId: 420, name: "Release", path: ".github/workflows/release.yml" }
    },
    artifact: { name: "pharmacy-package", run: "build", maxBytes: 1048576 },
    health: {
      url: "https://pharmacy.example.test/health",
      allowedOrigins: ["https://pharmacy.example.test"],
      path: "/health",
      service: "synthetic-pharmacy-reservations"
    },
    maintenance: { issueNumbers: [8] },
    controls: {
      requireReviewEnforcement: false,
      requireEnvironmentGate: false
    }
  };
}

function origin(endpoint, htmlUrl) {
  return {
    transport: "fixture",
    endpoint,
    apiUrl: `https://api.github.com/${endpoint}`,
    repository,
    ...(htmlUrl ? { htmlUrl } : {})
  };
}

function validCapture() {
  const input = config();
  return {
    schema: CAPTURE_SCHEMA,
    source: {
      kind: SYNTHETIC_SOURCE,
      collectedAt: "2026-09-05T12:00:00.000Z",
      collector: "test fixture",
      remoteOperations: "none"
    },
    config: input,
    collection: { errors: [], truncation: [], limitPerCollection: 100 },
    facts: {
      repository: {
        id: 10,
        nodeId: "R_10",
        fullName: repository,
        private: true,
        defaultBranch: "main",
        origin: origin(`repos/${repository}`)
      },
      issue: {
        id: 20,
        nodeId: "I_20",
        number: 2,
        repository,
        title: "Bound reservations",
        body: "Synthetic business intent.",
        state: "closed",
        isPullRequest: false,
        origin: origin(`repos/${repository}/issues/2`)
      },
      pullRequest: {
        id: 30,
        nodeId: "PR_30",
        number: 3,
        repository,
        state: "closed",
        draft: false,
        body: "Fixes #2",
        author: { login: "copilot-swe-agent[bot]", type: "Bot" },
        head: { sha: H, ref: "copilot/change", repository },
        base: { sha: OLD, ref: "main", repository },
        mergedAt: "2026-09-05T12:10:00.000Z",
        mergedBy: { login: "maintainer", type: "User" },
        mergeCommitSha: M,
        origin: origin(`repos/${repository}/pulls/3`)
      },
      issueTimeline: [{
        id: 31,
        event: "cross-referenced",
        sourceIssue: {
          id: 30,
          number: 3,
          repository,
          isPullRequest: true,
          htmlUrl: `https://github.com/${repository}/pull/3`
        }
      }],
      reviews: [{
        id: 40,
        nodeId: "R_40",
        state: "APPROVED",
        commitId: H,
        submittedAt: "2026-09-05T12:05:00.000Z",
        user: { login: "human-reviewer", type: "User" },
        origin: origin(`repos/${repository}/pulls/3/reviews`)
      }],
      checkRuns: [
        {
          id: 50,
          name: "CI / test",
          headSha: H,
          status: "completed",
          conclusion: "success",
          completedAt: "2026-09-05T12:02:00.000Z"
        },
        {
          id: 51,
          name: "Security / dependency review",
          headSha: H,
          status: "completed",
          conclusion: "success",
          completedAt: "2026-09-05T12:03:00.000Z"
        }
      ],
      workflows: {
        build: {
          id: 410,
          name: "Build",
          path: ".github/workflows/build.yml",
          status: "completed",
          conclusion: "success",
          headSha: M
        },
        release: {
          id: 420,
          name: "Release",
          path: ".github/workflows/release.yml",
          status: "completed",
          conclusion: "success",
          headSha: M
        }
      },
      artifacts: [{
        id: 60,
        name: "pharmacy-package",
        sizeInBytes: archiveBytes.length,
        expired: false,
        digest: `sha256:${archiveSha}`,
        workflowRun: { id: 410, headSha: M }
      }],
      artifactDownload: {
        artifactId: 60,
        runId: 410,
        archive: "pharmacy-package.zip",
        archivePath,
        bytes: archiveBytes.length,
        sha256: archiveSha,
        metadataDigest: `sha256:${archiveSha}`,
        digestMatchesMetadata: true
      },
      health: {
        url: "https://pharmacy.example.test/health",
        httpStatus: 200,
        body: {
          service: "synthetic-pharmacy-reservations",
          commit: M,
          runId: "420"
        }
      },
      maintenance: [{
        id: 80,
        number: 8,
        repository,
        title: "Review reservation telemetry",
        body: `Maintenance advisory for the released revision ${M}; inspect trends before the next release window.`,
        state: "open",
        isPullRequest: false
      }],
      controls: {
        branchProtection: { observed: false, reason: "not licensed" },
        environment: { observed: false, reason: "not configured" }
      }
    }
  };
}

function stage(report, id) {
  return report.stages.find((item) => item.id === id);
}

test("validates strict URL scope and rejects a fake live toggle", () => {
  assert.equal(validateConfig(config()).health.url, "https://pharmacy.example.test/health");
  const invalid = config();
  invalid.live = true;
  assert.throws(() => validateConfig(invalid), /unsupported key.*live/);

  const escaped = config();
  escaped.health.url = "https://other.example.test/health";
  assert.throws(() => validateConfig(escaped), /outside health\.allowedOrigins/);
});

test("accepts a valid H to distinct M chain but never stamps a synthetic fixture live", () => {
  const report = verifyChain(validCapture());
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.identity.headSha, H);
  assert.equal(report.identity.mergeSha, M);
  assert.notEqual(H, M);
  assert.equal(report.evidenceClass, "SYNTHETIC_OFFLINE_ONLY");
  assert.equal(report.liveClaimAllowed, false);
  assert.equal(report.claims.checksumIsCryptographicAttestation, false);
});

test("arbitrary JSON cannot authorize a live claim by changing source fields", () => {
  const capture = validCapture();
  capture.source.kind = LIVE_SOURCE;
  capture.source.collector = "live-chain.mjs";
  capture.source.remoteOperations = "read-only";
  capture.source.live = true;
  const report = verifyChain(capture);
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.evidenceClass, "RECORDED_CAPTURE_NOT_LIVE_AUTHORIZED");
  assert.equal(report.liveClaimAllowed, false);
});

test("artifact staging rejects repository overlap and always creates a dedicated directory", () => {
  assert.throws(
    () => prepareArtifactStagingDirectory(root, join(testWorkspace, "capture.json")),
    /dangerous ancestor/
  );
  const base = join(testWorkspace, "artifact-output");
  const first = prepareArtifactStagingDirectory(base, join(testWorkspace, "capture.json"));
  const second = prepareArtifactStagingDirectory(base, join(testWorkspace, "capture.json"));
  assert.notEqual(first, second);
  assert.match(first, /live-chain-artifact-/);
});

test("blocks mixed-repository evidence", () => {
  const capture = validCapture();
  capture.facts.issue.repository = "other/pharmacy";
  const report = verifyChain(capture);
  assert.equal(report.status, "BLOCKED");
  assert.equal(stage(report, "repository-and-intent").status, "BLOCKED");
});

test("blocks approval and checks from a stale pull-request head", () => {
  const capture = validCapture();
  capture.facts.reviews[0].commitId = OLD;
  capture.facts.checkRuns[0].headSha = OLD;
  const report = verifyChain(capture);
  assert.equal(stage(report, "human-review").status, "BLOCKED");
  assert.equal(stage(report, "required-checks").status, "BLOCKED");
});

test("newer queued or failed check identities supersede an older success", () => {
  for (const [status, conclusion] of [["queued", null], ["completed", "failure"]]) {
    const capture = validCapture();
    capture.facts.checkRuns.push({
      id: 52,
      name: "CI / test",
      headSha: H,
      status,
      conclusion,
      startedAt: "2026-09-05T12:04:00.000Z",
      completedAt: status === "completed" ? "2026-09-05T12:04:30.000Z" : null
    });
    assert.equal(stage(verifyChain(capture), "required-checks").status, "BLOCKED");
  }
});

test("blocks approvals and successful checks recorded after the merge", () => {
  const capture = validCapture();
  capture.facts.reviews[0].submittedAt = "2026-09-05T12:11:00.000Z";
  capture.facts.checkRuns[0].completedAt = "2026-09-05T12:11:00.000Z";
  const report = verifyChain(capture);
  assert.equal(stage(report, "human-review").status, "BLOCKED");
  assert.equal(stage(report, "required-checks").status, "BLOCKED");
});

test("a post-merge dismissal cannot clear a pre-merge changes request", () => {
  const capture = validCapture();
  capture.facts.reviews.push(
    {
      id: 41,
      state: "CHANGES_REQUESTED",
      commitId: H,
      submittedAt: "2026-09-05T12:06:00.000Z",
      user: { login: "second-reviewer", type: "User" }
    },
    {
      id: 42,
      state: "DISMISSED",
      commitId: H,
      submittedAt: "2026-09-05T12:11:00.000Z",
      user: { login: "second-reviewer", type: "User" }
    }
  );
  assert.equal(stage(verifyChain(capture), "human-review").status, "BLOCKED");
});

test("blocks an unrelated old release even when it succeeded", () => {
  const capture = validCapture();
  capture.facts.workflows.release.headSha = OLD;
  capture.facts.health.body.commit = OLD;
  const report = verifyChain(capture);
  assert.equal(stage(report, "build-and-release").status, "BLOCKED");
  assert.equal(stage(report, "azure-runtime").status, "BLOCKED");
});

test("represents not-yet-known release and health evidence as BLOCKED, not configuration success", () => {
  const capture = validCapture();
  capture.config.workflows.build.runId = null;
  capture.config.workflows.release.runId = null;
  capture.config.health = null;
  capture.facts.workflows = { build: null, release: null };
  capture.facts.artifacts = [];
  capture.facts.artifactDownload = null;
  capture.facts.health = null;
  const report = verifyChain(capture);
  assert.equal(report.status, "BLOCKED");
  assert.equal(stage(report, "build-and-release").status, "BLOCKED");
  assert.equal(stage(report, "artifact").status, "BLOCKED");
  assert.equal(stage(report, "azure-runtime").status, "BLOCKED");
});

test("blocks missing evidence and an outstanding changes request", () => {
  const capture = validCapture();
  capture.facts.artifactDownload = null;
  capture.facts.maintenance = [];
  capture.facts.reviews.push({
    id: 41,
    state: "CHANGES_REQUESTED",
    commitId: H,
    submittedAt: "2026-09-05T12:06:00.000Z",
    user: { login: "second-reviewer", type: "User" }
  });
  const report = verifyChain(capture);
  assert.equal(report.status, "BLOCKED");
  assert.equal(stage(report, "human-review").status, "BLOCKED");
  assert.equal(stage(report, "artifact").status, "BLOCKED");
  assert.equal(stage(report, "maintenance-loop").status, "BLOCKED");
  assert.ok(report.blockedReasons.length >= 3);
});

test("re-reads artifact bytes and rejects asserted digests, missing archives, and oversize files", () => {
  const tamperedDigest = validCapture();
  tamperedDigest.facts.artifactDownload.sha256 = "f".repeat(64);
  tamperedDigest.facts.artifactDownload.digestMatchesMetadata = true;
  assert.equal(stage(verifyChain(tamperedDigest), "artifact").status, "BLOCKED");

  const missingArchive = validCapture();
  missingArchive.facts.artifactDownload.archivePath = join(testWorkspace, "missing.zip");
  assert.equal(stage(verifyChain(missingArchive), "artifact").status, "BLOCKED");

  const oversize = validCapture();
  oversize.config.artifact.maxBytes = archiveBytes.length - 1;
  assert.equal(stage(verifyChain(oversize), "artifact").status, "BLOCKED");
});

test("a mutated dismissed review without dismissal timing cannot establish pre-merge approval", () => {
  const capture = validCapture();
  capture.facts.reviews.push({
    id: 41, state: "DISMISSED", commitId: H,
    submittedAt: "2026-09-05T12:06:00.000Z",
    user: { login: "second-reviewer", type: "User" }
  });
  assert.equal(stage(verifyChain(capture), "human-review").status, "BLOCKED");
});

test("the original intent cannot be reused as a maintenance follow-up", () => {
  const capture = validCapture();
  capture.config.maintenance.issueNumbers = [capture.config.issueNumber];
  capture.facts.maintenance = [{ ...capture.facts.issue, body: `Long enough original issue mentioning ${M}.` }];
  assert.throws(() => verifyChain(capture), /separate follow-up issue/);
});

test("a later workflow revision must prove the exact reviewed source inside its package", () => {
  const capture = validCapture();
  const R = "4".repeat(40);
  const sources = {
    "src/server.mjs": strToU8("// approved application\n"),
    "data/stock.json": strToU8('{"synthetic":true}'),
    "package.json": strToU8('{"type":"module"}')
  };
  capture.config.artifact.releaseManifest = true;
  capture.config.artifact.run = "release";
  capture.config.workflows.build = { ...capture.config.workflows.release };
  capture.facts.workflows.release = { ...capture.facts.workflows.release, headSha: R,
    event: "workflow_dispatch", headBranch: "main" };
  capture.facts.workflows.build = { ...capture.facts.workflows.release };
  capture.facts.releaseSourceTree = Object.entries(sources).map(([path, bytes]) => ({
    path, mode: "100644", sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
  }));
  const manifest = { commit: M, prHead: H, sourceRepo: repository, prNumber: 3, runId: "420", workflowSha: R };
  function setPackage(actualSources, actualManifest = manifest) {
    const payload = zipSync({ ...actualSources, "release-manifest.json": strToU8(JSON.stringify(actualManifest)) });
    const payloadSha = createHash("sha256").update(payload).digest("hex");
    const archive = zipSync({ "release.zip": payload, "release.zip.sha256": strToU8(`${payloadSha}  release.zip\n`) });
    const sha = createHash("sha256").update(archive).digest("hex");
    const path = join(testWorkspace, "release-artifact.zip");
    writeFileSync(path, archive);
    capture.facts.artifacts[0] = { ...capture.facts.artifacts[0], sizeInBytes: archive.length,
      digest: `sha256:${sha}`, workflowRun: { id: 420, headSha: R } };
    capture.facts.artifactDownload = { ...capture.facts.artifactDownload,
      runId: 420, archivePath: path, bytes: archive.length, sha256: sha };
  }
  setPackage(sources);
  assert.equal(verifyChain(capture).status, "COMPLETE");
  setPackage({ ...sources, "src/server.mjs": strToU8("// unreviewed application") });
  assert.equal(stage(verifyChain(capture), "artifact").status, "BLOCKED");
  setPackage(sources, { ...manifest, workflowSha: OLD });
  assert.equal(stage(verifyChain(capture), "build-and-release").status, "BLOCKED");
  setPackage(sources);
  capture.facts.workflows.release.event = "pull_request";
  assert.equal(stage(verifyChain(capture), "build-and-release").status, "BLOCKED");
});

test("verify CLI exits nonzero for an incomplete chain", () => {
  const directory = join(testWorkspace, "cli");
  const input = join(directory, "capture.json");
  mkdirSync(directory, { recursive: true });
  const capture = validCapture();
  capture.facts.health = null;
  writeFileSync(input, `${JSON.stringify(capture)}\n`);
  const result = spawnSync(process.execPath, [
    join(root, "teacher", "demos", "agentic-engineering-loop", "scripts", "live-chain.mjs"),
    "verify", "--input", input
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^BLOCKED SYNTHETIC_OFFLINE_ONLY/m);
  assert.match(result.stdout, /azure-runtime:/);
});
