import {
  assertOwnedTopics,
  loadConfig,
  parseArgs,
  requireApply,
  run,
  runJson,
  saveState,
  topic
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
const sha = options.sha ?? "";
if (!/^[0-9a-f]{40}$/.test(sha)) {
  throw new Error("Pass the exact reviewed main commit as --sha <40-lowercase-hex>");
}

console.log(`Plan: dispatch Manual test release from main for ${sha}.`);
console.log("The release input records operator intent; it is not an environment reviewer approval.");
if (!requireApply(options, "manual test release")) process.exit(0);

const topics = JSON.parse(run("gh", ["api", `repos/${config.repository}/topics`]).stdout);
assertOwnedTopics(config, topics);

const priorRuns = runJson("gh", ["run", "list", "--repo", config.repository,
  "--workflow", "release.yml", "--limit", "1", "--json", "databaseId"]);
run("gh", ["workflow", "run", "release.yml", "--repo", config.repository, "--ref", "main",
  "-f", `release_sha=${sha}`]);
saveState(config, { releaseAfterId: priorRuns[0]?.databaseId ?? 0 });
console.log(`PASS release dispatched; follow https://github.com/${config.repository}/actions/workflows/release.yml`);
