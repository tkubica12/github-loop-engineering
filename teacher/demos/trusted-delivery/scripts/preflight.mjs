import {
  assertGitHubClassicScopes,
  commandExists,
  loadConfig,
  localFixtureTest,
  normalizeLocation,
  parseArgs,
  requireLiveConfig,
  run,
  runJson
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
const failures = [];

if (Number(process.versions.node.split(".")[0]) < 22) failures.push("Node.js 22 or newer is required");
try {
  localFixtureTest();
  console.log("PASS local deterministic pharmacy tests");
} catch {
  failures.push("local deterministic pharmacy tests failed");
}

if (options.live) {
  for (const command of ["git", "gh", "az"]) {
    if (!commandExists(command)) failures.push(`${command} is not installed or not on PATH`);
  }
}

if (options.live && failures.length === 0) {
  try {
    requireLiveConfig(config);
    const login = runJson("gh", ["api", "user"]);
    console.log(`PASS GitHub authentication as ${login.login}`);
    assertGitHubClassicScopes();
    const account = runJson("az", ["account", "show", "--subscription", config.subscriptionId,
      "--output", "json"]);
    console.log(`PASS Azure authentication for subscription ${account.name}`);

    for (const namespace of ["Microsoft.Web", "Microsoft.ManagedIdentity"]) {
      const registration = run("az", ["provider", "show", "--namespace", namespace,
        "--subscription", config.subscriptionId, "--query", "registrationState", "-o", "tsv"]).stdout;
      if (registration !== "Registered") {
        failures.push(`${namespace} provider is ${registration}; register it before setup`);
      }
    }

    const locations = runJson("az", ["appservice", "list-locations", "--sku", "F1",
      "--linux-workers-enabled", "--subscription", config.subscriptionId, "-o", "json"]);
    if (!locations?.some((item) =>
      normalizeLocation(item.name ?? item) === normalizeLocation(config.location))) {
      failures.push(`Linux App Service F1 is not listed in ${config.location}; choose a listed region`);
    } else {
      console.log(`PASS Linux App Service F1 is listed in ${config.location}`);
    }
    const runtimes = runJson("az", ["webapp", "list-runtimes", "--os", "linux",
      "--subscription", config.subscriptionId, "-o", "json"]);
    if (!runtimes?.some((runtime) => /^NODE[:|]22-lts$/i.test(String(runtime)))) {
      failures.push("Linux App Service does not list NODE:22-lts in the selected subscription");
    } else {
      console.log("PASS Linux App Service lists NODE:22-lts");
    }
    run("az", ["identity", "federated-credential", "create", "--help"]);
  } catch (error) {
    failures.push(error.message);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}

console.log(options.live
  ? "PASS live preflight; no resources were changed"
  : "PASS local preflight; use --live to check GitHub and Azure without mutation");
