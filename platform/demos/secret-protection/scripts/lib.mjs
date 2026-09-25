import { createHash } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SOURCE = Object.freeze({
  owner: "skills",
  repository: "introduction-to-secret-scanning",
  commit: "77045e069f9deda2beba27990d65899c4ee4b221",
  path: ".github/steps/3-enable-push-protection.md",
  blobSha: "e769b8ab0e3b6fb0fb33c342ac163f40690eb818",
  url: "https://github.com/skills/introduction-to-secret-scanning/blob/77045e069f9deda2beba27990d65899c4ee4b221/.github/steps/3-enable-push-protection.md"
});

export const OWNERSHIP_TOPIC = "workshop-synthetic-pharmacy";
export const SAFE_CONTENT =
  "export const pharmacyStockApiToken = process.env.PHARMACY_STOCK_API_TOKEN;\n";
const SAMPLE_PATTERN = /github_pat_<REMOVE_ME>[A-Za-z0-9_]+/g;

export class DemoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DemoError";
    this.code = code;
    this.details = details;
  }
}

export function parseCli(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "plan";
  if (!["plan", "preflight", "exercise", "cleanup"].includes(command)) {
    throw new DemoError("USAGE", `Unknown command: ${command}`);
  }
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new DemoError("USAGE", `Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (!["repo", "run-id", "output", "apply"].includes(key)) {
      throw new DemoError("USAGE", `Unknown option: --${key}`);
    }
    if (key === "apply") {
      options.apply = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new DemoError("USAGE", `--${key} needs a value`);
    options[key] = value;
  }
  return { command, options };
}

export function validateConfig(options, { needsOutput = false } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo ?? "")) {
    throw new DemoError("CONFIG", "Provide --repo OWNER/REPOSITORY");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(options["run-id"] ?? "")) {
    throw new DemoError("CONFIG", "Provide a lowercase --run-id using letters, digits, and hyphens");
  }
  if (needsOutput && !options.output) {
    throw new DemoError("CONFIG", "Exercise --apply requires an explicit --output path");
  }
  return {
    repository: options.repo,
    runId: options["run-id"],
    runTopic: `run-${options["run-id"]}`,
    output: options.output ? resolve(options.output) : null
  };
}

export function validateNewOutput(path) {
  if (extname(path).toLowerCase() !== ".json") {
    throw new DemoError("OUTPUT", "Evidence output must be a new .json file");
  }
  if (!existsSync(dirname(path)) || !statSync(dirname(path)).isDirectory()) {
    throw new DemoError("OUTPUT", "Evidence output parent directory must already exist");
  }
  if (existsSync(path)) throw new DemoError("OUTPUT", "Refusing to overwrite existing evidence");
}

export function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

export function extractInactiveSample(sourceBytes, expectedSha = SOURCE.blobSha) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes);
  const actualSha = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
  if (actualSha !== expectedSha) {
    throw new DemoError("SOURCE_DRIFT", "Pinned source blob hash does not match the reviewed blob");
  }
  const matches = [...bytes.toString("utf8").matchAll(SAMPLE_PATTERN)];
  if (matches.length !== 1) {
    throw new DemoError("SOURCE_MISSING", "Pinned source does not contain exactly one marked sample");
  }
  return matches[0][0].replace("<REMOVE_ME>", "");
}

export function redact(value, sensitive = []) {
  let result = String(value ?? "");
  for (const item of sensitive.filter(Boolean)) result = result.split(item).join("[REDACTED]");
  return result
    .replace(/github_pat_[A-Za-z0-9_<>]+/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]*bypass[^\s"'<>]*/gi, "[REDACTED_BYPASS_URL]")
    .replace(/(placeholder_id|bypass_url)\s*[:=]\s*[^\s,}\]]+/gi, "$1=[REDACTED]");
}

function parseIncludedResponse(stdout) {
  const headerEnd = stdout.indexOf("\r\n\r\n") >= 0
    ? stdout.indexOf("\r\n\r\n") + 4
    : stdout.indexOf("\n\n") + 2;
  if (headerEnd < 2) throw new DemoError("TRANSPORT", "GitHub response headers were missing");
  const headers = stdout.slice(0, headerEnd);
  const status = Number(headers.match(/^HTTP\/\S+\s+(\d{3})/im)?.[1]);
  const requestId = headers.match(/^x-github-request-id:\s*(\S+)/im)?.[1] ?? null;
  return { status, requestId, rawBody: stdout.slice(headerEnd) };
}

export class GhApi {
  request(method, endpoint, { input, raw = false } = {}) {
    const args = ["api", "--include", "--method", method, endpoint];
    if (raw) args.push("-H", "Accept: application/vnd.github.raw+json");
    if (input !== undefined) args.push("--input", "-");
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      input: input === undefined ? undefined : JSON.stringify(input),
      shell: false,
      stdio: "pipe",
      timeout: 60_000
    });
    if (result.error) throw new DemoError("TRANSPORT",
      `GitHub CLI request could not run (${result.error.code ?? "spawn error"})`);
    const response = parseIncludedResponse(result.stdout ?? "");
    if (raw) return { ...response, body: Buffer.from(response.rawBody, "utf8") };
    let body = null;
    if (response.rawBody.trim()) {
      try {
        body = JSON.parse(response.rawBody);
      } catch {
        throw new DemoError("TRANSPORT", `GitHub returned non-JSON data (HTTP ${response.status})`);
      }
    }
    return { ...response, body };
  }
}

function requireStatus(response, expected, operation) {
  if (response.status !== expected) {
    const code = [401, 403, 404, 429].includes(response.status) ? `HTTP_${response.status}` : "HTTP";
    throw new DemoError(code, `${operation} failed with HTTP ${response.status}`, {
      httpStatus: response.status, requestId: response.requestId
    });
  }
  return response.body;
}

export function assertNativeSecretBlock(response) {
  if ([401, 403, 404, 429].includes(response.status)) {
    throw new DemoError(`HTTP_${response.status}`,
      `Inactive-sample request failed with HTTP ${response.status}`, {
        httpStatus: response.status, requestId: response.requestId
      });
  }
  const placeholders = response.body?.metadata?.secret_scanning?.bypass_placeholders;
  const tokenTypes = Array.isArray(placeholders)
    ? [...new Set(placeholders.map((entry) => entry?.token_type)
      .filter((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)))]
    : [];
  const semanticBlock =
    [409, 422].includes(response.status) &&
    /secret detected in content/i.test(response.body?.message ?? "") &&
    tokenTypes.length > 0;
  if (!semanticBlock) {
    throw new DemoError("NOT_SECRET_BLOCK", "Inactive sample was not blocked by native push protection", {
      httpStatus: response.status, requestId: response.requestId
    });
  }
  return {
    httpStatus: response.status,
    nativeType: "secret-scanning-push-protection",
    message: redact(response.body.message).trim(),
    tokenTypes,
    requestId: response.requestId
  };
}

export function preflight(api, config) {
  const metadataResponse = api.request("GET", `/repos/${config.repository}`);
  const metadata = requireStatus(metadataResponse, 200, "Repository capability check");
  if (metadata.full_name?.toLowerCase() !== config.repository.toLowerCase() ||
      !Number.isSafeInteger(metadata.id) || metadata.id <= 0 ||
      typeof metadata.default_branch !== "string" || !metadata.default_branch) {
    throw new DemoError("REPOSITORY", "GitHub repository identity or default branch was unexpected");
  }
  const topics = requireStatus(
    api.request("GET", `/repos/${config.repository}/topics`), 200, "Repository ownership check"
  );
  for (const topic of [OWNERSHIP_TOPIC, config.runTopic]) {
    if (!topics?.names?.includes(topic)) {
      throw new DemoError("OWNERSHIP", `Refusing repository: required topic ${topic} is absent`);
    }
  }
  const branch = metadata.default_branch;
  const ref = requireStatus(
    api.request("GET", `/repos/${config.repository}/git/ref/heads/${encodeURIComponent(branch)}`),
    200,
    "Default branch check"
  );
  if (!/^[0-9a-f]{40}$/i.test(ref.object?.sha ?? "")) {
    throw new DemoError("BRANCH", "Default branch did not resolve to an exact commit SHA");
  }
  const capabilities = metadata.security_and_analysis ?? {};
  if (capabilities.secret_scanning?.status !== "enabled" ||
      capabilities.secret_scanning_push_protection?.status !== "enabled") {
    throw new DemoError("CAPABILITY", "Secret scanning and push protection must both be enabled");
  }
  return {
    repository: {
      fullName: metadata.full_name,
      id: metadata.id,
      visibility: metadata.visibility ?? (metadata.private ? "private" : "public")
    },
    branch: { name: branch, before: ref.object?.sha ?? null },
    capabilities: {
      secretScanning: capabilities.secret_scanning.status,
      pushProtection: capabilities.secret_scanning_push_protection.status,
      validityChecks: capabilities.secret_scanning_validity_checks?.status ?? "unavailable"
    }
  };
}

function baseEvidence(config) {
  return {
    kind: "recorded-native-push-protection",
    timestamp: new Date().toISOString(),
    result: "FAIL",
    liveClaimAllowed: false,
    source: { ...SOURCE },
    repository: { fullName: config.repository, id: null },
    branch: { name: null, before: null, after: null, unchanged: false },
    capabilities: {},
    scope: {
      inactiveSampleRequestCreatedBlob: false,
      safeRequestCreatedUnreferencedBlobOnly: false,
      commitCreated: false,
      refChanged: null,
      pipelineTriggered: false,
      bypassAttempted: false
    },
    controls: {
      actualCredentialUsed: false,
      sampleUsedForAuthentication: false,
      aiDecisionUsed: false,
      policiesChanged: false
    }
  };
}

export async function exercise(api, config, dependencies = {}) {
  const sourceSpec = dependencies.source ?? SOURCE;
  const evidence = baseEvidence(config);
  evidence.source = { ...sourceSpec };
  let sample;
  try {
    const checked = preflight(api, config);
    evidence.repository = checked.repository;
    evidence.capabilities = checked.capabilities;
    Object.assign(evidence.branch, checked.branch);
    const sourceEndpoint =
      `/repos/${sourceSpec.owner}/${sourceSpec.repository}/contents/${sourceSpec.path}?ref=${sourceSpec.commit}`;
    const source = api.request("GET", sourceEndpoint, { raw: true });
    if (source.status !== 200) {
      throw new DemoError("SOURCE_UNAVAILABLE", `Pinned source is unavailable (HTTP ${source.status})`, {
        httpStatus: source.status, requestId: source.requestId
      });
    }
    sample = extractInactiveSample(source.body, sourceSpec.blobSha);
    const endpoint = `/repos/${config.repository}/git/blobs`;
    evidence.scope.inactiveSampleRequestCreatedBlob = null;
    const blocked = api.request("POST", endpoint, {
      input: { content: sample, encoding: "utf-8" }
    });
    if (blocked.status === 201) {
      evidence.scope.inactiveSampleRequestCreatedBlob = true;
      evidence.scope.unexpectedInactiveBlob = "unreferenced-orphan";
      throw new DemoError("UNEXPECTED_SAMPLE_SUCCESS",
        "Inactive sample unexpectedly created an unreferenced blob; stopped without bypass or ref changes", {
          httpStatus: blocked.status, requestId: blocked.requestId
        });
    }
    evidence.blockedAttempt = assertNativeSecretBlock(blocked);
    evidence.scope.inactiveSampleRequestCreatedBlob = false;

    const expectedSafeSha = gitBlobSha(SAFE_CONTENT);
    evidence.scope.safeRequestCreatedUnreferencedBlobOnly = null;
    const safe = api.request("POST", endpoint, {
      input: { content: SAFE_CONTENT, encoding: "utf-8" }
    });
    const safeBody = requireStatus(safe, 201, "Safe remediation blob creation");
    evidence.scope.safeRequestCreatedUnreferencedBlobOnly = true;
    if (safeBody?.sha !== expectedSafeSha) {
      throw new DemoError("SAFE_SHA", "GitHub returned an unexpected safe blob SHA");
    }
    const remote = api.request("GET", `/repos/${config.repository}/git/blobs/${expectedSafeSha}`,
      { raw: true });
    if (remote.status !== 200 || !remote.body.equals(Buffer.from(SAFE_CONTENT, "utf8"))) {
      throw new DemoError("SAFE_BYTES", "Remote safe blob bytes did not match the reviewed remediation");
    }
    evidence.safeBlobSha = expectedSafeSha;
    evidence.verifiedRemoteBytes = true;

    const afterRef = requireStatus(
      api.request("GET",
        `/repos/${config.repository}/git/ref/heads/${encodeURIComponent(evidence.branch.name)}`),
      200,
      "Default branch invariant check"
    );
    evidence.branch.after = afterRef.object?.sha ?? null;
    evidence.branch.unchanged =
      Boolean(evidence.branch.before) && evidence.branch.before === evidence.branch.after;
    evidence.scope.refChanged = !evidence.branch.unchanged;
    if (!evidence.branch.unchanged) {
      throw new DemoError("BRANCH_CHANGED", "Default branch changed during the exercise");
    }
    evidence.result = "PASS";
    return evidence;
  } catch (error) {
    if (evidence.branch.name && !evidence.branch.after) {
      try {
        const after = api.request("GET",
          `/repos/${config.repository}/git/ref/heads/${encodeURIComponent(evidence.branch.name)}`);
        if (after.status === 200 && /^[0-9a-f]{40}$/i.test(after.body?.object?.sha ?? "")) {
          evidence.branch.after = after.body.object.sha;
          evidence.branch.unchanged = evidence.branch.before === evidence.branch.after;
          evidence.scope.refChanged = !evidence.branch.unchanged;
        } else {
          evidence.branch.readFailure = `Cannot verify the final branch state (HTTP ${after.status}).`;
        }
      } catch (branchError) {
        evidence.branch.readFailure = redact(branchError?.message, [sample]);
      }
    }
    evidence.failure = {
      code: error instanceof DemoError ? error.code : "UNEXPECTED",
      message: redact(error?.message, [sample]),
      ...(error?.details?.httpStatus ? { httpStatus: error.details.httpStatus } : {}),
      ...(error?.details?.requestId ? { requestId: error.details.requestId } : {})
    };
    if (evidence.scope.inactiveSampleRequestCreatedBlob === null) {
      evidence.scope.inactiveSampleWriteUncertainty =
        "The request outcome is unknown; an unreferenced inactive-sample blob may remain. No automatic retry or deletion was attempted.";
    }
    if (evidence.scope.safeRequestCreatedUnreferencedBlobOnly === null) {
      evidence.scope.safeWriteUncertainty =
        "The clean write outcome is unknown; an unreferenced safe blob may remain.";
    }
    if (["SOURCE_UNAVAILABLE", "SOURCE_DRIFT", "SOURCE_MISSING"].includes(evidence.failure.code)) {
      evidence.fallback = "BLOCKED: pinned inactive-sample source unavailable; use recorded evidence, not a live claim.";
    }
    throw new DemoError("EXERCISE_FAILED", evidence.failure.message, { evidence });
  }
}

export function writeEvidence(path, evidence) {
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600
  });
}
