#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectReleaseArtifact } from "../../security-remediation/scripts/release-artifact.mjs";

const CAPTURE_SCHEMA = "workshop.live-evidence-chain/v1";
const REPORT_SCHEMA = "workshop.live-evidence-chain-report/v1";
const LIVE_SOURCE = "github-read-only-collection";
const SYNTHETIC_SOURCE = "synthetic-offline-fixture";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_RECORDS = 100;
const MAX_MAINTENANCE_ISSUES = 20;

function verifyContinuationReport(report) {
  if (!report) return {
    verdict: "NOT_EXECUTED",
    reason: "Run the security-remediation verifier live when presenting the continuation; this chain report does not consume a recorded continuation.",
    liveClaimAllowed: false
  };
  return {
    verdict: "BLOCKED",
    reason: "Recorded continuation reports are not retained in the public repository. Run the live verifier and read its result instead.",
    liveClaimAllowed: false
  };
}
const DEFAULT_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const MAX_HEALTH_BYTES = 64 * 1024;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const freshCollections = new WeakSet();

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) fail(`${label} contains unsupported key(s): ${unexpected.join(", ")}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  return value;
}

function workflowConfig(value, label) {
  assertObject(value, label);
  assertOnlyKeys(value, ["runId", "name", "path"], label);
  return {
    runId: value.runId === undefined || value.runId === null
      ? null
      : positiveInteger(value.runId, `${label}.runId`),
    ...(value.name === undefined ? {} : { name: requiredString(value.name, `${label}.name`) }),
    ...(value.path === undefined ? {} : { path: requiredString(value.path, `${label}.path`) })
  };
}

function strictHealthUrl(health) {
  const url = new URL(requiredString(health.url, "health.url"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    fail("health.url must be an HTTPS URL without credentials, query, or fragment");
  }
  if (!Array.isArray(health.allowedOrigins) || health.allowedOrigins.length < 1) {
    fail("health.allowedOrigins must contain at least one exact HTTPS origin");
  }
  const allowed = health.allowedOrigins.map((item, index) => {
    const origin = new URL(requiredString(item, `health.allowedOrigins[${index}]`));
    if (origin.protocol !== "https:" || origin.origin !== item || origin.pathname !== "/") {
      fail(`health.allowedOrigins[${index}] must be an exact HTTPS origin`);
    }
    return origin.origin;
  });
  if (!allowed.includes(url.origin)) fail(`health.url origin ${url.origin} is outside health.allowedOrigins`);
  const expectedPath = health.path ?? "/health";
  if (url.pathname !== expectedPath) fail(`health.url must use the configured exact path ${expectedPath}`);
  return url.toString();
}

export function validateConfig(input) {
  const config = assertObject(input, "config");
  assertOnlyKeys(config, [
    "schemaVersion", "repository", "issueNumber", "pullRequestNumber", "agentLogins",
    "requiredChecks", "workflows", "artifact", "health", "maintenance", "controls"
  ], "config");
  if (config.schemaVersion !== 1) fail("config.schemaVersion must be 1");
  if (!REPOSITORY_PATTERN.test(config.repository ?? "")) fail("repository must be OWNER/REPOSITORY");

  if (!Array.isArray(config.agentLogins) || config.agentLogins.length < 1) {
    fail("agentLogins must contain at least one explicit GitHub login");
  }
  const agentLogins = [...new Set(config.agentLogins.map((login, index) =>
    requiredString(login, `agentLogins[${index}]`)))];
  if (!Array.isArray(config.requiredChecks) || config.requiredChecks.length < 1) {
    fail("requiredChecks must contain at least one exact check-run name");
  }
  const requiredChecks = [...new Set(config.requiredChecks.map((name, index) =>
    requiredString(name, `requiredChecks[${index}]`)))];

  assertObject(config.workflows, "workflows");
  assertOnlyKeys(config.workflows, ["build", "release"], "workflows");
  const workflows = {
    build: workflowConfig(config.workflows.build, "workflows.build"),
    release: workflowConfig(config.workflows.release, "workflows.release")
  };

  assertObject(config.artifact, "artifact");
  assertOnlyKeys(config.artifact, ["name", "run", "maxBytes", "releaseManifest"], "artifact");
  if (config.artifact.releaseManifest !== undefined && typeof config.artifact.releaseManifest !== "boolean") {
    fail("artifact.releaseManifest must be boolean");
  }
  if (!["build", "release"].includes(config.artifact.run)) {
    fail("artifact.run must be build or release");
  }
  const maxBytes = config.artifact.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
    fail("artifact.maxBytes must be between 1 and 104857600");
  }

  let health = null;
  if (config.health !== undefined && config.health !== null) {
    assertObject(config.health, "health");
    assertOnlyKeys(config.health, ["url", "allowedOrigins", "path", "service"], "health");
    health = {
      url: strictHealthUrl(config.health),
      allowedOrigins: [...config.health.allowedOrigins],
      path: config.health.path ?? "/health",
      ...(config.health.service === undefined
        ? {}
        : { service: requiredString(config.health.service, "health.service") })
    };
  }

  assertObject(config.maintenance, "maintenance");
  assertOnlyKeys(config.maintenance, ["issueNumbers"], "maintenance");
  if (!Array.isArray(config.maintenance.issueNumbers) ||
      config.maintenance.issueNumbers.length < 1 ||
      config.maintenance.issueNumbers.length > MAX_MAINTENANCE_ISSUES) {
    fail(`maintenance.issueNumbers must contain 1-${MAX_MAINTENANCE_ISSUES} issue numbers`);
  }
  const maintenanceIssueNumbers = [...new Set(config.maintenance.issueNumbers.map((number, index) =>
    positiveInteger(number, `maintenance.issueNumbers[${index}]`)))];
  if (maintenanceIssueNumbers.includes(config.issueNumber)) {
    fail("Maintenance must be a separate follow-up issue, not the original intent.");
  }

  const controls = config.controls ?? {};
  assertObject(controls, "controls");
  assertOnlyKeys(controls, [
    "requireReviewEnforcement", "requireEnvironmentGate", "environmentName"
  ], "controls");
  for (const key of ["requireReviewEnforcement", "requireEnvironmentGate"]) {
    if (controls[key] !== undefined && typeof controls[key] !== "boolean") {
      fail(`controls.${key} must be boolean`);
    }
  }
  if (controls.requireEnvironmentGate && !controls.environmentName) {
    fail("controls.environmentName is required when requireEnvironmentGate is true");
  }

  return {
    schemaVersion: 1,
    repository: config.repository,
    issueNumber: positiveInteger(config.issueNumber, "issueNumber"),
    pullRequestNumber: positiveInteger(config.pullRequestNumber, "pullRequestNumber"),
    agentLogins,
    requiredChecks,
    workflows,
    artifact: {
      name: requiredString(config.artifact.name, "artifact.name"),
      run: config.artifact.run,
      releaseManifest: config.artifact.releaseManifest ?? false,
      maxBytes
    },
    health,
    maintenance: { issueNumbers: maintenanceIssueNumbers },
    controls: {
      requireReviewEnforcement: controls.requireReviewEnforcement ?? false,
      requireEnvironmentGate: controls.requireEnvironmentGate ?? false,
      ...(controls.environmentName
        ? { environmentName: requiredString(controls.environmentName, "controls.environmentName") }
        : {})
    }
  };
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    fail(`Cannot read ${label} ${path}: ${error.message}`);
  }
}

function writeJson(path, value, force = false) {
  const destination = resolve(path);
  if (existsSync(destination) && !force) {
    fail(`Refusing to overwrite ${destination}; choose a new path or pass --force`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, { flag: force ? "w" : "wx" });
  return destination;
}

function apiOrigin(repository, endpoint, htmlUrl) {
  return {
    transport: "gh api (GET)",
    endpoint,
    apiUrl: `https://api.github.com/${endpoint}`,
    repository,
    ...(htmlUrl ? { htmlUrl } : {})
  };
}

function runGh(args, { binary = false, maxBuffer = 5 * 1024 * 1024 } = {}) {
  const result = spawnSync("gh", args, {
    encoding: binary ? null : "utf8",
    shell: false,
    timeout: 45_000,
    maxBuffer
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : (result.stderr ?? "");
    throw new Error(`gh ${args.join(" ")} failed (${result.status}): ${stderr.trim()}`);
  }
  return result.stdout;
}

function ghApi(endpoint) {
  return JSON.parse(runGh(["api", endpoint, "-H", "Accept: application/vnd.github+json"]));
}

function safeApi(endpoint, errors, key) {
  try {
    return ghApi(endpoint);
  } catch (error) {
    errors.push({ key, endpoint, message: error.message });
    return null;
  }
}

function normalizeRepository(raw, endpoint) {
  if (!raw) return null;
  return {
    id: raw.id,
    nodeId: raw.node_id,
    fullName: raw.full_name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    origin: apiOrigin(raw.full_name, endpoint, raw.html_url)
  };
}

function repositoryFromApiUrl(repositoryUrl) {
  return typeof repositoryUrl === "string"
    ? repositoryUrl.replace(/^https:\/\/api\.github\.com\/repos\//, "")
    : null;
}

function normalizeIssue(raw, repository, endpoint) {
  if (!raw) return null;
  return {
    id: raw.id,
    nodeId: raw.node_id,
    number: raw.number,
    repository: repositoryFromApiUrl(raw.repository_url),
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state,
    isPullRequest: Boolean(raw.pull_request),
    origin: apiOrigin(repository, endpoint, raw.html_url)
  };
}

function normalizePullRequest(raw, repository, endpoint) {
  if (!raw) return null;
  return {
    id: raw.id,
    nodeId: raw.node_id,
    number: raw.number,
    repository: raw.base?.repo?.full_name ?? repositoryFromApiUrl(raw.base?.repo?.url),
    state: raw.state,
    draft: raw.draft,
    body: raw.body ?? "",
    author: { login: raw.user?.login, type: raw.user?.type },
    head: { sha: raw.head?.sha, ref: raw.head?.ref, repository: raw.head?.repo?.full_name },
    base: { sha: raw.base?.sha, ref: raw.base?.ref, repository: raw.base?.repo?.full_name },
    mergedAt: raw.merged_at,
    mergedBy: raw.merged_by
      ? { login: raw.merged_by.login, type: raw.merged_by.type }
      : null,
    mergeCommitSha: raw.merge_commit_sha,
    origin: apiOrigin(repository, endpoint, raw.html_url)
  };
}

function normalizeTimeline(raw, repository, endpoint) {
  if (!Array.isArray(raw)) return [];
  return raw.map((event) => ({
    id: event.id,
    nodeId: event.node_id,
    event: event.event,
    createdAt: event.created_at,
    actor: event.actor ? { login: event.actor.login, type: event.actor.type } : null,
    sourceIssue: event.source?.issue
      ? {
          id: event.source.issue.id,
          number: event.source.issue.number,
          repository: repositoryFromApiUrl(event.source.issue.repository_url),
          isPullRequest: Boolean(event.source.issue.pull_request),
          htmlUrl: event.source.issue.html_url
        }
      : null,
    origin: apiOrigin(repository, endpoint)
  }));
}

function normalizeReviews(raw, repository, endpoint) {
  if (!Array.isArray(raw)) return [];
  return raw.map((review) => ({
    id: review.id,
    nodeId: review.node_id,
    state: review.state,
    commitId: review.commit_id,
    submittedAt: review.submitted_at,
    user: { login: review.user?.login, type: review.user?.type },
    origin: apiOrigin(repository, endpoint, review.html_url)
  }));
}

function normalizeCheckRuns(raw, repository, endpoint) {
  if (!raw?.check_runs) return [];
  return raw.check_runs.map((check) => ({
    id: check.id,
    nodeId: check.node_id,
    name: check.name,
    headSha: check.head_sha,
    status: check.status,
    conclusion: check.conclusion,
    startedAt: check.started_at,
    completedAt: check.completed_at,
    app: check.app ? { id: check.app.id, slug: check.app.slug } : null,
    origin: apiOrigin(repository, endpoint, check.html_url)
  }));
}

function normalizeRun(raw, repository, endpoint) {
  if (!raw) return null;
  return {
    id: raw.id,
    nodeId: raw.node_id,
    name: raw.name,
    path: raw.path,
    event: raw.event,
    status: raw.status,
    conclusion: raw.conclusion,
    headSha: raw.head_sha,
    headBranch: raw.head_branch,
    runAttempt: raw.run_attempt,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    origin: apiOrigin(repository, endpoint, raw.html_url)
  };
}

function normalizeArtifacts(raw, repository, endpoint) {
  if (!raw?.artifacts) return [];
  return raw.artifacts.map((artifact) => ({
    id: artifact.id,
    nodeId: artifact.node_id,
    name: artifact.name,
    sizeInBytes: artifact.size_in_bytes,
    expired: artifact.expired,
    expiresAt: artifact.expires_at ?? null,
    digest: artifact.digest ?? null,
    workflowRun: artifact.workflow_run
      ? { id: artifact.workflow_run.id, headSha: artifact.workflow_run.head_sha }
      : null,
    origin: apiOrigin(repository, endpoint, artifact.archive_download_url)
  }));
}

function normalizeMaintenance(raw, repository, endpoint) {
  if (!raw) return null;
  return {
    id: raw.id,
    nodeId: raw.node_id,
    number: raw.number,
    repository: repositoryFromApiUrl(raw.repository_url),
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state,
    isPullRequest: Boolean(raw.pull_request),
    labels: (raw.labels ?? []).map((label) =>
      typeof label === "string" ? label : label.name),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    origin: apiOrigin(repository, endpoint, raw.html_url)
  };
}

function normalizeProtection(raw, repository, endpoint, error) {
  if (!raw) return { observed: false, reason: error ?? "not returned", origin: apiOrigin(repository, endpoint) };
  return {
    observed: true,
    requiredApprovingReviewCount:
      raw.required_pull_request_reviews?.required_approving_review_count ?? null,
    dismissStaleReviews:
      raw.required_pull_request_reviews?.dismiss_stale_reviews ?? null,
    origin: apiOrigin(repository, endpoint, raw.url)
  };
}

function normalizeEnvironment(raw, repository, endpoint, error) {
  if (!raw) return { observed: false, reason: error ?? "not returned", origin: apiOrigin(repository, endpoint) };
  const rules = raw.protection_rules ?? [];
  return {
    observed: true,
    name: raw.name,
    reviewerGateObserved: rules.some((rule) =>
      rule.type === "required_reviewers" && (rule.reviewers?.length ?? 0) > 0),
    protectionRuleTypes: rules.map((rule) => rule.type),
    origin: apiOrigin(repository, endpoint, raw.html_url)
  };
}

function normalizeEnvironmentApprovals(raw, repository, endpoint) {
  if (!Array.isArray(raw)) return [];
  return raw.map((approval) => ({
    state: approval.state,
    comment: approval.comment ?? "",
    user: approval.user
      ? { id: approval.user.id, login: approval.user.login, type: approval.user.type }
      : null,
    environments: (approval.environments ?? []).map((environment) => ({
      id: environment.id,
      nodeId: environment.node_id,
      name: environment.name
    })),
    origin: apiOrigin(repository, endpoint)
  }));
}

function pathContains(parent, child) {
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export function prepareArtifactStagingDirectory(destination, outputPath) {
  const base = resolve(destination);
  const filesystemRoot = parse(base).root;
  if (base === filesystemRoot || pathContains(base, repositoryRoot)) {
    throw new Error(`Artifact destination ${base} is a dangerous ancestor of the repository`);
  }
  if (outputPath && base === resolve(outputPath)) {
    throw new Error("Artifact destination must not equal the capture output file");
  }
  if (existsSync(base) && !statSync(base).isDirectory()) {
    throw new Error(`Artifact destination ${base} is not a directory`);
  }
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "live-chain-artifact-"));
}

function downloadArtifact(repository, artifact, destination, outputPath, maxBytes) {
  if (!artifact || artifact.expired) return null;
  if (!Number.isSafeInteger(artifact.sizeInBytes) || artifact.sizeInBytes > maxBytes) {
    throw new Error(`Artifact ${artifact.id} is larger than configured artifact.maxBytes`);
  }
  const directory = prepareArtifactStagingDirectory(destination, outputPath);
  const endpoint = `repos/${repository}/actions/artifacts/${artifact.id}/zip`;
  const archive = runGh(["api", endpoint], {
    binary: true,
    maxBuffer: Math.max(maxBytes + 1024 * 1024, 5 * 1024 * 1024)
  });
  if (archive.length > maxBytes) throw new Error("Downloaded artifact exceeded artifact.maxBytes");
  const path = resolve(directory, `artifact-${artifact.id}.zip`);
  writeFileSync(path, archive, { flag: "wx" });
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return {
    artifactId: artifact.id,
    runId: artifact.workflowRun?.id ?? null,
    archive: basename(path),
    archivePath: path,
    bytes: statSync(path).size,
    sha256,
    metadataDigest: artifact.digest,
    origin: apiOrigin(repository, endpoint)
  };
}

async function collectHealth(config, errors) {
  if (!config.health) return null;
  try {
    const response = await fetch(config.health.url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let bytes = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_HEALTH_BYTES) {
          await reader.cancel();
          throw new Error(`response exceeded ${MAX_HEALTH_BYTES} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      errors.push({ key: "health", endpoint: config.health.url, message: "response was not JSON" });
    }
    return {
      url: config.health.url,
      httpStatus: response.status,
      body,
      origin: { transport: "HTTPS GET", url: config.health.url }
    };
  } catch (error) {
    errors.push({ key: "health", endpoint: config.health.url, message: error.message });
    return null;
  }
}

export async function collectChain(inputConfig, options = {}) {
  const config = validateConfig(inputConfig);
  const repository = config.repository;
  const errors = [];
  const truncation = [];
  const endpoint = {
    repository: `repos/${repository}`,
    issue: `repos/${repository}/issues/${config.issueNumber}`,
    pullRequest: `repos/${repository}/pulls/${config.pullRequestNumber}`,
    timeline: `repos/${repository}/issues/${config.issueNumber}/timeline?per_page=${MAX_RECORDS}`,
    reviews: `repos/${repository}/pulls/${config.pullRequestNumber}/reviews?per_page=${MAX_RECORDS}`,
    build: config.workflows.build.runId
      ? `repos/${repository}/actions/runs/${config.workflows.build.runId}`
      : null,
    release: config.workflows.release.runId
      ? `repos/${repository}/actions/runs/${config.workflows.release.runId}`
      : null
  };

  const repositoryRaw = safeApi(endpoint.repository, errors, "repository");
  const issueRaw = safeApi(endpoint.issue, errors, "issue");
  const pullRequestRaw = safeApi(endpoint.pullRequest, errors, "pullRequest");
  const timelineRaw = safeApi(endpoint.timeline, errors, "issueTimeline");
  const reviewsRaw = safeApi(endpoint.reviews, errors, "reviews");
  if (timelineRaw?.length === MAX_RECORDS) truncation.push("issueTimeline");
  if (reviewsRaw?.length === MAX_RECORDS) truncation.push("reviews");

  const headSha = pullRequestRaw?.head?.sha;
  const checksEndpoint = headSha
    ? `repos/${repository}/commits/${headSha}/check-runs?per_page=${MAX_RECORDS}`
    : null;
  const checksRaw = checksEndpoint ? safeApi(checksEndpoint, errors, "checkRuns") : null;
  if (checksRaw?.total_count > MAX_RECORDS) truncation.push("checkRuns");

  const buildRaw = endpoint.build ? safeApi(endpoint.build, errors, "buildWorkflow") : null;
  const releaseRaw = endpoint.release ? safeApi(endpoint.release, errors, "releaseWorkflow") : null;
  let releaseSourceTree = null;
  if (config.artifact.releaseManifest && pullRequestRaw?.merged_at) {
    const tree = safeApi(`repos/${repository}/git/trees/${pullRequestRaw.merge_commit_sha}?recursive=1`,
      errors, "releaseSourceTree");
    if (tree?.truncated) truncation.push("releaseSourceTree");
    releaseSourceTree = tree?.tree?.filter((entry) => entry.type === "blob" &&
      (entry.path.startsWith("src/") || entry.path.startsWith("data/") ||
        ["package.json", "package-lock.json"].includes(entry.path))) ?? null;
  }
  const artifactRun = config.artifact.run === "build" ? config.workflows.build : config.workflows.release;
  const artifactsEndpoint = artifactRun.runId
    ? `repos/${repository}/actions/runs/${artifactRun.runId}/artifacts?per_page=${MAX_RECORDS}`
    : null;
  const artifactsRaw = artifactsEndpoint
    ? safeApi(artifactsEndpoint, errors, "artifacts")
    : null;
  if (artifactsRaw?.total_count > MAX_RECORDS) truncation.push("artifacts");
  const artifacts = normalizeArtifacts(artifactsRaw, repository, artifactsEndpoint);
  const namedArtifacts = artifacts.filter((item) => item.name === config.artifact.name);
  let artifactDownload = null;
  if (namedArtifacts.length === 1 && options.artifactDirectory) {
    try {
      artifactDownload = downloadArtifact(
        repository,
        namedArtifacts[0],
        options.artifactDirectory,
        options.outputPath,
        config.artifact.maxBytes
      );
    } catch (error) {
      errors.push({ key: "artifactDownload", endpoint: namedArtifacts[0].origin.endpoint, message: error.message });
    }
  }

  const maintenance = config.maintenance.issueNumbers.map((number) => {
    const issueEndpoint = `repos/${repository}/issues/${number}`;
    return normalizeMaintenance(safeApi(issueEndpoint, errors, `maintenance:${number}`), repository, issueEndpoint);
  }).filter(Boolean);

  const baseRef = pullRequestRaw?.base?.ref;
  const protectionEndpoint = baseRef
    ? `repos/${repository}/branches/${encodeURIComponent(baseRef)}/protection`
    : null;
  const protectionErrorStart = errors.length;
  const protectionRaw = protectionEndpoint
    ? safeApi(protectionEndpoint, errors, "branchProtection")
    : null;
  const protectionError = errors.slice(protectionErrorStart).find((item) => item.key === "branchProtection");

  const environmentEndpoint = config.controls.environmentName
    ? `repos/${repository}/environments/${encodeURIComponent(config.controls.environmentName)}`
    : null;
  const environmentErrorStart = errors.length;
  const environmentRaw = environmentEndpoint
    ? safeApi(environmentEndpoint, errors, "environment")
    : null;
  const environmentError = errors.slice(environmentErrorStart).find((item) => item.key === "environment");
  const approvalsEndpoint = config.controls.environmentName && config.workflows.release.runId
    ? `repos/${repository}/actions/runs/${config.workflows.release.runId}/approvals`
    : null;
  const approvalsRaw = approvalsEndpoint
    ? safeApi(approvalsEndpoint, errors, "environmentApprovals")
    : null;

  const capture = {
    schema: CAPTURE_SCHEMA,
    source: {
      kind: LIVE_SOURCE,
      collectedAt: new Date().toISOString(),
      collector: "live-chain.mjs",
      remoteOperations: "read-only"
    },
    config,
    collection: { errors, truncation, limitPerCollection: MAX_RECORDS },
    facts: {
      repository: normalizeRepository(repositoryRaw, endpoint.repository),
      issue: normalizeIssue(issueRaw, repository, endpoint.issue),
      pullRequest: normalizePullRequest(pullRequestRaw, repository, endpoint.pullRequest),
      issueTimeline: normalizeTimeline(timelineRaw, repository, endpoint.timeline),
      reviews: normalizeReviews(reviewsRaw, repository, endpoint.reviews),
      checkRuns: normalizeCheckRuns(checksRaw, repository, checksEndpoint),
      workflows: {
        build: normalizeRun(buildRaw, repository, endpoint.build),
        release: normalizeRun(releaseRaw, repository, endpoint.release)
      },
      artifacts,
      releaseSourceTree,
      artifactDownload,
      health: await collectHealth(config, errors),
      maintenance,
      controls: {
        branchProtection: normalizeProtection(
          protectionRaw,
          repository,
          protectionEndpoint ?? "unavailable",
          protectionError?.message
        ),
        environment: config.controls.environmentName
          ? normalizeEnvironment(
              environmentRaw,
              repository,
              environmentEndpoint,
              environmentError?.message
            )
          : { observed: false, reason: "No environmentName configured; no environment gate claimed" },
        environmentApprovals: normalizeEnvironmentApprovals(
          approvalsRaw,
          repository,
          approvalsEndpoint ?? "unavailable"
        )
      }
    }
  };
  freshCollections.add(capture);
  return { capture, report: verifyChain(capture) };
}

function result(id, passed, reason, evidence = {}) {
  return { id, status: passed ? "PASS" : "BLOCKED", reason, evidence };
}

function exactClosingReference(body, issueNumber, repository) {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const local = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b`, "i");
  const qualified = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+${escaped}#${issueNumber}\\b`,
    "i"
  );
  return local.test(body ?? "") || qualified.test(body ?? "");
}

function latestReviewDecisions(reviews) {
  const decisions = new Map();
  for (const review of reviews ?? []) {
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) continue;
    const prior = decisions.get(review.user?.login);
    const currentKey = `${review.submittedAt ?? ""}:${String(review.id ?? 0).padStart(20, "0")}`;
    const priorKey = prior
      ? `${prior.submittedAt ?? ""}:${String(prior.id ?? 0).padStart(20, "0")}`
      : "";
    if (!prior || currentKey > priorKey) decisions.set(review.user?.login, review);
  }
  return [...decisions.values()];
}

function newestCheck(checks) {
  return [...checks].sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0))[0];
}

function atOrBefore(value, boundary) {
  const timestamp = Date.parse(value ?? "");
  const limit = Date.parse(boundary ?? "");
  return Number.isFinite(timestamp) && Number.isFinite(limit) && timestamp <= limit;
}

function reverifyArtifact(download, artifact, maxBytes) {
  if (!download?.archivePath || !isAbsolute(download.archivePath)) {
    return { verified: false, reason: "archivePath is absent or not absolute" };
  }
  try {
    const stats = statSync(download.archivePath);
    if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) {
      return { verified: false, reason: "archive is absent, empty, or exceeds artifact.maxBytes" };
    }
    if (!Number.isSafeInteger(artifact.sizeInBytes) ||
        artifact.sizeInBytes < 1 ||
        artifact.sizeInBytes > maxBytes) {
      return { verified: false, reason: "GitHub artifact metadata exceeds artifact.maxBytes" };
    }
    const bytes = readFileSync(download.archivePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadataSha256 =
      artifact.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase() ?? null;
    const verified =
      bytes.length <= maxBytes &&
      bytes.length === stats.size &&
      stats.size === artifact.sizeInBytes &&
      stats.size === download.bytes &&
      sha256 === download.sha256 &&
      (metadataSha256 === null || metadataSha256 === sha256);
    return {
      verified,
      reason: verified ? "archive bytes re-read and hashes match" : "archive bytes or hashes do not match",
      bytes: stats.size,
      sha256,
      metadataSha256
    };
  } catch (error) {
    return { verified: false, reason: `archive could not be read: ${error.message}` };
  }
}

function maintenanceLink(record, repository, headSha, mergeSha, workflowRuns) {
  const text = `${record.title ?? ""}\n${record.body ?? ""}`;
  if ([headSha, mergeSha].some((sha) => SHA_PATTERN.test(sha ?? "") && text.includes(sha))) {
    return true;
  }
  return workflowRuns.some((run) =>
    run?.id &&
    [headSha, mergeSha].includes(run.headSha) &&
    text.includes(`https://github.com/${repository}/actions/runs/${run.id}`));
}

export function liveArtifactFresh(artifact, now = Date.now()) {
  return artifact?.expired === false && Number.isFinite(Date.parse(artifact.expiresAt)) &&
    Date.parse(artifact.expiresAt) > now;
}

export function verifyChain(capture, { continuationReport } = {}) {
  assertObject(capture, "capture");
  if (capture.schema !== CAPTURE_SCHEMA) fail(`capture.schema must be ${CAPTURE_SCHEMA}`);
  if (![LIVE_SOURCE, SYNTHETIC_SOURCE].includes(capture.source?.kind)) {
    fail(`capture.source.kind must be ${LIVE_SOURCE} or ${SYNTHETIC_SOURCE}`);
  }
  const freshLiveCollection =
    capture.source.kind === LIVE_SOURCE && freshCollections.has(capture);
  if (freshLiveCollection) freshCollections.delete(capture);
  const config = validateConfig(capture.config);
  const facts = capture.facts ?? {};
  const stages = [];
  const repository = facts.repository;
  const issue = facts.issue;
  const pullRequest = facts.pullRequest;
  const headSha = pullRequest?.head?.sha;
  const mergeSha = pullRequest?.mergeCommitSha;
  let packageProof = null;
  let packageError = null;
  if (config.artifact.releaseManifest && facts.artifactDownload?.archivePath) {
    try {
      const size = statSync(facts.artifactDownload.archivePath).size;
      if (size < 1 || size > config.artifact.maxBytes) throw new Error("Release archive exceeds artifact.maxBytes");
      const bytes = readFileSync(facts.artifactDownload.archivePath);
      packageProof = inspectReleaseArtifact(bytes, config.artifact.maxBytes);
    } catch (error) {
      packageError = error.message;
    }
  }
  const manifest = packageProof?.manifest;
  const sourceMatches = Array.isArray(facts.releaseSourceTree) && packageProof?.sourceBlobs?.length === facts.releaseSourceTree.length &&
    facts.releaseSourceTree.every((entry) =>
      ["100644", "100755"].includes(entry.mode) &&
      packageProof.sourceBlobs.some((blob) => blob.path === entry.path && blob.sha === entry.sha));
  const manifestMatches = sourceMatches &&
    manifest?.commit === mergeSha && manifest?.prHead === headSha &&
    manifest?.sourceRepo === config.repository && manifest?.prNumber === config.pullRequestNumber &&
    manifest?.runId === String(config.workflows.release.runId) &&
    manifest?.workflowSha === facts.workflows?.release?.headSha;

  const repoMatch =
    repository?.fullName === config.repository &&
    issue?.repository === config.repository &&
    pullRequest?.repository === config.repository &&
    pullRequest?.base?.repository === config.repository;
  stages.push(result(
    "repository-and-intent",
    repoMatch && issue?.number === config.issueNumber && !issue?.isPullRequest,
    repoMatch && issue?.number === config.issueNumber && !issue?.isPullRequest
      ? "Issue, pull request, and base repository share the configured repository."
      : "Repository or issue identity is missing or mixed.",
    { repositoryId: repository?.id, issueId: issue?.id, pullRequestId: pullRequest?.id }
  ));

  const timelineLink = (facts.issueTimeline ?? []).some((event) =>
    event.event === "cross-referenced" &&
    event.sourceIssue?.isPullRequest &&
    event.sourceIssue?.number === config.pullRequestNumber &&
    event.sourceIssue?.repository === config.repository);
  const closingLink = exactClosingReference(
    pullRequest?.body,
    config.issueNumber,
    config.repository
  );
  const agentProposal =
    pullRequest?.number === config.pullRequestNumber &&
    config.agentLogins.includes(pullRequest?.author?.login);
  stages.push(result(
    "agent-proposal-link",
    agentProposal && (timelineLink || closingLink),
    agentProposal && (timelineLink || closingLink)
      ? "The configured agent-authored pull request links to the exact issue."
      : "The exact issue-to-agent-pull-request link is absent or the author is not allowlisted.",
    {
      pullRequestId: pullRequest?.id,
      author: pullRequest?.author,
      linkage: timelineLink ? "issue-timeline-cross-reference" : (closingLink ? "closing-reference" : null)
    }
  ));

  const decisions = latestReviewDecisions(
    (facts.reviews ?? []).filter((review) =>
      atOrBefore(review.submittedAt, pullRequest?.mergedAt))
  );
  // REST mutates a dismissed review in place without changing submitted_at.
  // Without dismissal timeline evidence, its pre-merge decision is unknown.
  const unresolvedDismissalHistory = (facts.reviews ?? []).some((review) => review.state === "DISMISSED");
  const outstandingChanges = decisions.filter((review) => review.state === "CHANGES_REQUESTED");
  const humanApprovals = decisions.filter((review) =>
    review.state === "APPROVED" &&
    review.commitId === headSha &&
    atOrBefore(review.submittedAt, pullRequest?.mergedAt) &&
    review.user?.type === "User" &&
    review.user?.login !== pullRequest?.author?.login &&
    !config.agentLogins.includes(review.user?.login));
  const reviewPassed =
    SHA_PATTERN.test(headSha ?? "") &&
    humanApprovals.length > 0 &&
    !unresolvedDismissalHistory &&
    outstandingChanges.length === 0 &&
    !capture.collection?.truncation?.includes("reviews");
  stages.push(result(
    "human-review",
    reviewPassed,
    reviewPassed
      ? "A non-agent human approval applies to the exact final pull-request head, with no outstanding changes request."
      : "Approval is missing, stale, after merge, non-human, superseded, or blocked by a changes request or unresolved dismissal history.",
    {
      headSha,
      approvalReviewIds: humanApprovals.map((review) => review.id),
      outstandingChangesReviewIds: outstandingChanges.map((review) => review.id)
    }
  ));

  const checks = config.requiredChecks.map((name) => {
    const matching = (facts.checkRuns ?? []).filter((check) => check.name === name);
    const current = newestCheck(matching);
    return {
      name,
      id: current?.id ?? null,
      headSha: current?.headSha ?? null,
      status: current?.status ?? null,
      conclusion: current?.conclusion ?? null,
      passed:
        current?.headSha === headSha &&
        current?.status === "completed" &&
        current?.conclusion === "success" &&
        atOrBefore(current?.completedAt, pullRequest?.mergedAt)
    };
  });
  const checksPassed =
    SHA_PATTERN.test(headSha ?? "") &&
    checks.every((check) => check.passed) &&
    !capture.collection?.truncation?.includes("checkRuns");
  stages.push(result(
    "required-checks",
    checksPassed,
    checksPassed
      ? "Every configured named check completed successfully on the final pull-request head."
      : "A required named check is missing, non-successful, stale, cancelled, skipped, incomplete, or completed after merge.",
    { headSha, checks }
  ));

  const merged =
    pullRequest?.state === "closed" &&
    Number.isFinite(Date.parse(pullRequest?.mergedAt ?? "")) &&
    SHA_PATTERN.test(headSha ?? "") &&
    SHA_PATTERN.test(mergeSha ?? "");
  stages.push(result(
    "merge-mapping",
    merged,
    merged
      ? "GitHub maps the final pull-request head H to its reported merge commit M."
      : "The pull request is not merged or its exact H-to-M mapping is unavailable.",
    { headSha, mergeSha, mergedAt: pullRequest?.mergedAt }
  ));

  const workflowResults = ["build", "release"].map((kind) => {
    const expected = config.workflows[kind];
    const observed = facts.workflows?.[kind];
    const passed =
      observed?.id === expected.runId &&
      (observed?.headSha === mergeSha || (config.artifact.releaseManifest && manifestMatches &&
        observed?.id === config.workflows.release.runId &&
        observed?.event === "workflow_dispatch" && observed?.headBranch === "main")) &&
      observed?.status === "completed" &&
      observed?.conclusion === "success" &&
      (expected.name === undefined || observed?.name === expected.name) &&
      (expected.path === undefined || observed?.path === expected.path);
    return {
      kind,
      expectedRunId: expected.runId,
      observedRunId: observed?.id ?? null,
      headSha: observed?.headSha ?? null,
      conclusion: observed?.conclusion ?? null,
      passed
    };
  });
  stages.push(result(
    "build-and-release",
    merged && workflowResults.every((item) => item.passed),
    merged && workflowResults.every((item) => item.passed)
      ? "Successful build and release evidence identifies M directly or through a verified package whose source blobs match M."
      : "A build or release run is missing, unsuccessful, or belongs to an unrelated commit.",
    { mergeSha, workflows: workflowResults }
  ));

  const expectedArtifactRunId = config.workflows[config.artifact.run].runId;
  const artifacts = (facts.artifacts ?? []).filter((artifact) =>
    artifact.name === config.artifact.name &&
    artifact.workflowRun?.id === expectedArtifactRunId);
  const artifact = artifacts.length === 1 ? artifacts[0] : null;
  const download = facts.artifactDownload;
  const reverifiedArchive = artifact
    ? reverifyArtifact(download, artifact, config.artifact.maxBytes)
    : { verified: false, reason: "artifact metadata is absent or ambiguous" };
  const artifactPassed =
    artifact !== null &&
    artifact.expired === false &&
    (!freshLiveCollection || liveArtifactFresh(artifact)) &&
    (artifact.workflowRun?.headSha === mergeSha || (config.artifact.releaseManifest && manifestMatches &&
      artifact.workflowRun?.headSha === manifest.workflowSha)) &&
    download?.artifactId === artifact.id &&
    download?.runId === expectedArtifactRunId &&
    /^[a-f0-9]{64}$/.test(download?.sha256 ?? "") &&
    reverifiedArchive.verified &&
    (!config.artifact.releaseManifest || manifestMatches) &&
    !capture.collection?.truncation?.includes("artifacts");
  stages.push(result(
    "artifact",
    artifactPassed,
    artifactPassed
      ? "The exact workflow artifact was downloaded and checksummed for merge commit M."
      : "The exact non-expired artifact, download, run binding, or checksum evidence is missing.",
    {
      artifactId: artifact?.id ?? null,
      runId: download?.runId ?? null,
      sha256: download?.sha256 ?? null,
      metadataDigest: download?.metadataDigest ?? null,
      archiveReverification: reverifiedArchive,
      releaseManifestMatchesSource: config.artifact.releaseManifest ? Boolean(manifestMatches) : null,
      releaseManifestError: packageError,
      checksumIsCryptographicAttestation: false
    }
  ));

  const health = facts.health;
  const healthPassed =
    config.health !== null &&
    health?.url === config.health.url &&
    health?.httpStatus === 200 &&
    health?.body?.commit === mergeSha &&
    String(health?.body?.runId ?? "") === String(config.workflows.release.runId) &&
    (config.health.service === undefined || health?.body?.service === config.health.service);
  stages.push(result(
    "azure-runtime",
    healthPassed,
    healthPassed
      ? "The scoped health endpoint reports merge commit M and the exact release run."
      : "Azure runtime health is missing or does not identify merge commit M and the release run.",
    {
      url: health?.url ?? config.health?.url ?? null,
      httpStatus: health?.httpStatus ?? null,
      commit: health?.body?.commit ?? null,
      runId: health?.body?.runId ?? null
    }
  ));

  const relevantRuns = [facts.workflows?.build, facts.workflows?.release];
  const maintenance = (facts.maintenance ?? []).map((record) => ({
    number: record.number,
    id: record.id,
    meaningful:
      record.repository === config.repository &&
      !record.isPullRequest &&
      (record.title?.trim().length ?? 0) >= 8 &&
      (record.body?.trim().length ?? 0) >= 40,
    linked: maintenanceLink(record, config.repository, headSha, mergeSha, relevantRuns)
  }));
  const expectedNumbers = config.maintenance.issueNumbers;
  const maintenancePassed = expectedNumbers.every((number) => {
    const record = maintenance.find((item) => item.number === number);
    return record?.meaningful && record?.linked;
  });
  stages.push(result(
    "maintenance-loop",
    maintenancePassed,
    maintenancePassed
      ? "Each separate follow-up has structural evidence: a description and explicit link to H, M, or its run. A person must judge its usefulness."
      : "A configured maintenance/advisory record is missing, too weak, or tied to another revision.",
    { records: maintenance }
  ));

  const reviewEnforcement = facts.controls?.branchProtection;
  const environment = facts.controls?.environment;
  const reviewEnforced =
    reviewEnforcement?.observed === true &&
    Number(reviewEnforcement.requiredApprovingReviewCount) > 0;
  const environmentEnforced =
    environment?.observed === true && environment?.reviewerGateObserved === true;
  const environmentApprovalRecorded = (facts.controls?.environmentApprovals ?? []).some((approval) =>
    approval.state?.toLowerCase() === "approved" &&
    approval.user?.type === "User" &&
    approval.environments.some((item) => item.name === config.controls.environmentName));
  const controlsPassed =
    (!config.controls.requireReviewEnforcement || reviewEnforced) &&
    (!config.controls.requireEnvironmentGate ||
      (environmentEnforced && environmentApprovalRecorded));
  stages.push(result(
    "platform-enforcement",
    controlsPassed,
    controlsPassed
      ? "Configured enforcement requirements are observed; unrequired controls remain separately characterized."
      : "A configured platform-enforced review or environment gate was not observed.",
    {
      recordedManualApproval: humanApprovals.length > 0,
      branchProtectionReviewRequirement: reviewEnforced ? "observed" : "not-observed",
      environmentReviewerGateConfiguration: environmentEnforced ? "observed" : "not-observed",
      environmentApprovalRecord: environmentApprovalRecorded ? "observed" : "not-observed"
    }
  ));

  const collectionComplete =
    (capture.collection?.truncation?.length ?? 0) === 0 &&
    (capture.collection?.errors ?? []).every((error) =>
      (error.key === "branchProtection" && !config.controls.requireReviewEnforcement) ||
      (error.key === "environment" && !config.controls.requireEnvironmentGate) ||
      (error.key === "environmentApprovals" && !config.controls.requireEnvironmentGate));
  stages.push(result(
    "collection-completeness",
    collectionComplete,
    collectionComplete
      ? "All required bounded reads completed without truncation."
      : "Required reads failed or reached a pagination bound.",
    {
      errors: capture.collection?.errors ?? [],
      truncation: capture.collection?.truncation ?? []
    }
  ));

  const complete = stages.every((stage) => stage.status === "PASS");
  const synthetic = capture.source.kind === SYNTHETIC_SOURCE;
  return {
    schema: REPORT_SCHEMA,
    evaluatedAt: new Date().toISOString(),
    status: complete ? "COMPLETE" : "BLOCKED",
    evidenceClass: synthetic
      ? "SYNTHETIC_OFFLINE_ONLY"
      : (freshLiveCollection
          ? (complete ? "FRESH_LIVE_READS" : "INCOMPLETE_FRESH_LIVE_READS")
          : "RECORDED_CAPTURE_NOT_LIVE_AUTHORIZED"),
    liveClaimAllowed: complete && freshLiveCollection,
    loopContinuation: verifyContinuationReport(continuationReport),
    claims: {
      humanApprovalStillRequired: true,
      checksumIsCryptographicAttestation: false,
      capturedJsonIsCryptographicAttestation: false,
      collectorMutatedRemoteResources: false
    },
    identity: {
      repository: config.repository,
      issueNumber: config.issueNumber,
      pullRequestNumber: config.pullRequestNumber,
      headSha: headSha ?? null,
      mergeSha: mergeSha ?? null
    },
    stages,
    blockedReasons: stages
      .filter((stage) => stage.status === "BLOCKED")
      .map((stage) => `${stage.id}: ${stage.reason}`)
  };
}

function printPlan(config, options) {
  const artifactRunId = config.workflows[config.artifact.run].runId ?? "pending";
  const artifactDirectory = options["artifact-dir"] ??
    (options.output
      ? resolve(dirname(resolve(options.output)), `live-chain-artifacts-${artifactRunId}`)
      : "<derived beside --output>");
  console.log("Bounded read-only live evidence-chain plan");
  console.log(`  repository:        ${config.repository}`);
  console.log(`  issue -> PR:       #${config.issueNumber} -> #${config.pullRequestNumber}`);
  console.log(`  required checks:   ${config.requiredChecks.join(", ")}`);
  console.log(`  build/release:     ${config.workflows.build.runId ?? "pending"} / ${config.workflows.release.runId ?? "pending"}`);
  console.log(`  artifact:          ${config.artifact.name} from ${config.artifact.run}`);
  console.log(`  artifact output:   ${artifactDirectory}`);
  console.log(`  scoped health GET: ${config.health?.url ?? "(not configured; verification will block)"}`);
  console.log(`  maintenance:       ${config.maintenance.issueNumbers.map((item) => `#${item}`).join(", ")}`);
  console.log("  remote operations: GitHub REST GETs, artifact download, and the optional scoped HTTPS health GET");
  console.log("  remote mutations:  none");
  console.log("  approval evidence: recorded human review is distinct from platform enforcement");
  console.log("  integrity boundary: checksums and captured JSON are not cryptographic attestations");
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!["plan", "collect", "verify"].includes(command)) {
    fail("Usage: live-chain.mjs plan|collect --config FILE [--output FILE] [--artifact-dir DIR] [--force]\n" +
      "       live-chain.mjs verify --input CAPTURE [--output REPORT] [--force]");
  }
  if (command === "verify") {
    if (!options.input) fail("verify requires --input CAPTURE");
    const report = verifyChain(readJson(options.input, "capture"));
    if (options.output) writeJson(options.output, report, options.force === true);
    console.log(`${report.status} ${report.evidenceClass}`);
    for (const reason of report.blockedReasons) console.log(`  ${reason}`);
    process.exitCode = report.status === "COMPLETE" ? 0 : 2;
    return;
  }

  if (!options.config) fail(`${command} requires --config FILE`);
  const config = validateConfig(readJson(options.config, "config"));
  if (command === "plan") {
    printPlan(config, options);
    return;
  }
  if (!options.output) fail("collect requires explicit --output FILE");
  if (existsSync(resolve(options.output)) && options.force !== true) {
    fail(`Refusing to overwrite ${resolve(options.output)}; choose a new path or pass --force`);
  }
  const artifactRunId = config.workflows[config.artifact.run].runId ?? "pending";
  const artifactDirectory = options["artifact-dir"] ??
    resolve(dirname(resolve(options.output)), `live-chain-artifacts-${artifactRunId}`);
  const { capture, report } = await collectChain(config, {
    artifactDirectory,
    outputPath: options.output,
    force: options.force === true
  });
  capture.verification = report;
  const destination = writeJson(options.output, capture, options.force === true);
  console.log(`${report.status} capture written to ${destination}`);
  for (const reason of report.blockedReasons) console.log(`  ${reason}`);
  process.exitCode = report.status === "COMPLETE" ? 0 : 2;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  CAPTURE_SCHEMA,
  LIVE_SOURCE,
  REPORT_SCHEMA,
  SYNTHETIC_SOURCE
};
