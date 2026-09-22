import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryFixture = join(demoRoot, "fixture", "repository");
export const redFixture = join(demoRoot, "fixture", "red", "reservations.mjs");
export const statePath = join(demoRoot, ".state.json");
export const topic = "workshop-trusted-delivery";
export const branch = "demo/reservation-zero-boundary";
export const runTopic = (config) => `run-${config.workshopId}`;
export const commitMessage = (subject) => process.env.WORKSHOP_COMMIT_TRAILERS
  ? `${subject}\n\n${process.env.WORKSHOP_COMMIT_TRAILERS}` : subject;

export function assertOwnedTopics(config, topics) {
  for (const expected of [topic, runTopic(config)]) {
    if (!topics?.names.includes(expected)) throw new Error(`Refusing ${config.repository}: topic ${expected} is absent`);
  }
}

export function normalizeLocation(value) {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function readState() {
  if (!existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function cleanName(value, label) {
  if (!/^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/.test(value)) {
    throw new Error(`${label} must contain 4-40 lowercase letters, digits, or hyphens`);
  }
  return value;
}

export function loadConfig(options = {}) {
  const state = readState();
  const workshopId = cleanName(
    options["workshop-id"] ??
      process.env.TRUSTED_DELIVERY_WORKSHOP_ID ??
      state.workshopId ??
      "trusted-delivery-demo",
    "workshop id"
  );
  const repository =
    options.repo ??
    process.env.TRUSTED_DELIVERY_REPOSITORY ??
    state.repository ??
    `tkubica12/${workshopId}`;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must be OWNER/REPOSITORY");
  }
  const resourceStem = workshopId.slice(0, 32);
  return {
    workshopId,
    repository,
    owner: repository.split("/")[0],
    repositoryName: repository.split("/")[1],
    subscriptionId:
      options.subscription ??
      process.env.AZURE_SUBSCRIPTION_ID ??
      state.subscriptionId ??
      "",
    location:
      options.location ??
      process.env.AZURE_LOCATION ??
      state.location ??
      "westeurope",
    webAppName:
      options["app-name"] ??
      process.env.AZURE_WEBAPP_NAME ??
      state.webAppName ??
      "",
    resourceGroup: `rg-${resourceStem}`,
    appServicePlan: `asp-${resourceStem}`,
    identityName: `id-${resourceStem}`,
    releaseAfterId: state.repository === repository ? (state.releaseAfterId ?? 0) : 0,
    workspace: join(demoRoot, ".workspace", workshopId)
  };
}

export function saveState(config, extra = {}) {
  writeFileSync(statePath, `${JSON.stringify({ ...config, workspace: undefined, ...extra }, null, 2)}\n`);
}

export function commandExists(command) {
  const invocation = resolveCommand(command, ["--version"]);
  if (process.platform === "win32" && command === "az" && invocation.file !== "az") {
    return existsSync(invocation.file);
  }
  const probe = spawnSync(invocation.file, invocation.args, {
    encoding: "utf8", shell: false, env: invocation.env, timeout: 30_000
  });
  if (probe.error && probe.error.code !== "ENOENT") throw probe.error;
  return !probe.error && probe.status === 0;
}

export function azureMsiInvocation(launcher, args) {
  return { file: win32.resolve(win32.dirname(launcher), "..", "python.exe"),
    args: ["-IBm", "azure.cli", ...args] };
}

function resolveCommand(command, args) {
  if (process.platform !== "win32" || command !== "az") return { file: command, args };
  const found = spawnSync("where.exe", ["az.cmd"], { encoding: "utf8", shell: false });
  if (found.error) throw found.error;
  if (found.status !== 0) return { file: command, args };
  const launcher = found.stdout.trim().split(/\r?\n/)[0];
  const invocation = azureMsiInvocation(launcher, args);
  if (!existsSync(invocation.file)) throw new Error("Use the Azure CLI Windows MSI installation; its Python launcher is missing.");
  return { ...invocation, env: { ...process.env, AZ_INSTALLER: "MSI" } };
}

export function run(command, args, options = {}) {
  const toolArgs = command === "git" && args[0] === "push"
    ? ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
      "-c", "http.https://github.com/.extraheader=", ...args]
    : args;
  const invocation = resolveCommand(command, toolArgs);
  const result = spawnSync(invocation.file, invocation.args, {
    cwd: options.cwd ?? demoRoot,
    encoding: "utf8",
    shell: false,
    env: invocation.env,
    timeout: options.timeout ?? 180_000,
    stdio: options.capture === false ? "inherit" : "pipe"
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${detail ? `\n${detail}` : ""}`);
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
}

export function runJson(command, args, options = {}) {
  const result = run(command, args, options);
  return result.ok && result.stdout ? JSON.parse(result.stdout) : null;
}

export function runJsonOrMissing(command, args, missingPattern) {
  const result = run(command, args, { allowFailure: true });
  if (result.ok) return result.stdout ? JSON.parse(result.stdout) : null;
  const detail = `${result.stdout}\n${result.stderr}`.trim();
  if (missingPattern.test(detail)) return null;
  throw new Error(`${command} ${args.join(" ")} failed\n${detail}`);
}

export function assertGitHubClassicScopes(required = ["repo", "workflow"]) {
  const response = run("gh", ["api", "--include", "user"]);
  const header = response.stdout.match(/^x-oauth-scopes:\s*(.*)$/im);
  if (!header || !header[1].trim()) {
    console.log("INFO GitHub token scopes are not exposed; capability checks remain authoritative");
    return;
  }
  const scopes = header[1].split(",").map((scope) => scope.trim());
  const missing = required.filter((scope) => !scopes.includes(scope));
  if (missing.length) {
    const source = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
      ? "environment token"
      : "active gh credential";
    throw new Error(`${source} lacks required classic scope(s): ${missing.join(", ")}`);
  }
  console.log(`PASS GitHub classic scopes include ${required.join(" and ")}`);
}

export function getImmutableMainSubject(repository) {
  const metadata = runJson("gh", ["api", `repos/${repository}`]);
  const settings = runJson("gh", ["api", `repos/${repository}/actions/oidc/customization/sub`]);
  if (settings?.use_default !== true || settings?.use_immutable_subject !== true) {
    throw new Error("Repository must use GitHub's default immutable OIDC subject");
  }
  if (!Number.isSafeInteger(metadata.owner.id) || !Number.isSafeInteger(metadata.id)) {
    throw new Error("GitHub did not return valid immutable owner and repository IDs.");
  }
  const prefix =
    `repo:${metadata.owner.login}@${metadata.owner.id}/${metadata.name}@${metadata.id}`;
  if (settings.sub_claim_prefix && settings.sub_claim_prefix !== prefix) {
    throw new Error(`GitHub OIDC subject prefix differs from repository IDs: ${settings.sub_claim_prefix}`);
  }
  return `${prefix}:ref:refs/heads/main`;
}

export function requireApply(options, operation) {
  if (!options.apply) {
    console.log(`PLAN ONLY: ${operation} makes no changes without --apply.`);
    return false;
  }
  return true;
}

export function requireLiveConfig(config) {
  if (!/^[0-9a-f-]{36}$/i.test(config.subscriptionId)) {
    throw new Error("Provide a real Azure subscription ID with --subscription or AZURE_SUBSCRIPTION_ID");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(config.webAppName)) {
    throw new Error("Provide a globally unique lowercase web app name with --app-name or AZURE_WEBAPP_NAME");
  }
}

export function printCommand(command, args) {
  const quoted = args.map((value) =>
    /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)
  );
  console.log(`  ${command} ${quoted.join(" ")}`);
}

export function printPlan(config) {
  console.log("Trusted delivery isolated plan");
  console.log(`  workshop id:      ${config.workshopId}`);
  console.log(`  private repo:     ${config.repository}`);
  console.log(`  resource group:   ${config.resourceGroup}`);
  console.log(`  app service plan: ${config.appServicePlan} (Linux F1 only)`);
  console.log(`  web app:          ${config.webAppName || "(required before Azure apply)"}`);
  console.log(`  identity:         ${config.identityName}`);
  console.log(`  region:           ${config.location}`);
  console.log(`  cleanup guard:    tag WorkshopId=${config.workshopId}`);
  console.log("");
  console.log("Mutation sequence (not executed):");
  printCommand("gh", ["repo", "create", config.repository, "--private"]);
  printCommand("az", ["group", "create", "--name", config.resourceGroup, "--location", config.location,
    "--tags", `WorkshopId=${config.workshopId}`, "Purpose=trusted-delivery-demo"]);
  printCommand("az", ["appservice", "plan", "create", "--name", config.appServicePlan,
    "--resource-group", config.resourceGroup, "--location", config.location, "--sku", "F1", "--is-linux"]);
  printCommand("az", ["webapp", "create", "--name", config.webAppName || "<required>",
    "--resource-group", config.resourceGroup, "--plan", config.appServicePlan, "--runtime", "NODE:22-lts"]);
  printCommand("az", ["identity", "create", "--name", config.identityName,
    "--resource-group", config.resourceGroup]);
  console.log("  az role assignment create --role \"Website Contributor\" --scope <exact-web-app-id>");
  console.log("  gh api --method PUT repos/<owner>/<repo>/actions/oidc/customization/sub -F use_default=true -F use_immutable_subject=true");
  console.log("  az identity federated-credential create --subject repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:refs/heads/main ...");
  console.log("  gh variable set AZURE_{CLIENT_ID,TENANT_ID,SUBSCRIPTION_ID,WEBAPP_NAME}");
  console.log("");
  console.log("Estimated live setup: 6-12 minutes. F1 has no compute charge while available, but subscription");
  console.log("quotas, outbound traffic, logs, and future SKU changes can incur cost. Setup never upgrades SKU.");
}

export function copyRepositoryFixture(destination) {
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  cpSync(repositoryFixture, destination, { recursive: true });
  // The proposal contributes these checks even after its refactor is corrected.
  rmSync(join(destination, "test", "quantity-contract.test.mjs"));
}

export function workspaceFor(config, suffix = "") {
  return suffix ? `${config.workspace}-${suffix}` : config.workspace;
}

export function currentMainSha(repository) {
  return run("gh", ["api", `repos/${repository}/commits/main`, "--jq", ".sha"]).stdout;
}

export function selectRunForSha(runs, sha, afterId = 0) {
  return runs.find((run) => run.headSha === sha && (run.databaseId ?? 0) > afterId);
}

export async function waitForRun(repository, workflow, sha, branchName, afterId = 0, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  console.log(`Waiting up to ${timeoutMs === 300_000 ? "five" : timeoutMs / 60_000} minutes for ${workflow} on ${sha}.`);
  while (Date.now() < deadline) {
    const runs = runJson("gh", ["run", "list", "--repo", repository, "--workflow", workflow,
      "--commit", sha, ...(branchName ? ["--branch", branchName] : []), "--limit", "10",
      "--json", "databaseId,headSha,status,conclusion,url"]);
    const current = selectRunForSha(runs, sha, afterId);
    if (current?.status === "completed") return current;
    await delay(5000);
  }
  throw new Error(`Timed out waiting for ${workflow} on ${sha}; inspect Actions and rerun verification, not setup.`);
}

export function seedRedPullRequest(config) {
  const workspace = workspaceFor(config, "red");
  rmSync(workspace, { force: true, recursive: true });
  mkdirSync(dirname(workspace), { recursive: true });
  run("gh", ["repo", "clone", config.repository, workspace], { capture: false });
  run("git", ["checkout", "main"], { cwd: workspace });
  run("git", ["checkout", "-B", branch], { cwd: workspace });
  cpSync(redFixture, join(workspace, "src", "reservations.mjs"));
  cpSync(join(repositoryFixture, "test", "quantity-contract.test.mjs"),
    join(workspace, "test", "quantity-contract.test.mjs"));
  run("git", ["add", "src/reservations.mjs", "test/quantity-contract.test.mjs"], { cwd: workspace });
  run("git", ["-c", "user.name=Trusted Delivery Demo", "-c",
    "user.email=trusted-delivery@example.invalid", "commit", "-m",
    commitMessage("Refactor reservation quantity validation")], { cwd: workspace });
  run("git", ["push", "--force-with-lease", "-u", "origin", branch], {
    cwd: workspace,
    capture: false
  });
  const existing = runJson("gh", ["pr", "list", "--repo", config.repository, "--head", branch,
    "--state", "open", "--json", "number,url"]);
  if (existing?.length) return existing[0];
  const url = run("gh", ["pr", "create", "--repo", config.repository, "--head", branch,
    "--base", "main", "--title", "Refactor reservation quantity validation", "--body",
    "Bounded demo change. The deterministic test deliberately exposes a safe zero-quantity boundary regression."]).stdout;
  return { url };
}

export function localFixtureTest() {
  execFileSync(process.execPath, ["--test"], {
    cwd: repositoryFixture,
    encoding: "utf8",
    stdio: "pipe"
  });
}
