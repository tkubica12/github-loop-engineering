import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInventory, listStock, reserve } from "../../../../platform/templates/station-repository/src/inventory.mjs";

const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(demoRoot, "..", "..", "..");
const state = JSON.parse(readFileSync(join(demoRoot, "fixtures", "showcase-state.json"), "utf8"));

const required = [
  "docs/slides/agentic-engineering-loop.html",
  "docs/guides/agentic-engineering-loop.html",
  "teacher/demos/agentic-engineering-loop/control-room.html",
  ".github/workflows/repository-pulse.md",
  ".github/workflows/repository-pulse.lock.yml",
  ".github/workflows/showcase-signal.md",
  ".github/workflows/showcase-signal.lock.yml",
  "student/labs/02-intent-to-pr/artifacts/feature-request.md"
];

for (const path of required) {
  readFileSync(join(root, path));
}
for (const scene of state.scenes) {
  const fallbackPath = scene.fallback.split("#")[0];
  readFileSync(resolve(demoRoot, fallbackPath));
}

const inventory = createInventory();
assert.equal(listStock(inventory).find((item) => item.sku === "MED-003").available, 0);
assert.equal(listStock(inventory).find((item) => item.sku === "MED-004").available, 6);
assert.equal(reserve(inventory, { sku: "MED-003", quantity: 1 }).status, 409);
assert.ok(state.scenes.length >= 8);
assert.ok(state.scenes.at(-1).minute <= 58);

console.log(`PASS ${state.title}`);
console.log(`PASS ${required.length} required artifacts`);
console.log("PASS synthetic reservation baseline");
console.log("PASS local evidence or explicit stop condition for every scene");
console.log("NOT EVENT READINESS: live mode requires a fresh live-chain result; recorded mode requires retained evidence. Human sign-off remains required.");
const continuationIndex = process.argv.indexOf("--continuation");
const continuationVerdict = continuationIndex < 0
  ? {
      verdict: "NOT_EXECUTED",
      reason: "Run teacher\\demos\\security-remediation\\scripts\\verify-continuation.mjs during the closing beat and read that live result."
    }
  : {
      verdict: "BLOCKED",
      reason: "Recorded continuation receipts were removed before publication; do not pass retained recordings to the showcase rehearsal."
    };
console.log(`LOOP CONTINUATION: ${continuationVerdict.verdict}. ${continuationVerdict.reason}`);
console.log("CHRONOLOGY: recorded maintenance is source-based post-review and predates deployment; no historical result is upgraded.");
if (continuationVerdict.verdict === "BLOCKED") process.exitCode = 2;
console.log("");
console.log("REHEARSAL CUES");
for (const scene of state.scenes) {
  console.log(`${String(scene.minute).padStart(2, "0")}:00  ${scene.name.padEnd(12)} ${scene.artifact}`);
}
