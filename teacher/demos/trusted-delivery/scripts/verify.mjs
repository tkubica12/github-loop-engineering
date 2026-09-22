import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertOwnedTopics,
  branch,
  loadConfig,
  localFixtureTest,
  parseArgs,
  repositoryFixture,
  run,
  runJson,
  topic,
  waitForRun
} from "./lib.mjs";

const options = parseArgs();
const config = loadConfig(options);
const expectation = options.expect ?? "local";
if (!["local", "red", "green", "rejected", "deployed"].includes(expectation)) throw new Error("Unknown verification expectation.");
const failures = [];

try {
  localFixtureTest();
} catch {
  failures.push("fixture tests do not pass");
}

for (const workflow of ["ci.yml", "release.yml"]) {
  const content = readFileSync(join(repositoryFixture, ".github", "workflows", workflow), "utf8");
  for (const match of content.matchAll(/uses:\s*([^\s#]+)/g)) {
    if (!/@[0-9a-f]{40}$/.test(match[1])) failures.push(`${workflow} has an unpinned action: ${match[1]}`);
  }
  if (/pull_request_target:/.test(content)) failures.push(`${workflow} uses pull_request_target`);
}

const release = readFileSync(join(repositoryFixture, ".github", "workflows", "release.yml"), "utf8");
const beforeDeploy = release.split("deploy-test:")[0];
const deploy = release.split("deploy-test:")[1] ?? "";
if (/id-token:\s*write/.test(beforeDeploy)) failures.push("id-token: write appears before deploy-test");
if (!/deploy-test:[\s\S]*id-token:\s*write/.test(release)) {
  failures.push("deploy-test is missing id-token: write");
}
if (!/RELEASE_SHA.*GITHUB_SHA/s.test(release)) failures.push("release does not bind input SHA to main SHA");

if (expectation !== "local") {
  const repo = runJson("gh", ["repo", "view", config.repository, "--json", "isPrivate,nameWithOwner"]);
  if (!repo?.isPrivate) failures.push("remote repository is not private");
  const topics = runJson("gh", ["api", `repos/${config.repository}/topics`]);
  assertOwnedTopics(config, topics);

  if (expectation === "red" || expectation === "green") {
    const pulls = runJson("gh", ["pr", "list", "--repo", config.repository, "--head", branch,
      "--state", "open", "--json", "number,headRefOid"]);
    if (pulls.length !== 1) throw new Error("Expected exactly one open demonstration pull request.");
    const head = pulls[0].headRefOid;
    const runState = await waitForRun(config.repository, "ci.yml", head, branch);
    const currentHead = run("gh", ["pr", "view", String(pulls[0].number), "--repo", config.repository,
      "--json", "headRefOid", "--jq", ".headRefOid"]).stdout;
    if (currentHead !== head) throw new Error("The pull request changed during verification; rerun for its new head.");
    const expectedConclusion = expectation === "red" ? "failure" : "success";
    if (runState?.conclusion !== expectedConclusion) {
      failures.push(`latest CI conclusion is ${runState?.conclusion || runState?.status || "unknown"}, expected ${expectedConclusion}`);
    } else if (expectation === "red") {
      console.log(`PASS red CI evidence ${runState.url}`);
    } else {
      console.log(`PASS ${expectation} CI evidence ${runState.url}`);
    }
  }

  if (expectation === "rejected") {
    const main = runJson("gh", ["api", `repos/${config.repository}/commits/main`]);
    const releaseRun = await waitForRun(config.repository, "release.yml", main.sha, "main", config.releaseAfterId);
    const jobs = runJson("gh", ["api", `repos/${config.repository}/actions/runs/${releaseRun.databaseId}/jobs?per_page=100`]);
    if (releaseRun.conclusion !== "failure" ||
        jobs.jobs.find((job) => job.name === "gate")?.conclusion !== "failure" ||
        ["package", "deploy-test"].some((name) => jobs.jobs.find((job) => job.name === name)?.conclusion !== "skipped")) {
      failures.push("The negative release must fail at the gate and skip packaging and deployment.");
    } else {
      console.log(`PASS rejected SHA; package and deployment skipped ${releaseRun.url}`);
    }
  }

  if (expectation === "deployed") {
    if (!config.webAppName) failures.push("web app name is not available in state or arguments");
    const main = runJson("gh", ["api", `repos/${config.repository}/commits/main`]);
    const releaseRun = await waitForRun(config.repository, "release.yml", main.sha, "main", config.releaseAfterId);
    if (releaseRun.conclusion !== "success") {
      failures.push(`release conclusion is ${releaseRun.conclusion}`);
    } else {
      console.log(`PASS GitHub deployment evidence ${releaseRun.url}`);
    }
    if (config.webAppName) {
      const host = run("az", ["webapp", "show", "--name", config.webAppName,
        "--resource-group", config.resourceGroup, "--subscription", config.subscriptionId,
        "--query", "defaultHostName", "-o", "tsv"]).stdout;
      if (!/^[a-z0-9.-]+\.azurewebsites\.net$/i.test(host)) throw new Error("Azure returned an unexpected app hostname.");
      let verified = false;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !verified) {
        let response;
        try {
          response = await fetch(`https://${host}/health`, {
            signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now())))
          });
        } catch (error) {
          if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
          console.log(`WAIT Azure test app: ${error.name}; cold-start budget is two minutes.`);
          await delay(5000);
          continue;
        }
        if ([429, 502, 503, 504].includes(response.status)) {
          console.log(`WAIT Azure test app returned HTTP ${response.status}.`);
          await response.body?.cancel();
          await delay(5000);
          continue;
        }
        if (!response.ok) throw new Error(`Azure health failed with HTTP ${response.status}.`);
        const body = await response.json();
        if (body.service !== "synthetic-pharmacy-reservations") throw new Error("Unexpected Azure service identity.");
        if (body.commit === main.sha && body.runId === String(releaseRun.databaseId)) {
          verified = true;
          console.log(`PASS live Azure health https://${host}/health (${body.commit})`);
        } else {
          console.log("WAIT Azure is still serving an older package.");
          await delay(5000);
        }
      }
      if (!verified) failures.push("Azure did not serve the exact main SHA and release run within two minutes.");
    }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log(expectation === "local"
  ? "PASS local fixture, action pinning, SHA gate, and OIDC permission boundary"
  : `PASS trusted delivery verification (${expectation})`);
