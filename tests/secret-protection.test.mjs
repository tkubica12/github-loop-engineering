import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DemoError,
  SOURCE,
  SAFE_CONTENT,
  assertNativeSecretBlock,
  exercise,
  extractInactiveSample,
  gitBlobSha,
  parseCli,
  preflight,
  redact,
  validateConfig,
  validateNewOutput
} from "../platform/demos/secret-protection/scripts/lib.mjs";
import { main } from "../platform/demos/secret-protection/scripts/protection.mjs";

const config = {
  repository: "example/pharmacy",
  runId: "pharmacy-loop-20260905",
  runTopic: "run-pharmacy-loop-20260905"
};
const branchSha = "1ea98c29d0cfcd0032a04a3a3aa40442b3267678";
const marked = "github_pat_<REMOVE_ME>synthetic_unit_value";
const source = Buffer.from(`Reviewed inactive example:\n\`${marked}\`\n`);
const sourceSha = createHash("sha1")
  .update(Buffer.from(`blob ${source.length}\0`))
  .update(source)
  .digest("hex");
const sourceSpec = {
  owner: "example",
  repository: "reviewed-source",
  commit: "a".repeat(40),
  path: "reviewed.md",
  blobSha: sourceSha,
  url: "https://example.invalid/reviewed-source"
};

test("recorded native observation preserves the blocked write and clean control without publishing sample values", () => {
  const file = new URL("../platform/demos/secret-protection/evidence/push-protection.json", import.meta.url);
  const text = readFileSync(file, "utf8");
  const evidence = JSON.parse(text);
  assert.equal(evidence.kind, "recorded-native-push-protection");
  assert.equal(evidence.result, "PASS");
  assert.equal(evidence.liveClaimAllowed, false);
  assert.deepEqual(evidence.source, SOURCE);
  assert.ok([409, 422].includes(evidence.blockedAttempt.httpStatus));
  assert.equal(evidence.blockedAttempt.nativeType, "secret-scanning-push-protection");
  assert.deepEqual(evidence.blockedAttempt.tokenTypes, ["GITHUB_TOKEN_V2"]);
  assert.match(evidence.blockedAttempt.message, /Secret detected in content/);
  assert.equal(evidence.scope.inactiveSampleRequestCreatedBlob, false);
  assert.equal(evidence.scope.safeRequestCreatedUnreferencedBlobOnly, true);
  assert.equal(evidence.scope.commitCreated, false);
  assert.equal(evidence.scope.refChanged, false);
  assert.equal(evidence.scope.bypassAttempted, false);
  assert.equal(evidence.branch.before, evidence.branch.after);
  assert.equal(evidence.branch.unchanged, true);
  assert.equal(evidence.safeBlobSha, gitBlobSha(SAFE_CONTENT));
  assert.equal(evidence.verifiedRemoteBytes, true);
  assert.doesNotMatch(text, /github_pat_|placeholder_id|bypass_placeholders|authorization/i);
});

function response(status, body, requestId = "REQ-SYNTHETIC") {
  return { status, body, requestId };
}

function metadata(overrides = {}) {
  return {
    full_name: config.repository,
    id: 12345,
    visibility: "public",
    default_branch: "main",
    security_and_analysis: {
      secret_scanning: { status: "enabled" },
      secret_scanning_push_protection: { status: "enabled" },
      secret_scanning_validity_checks: { status: "disabled" }
    },
    ...overrides
  };
}

class FakeApi {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
  }
  request(method, endpoint, options = {}) {
    this.calls.push({ method, endpoint, options });
    return this.handler(method, endpoint, options, this.calls.length);
  }
}

function preflightApi({ topics = ["workshop-synthetic-pharmacy", config.runTopic],
  metadataBody = metadata(), refSha = branchSha } = {}) {
  return new FakeApi((method, endpoint) => {
    if (endpoint === `/repos/${config.repository}`) return response(200, metadataBody);
    if (endpoint.endsWith("/topics")) return response(200, { names: topics });
    if (endpoint.includes("/git/ref/heads/")) {
      return response(200, { object: { sha: refSha } });
    }
    throw new Error(`Unexpected test request ${method} ${endpoint}`);
  });
}

function exerciseApi({ blockedStatus = 422, blockedBody, afterSha = branchSha,
  sourceStatus = 200, sourceBody = source, safeStatus = 201, safeSha = gitBlobSha(SAFE_CONTENT),
  remoteSafeBody = Buffer.from(SAFE_CONTENT) } = {}) {
  let refReads = 0;
  return new FakeApi((method, endpoint, options) => {
    if (endpoint === `/repos/${config.repository}`) return response(200, metadata());
    if (endpoint.endsWith("/topics")) {
      return response(200, { names: ["workshop-synthetic-pharmacy", config.runTopic] });
    }
    if (endpoint.includes("/git/ref/heads/")) {
      refReads += 1;
      return response(200, { object: { sha: refReads === 1 ? branchSha : afterSha } });
    }
    if (endpoint.includes("/contents/")) {
      return { status: sourceStatus, body: sourceBody, requestId: "SOURCE-REQ" };
    }
    if (method === "POST" && endpoint.endsWith("/git/blobs")) {
      if (options.input.content === SAFE_CONTENT) return response(safeStatus, { sha: safeSha });
      return response(blockedStatus, blockedBody ?? {
        message: "Repository rule violations found\n\nSecret detected in content\n",
        metadata: { secret_scanning: {
          bypass_placeholders: [{ placeholder_id: "sensitive-bypass-value", token_type: "GITHUB_TOKEN_V2" }]
        } }
      });
    }
    if (method === "GET" && endpoint.includes("/git/blobs/")) {
      return { status: 200, body: remoteSafeBody, requestId: "SAFE-GET" };
    }
    throw new Error(`Unexpected test request ${method} ${endpoint}`);
  });
}

async function runSyntheticExercise(options = {}) {
  const api = exerciseApi(options);
  const evidence = await exercise(api, config, { source: sourceSpec });
  return { api, evidence };
}

test("plan is the default and performs no authentication or mutation", async () => {
  let calls = 0;
  const io = { log() {}, error() {} };
  const exit = await main(["--repo", config.repository, "--run-id", config.runId], io, {
    request() { calls += 1; }
  });
  assert.equal(exit, 0);
  assert.equal(calls, 0);

  const exercisePlan = await main(
    ["exercise", "--repo", config.repository, "--run-id", config.runId], io,
    { request() { calls += 1; } }
  );
  assert.equal(exercisePlan, 0);
  assert.equal(calls, 0);
});

test("CLI rejects unknown inputs and invalid owner/run configuration", () => {
  assert.throws(() => parseCli(["plan", "--token", "never"]), /Unknown option/);
  assert.throws(() => validateConfig({ repo: "not-a-repo", "run-id": config.runId }), /OWNER/);
  assert.throws(() => validateConfig({ repo: config.repository, "run-id": "../other" }), /run-id/);
  assert.throws(() => validateNewOutput(fileURLToPath(import.meta.url)),
    (error) => error.code === "OUTPUT");
  assert.throws(() => validateNewOutput("not-json.txt"), (error) => error.code === "OUTPUT");
});

test("preflight requires exact ownership topics and enabled capabilities", () => {
  const privateTarget = preflight(preflightApi({
    metadataBody: metadata({ private: true, visibility: "private" })
  }), config);
  assert.equal(privateTarget.repository.visibility, "private");
  assert.equal(privateTarget.capabilities.pushProtection, "enabled");
  assert.throws(() => preflight(preflightApi({ topics: ["workshop-synthetic-pharmacy"] }), config),
    (error) => error.code === "OWNERSHIP");
  assert.throws(() => preflight(preflightApi({
    metadataBody: metadata({
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "disabled" }
      }
    })
  }), config), (error) => error.code === "CAPABILITY");
  assert.throws(() => preflight(preflightApi({
    metadataBody: metadata({ full_name: "other/pharmacy" })
  }), config), (error) => error.code === "REPOSITORY");
});

test("preflight treats permission/offline 404 as an error, never a pass", () => {
  const api = new FakeApi(() => response(404, { message: "Not Found" }));
  assert.throws(() => preflight(api, config), (error) => error.code === "HTTP_404");
});

test("only semantic 409/422 native secret blocks pass", () => {
  for (const status of [409, 422]) {
    assert.equal(assertNativeSecretBlock(response(status, {
      message: "Secret detected in content",
      metadata: { secret_scanning: { bypass_placeholders: [{ token_type: "SYNTHETIC" }] } }
    })).httpStatus, status);
  }
  assert.throws(() => assertNativeSecretBlock(response(409, { message: "Git conflict" })),
    (error) => error.code === "NOT_SECRET_BLOCK");
  assert.throws(() => assertNativeSecretBlock(response(422, { message: "Validation failed" })),
    (error) => error.code === "NOT_SECRET_BLOCK");
});

test("401, 403, and 429 failures cannot become PASS", async () => {
  for (const status of [401, 403, 429]) {
    const api = new FakeApi(() => response(status, { message: "Denied" }));
    await assert.rejects(exercise(api, config), (error) => {
      assert.equal(error.details.evidence.result, "FAIL");
      assert.equal(error.details.evidence.failure.code, `HTTP_${status}`);
      return true;
    });
  }
});

test("inactive-attempt authorization and rate failures retain HTTP classification", () => {
  for (const status of [401, 403, 429]) {
    assert.throws(() => assertNativeSecretBlock(response(status, { message: "Denied" })),
      (error) => error.code === `HTTP_${status}`);
  }
});

test("pinned source hash drift and missing source are blocked fallbacks", async () => {
  assert.throws(() => extractInactiveSample(source, "0".repeat(40)),
    (error) => error.code === "SOURCE_DRIFT");
  const api = exerciseApi({ sourceStatus: 404, sourceBody: Buffer.alloc(0) });
  await assert.rejects(exercise(api, config, { source: sourceSpec }), (error) => {
    assert.match(error.details.evidence.fallback, /^BLOCKED:/);
    assert.equal(error.details.evidence.liveClaimAllowed, false);
    return true;
  });
  const driftApi = exerciseApi({ sourceBody: Buffer.from(`${source.toString()}drift`) });
  await assert.rejects(exercise(driftApi, config, { source: sourceSpec }), (error) => {
    assert.equal(error.details.evidence.failure.code, "SOURCE_DRIFT");
    assert.match(error.details.evidence.fallback, /^BLOCKED:/);
    return true;
  });
});

test("sample and bypass values are redacted from diagnostics", () => {
  const reconstructed = marked.replace("<REMOVE_ME>", "");
  const dirty = `failure ${reconstructed} placeholder_id=sensitive-bypass-value https://x/bypass/abc`;
  const clean = redact(dirty, [reconstructed, "sensitive-bypass-value"]);
  assert.doesNotMatch(clean, /synthetic_unit_value|sensitive-bypass-value|\/bypass\/abc/);
});

test("semantic block, safe bytes, and exact branch invariant produce compact PASS evidence", async () => {
  const originalExtract = extractInactiveSample(source, sourceSha);
  assert.equal(originalExtract, marked.replace("<REMOVE_ME>", ""));

  const { api, evidence } = await runSyntheticExercise();
  assert.equal(evidence.result, "PASS");
  assert.equal(evidence.blockedAttempt.httpStatus, 422);
  assert.equal(evidence.verifiedRemoteBytes, true);
  assert.equal(evidence.safeBlobSha, gitBlobSha(SAFE_CONTENT));
  assert.equal(evidence.branch.before, branchSha);
  assert.equal(evidence.branch.after, branchSha);
  assert.equal(evidence.branch.unchanged, true);
  assert.equal(evidence.scope.commitCreated, false);
  assert.equal(evidence.scope.refChanged, false);
  assert.equal(evidence.controls.actualCredentialUsed, false);
  assert.equal(evidence.liveClaimAllowed, false);
  assert.doesNotMatch(JSON.stringify(evidence), /synthetic_unit_value|sensitive-bypass-value/);
  assert.equal(api.calls.filter((call) => call.method === "POST").length, 2);
});

test("branch movement and clean-blob verification failures remain FAIL", async () => {
  await assert.rejects(
    exercise(exerciseApi({ afterSha: "b".repeat(40) }), config, { source: sourceSpec }),
    (error) => error.details.evidence.failure.code === "BRANCH_CHANGED"
  );
  await assert.rejects(
    exercise(exerciseApi({ remoteSafeBody: Buffer.from("different") }), config,
      { source: sourceSpec }),
    (error) => error.details.evidence.failure.code === "SAFE_BYTES"
  );
  await assert.rejects(
    exercise(exerciseApi({ safeSha: "d".repeat(40) }), config, { source: sourceSpec }),
    (error) => error.details.evidence.failure.code === "SAFE_SHA"
  );
});

test("lost write responses retain uncertainty even when the branch remains unchanged", async () => {
  for (const loseSafeResponse of [false, true]) {
    const delegate = exerciseApi();
    let stored = false;
    const api = new FakeApi((method, endpoint, options) => {
      if (method === "POST" && (options.input.content === SAFE_CONTENT) === loseSafeResponse) {
        stored = true;
        throw new DemoError("TRANSPORT", "Response lost after the simulated write");
      }
      return delegate.request(method, endpoint, options);
    });
    await assert.rejects(exercise(api, config, { source: sourceSpec }), (error) => {
      const evidence = error.details.evidence;
      assert.equal(stored, true);
      assert.equal(evidence.result, "FAIL");
      assert.equal(evidence.failure.code, "TRANSPORT");
      assert.equal(evidence.branch.unchanged, true);
      if (loseSafeResponse) {
        assert.equal(evidence.scope.inactiveSampleRequestCreatedBlob, false);
        assert.equal(evidence.scope.safeRequestCreatedUnreferencedBlobOnly, null);
        assert.match(evidence.scope.safeWriteUncertainty, /unknown/);
      } else {
        assert.equal(evidence.scope.inactiveSampleRequestCreatedBlob, null);
        assert.match(evidence.scope.inactiveSampleWriteUncertainty, /may remain/);
      }
      assert.equal(api.calls.filter((call) => call.method === "POST").length, loseSafeResponse ? 2 : 1);
      return true;
    });
  }
});

test("unexpected inactive sample success stops before remediation and records orphan scope", async () => {
  const api = exerciseApi({ blockedStatus: 201, blockedBody: { sha: "c".repeat(40) } });
  await assert.rejects(exercise(api, config, { source: sourceSpec }), (error) => {
    const evidence = error.details.evidence;
    assert.equal(evidence.failure.code, "UNEXPECTED_SAMPLE_SUCCESS");
    assert.equal(evidence.scope.unexpectedInactiveBlob, "unreferenced-orphan");
    assert.equal(evidence.scope.inactiveSampleRequestCreatedBlob, true);
    assert.equal(evidence.branch.unchanged, true);
    assert.equal(evidence.scope.bypassAttempted, false);
    return true;
  });
  assert.equal(api.calls.filter((call) => call.method === "POST").length, 1);
});

test("safe Git blob hash uses Git's UTF-8 blob object format", () => {
  const bytes = Buffer.from(SAFE_CONTENT);
  const expected = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
  assert.equal(gitBlobSha(SAFE_CONTENT), expected);
});
