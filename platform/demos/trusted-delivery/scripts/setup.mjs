import {
  assertGitHubClassicScopes,
  assertOwnedTopics,
  branch,
  commitMessage,
  copyRepositoryFixture,
  getImmutableMainSubject,
  loadConfig,
  normalizeLocation,
  parseArgs,
  printPlan,
  requireApply,
  requireLiveConfig,
  run,
  runJson,
  runJsonOrMissing,
  runTopic,
  saveState,
  seedRedPullRequest,
  topic,
  workspaceFor
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
const target = options.target ?? "all";
if (!["github", "azure", "all"].includes(target)) throw new Error("--target must be github, azure, or all");

printPlan(config);
if (!requireApply(options, `setup target=${target}`)) process.exit(0);
if (target === "azure" || target === "all") requireLiveConfig(config);

function setupGitHub() {
  assertGitHubClassicScopes();
  const existing = runJsonOrMissing("gh", ["repo", "view", config.repository, "--json",
    "nameWithOwner,isPrivate"], /Could not resolve to a Repository|HTTP 404/i);
  if (existing) {
    const topics = runJson("gh", ["api", `repos/${config.repository}/topics`]);
    assertOwnedTopics(config, topics);
    if (!existing.isPrivate) throw new Error(`Refusing to use non-private repository ${config.repository}`);
    console.log(`PASS existing isolated private repository ${config.repository}`);
  } else {
    run("gh", ["repo", "create", config.repository, "--private",
      "--description", "Isolated synthetic pharmacy trusted-delivery demonstration"]);
    run("gh", ["repo", "edit", config.repository, "--add-topic", topic,
      "--add-topic", runTopic(config), "--add-topic", "synthetic-pharmacy"]);
  }
  const main = runJsonOrMissing("gh", ["api", `repos/${config.repository}/git/ref/heads/main`],
    /Git Repository is empty|HTTP 404|HTTP 409/i);
  if (!main) {
    const refs = runJsonOrMissing("gh", ["api", `repos/${config.repository}/git/matching-refs/heads/`],
      /Git Repository is empty|HTTP 409/i);
    if (refs?.length) throw new Error("Owned repository has branches but no main; refusing to reseed it.");
    const workspace = workspaceFor(config, "seed");
    copyRepositoryFixture(workspace);
    run("git", ["init", "-b", "main"], { cwd: workspace });
    run("git", ["add", "."], { cwd: workspace });
    run("git", ["-c", "user.name=Trusted Delivery Demo", "-c",
      "user.email=trusted-delivery@example.invalid", "commit", "-m",
      commitMessage("Create deterministic pharmacy delivery fixture")], { cwd: workspace });
    run("git", ["remote", "add", "origin", `https://github.com/${config.repository}.git`],
      { cwd: workspace });
    run("git", ["push", "-u", "origin", "main"], { cwd: workspace, capture: false });
  }

  const oidcSettings = runJson("gh", ["api", `repos/${config.repository}/actions/oidc/customization/sub`]);
  if (oidcSettings.use_default === true && oidcSettings.use_immutable_subject === false) {
    run("gh", ["api", "--method", "PUT", `repos/${config.repository}/actions/oidc/customization/sub`,
      "-F", "use_default=true", "-F", "use_immutable_subject=true"]);
  }
  const oidcSubject = getImmutableMainSubject(config.repository);
  console.log(`PASS immutable GitHub OIDC subject ${oidcSubject}`);
  const open = runJson("gh", ["pr", "list", "--repo", config.repository, "--head", branch,
    "--state", "open", "--json", "number,url"]);
  const pullRequest = open?.[0] ?? seedRedPullRequest(config);
  console.log(`PASS red demonstration pull request ${pullRequest.url}`);
}

function setupAzure() {
  assertGitHubClassicScopes();
  const repo = runJson("gh", ["repo", "view", config.repository, "--json", "isPrivate"]);
  const topics = runJson("gh", ["api", `repos/${config.repository}/topics`]);
  assertOwnedTopics(config, topics);
  if (!repo?.isPrivate) {
    throw new Error("Run the scoped GitHub setup before Azure setup");
  }
  run("az", ["account", "set", "--subscription", config.subscriptionId]);
  for (const namespace of ["Microsoft.Web", "Microsoft.ManagedIdentity"]) {
    const registration = run("az", ["provider", "show", "--namespace", namespace,
      "--subscription", config.subscriptionId, "--query", "registrationState", "-o", "tsv"]).stdout;
    if (registration !== "Registered") {
      throw new Error(`${namespace} is ${registration}; setup does not register providers implicitly`);
    }
  }
  const locations = runJson("az", ["appservice", "list-locations", "--sku", "F1",
    "--linux-workers-enabled", "--subscription", config.subscriptionId, "-o", "json"]);
  if (!locations?.some((item) =>
    normalizeLocation(item.name ?? item) === normalizeLocation(config.location))) {
    throw new Error(`Linux App Service F1 is not listed in ${config.location}; setup will not upgrade`);
  }
  const runtimes = runJson("az", ["webapp", "list-runtimes", "--os", "linux",
    "--subscription", config.subscriptionId, "-o", "json"]);
  if (!runtimes?.some((runtime) => /^NODE[:|]22-lts$/i.test(String(runtime)))) {
    throw new Error("Linux App Service does not list NODE:22-lts; setup will not guess a runtime");
  }
  const existingGroup = runJsonOrMissing("az", ["group", "show", "--name", config.resourceGroup,
    "--subscription", config.subscriptionId, "-o", "json"], /ResourceGroupNotFound/i);
  if (existingGroup && existingGroup.tags?.WorkshopId !== config.workshopId) {
    throw new Error(`Refusing to reuse ${config.resourceGroup}: WorkshopId tag does not match`);
  }
  if (!existingGroup) {
    run("az", ["group", "create", "--name", config.resourceGroup, "--location", config.location,
      "--subscription", config.subscriptionId, "--tags", `WorkshopId=${config.workshopId}`,
      "Purpose=trusted-delivery-demo", "-o", "none"]);
  }

  const plan = runJsonOrMissing("az", ["appservice", "plan", "show", "--name", config.appServicePlan,
    "--resource-group", config.resourceGroup, "--subscription", config.subscriptionId, "-o", "json"],
  /ResourceNotFound/i);
  if (!plan) {
    run("az", ["appservice", "plan", "create", "--name", config.appServicePlan,
      "--resource-group", config.resourceGroup, "--location", config.location,
      "--subscription", config.subscriptionId, "--sku", "F1", "--is-linux", "-o", "none"]);
  } else if (plan.sku?.name !== "F1") {
    throw new Error(`Refusing existing non-F1 plan ${config.appServicePlan}`);
  }

  let webApp = runJsonOrMissing("az", ["webapp", "show", "--name", config.webAppName,
    "--resource-group", config.resourceGroup, "--subscription", config.subscriptionId, "-o", "json"],
  /ResourceNotFound/i);
  if (!webApp) {
    run("az", ["webapp", "create", "--name", config.webAppName, "--resource-group",
      config.resourceGroup, "--plan", config.appServicePlan, "--runtime", "NODE:22-lts",
      "--subscription", config.subscriptionId, "-o", "none"]);
    webApp = runJson("az", ["webapp", "show", "--name", config.webAppName,
      "--resource-group", config.resourceGroup, "--subscription", config.subscriptionId, "-o", "json"]);
  }
  run("az", ["webapp", "config", "set", "--name", config.webAppName, "--resource-group",
    config.resourceGroup, "--subscription", config.subscriptionId, "--startup-file", "npm start",
    "--ftps-state", "Disabled", "--min-tls-version", "1.2", "--http20-enabled", "true", "-o", "none"]);
  run("az", ["webapp", "update", "--name", config.webAppName, "--resource-group",
    config.resourceGroup, "--subscription", config.subscriptionId, "--https-only", "true", "-o", "none"]);

  let identity = runJsonOrMissing("az", ["identity", "show", "--name", config.identityName,
    "--resource-group", config.resourceGroup, "--subscription", config.subscriptionId, "-o", "json"],
  /ResourceNotFound/i);
  if (!identity) {
    identity = runJson("az", ["identity", "create", "--name", config.identityName,
      "--resource-group", config.resourceGroup, "--location", config.location,
      "--subscription", config.subscriptionId, "-o", "json"]);
  }

  const role = runJson("az", ["role", "assignment", "list", "--assignee",
    identity.principalId, "--scope", webApp.id, "--role", "Website Contributor",
    "--subscription", config.subscriptionId, "-o", "json"]);
  if (!role.length) {
    run("az", ["role", "assignment", "create", "--assignee-object-id", identity.principalId,
      "--assignee-principal-type", "ServicePrincipal", "--role", "Website Contributor",
      "--scope", webApp.id, "--subscription", config.subscriptionId, "-o", "none"]);
  }

  const credentialName = "github-test";
  const credential = runJsonOrMissing("az", ["identity", "federated-credential", "show", "--name",
    credentialName, "--identity-name", config.identityName, "--resource-group", config.resourceGroup,
    "--subscription", config.subscriptionId, "-o", "json"],
  /ResourceNotFound|FederatedIdentityCredential.*not found/i);
  const expectedSubject = getImmutableMainSubject(config.repository);
  if (credential && (credential.subject !== expectedSubject ||
      credential.issuer !== "https://token.actions.githubusercontent.com" ||
      credential.audiences?.length !== 1 || credential.audiences[0] !== "api://AzureADTokenExchange")) {
    throw new Error("Refusing a federated credential with a mismatched subject, issuer, or audience.");
  }
  if (!credential) {
    run("az", ["identity", "federated-credential", "create", "--name", credentialName,
      "--identity-name", config.identityName, "--resource-group", config.resourceGroup,
      "--issuer", "https://token.actions.githubusercontent.com", "--subject", expectedSubject,
      "--audiences", "api://AzureADTokenExchange", "--subscription", config.subscriptionId,
      "-o", "none"]);
  }

  const tenantId = run("az", ["account", "show", "--subscription", config.subscriptionId,
    "--query", "tenantId", "-o", "tsv"]).stdout;
  for (const [name, value] of Object.entries({
    AZURE_CLIENT_ID: identity.clientId,
    AZURE_TENANT_ID: tenantId,
    AZURE_SUBSCRIPTION_ID: config.subscriptionId,
    AZURE_WEBAPP_NAME: config.webAppName
  })) {
    run("gh", ["variable", "set", name, "--repo", config.repository, "--body", value]);
  }
  console.log(`PASS Azure OIDC subject ${expectedSubject}`);
}

if (target === "github" || target === "all") setupGitHub();
if (target === "azure" || target === "all") setupAzure();
saveState(config);
console.log("PASS setup complete; no agent or paid SKU was enabled");
