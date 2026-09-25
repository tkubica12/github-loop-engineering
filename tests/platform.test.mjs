import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";
import { assertCompilerStamp, compilerProbeVersion, expectedCompilerVersion } from "../platform/scripts/workflow-version.mjs";
import { issueBody, loadBacklog, missingLabels, planSeed } from "../platform/scripts/backlog.mjs";

test("sandbox profile renders and verifies a station", () => {
  const output = execFileSync(process.execPath, [
    join(root, "platform", "scripts", "workshop.mjs"),
    "verify",
    "--profile",
    "sandbox",
    "--station",
    "test01"
  ], { cwd: root, encoding: "utf8" });
  assert.match(output, /PASS rendered station workshop-lab-test01/);
});

test("enterprise example keeps organization-specific values configurable", () => {
  const profile = JSON.parse(readFileSync(join(root, "platform", "profiles", "enterprise.example.json"), "utf8"));
  assert.equal(profile.owner, "REPLACE_WITH_STUDENT_ORGANIZATION");
  assert.equal(profile.allowRemoteProvision, false);
  assert.equal(profile.allowRemoteSeed, true, "Enterprise stations are provisioned by owners but still need the synthetic backlog");
  assert.equal(profile.stationMode, "per-team");
});

test("sandbox remote provision requires explicit apply", () => {
  const output = execFileSync(process.execPath, [
    join(root, "platform", "scripts", "workshop.mjs"),
    "provision",
    "--profile",
    "sandbox",
    "--station",
    "test01"
  ], { cwd: root, encoding: "utf8" });
  assert.match(output, /PLAN ONLY/);
});

test("profile traversal is rejected and concrete enterprise config is ignored", () => {
  assert.throws(() => execFileSync(process.execPath, [
    join(root, "platform", "scripts", "workshop.mjs"),
    "cleanup",
    "--profile",
    "..",
    "--station",
    "test01",
    "--apply"
  ], { cwd: root, stdio: "pipe" }));
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^platform\/profiles\/enterprise\.json$/m);
});

test("station template carries reproducible Agentic Workflow inputs", () => {
  const template = join(root, "platform", "templates", "station-repository");
  const attributes = readFileSync(join(template, ".gitattributes"), "utf8");
  const workflowConfig = JSON.parse(readFileSync(join(template, ".github", "workflows", "aw.json"), "utf8"));
  const actionsLock = JSON.parse(readFileSync(join(template, ".github", "aw", "actions-lock.json"), "utf8"));

  assert.match(attributes, /\.github\/workflows\/\*\.lock\.yml/);
  assert.equal(workflowConfig.maintenance, false);
  assert.equal(actionsLock.entries["github/gh-aw-actions/setup@v0.86.2"].sha, "6aab9e5b5c91c615506061f09bedd81a23babe3c");
  assert.doesNotThrow(() => readFileSync(join(template, ".github", "workflows", "showcase-signal.md")));
  assert.doesNotThrow(() => readFileSync(join(template, ".github", "workflows", "showcase-signal.lock.yml")));
  for (const name of ["repository-pulse", "showcase-signal"]) {
    assert.equal(assertCompilerStamp(readFileSync(join(template, ".github", "workflows", `${name}.lock.yml`), "utf8"), name),
      expectedCompilerVersion);
  }
});

test("preflight refuses missing or drifted compiled workflow stamps", () => {
  assert.throws(() => assertCompilerStamp("name: Not generated", "test"), /missing/);
  assert.throws(() => assertCompilerStamp('# gh-aw-metadata: {"compiler_version":"v0.1.0"}', "test"),
    /expected v0\.86\.2/);
  assert.throws(() => assertCompilerStamp("# gh-aw-metadata: invalid JSON", "test"));
});

test("an unavailable optional compiler preserves the verified compiled fallback", () => {
  for (const code of ["ETIMEDOUT", "ENOENT"]) {
    assert.equal(compilerProbeVersion({ error: { code }, status: null }), `unavailable (${code})`);
  }
  assert.equal(compilerProbeVersion({ status: 1 }), "unavailable");
  assert.equal(compilerProbeVersion({ status: 0, stdout: "", stderr: "gh-aw v0.86.2" }), expectedCompilerVersion);
});

test("primary harnesses use Copilot without an Anthropic dependency", () => {
  const template = join(root, "platform", "templates", "station-repository");
  for (const directory of [root, template]) {
    for (const name of ["repository-pulse", "showcase-signal"]) {
      const source = readFileSync(join(directory, ".github", "workflows", `${name}.md`), "utf8");
      assert.match(source, /^engine: copilot$/m);
      assert.doesNotMatch(source, /ANTHROPIC_API_KEY/);
      assert.match(source, /copilot-requests:\s*write/);
    }
  }
  const lab = readFileSync(join(root, "docs", "labs", "02-intent-to-pr", "index.html"), "utf8");
  assert.match(lab, /Copilot/);
  assert.match(readFileSync(join(template, "AGENTS.md"), "utf8"), /Copilot.*OpenCode/);
  assert.match(readFileSync(join(template, ".github", "CODEOWNERS"), "utf8"), /\/AGENTS\.md/);
});

test("verification preserves an existing station and cleanup rejects an unowned directory", () => {
  const station = `safety-${process.pid}`;
  const directory = join(root, ".workshop", `workshop-lab-${station}`);
  assert.equal(existsSync(directory), false);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "keep.txt"), "Unrelated learner work");
  const invoke = (command, extra = []) => execFileSync(process.execPath, [
    join(root, "platform", "scripts", "workshop.mjs"), command,
    "--profile", "sandbox", "--station", station, ...extra
  ], { cwd: root, encoding: "utf8", stdio: "pipe" });
  try {
    assert.match(invoke("verify"), /PASS rendered station/);
    assert.equal(readFileSync(join(directory, "keep.txt"), "utf8"), "Unrelated learner work");
    assert.throws(() => invoke("render"), /Station already exists/);
    assert.throws(() => invoke("cleanup", ["--apply"]), /ownership marker is missing/);
    assert.equal(readFileSync(join(directory, "keep.txt"), "utf8"), "Unrelated learner work");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backlog seed plan is idempotent and never duplicates existing work", () => {
  const backlog = loadBacklog(join(root, "platform", "templates", "station-backlog.json"));
  const first = planSeed(backlog, []);
  assert.ok(first.every((item) => item.action === "create"));
  const created = backlog.issues.map((issue, index) => ({ number: index + 1, title: issue.title, body: issueBody(issue) }));
  assert.ok(planSeed(backlog, created).every((item) => item.action === "skip" && item.reason === "seed marker present"));
  const renamed = [{ number: 9, title: "Renamed by a facilitator", body: issueBody(backlog.issues[0]) }];
  assert.equal(planSeed(backlog, renamed)[0].action, "skip");
  const manual = [{ number: 10, title: backlog.issues[1].title, body: "Created by hand" }];
  assert.equal(planSeed(backlog, manual)[1].reason, "same title already exists");
  assert.ok(planSeed(backlog, null).every((item) => item.action === "unverified"));
  assert.deepEqual(missingLabels(backlog, ["backlog"]).map((label) => label.name), ["workshop-seed"]);
  assert.deepEqual(missingLabels(backlog, ["Backlog", "Workshop-Seed"]), [], "GitHub label names are case-insensitive");
  assert.doesNotMatch(JSON.stringify(backlog), /substitut|alternative|suggest/i,
    "The seeded backlog must not pre-plan the Lab 2 requirement");
});

test("backlog seed is dry-run by default and refuses unsafe apply targets", () => {
  const invoke = (extra) => execFileSync(process.execPath, [
    join(root, "platform", "scripts", "workshop.mjs"), "seed", "--profile", "sandbox", "--station", "test01", ...extra
  ], { cwd: root, encoding: "utf8", stdio: "pipe" });
  const output = invoke(["--offline"]);
  assert.match(output, /workshop-lab-test01/);
  assert.match(output, /UNVERIFIED \[Backlog\] Alert when stock falls below a threshold/);
  assert.match(output, /DRY RUN/);
  assert.throws(() => invoke(["--offline", "--apply"]), /cannot apply offline/);
  assert.throws(() => invoke(["--repository", "tkubica12/github-loop-engineering", "--apply"]),
    /applies only to tkubica12\/workshop-lab-test01/);
  assert.throws(() => invoke(["--repository", "tkubica12/workshop-lab-other", "--apply"]),
    /applies only to tkubica12\/workshop-lab-test01/, "A different station repository is refused");
});

test("station intake context, coaching agent, and path-scoped instructions stay consistent", () => {
  const template = join(root, "platform", "templates", "station-repository");
  const read = (...parts) => readFileSync(join(template, ...parts), "utf8");
  const agent = read(".github", "agents", "requirement-refiner.agent.md");
  const frontmatter = agent.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  assert.match(frontmatter, /^name: requirement-refiner$/m);
  assert.match(frontmatter, /^description: .+/m);
  assert.match(frontmatter, /^tools: \["read", "search"\]$/m);
  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  assert.match(agent, /CONFIRMED:/);
  assert.doesNotMatch(agent, /MED-00\d|same[- ]category|lowest SKU|ordered by SKU|substitut/i,
    "The coach must not contain the Lab 2 answer");

  for (const [file, glob] of [
    ["inventory.instructions.md", "src/**/*.mjs"],
    ["tests.instructions.md", "test/**/*.mjs"],
    ["intake-context.instructions.md", "context/**"]
  ]) {
    assert.match(read(".github", "instructions", file), new RegExp(`^---\\r?\\napplyTo: "${glob.replaceAll("*", "\\*")}"\\r?\\n---`), file);
  }
  assert.match(read(".github", "CODEOWNERS"), /^\/context\/ /m);

  const context = ["chat-thread.md", "ticket-digest.md", "stakeholder-email.md"].map((name) => read("context", "intake", name)).join("\n");
  assert.doesNotMatch(context, /Suggest an available substitute|suggestion/i, "Context must not quote the confirmed contract");
  const backlog = loadBacklog(join(root, "platform", "templates", "station-backlog.json"));
  const ids = new Set(backlog.issues.map((issue) => issue.id));
  const digest = read("context", "intake", "ticket-digest.md");
  for (const [pattern, id] of [
    [/low-stock alert[^|]*\| Duplicate of backlog/i, "low-stock-alert"],
    [/Unconfirmed reservations[^|]*\| Duplicate of backlog/i, "reservation-expiry"],
    [/too bright[^|]*\| Duplicate of backlog/i, "dashboard-dark-mode"],
    [/spreadsheet[^|]*\| Duplicate of backlog/i, "audit-csv-export"]
  ]) {
    assert.match(digest, pattern);
    assert.ok(ids.has(id), `Backlog noise '${id}' must be seeded`);
  }
  assert.equal(existsSync(join(template, "feature-request.md")), false);
  for (const file of ["AGENTS.md", "CLAUDE.md", join(".github", "copilot-instructions.md"),
    ...readdirSync(join(template, ".github", "instructions")).map((name) => join(".github", "instructions", name))]) {
    if (existsSync(join(template, file))) {
      assert.doesNotMatch(read(file), /substitut|same[- ]category|lowest SKU/i, `${file} must not settle the Lab 2 refinement`);
    }
  }
});
