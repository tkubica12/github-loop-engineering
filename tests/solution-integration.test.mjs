import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";

test("lab artifacts preserve the complete station service", () => {
  mkdirSync(join(root, ".workshop"), { recursive: true });
  const ownedRoot = mkdtempSync(join(root, ".workshop", "solution-test-"));
  const ownership = join(ownedRoot, ".owner");
  writeFileSync(ownership, "tests/solution-integration.test.mjs");
  const station = join(ownedRoot, "station");
  try {
    cpSync(join(root, "platform", "templates", "station-repository"), station, { recursive: true });
    cpSync(
      join(root, "student", "labs", "02-intent-to-pr", "artifacts", "inventory.reference.mjs"),
      join(station, "src", "inventory.mjs")
    );
    cpSync(
      join(root, "student", "labs", "02-intent-to-pr", "artifacts", "suggestion.test.mjs"),
      join(station, "test", "suggestion.test.mjs")
    );
    const { NODE_TEST_CONTEXT: _testContext, ...cleanEnvironment } = process.env;
    const result = spawnSync(process.execPath, [
      "--test",
      join(station, "test", "inventory.test.mjs"),
      join(station, "test", "public.test.mjs"),
      join(station, "test", "server.test.mjs"),
      join(station, "test", "suggestion.test.mjs")
    ], { cwd: station, encoding: "utf8", env: cleanEnvironment });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unit: selects the first eligible same-category SKU without mutation/);
    assert.match(result.stdout, /http: returns one suggestion without reserving it/);
  } finally {
    assert.equal(readFileSync(ownership, "utf8"), "tests/solution-integration.test.mjs");
    rmSync(ownedRoot, { recursive: true, force: true });
  }
});
