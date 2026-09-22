import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";

const artifacts = join(root, "student", "labs", "04-trusted-delivery", "artifacts");
const read = (name) => readFileSync(join(artifacts, name), "utf8");

test("the starter workflow still carries the injection the lab repairs", () => {
  const starter = read("title-check.starter.yml");
  assert.match(starter, /run:\s*echo "\$\{\{\s*github\.event\.pull_request\.title\s*\}\}"/,
    "the starter must interpolate the title directly into the shell so the exercise starts vulnerable");
  assert.doesNotMatch(starter, /env:/, "the starter must not already bind the title to an environment variable");
});

test("the reference workflow handles the title as data under least privilege", () => {
  const reference = read("title-check.reference.yml");
  assert.match(reference, /env:\s*\n\s*PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/,
    "the title must reach the step through an environment variable");
  assert.match(reference, /run: printf '%s\\n' "\$PR_TITLE"/, "the expansion must be quoted and never shell source");
  assert.doesNotMatch(reference, /run:.*\$\{\{/, "no expression may be interpolated into a run block");
  assert.match(reference, /permissions:\s*\n\s*contents: read/, "the repaired gate stays read-only");
});

test("the unsafe fragment is documentation, not an executable workflow", () => {
  const fragment = read("unsafe-fragment.yml");
  assert.match(fragment, /\$\{\{\s*github\.event/, "the fragment must show the pattern it warns about");
  assert.doesNotMatch(fragment, /^on:/m, "a fragment without a trigger cannot be run by mistake");
});
