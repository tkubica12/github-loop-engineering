import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { commandExists, commitMessage, normalizeLocation, parseArgs, run, runJson,
  runJsonOrMissing } from "../../trusted-delivery/scripts/lib.mjs";
import { inspectReleasePackage } from "./release-artifact.mjs";
const demo = resolve(dirname(fileURLToPath(import.meta.url)), ".."), stateDirectory = join(demo, ".state"), environmentName = "test";
export function acceptsCheckCommit(commit, baseSha, headSha) {
  return commit?.sha === headSha || (commit?.parents?.length === 2 &&
    commit.parents[0].sha === baseSha && commit.parents[1].sha === headSha);
}
function loadConfig(options) {
  const runId = options["run-id"] ?? process.env.SECURITY_DEMO_RUN_ID;
  if (!/^[a-z0-9][a-z0-9-]{2,38}$/.test(runId ?? ""))
    throw new Error("Supply --run-id with 3-39 lowercase letters, digits, or hyphens.");
  const statePath = join(stateDirectory, `${runId}-azure.json`);
  const saved = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  const repository = options.repo ?? process.env.SECURITY_DEMO_REPOSITORY ?? saved.repository;
  const reviewer = options.reviewer ?? process.env.SECURITY_DEMO_REVIEWER ?? saved.reviewer?.login;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository ?? ""))
    throw new Error("Supply --repo OWNER/REPO or SECURITY_DEMO_REPOSITORY.");
  if (saved.repository && saved.repository !== repository) {
    throw new Error("The saved Azure run belongs to another repository; use a new run ID.");
  }
  if (!/^[A-Za-z0-9-]+$/.test(reviewer ?? "")) throw new Error("Supply --reviewer LOGIN.");
  const stem = `security-${runId}`.slice(0, 34).replace(/-$/, "");
  return {
    runId, repository, reviewer, statePath,
    subscriptionId: options.subscription ?? process.env.AZURE_SUBSCRIPTION_ID ?? saved.subscriptionId ?? "",
    webAppName: options["app-name"] ?? process.env.AZURE_WEBAPP_NAME ?? saved.webAppName ?? "",
    location: options.location ?? process.env.AZURE_LOCATION ?? saved.location ?? "westeurope",
    resourceGroup: `rg-${stem}`, planName: `asp-${stem}`, identityName: `id-${stem}`,
    releaseRunId: options["release-run"] ?? saved.releaseRunId, releaseSha: options["release-sha"] ?? saved.releaseSha,
    prNumber: Number(options["pr-number"] ?? saved.prNumber ?? 0)
  };
}
function saveState(config, extra = {}) {
  mkdirSync(stateDirectory, { recursive: true });
  const value = {
    schema: "security-remediation-azure/v1", runId: config.runId, repository: config.repository,
    repositoryId: extra.repositoryId, ownerId: extra.ownerId, reviewer: extra.reviewer,
    subscriptionId: config.subscriptionId, location: config.location, resourceGroup: config.resourceGroup,
    planName: config.planName, identityName: config.identityName, webAppName: config.webAppName,
    releaseSha: extra.releaseSha ?? config.releaseSha,
    prNumber: (extra.prNumber ?? config.prNumber) || undefined,
    releaseRunId: extra.releaseRunId ?? config.releaseRunId
  };
  writeFileSync(config.statePath, `${JSON.stringify(value, null, 2)}\n`);
}
function requireApply(options, action) {
  if (options.apply) return;
  console.log(`PLAN ONLY: ${action} requires --apply; no GitHub or Azure state was changed.`); process.exit(0);
}
function requireAzure(config) {
  if (!/^[0-9a-f-]{36}$/i.test(config.subscriptionId))
    throw new Error("Supply AZURE_SUBSCRIPTION_ID or --subscription.");
  if (!/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(config.webAppName))
    throw new Error("Supply a globally unique lowercase AZURE_WEBAPP_NAME or --app-name.");
}
function repositoryAndReviewer(config) {
  const metadata = runJson("gh", ["api", `repos/${config.repository}`]);
  if (metadata.private || metadata.default_branch !== "main" ||
      metadata.full_name.toLowerCase() !== config.repository.toLowerCase() ||
      !metadata.topics?.includes("workshop-synthetic-pharmacy") ||
      !metadata.topics?.includes(`run-${config.runId}`)) {
    throw new Error("Refusing a repository not public and labelled for this exact synthetic run.");
  }
  const reviewer = runJson("gh", ["api", `users/${config.reviewer}`]);
  if (reviewer.type !== "User" || reviewer.login.toLowerCase() !== config.reviewer.toLowerCase() ||
      !Number.isSafeInteger(reviewer.id)) {
    throw new Error("The required reviewer must resolve to a verified GitHub User.");
  }
  return { metadata, reviewer };
}
function immutableEnvironmentSubject(config, metadata) {
  const settings = runJson("gh", ["api", `repos/${config.repository}/actions/oidc/customization/sub`]);
  if (settings.use_default !== true || settings.use_immutable_subject !== true)
    throw new Error("Repository has not opted into GitHub's default immutable OIDC subject.");
  const prefix = `repo:${metadata.owner.login}@${metadata.owner.id}/${metadata.name}@${metadata.id}`;
  if (settings.sub_claim_prefix && settings.sub_claim_prefix !== prefix)
    throw new Error("GitHub's immutable OIDC prefix does not match the repository metadata IDs.");
  return `${prefix}:environment:${environmentName}`;
}
export function assertBranchPolicy(policies) {
  if (policies.branch_policies?.length !== 1 ||
      policies.branch_policies[0].name !== "main" || policies.branch_policies[0].type !== "branch") {
    throw new Error("Environment test must select only the main branch, not a tag.");
  }
}
export function assertDefaultOidc(settings) {
  if (settings.use_default !== true) throw new Error("Refusing to replace an existing custom OIDC subject.");
}
function environment(config, reviewerId) {
  const value = runJson("gh", ["api", `repos/${config.repository}/environments/${environmentName}`]);
  const reviewers = value.protection_rules?.find((rule) => rule.type === "required_reviewers")?.reviewers ?? [];
  if (!reviewers.some((item) => item.reviewer?.type === "User" && item.reviewer.id === reviewerId))
    throw new Error("Environment test does not require the verified reviewer.");
  if (value.deployment_branch_policy?.protected_branches !== false ||
      value.deployment_branch_policy?.custom_branch_policies !== true) {
    throw new Error("Environment test is not restricted by a selected deployment branch policy.");
  }
  const policies = runJson("gh", ["api",
    `repos/${config.repository}/environments/${environmentName}/deployment-branch-policies`]);
  assertBranchPolicy(policies);
}
function configureEnvironment(config, reviewer) {
  const existing = runJsonOrMissing("gh", ["api",
    `repos/${config.repository}/environments/${environmentName}`], /HTTP 404/);
  if (existing) {
    environment(config, reviewer.id);
    console.log("PASS existing compatible environment protections retained without modification.");
    return;
  }
  runJson("gh", ["api", "--method", "PUT", `repos/${config.repository}/environments/${environmentName}`,
    "-F", "wait_timer=0", "-F", "prevent_self_review=false", "-f", "reviewers[][type]=User",
    "-F", `reviewers[][id]=${reviewer.id}`, "-F", "can_admins_bypass=false", "-F", "deployment_branch_policy[protected_branches]=false",
    "-F", "deployment_branch_policy[custom_branch_policies]=true"]);
  const endpoint = `repos/${config.repository}/environments/${environmentName}/deployment-branch-policies`;
  const policies = runJson("gh", ["api", endpoint]);
  if (!policies.branch_policies?.length) {
    runJson("gh", ["api", "--method", "POST", endpoint, "-f", "name=main", "-f", "type=branch"]);
  } else {
    assertBranchPolicy(policies);
  }
  environment(config, reviewer.id);
}
function azJson(config, args) {
  return runJson("az", [...args, "--subscription", config.subscriptionId, "-o", "json"]);
}
function azMissing(config, args, pattern = /ResourceNotFound/i) {
  return runJsonOrMissing("az", [...args, "--subscription", config.subscriptionId, "-o", "json"], pattern);
}
function assertF1Available(config) {
  const locations = azJson(config, ["appservice", "list-locations", "--sku", "F1",
    "--linux-workers-enabled"]);
  if (!locations?.some((item) =>
    normalizeLocation(item.name ?? item) === normalizeLocation(config.location))) {
    throw new Error(`Linux App Service F1 is unavailable in ${config.location}; no paid SKU fallback is allowed.`);
  }
  const runtimes = azJson(config, ["webapp", "list-runtimes", "--os", "linux"]);
  if (!runtimes?.some((item) => /^NODE[:|]22-lts$/i.test(String(item)))) {
    throw new Error("Linux App Service does not list NODE:22-lts; setup will not guess a runtime.");
  }
}
async function setup(config, options) {
  requireApply(options, "setup");
  requireAzure(config);
  const { metadata, reviewer } = repositoryAndReviewer(config);
  const currentOidc = runJson("gh", ["api", `repos/${config.repository}/actions/oidc/customization/sub`]);
  assertDefaultOidc(currentOidc);
  configureEnvironment(config, reviewer); // Unsupported plans fail before the first Azure mutation.
  if (currentOidc.use_immutable_subject !== true) {
    run("gh", ["api", "--method", "PUT", `repos/${config.repository}/actions/oidc/customization/sub`,
      "-F", "use_default=true", "-F", "use_immutable_subject=true"]);
  }
  const subject = immutableEnvironmentSubject(config, metadata);
  run("az", ["account", "set", "--subscription", config.subscriptionId]);
  for (const namespace of ["Microsoft.Web", "Microsoft.ManagedIdentity"]) {
    const state = run("az", ["provider", "show", "--namespace", namespace, "--subscription",
      config.subscriptionId, "--query", "registrationState", "-o", "tsv"]).stdout;
    if (state !== "Registered") throw new Error(`${namespace} is ${state}; setup does not register providers.`);
  }
  assertF1Available(config);
  const group = azMissing(config, ["group", "show", "--name", config.resourceGroup], /ResourceGroupNotFound/i);
  if (group && group.tags?.WorkshopRunId !== config.runId)
    throw new Error("Refusing a resource group without the exact WorkshopRunId tag.");
  if (!group) run("az", ["group", "create", "--name", config.resourceGroup, "--location",
    config.location, "--subscription", config.subscriptionId, "--tags",
    `WorkshopRunId=${config.runId}`, "Purpose=security-remediation-demo", "-o", "none"]);
  const plan = azMissing(config, ["appservice", "plan", "show", "--name", config.planName, "--resource-group", config.resourceGroup]);
  if (!plan) run("az", ["appservice", "plan", "create", "--name", config.planName,
    "--resource-group", config.resourceGroup, "--location", config.location, "--subscription",
    config.subscriptionId, "--sku", "F1", "--is-linux", "-o", "none"]);
  else if (plan.sku?.name !== "F1") throw new Error("Refusing an existing non-F1 App Service plan.");
  let app = azMissing(config, ["webapp", "show", "--name", config.webAppName, "--resource-group", config.resourceGroup]);
  if (!app) {
    run("az", ["webapp", "create", "--name", config.webAppName, "--resource-group",
      config.resourceGroup, "--plan", config.planName, "--runtime", "NODE:22-lts",
      "--subscription", config.subscriptionId, "-o", "none"]);
    app = azJson(config, ["webapp", "show", "--name", config.webAppName, "--resource-group", config.resourceGroup]);
  }
  run("az", ["webapp", "config", "appsettings", "set", "--name", config.webAppName,
    "--resource-group", config.resourceGroup, "--subscription", config.subscriptionId,
    "--settings", "HOST=0.0.0.0", "SCM_DO_BUILD_DURING_DEPLOYMENT=false", "-o", "none"]);
  run("az", ["webapp", "config", "set", "--name", config.webAppName, "--resource-group",
    config.resourceGroup, "--subscription", config.subscriptionId, "--startup-file", "npm start",
    "--ftps-state", "Disabled", "--min-tls-version", "1.2", "--http20-enabled", "true", "-o", "none"]);
  run("az", ["webapp", "update", "--name", config.webAppName, "--resource-group",
    config.resourceGroup, "--subscription", config.subscriptionId, "--https-only", "true", "-o", "none"]);
  let identity = azMissing(config, ["identity", "show", "--name", config.identityName, "--resource-group", config.resourceGroup]);
  if (!identity) identity = azJson(config, ["identity", "create", "--name", config.identityName, "--resource-group", config.resourceGroup, "--location", config.location]);
  const roles = azJson(config, ["role", "assignment", "list", "--assignee", identity.principalId, "--scope", app.id, "--role", "Website Contributor"]);
  if (!roles.some((role) => role.scope.toLowerCase() === app.id.toLowerCase() &&
      role.roleDefinitionName === "Website Contributor")) {
    run("az", ["role", "assignment", "create", "--assignee-object-id", identity.principalId,
      "--assignee-principal-type", "ServicePrincipal", "--role", "Website Contributor",
      "--scope", app.id, "--subscription", config.subscriptionId, "-o", "none"]);
  }
  const credential = azMissing(config, ["identity", "federated-credential", "show", "--name",
    "github-test", "--identity-name", config.identityName, "--resource-group", config.resourceGroup],
  /ResourceNotFound|not found/i);
  if (credential && (credential.subject !== subject ||
      credential.issuer !== "https://token.actions.githubusercontent.com" ||
      credential.audiences?.join() !== "api://AzureADTokenExchange"))
    throw new Error("Refusing a mismatched existing federated credential.");
  if (!credential) run("az", ["identity", "federated-credential", "create", "--name", "github-test",
    "--identity-name", config.identityName, "--resource-group", config.resourceGroup,
    "--issuer", "https://token.actions.githubusercontent.com", "--subject", subject,
    "--audiences", "api://AzureADTokenExchange", "--subscription", config.subscriptionId, "-o", "none"]);
  const tenantId = run("az", ["account", "show", "--subscription", config.subscriptionId,
    "--query", "tenantId", "-o", "tsv"]).stdout;
  for (const [name, value] of Object.entries({
    AZURE_CLIENT_ID: identity.clientId, AZURE_TENANT_ID: tenantId,
    AZURE_SUBSCRIPTION_ID: config.subscriptionId, AZURE_WEBAPP_NAME: config.webAppName
  })) run("gh", ["variable", "set", name, "--env", environmentName,
    "--repo", config.repository, "--body", value]);
  saveState(config, { repositoryId: metadata.id, ownerId: metadata.owner.id,
    reviewer: { login: reviewer.login, id: reviewer.id, type: reviewer.type } });
  console.log("PASS F1 test app, exact-scope OIDC identity, and required-reviewer environment configured.");
}
async function publish(config, options) {
  requireApply(options, "publish");
  repositoryAndReviewer(config);
  const temporary = mkdtempSync(join(tmpdir(), "pharmacy-release-publish-"));
  const workspace = join(temporary, "repo");
  try {
    run("gh", ["repo", "clone", config.repository, workspace]);
    run("git", ["checkout", "main"], { cwd: workspace });
    const target = join(workspace, ".github", "workflows", "release.yml");
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(demo, "workflows", "release.yml"), target);
    run("git", ["add", ".github/workflows/release.yml"], { cwd: workspace });
    const clean = run("git", ["diff", "--cached", "--quiet"], { cwd: workspace, allowFailure: true });
    if (!clean.ok) {
      run("git", ["-c", "user.name=Synthetic Pharmacy Demo", "-c",
        "user.email=workshop@example.invalid", "commit", "-m",
        commitMessage("Add governed synthetic test release")], { cwd: workspace });
      run("git", ["push", "origin", "main"], { cwd: workspace, capture: false });
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log("PASS published only .github/workflows/release.yml; no fixture or private history copied.");
}
async function release(config, options) {
  requireApply(options, "release");
  if (!/^[0-9a-f]{40}$/.test(config.releaseSha ?? "") || !Number.isSafeInteger(config.prNumber) ||
      config.prNumber < 1) throw new Error("Supply --release-sha and --pr-number.");
  const { metadata, reviewer } = repositoryAndReviewer(config);
  environment(config, reviewer.id);
  const before = runJson("gh", ["run", "list", "--repo", config.repository, "--workflow",
    "release.yml", "--limit", "1", "--json", "databaseId"])[0]?.databaseId ?? 0;
  run("gh", ["workflow", "run", "release.yml", "--repo", config.repository, "--ref", "main",
    "-f", `release_sha=${config.releaseSha}`, "-f", `pr_number=${config.prNumber}`,
    "-f", `run_id=${config.runId}`]);
  let dispatched;
  const deadline = Date.now() + 30_000;
  while (!dispatched && Date.now() < deadline) {
    dispatched = runJson("gh", ["run", "list", "--repo", config.repository, "--workflow",
      "release.yml", "--event", "workflow_dispatch", "--limit", "10",
      "--json", "databaseId,url"]).find((item) => item.databaseId > before);
    if (!dispatched) await delay(2000);
  }
  if (!dispatched) throw new Error("Dispatch succeeded but its workflow run was not discoverable.");
  saveState(config, { repositoryId: metadata.id, ownerId: metadata.owner.id,
    reviewer: { login: reviewer.login, id: reviewer.id, type: reviewer.type },
    releaseSha: config.releaseSha, prNumber: config.prNumber, releaseRunId: dispatched.databaseId });
  console.log(`PASS dispatched ${dispatched.url}; approve its test deployment in GitHub, then run verify.`);
}
async function verify(config) {
  requireAzure(config);
  const { metadata, reviewer } = repositoryAndReviewer(config);
  environment(config, reviewer.id);
  const group = azJson(config, ["group", "show", "--name", config.resourceGroup]);
  if (group.tags?.WorkshopRunId !== config.runId) throw new Error("Azure group ownership tag drifted.");
  const plan = azJson(config, ["appservice", "plan", "show", "--name", config.planName, "--resource-group", config.resourceGroup]);
  if (plan.sku?.name !== "F1") throw new Error("Azure plan is no longer F1.");
  const identity = azJson(config, ["identity", "show", "--name", config.identityName, "--resource-group", config.resourceGroup]);
  const app = azJson(config, ["webapp", "show", "--name", config.webAppName, "--resource-group", config.resourceGroup]);
  const roles = azJson(config, ["role", "assignment", "list", "--assignee", identity.principalId, "--scope", app.id, "--role", "Website Contributor"]);
  if (!roles.some((role) => role.scope.toLowerCase() === app.id.toLowerCase() &&
      role.roleDefinitionName === "Website Contributor")) throw new Error("Exact web-app role is absent.");
  const credential = azJson(config, ["identity", "federated-credential", "show", "--name",
    "github-test", "--identity-name", config.identityName, "--resource-group", config.resourceGroup]);
  if (credential.subject !== immutableEnvironmentSubject(config, metadata) ||
      credential.issuer !== "https://token.actions.githubusercontent.com" ||
      credential.audiences?.join() !== "api://AzureADTokenExchange") {
    throw new Error("Federated credential no longer matches the immutable environment subject.");
  }
  const runs = runJson("gh", ["run", "list", "--repo", config.repository, "--workflow",
    "release.yml", "--limit", "20", "--json", "databaseId,status,conclusion,headSha,url"]);
  const selected = runs.find((item) => item.databaseId === Number(config.releaseRunId));
  if (!selected || selected.status !== "completed" || selected.conclusion !== "success")
    throw new Error("The selected release run is absent or not successful.");
  const artifacts = runJson("gh", ["api",
    `repos/${config.repository}/actions/runs/${selected.databaseId}/artifacts`]).artifacts;
  if (!artifacts.some((item) => item.name === `release-${selected.databaseId}` && !item.expired))
    throw new Error("The run-unique release artifact is absent or expired.");
  const destination = mkdtempSync(join(tmpdir(), "pharmacy-release-verify-"));
  let actual;
  let packageProof;
  try {
    run("gh", ["run", "download", String(selected.databaseId), "--repo", config.repository,
      "--name", `release-${selected.databaseId}`, "--dir", destination]);
    const archive = readFileSync(join(destination, "release.zip"));
    packageProof = inspectReleasePackage(archive);
    actual = packageProof.sha256;
    const expected = readFileSync(join(destination, "release.zip.sha256"), "utf8").trim();
    if (!/^[a-f0-9]{64}\s+release\.zip$/.test(expected) || actual !== expected.split(/\s+/)[0]) {
      throw new Error("Downloaded release package SHA-256 does not match.");
    }
  } finally {
    rmSync(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  const pull = runJson("gh", ["api", `repos/${config.repository}/pulls/${config.prNumber}`]);
  assertReleaseProvenance(packageProof, config, pull, selected);
  const tree = runJson("gh", ["api", `repos/${config.repository}/git/trees/${config.releaseSha}?recursive=1`]);
  const sources = tree.tree.filter((entry) => entry.type === "blob" &&
    (entry.path.startsWith("src/") || entry.path.startsWith("data/") || ["package.json", "package-lock.json"].includes(entry.path)));
  if (tree.truncated || sources.length !== packageProof.sourceBlobs.length ||
      !sources.every((entry) => ["100644", "100755"].includes(entry.mode) &&
        packageProof.sourceBlobs.some((file) => file.path === entry.path && file.sha === entry.sha))) {
    throw new Error("Packaged source differs from the reviewed Git commit.");
  }
  if (!/^[a-z0-9.-]+\.azurewebsites\.net$/i.test(app.defaultHostName)) throw new Error("Unexpected Azure app hostname.");
  const deadline = Date.now() + 180_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    try {
      const response = await fetch(`https://${app.defaultHostName}/health`,
        { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const body = await response.json();
        healthy = body.service === "synthetic-pharmacy" &&
          body.commit === config.releaseSha && body.runId === String(selected.databaseId);
      }
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
      console.log(`WAIT Azure cold start: ${error.name}`);
    }
    if (!healthy) await delay(5000);
  }
  if (!healthy) throw new Error("Azure health did not identify the exact release commit and workflow run.");
  saveState(config, { repositoryId: metadata.id, ownerId: metadata.owner.id,
    reviewer: { login: reviewer.login, id: reviewer.id, type: reviewer.type },
    releaseSha: config.releaseSha, prNumber: config.prNumber, releaseRunId: selected.databaseId });
  console.log(`PASS release ${selected.databaseId} serves ${config.releaseSha}; artifact SHA-256 ${actual}.`);
}
export function assertReleaseProvenance(proof, config, pull, selected) {
  const manifest = proof.manifest;
  if (!pull.merged || pull.merge_commit_sha !== config.releaseSha ||
      pull.base.repo.full_name !== config.repository || manifest.commit !== config.releaseSha ||
      manifest.runId !== String(selected.databaseId) || manifest.sourceRepo !== config.repository ||
      manifest.prNumber !== config.prNumber || manifest.prHead !== pull.head.sha ||
      manifest.workflowSha !== selected.headSha) {
    throw new Error("Package manifest does not match the actual reviewed PR, application and workflow revision.");
  }
}
async function cleanup(config, options) {
  requireApply(options, "cleanup");
  requireAzure(config);
  if (options.confirm !== config.runId) throw new Error(`Cleanup requires --confirm ${config.runId}.`);
  const group = azMissing(config, ["group", "show", "--name", config.resourceGroup], /ResourceGroupNotFound/i);
  if (!group) return console.log("PASS scoped Azure resource group is already absent; GitHub evidence retained.");
  if (group.tags?.WorkshopRunId !== config.runId)
    throw new Error("Refusing cleanup: resource group WorkshopRunId tag does not match.");
  run("az", ["group", "delete", "--name", config.resourceGroup, "--subscription",
    config.subscriptionId, "--yes"], { capture: false, timeout: 900_000 });
  if (run("az", ["group", "exists", "--name", config.resourceGroup, "--subscription",
    config.subscriptionId, "-o", "tsv"]).stdout === "true") throw new Error("Resource group still exists.");
  console.log("PASS deleted only the tagged Azure resource group; repository and issues retained.");
}
async function main() {
  const action = process.argv[2] ?? "plan";
  const options = parseArgs(process.argv.slice(3));
  if (!["plan", "preflight", "setup", "publish", "release", "verify", "cleanup"].includes(action))
    throw new Error("Use plan, preflight, setup, publish, release, verify, or cleanup.");
  const config = loadConfig(options);
  console.log(`PUBLIC synthetic release: ${config.repository}; run ${config.runId}`);
  if (action === "plan") {
    console.log(`GitHub: require verified ${config.reviewer} on environment test; deployments only from main.`);
    console.log(`Azure: ${config.resourceGroup}/${config.webAppName || "<required>"} in ${config.location}, Linux F1 only.`);
    console.log("OIDC: immutable repository-ID environment subject; Website Contributor at exact web-app scope.");
    console.log("Publish: only the reviewed release workflow. Cleanup: tagged Azure group only.");
  } else if (action === "preflight") {
    const missing = ["git", "gh", "az"].filter((tool) => !commandExists(tool));
    if (missing.length) throw new Error(`Missing command(s): ${missing.join(", ")}`);
    requireAzure(config); const { metadata, reviewer } = repositoryAndReviewer(config);
    runJson("gh", ["api", `repos/${config.repository}/environments`]);
    run("az", ["account", "show", "--subscription", config.subscriptionId, "-o", "none"]);
    assertF1Available(config);
    console.log(`PASS live read-only preflight for repository ${metadata.id} and reviewer ${reviewer.login}.`);
  } else if (action === "setup") await setup(config, options);
  else if (action === "publish") await publish(config, options);
  else if (action === "release") await release(config, options);
  else if (action === "verify") await verify(config);
  else await cleanup(config, options);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
