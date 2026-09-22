import {
  assertOwnedTopics,
  branch,
  loadConfig,
  parseArgs,
  requireApply,
  run,
  runJson,
  runJsonOrMissing,
  seedRedPullRequest,
  topic
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
console.log(`Plan: close the demonstration PR, replace only ${branch}, and recreate the red state.`);
console.log("Azure resources and main are preserved.");
if (!requireApply(options, "reset demonstration pull request")) process.exit(0);

const topics = runJson("gh", ["api", `repos/${config.repository}/topics`]);
assertOwnedTopics(config, topics);

const pulls = runJson("gh", ["pr", "list", "--repo", config.repository, "--head", branch,
  "--state", "open", "--json", "number"]);
for (const pull of pulls) {
  run("gh", ["pr", "close", String(pull.number), "--repo", config.repository]);
}
const ref = runJsonOrMissing("gh", ["api", `repos/${config.repository}/git/ref/heads/${branch}`], /HTTP 404/);
if (ref) run("gh", ["api", "--method", "DELETE", `repos/${config.repository}/git/refs/heads/${branch}`]);
const pullRequest = seedRedPullRequest(config);
console.log(`PASS reset to red pull request ${pullRequest.url}`);
