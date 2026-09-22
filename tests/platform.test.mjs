import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";
import { assertCompilerStamp, compilerProbeVersion, expectedCompilerVersion } from "../platform/scripts/workflow-version.mjs";

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
  const lab = readFileSync(join(root, "student", "labs", "02-intent-to-pr", "index.html"), "utf8");
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
