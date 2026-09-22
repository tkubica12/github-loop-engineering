import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  assertOwnedTopics,
  branch,
  commitMessage,
  loadConfig,
  parseArgs,
  repositoryFixture,
  requireApply,
  run,
  topic,
  workspaceFor
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
console.log(`Plan: replace the safe boundary regression on ${branch} in ${config.repository}.`);
if (!requireApply(options, "advance red pull request to green")) process.exit(0);

const topics = JSON.parse(run("gh", ["api", `repos/${config.repository}/topics`]).stdout);
assertOwnedTopics(config, topics);

const workspace = workspaceFor(config, "advance");
rmSync(workspace, { recursive: true, force: true });
mkdirSync(dirname(workspace), { recursive: true });
run("gh", ["repo", "clone", config.repository, workspace], { capture: false });
run("git", ["checkout", branch], { cwd: workspace });
cpSync(join(repositoryFixture, "src", "reservations.mjs"),
  join(workspace, "src", "reservations.mjs"));
cpSync(join(repositoryFixture, "test", "quantity-contract.test.mjs"),
  join(workspace, "test", "quantity-contract.test.mjs"));
run("git", ["add", "src/reservations.mjs", "test/quantity-contract.test.mjs"], { cwd: workspace });
const changed = run("git", ["diff", "--cached", "--quiet"], {
  cwd: workspace,
  allowFailure: true
});
if (changed.ok) {
  console.log("PASS branch already contains the corrected boundary");
  process.exit(0);
}
run("git", ["-c", "user.name=Trusted Delivery Demo", "-c",
  "user.email=trusted-delivery@example.invalid", "commit", "-m",
  commitMessage("Reject zero-quantity reservations")], { cwd: workspace });
run("git", ["push", "origin", branch], { cwd: workspace, capture: false });
console.log("PASS corrective commit pushed; deterministic CI should move from red to green");
