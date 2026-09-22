import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertOwnedTopics,
  demoRoot,
  loadConfig,
  parseArgs,
  requireApply,
  run,
  runJson,
  runJsonOrMissing,
  statePath,
  topic,
  workspaceFor
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
const target = options.target ?? "all";
if (!["github", "azure", "all"].includes(target)) throw new Error("--target must be github, azure, or all");

console.log(`Plan: delete target=${target} only for WorkshopId=${config.workshopId}.`);
console.log(`  GitHub: ${config.repository}`);
console.log(`  Azure:  ${config.resourceGroup}`);
if (!requireApply(options, "destructive cleanup")) process.exit(0);
if (options.confirm !== config.workshopId) {
  throw new Error(`Cleanup requires --confirm ${config.workshopId}`);
}

if (target === "azure" || target === "all") {
  if (!config.subscriptionId) throw new Error("Azure cleanup requires the recorded subscription ID");
  const group = runJsonOrMissing("az", ["group", "show", "--name", config.resourceGroup,
    "--subscription", config.subscriptionId, "-o", "json"], /ResourceGroupNotFound/i);
  if (group) {
    if (group.tags?.WorkshopId !== config.workshopId) {
      throw new Error(`Refusing to delete ${config.resourceGroup}: WorkshopId tag does not match`);
    }
    run("az", ["group", "delete", "--name", config.resourceGroup, "--subscription",
      config.subscriptionId, "--yes"], { capture: false, timeout: 900_000 });
    const stillExists = run("az", ["group", "exists", "--name", config.resourceGroup,
      "--subscription", config.subscriptionId, "-o", "tsv"]).stdout === "true";
    if (stillExists) throw new Error(`Azure resource group ${config.resourceGroup} still exists`);
    console.log(`PASS deleted tagged Azure resource group ${config.resourceGroup}`);
  } else {
    console.log(`PASS Azure resource group ${config.resourceGroup} is already absent`);
  }
}

if (target === "github" || target === "all") {
  const repo = runJsonOrMissing("gh", ["repo", "view", config.repository, "--json", "nameWithOwner"],
    /Could not resolve to a Repository|HTTP 404/i);
  if (repo) {
    const topics = runJson("gh", ["api", `repos/${config.repository}/topics`]);
    assertOwnedTopics(config, topics);
    run("gh", ["repo", "delete", config.repository, "--yes"]);
    const afterDelete = runJsonOrMissing("gh", ["repo", "view", config.repository, "--json",
      "nameWithOwner"], /Could not resolve to a Repository|HTTP 404/i);
    if (afterDelete) throw new Error(`GitHub repository ${config.repository} still exists`);
    console.log(`PASS deleted isolated GitHub repository ${config.repository}`);
  } else {
    console.log(`PASS GitHub repository ${config.repository} is already absent`);
  }
}

for (const suffix of ["", "seed", "red", "advance"]) {
  rmSync(workspaceFor(config, suffix), { recursive: true, force: true });
}
if (existsSync(statePath) && target === "all") rmSync(statePath);
console.log("PASS scoped cleanup complete");
