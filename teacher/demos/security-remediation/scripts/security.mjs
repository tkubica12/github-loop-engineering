import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assertGitHubClassicScopes, commitMessage, parseArgs, run, runJson,
  runJsonOrMissing, waitForRun
} from "../../trusted-delivery/scripts/lib.mjs";

const demo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(demo, "fixture", "repository");
const action = process.argv[2] ?? "plan";
const options = parseArgs(process.argv.slice(3));
const repository = options.repo ?? process.env.SECURITY_DEMO_REPOSITORY;
const runId = options["run-id"] ?? process.env.SECURITY_DEMO_RUN_ID;
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository ?? "")) throw new Error("Supply --repo OWNER/REPO.");
if (!/^[a-z0-9][a-z0-9-]{2,38}$/.test(runId ?? "")) throw new Error("Supply --run-id with 3-39 lowercase letters, digits, or hyphens.");
if (!["plan", "setup", "inspect", "publish-maintenance", "cleanup"].includes(action)) {
  throw new Error("Use plan, setup, inspect, publish-maintenance, or cleanup.");
}
if (options.expect !== undefined && !["finding", "clean"].includes(options.expect)) {
  throw new Error("--expect must be finding or clean.");
}
const topics = ["workshop-synthetic-pharmacy", `run-${runId}`];
const files = [
  ".gitattributes", ".gitignore", "AGENTS.md", "LICENSE", "README.md", "package.json", "package-lock.json",
  ".github/workflows/quality.yml", ".github/workflows/codeql.yml",
  "data/stock.json", "src/inventory.mjs", "src/server.mjs", "test/server.test.mjs"
];
const stateDirectory = join(demo, ".state");
const statePath = join(stateDirectory, `${runId}.json`);

function assertOwned(metadata) {
  if (metadata.private || metadata.full_name.toLowerCase() !== repository.toLowerCase() ||
      !topics.every((topic) => metadata.topics?.includes(topic))) {
    throw new Error("Refusing a repository that is not public and labelled for this exact workshop run.");
  }
}

function saveState(value) {
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`);
}

console.log(`PUBLIC synthetic demonstration: ${repository}`);
console.log(`Run: ${runId}; only ${files.length} allowlisted fixture files are publishable.`);
console.log("No private workshop history, documentation, credentials, or tenant identifiers are copied.");
console.log("The starter contains an intentional export-path flaw. No deployment workflow is included.");

if (action === "plan") {
  console.log(files.join("\n"));
  process.exit(0);
}

if (action === "setup") {
  for (const file of files) {
    const text = readFileSync(join(fixture, file), "utf8");
    if (/github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{30,}/.test(text) ||
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)) {
      throw new Error(`Refusing credential-shaped or tenant-identifier-shaped content in ${file}.`);
    }
  }
  run(process.execPath, ["--test"], { cwd: fixture });
  if (!options.apply) {
    console.log("PLAN ONLY: --apply --allow-public is required to create and seed the public repository.");
    process.exit(0);
  }
  if (!options["allow-public"]) throw new Error("Explicit --allow-public consent is required.");
  assertGitHubClassicScopes();
  let metadata = runJsonOrMissing("gh", ["api", `repos/${repository}`], /HTTP 404/);
  if (metadata) assertOwned(metadata);
  else {
    run("gh", ["repo", "create", repository, "--public",
      "--description", "Synthetic pharmacy engineering demo: real CodeQL finding and governed remediation. No real customer data."]);
    run("gh", ["repo", "edit", repository, "--add-topic", topics[0], "--add-topic", topics[1]]);
    metadata = runJson("gh", ["api", `repos/${repository}`]);
    assertOwned(metadata);
  }
  const prior = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  if (prior && (prior.repository !== repository || prior.repositoryId !== metadata.id)) {
    throw new Error("The saved run belongs to a different repository identity.");
  }
  saveState({ repository, repositoryId: metadata.id, runId, visibility: "public", baselineSha: prior?.baselineSha ?? null });
  const main = runJsonOrMissing("gh", ["api", `repos/${repository}/git/ref/heads/main`], /HTTP 404|HTTP 409/);
  if (!main) {
    const branches = runJson("gh", ["api", `repos/${repository}/branches`]);
    if (branches.length) throw new Error("Refusing to seed a repository that already has other branches.");
    const temporary = mkdtempSync(join(tmpdir(), "pharmacy-public-"));
    try {
      for (const file of files) {
        const target = join(temporary, file);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(fixture, file), target);
      }
      run("git", ["init", "--initial-branch=main"], { cwd: temporary });
      run("git", ["add", "."], { cwd: temporary });
      run("git", ["-c", "user.name=Synthetic Pharmacy Demo", "-c", "user.email=workshop@example.invalid",
        "commit", "-m", commitMessage("Seed isolated synthetic pharmacy security exercise")], { cwd: temporary });
      run("git", ["remote", "add", "origin", `https://github.com/${repository}.git`], { cwd: temporary });
      run("git", ["push", "--set-upstream", "origin", "main"], { cwd: temporary, capture: false });
    } finally {
      rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  const head = run("gh", ["api", `repos/${repository}/commits/main`, "--jq", ".sha"]).stdout;
  saveState({ repository, repositoryId: metadata.id, runId, visibility: "public", baselineSha: prior?.baselineSha ?? head });
  console.log(`READY source only: https://github.com/${repository} at ${head}. It has not been deployed.`);
} else if (action === "inspect") {
  assertOwned(runJson("gh", ["api", `repos/${repository}`]));
  const head = run("gh", ["api", `repos/${repository}/commits/main`, "--jq", ".sha"]).stdout;
  const workflow = await waitForRun(repository, "codeql.yml", head, "main", 0, 1_200_000);
  if (workflow.conclusion !== "success") throw new Error(`CodeQL workflow did not succeed: ${workflow.url}`);
  const analyses = runJson("gh", ["api", "--paginate", "--slurp",
    `repos/${repository}/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100`]).flat();
  const analysis = analyses.find((item) => item.commit_sha === head && item.tool?.name === "CodeQL");
  if (!analysis || analysis.error) throw new Error("No successful CodeQL analysis matches the current main commit.");
  const alerts = runJson("gh", ["api", "--paginate", "--slurp",
    `repos/${repository}/code-scanning/alerts?state=open&ref=refs%2Fheads%2Fmain&per_page=100`]).flat();
  const evidence = {
    kind: "live-codeql-observation", capturedAt: new Date().toISOString(), repository, commit: head,
    workflow, analysis: { id: analysis.id, commit: analysis.commit_sha, tool: analysis.tool.name, category: analysis.category },
    alerts: alerts.map((alert) => ({
      number: alert.number, url: alert.html_url, state: alert.state, rule: alert.rule.id,
      severity: alert.rule.security_severity_level ?? alert.rule.severity,
      location: alert.most_recent_instance?.location
    }))
  };
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(join(stateDirectory, `${runId}-codeql.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  if (options.expect === "finding" && !evidence.alerts.some((alert) => alert.rule === "js/path-injection")) {
    throw new Error("The expected native CodeQL path-injection finding was not observed.");
  }
  if (options.expect === "clean" && evidence.alerts.length) throw new Error("Open CodeQL alerts still block release.");
  if (options.expect === "finding") {
    const baselinePath = join(stateDirectory, `${runId}-baseline.json`);
    if (!existsSync(baselinePath)) writeFileSync(baselinePath,
      `${JSON.stringify({ ...evidence, openAlerts: evidence.alerts }, null, 2)}\n`, { flag: "wx" });
    console.log(`BASELINE retained at ${baselinePath}`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} else if (action === "publish-maintenance") {
  if (!options.apply) {
    console.log("PLAN ONLY: publish the bounded experimental OpenCode follow-up workflow with --apply.");
    process.exit(0);
  }
  assertOwned(runJson("gh", ["api", `repos/${repository}`]));
  const compiler = run("gh", ["aw", "version"]);
  if ([compiler.stdout, compiler.stderr].filter(Boolean).join("\n") !== "gh aw version v0.86.2") {
    throw new Error("Publishing requires the reviewed gh-aw v0.86.2 compiler.");
  }
  assertGitHubClassicScopes();
  const temporary = mkdtempSync(join(tmpdir(), "pharmacy-maintenance-"));
  const checkout = join(temporary, "repo");
  try {
    run("gh", ["repo", "clone", repository, checkout]);
    run("git", ["checkout", "main"], { cwd: checkout });
    cpSync(join(demo, "workflows", "maintenance.md"), join(checkout, ".github", "workflows", "maintenance.md"));
    writeFileSync(join(checkout, ".github", "workflows", "aw.json"), '{"maintenance":false}\n');
    run("gh", ["aw", "compile", "maintenance", "--validate"], { cwd: checkout, capture: false });
    const lock = readFileSync(join(checkout, ".github", "workflows", "maintenance.lock.yml"), "utf8");
    if (!lock.includes("COPILOT_GITHUB_TOKEN: ${{ github.token }}") || /secrets\.COPILOT_GITHUB_TOKEN/.test(lock)) {
      throw new Error("Maintenance must use the native token, not a copied personal credential.");
    }
    const imported = join(checkout, ".github", "aw", "imports", "github", "gh-aw",
      "48e5fa3ff52294d91d97715017a9f8693a48387f");
    mkdirSync(imported, { recursive: true });
    cpSync(resolve(demo, "..", "..", "..", ".github", "aw", "imports", "github", "gh-aw",
      "48e5fa3ff52294d91d97715017a9f8693a48387f", "LICENSE"), join(imported, "LICENSE"));
    run("git", ["add", ".github"], { cwd: checkout });
    const changed = run("git", ["diff", "--cached", "--quiet"], { cwd: checkout, allowFailure: true });
    if (!changed.ok) {
      run("git", ["-c", "user.name=Synthetic Pharmacy Demo", "-c", "user.email=workshop@example.invalid",
        "commit", "-m", commitMessage("Add bounded post-review maintenance through OpenCode")], { cwd: checkout });
      run("git", ["push", "origin", "main"], { cwd: checkout, capture: false });
    }
    console.log("PUBLISHED maintenance; no model request was dispatched.");
  } finally {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
} else {
  if (!options.apply) {
    console.log("PLAN ONLY: cleanup retains public evidence. To delete the isolated repository, pass --apply --delete-repository --confirm RUN-ID.");
    process.exit(0);
  }
  if (!options["delete-repository"] || options.confirm !== runId) {
    throw new Error("Deletion requires --delete-repository and exact --confirm RUN-ID.");
  }
  assertOwned(runJson("gh", ["api", `repos/${repository}`]));
  run("gh", ["repo", "delete", repository, "--yes"]);
  console.log(`DELETED only ${repository}; local evidence is retained.`);
}
