import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { root } from "./validation.mjs";
import {
  assertOwnedTopics, azureMsiInvocation, normalizeLocation, selectRunForSha
} from "../platform/demos/trusted-delivery/scripts/lib.mjs";

const demo = join(root, "platform", "demos", "trusted-delivery");
const repository = join(demo, "fixture", "repository");

function read(...parts) {
  return readFileSync(join(...parts), "utf8");
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if ([".state.json", ".workspace", ".git"].includes(entry)) return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("local trusted delivery fixture and permission boundary verify", () => {
  const output = execFileSync(process.execPath, [
    join(demo, "scripts", "verify.mjs"),
    "--expect",
    "local"
  ], { cwd: root, encoding: "utf8" });
  assert.match(output, /PASS local fixture, action pinning, SHA gate, and OIDC permission boundary/);
});

test("seeded regression is safe, specific, and red", async () => {
  const red = await import(`${pathToFileURL(join(demo, "fixture", "red", "reservations.mjs"))}?test=red`);
  assert.equal(red.createReservation({ sku: "MED-001", quantity: 0 }).status, 201);
  const fixed = await import(`${pathToFileURL(join(repository, "src", "reservations.mjs"))}?test=fixed`);
  assert.equal(fixed.createReservation({ sku: "MED-001", quantity: 0 }).status, 400);
  assert.equal(fixed.createReservation({ sku: "REAL-PATIENT-DATA", quantity: 1 }).status, 404);
});

test("synthetic service exposes a working health endpoint", async () => {
  const { server } = await import(`${pathToFileURL(join(repository, "src", "server.mjs"))}?test=health`);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      service: "synthetic-pharmacy-reservations",
      status: "ok"
    });
    const oversized = await fetch(`http://127.0.0.1:${address.port}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "MED-001", padding: "x".repeat(17_000) })
    });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});

test("workflows pin actions and isolate the OIDC permission", () => {
  const ci = read(repository, ".github", "workflows", "ci.yml");
  const release = read(repository, ".github", "workflows", "release.yml");
  for (const workflow of [ci, release]) {
    const uses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(uses.length > 0);
    assert.ok(uses.every((action) => /@[0-9a-f]{40}$/.test(action)));
    assert.doesNotMatch(workflow, /pull_request_target:/);
  }
  assert.equal((release.match(/id-token:\s*write/g) ?? []).length, 1);
  assert.doesNotMatch(release, /^\s+environment:/m);
  assert.match(release, /RELEASE_SHA[\s\S]*GITHUB_SHA/);
  assert.match(release, /release-\$\{\{ needs\.gate\.outputs\.release_sha \}\}/);
  assert.doesNotMatch(release, /secrets\./);
});

test("remote scripts default to plans and cleanup has two guards", () => {
  const common = [
    "--workshop-id", "trusted-delivery-test",
    "--repo", "tkubica12/trusted-delivery-test",
    "--app-name", "ghw-trusted-delivery-test"
  ];
  const setup = execFileSync(process.execPath, [
    join(demo, "scripts", "setup.mjs"),
    "--target", "github",
    ...common
  ], { cwd: root, encoding: "utf8" });
  assert.match(setup, /PLAN ONLY/);

  const cleanup = execFileSync(process.execPath, [
    join(demo, "scripts", "cleanup.mjs"),
    ...common
  ], { cwd: root, encoding: "utf8" });
  assert.match(cleanup, /PLAN ONLY/);
  const cleanupSource = read(demo, "scripts", "cleanup.mjs");
  assert.match(cleanupSource, /options\.confirm !== config\.workshopId/);
  assert.match(cleanupSource, /WorkshopId tag does not match/);
  assert.match(cleanupSource, /assertOwnedTopics/);
  const setupSource = read(demo, "scripts", "setup.mjs");
  const librarySource = read(demo, "scripts", "lib.mjs");
  assert.match(setupSource, /getImmutableMainSubject/);
  assert.match(librarySource, /use_immutable_subject !== true/);
  assert.match(librarySource, /repo:\$\{metadata\.owner\.login\}@\$\{metadata\.owner\.id\}/);
  assert.doesNotMatch(setupSource, /repo:\$\{config\.repository\}:/);
});

test("operator and lab distinguish live evidence from recorded examples", () => {
  const operator = readFileSync(join(demo, "operator-guide.html"), "utf8");
  const lab = readFileSync(join(root, "docs", "labs", "04-trusted-delivery", "index.html"), "utf8");
  for (const html of [operator, lab]) {
    assert.doesNotMatch(html, /evidence\.html/);
    assert.match(html, /recorded/i);
    assert.match(html, /OIDC/i);
  }
  assert.match(operator, /Live (?:path|run)/i);
  assert.match(operator, /not (?:an )?independent (?:protected-environment )?approval/i);
  assert.match(operator, /F1/);
  assert.match(operator, /no production (?:claim|deployment is represented)/i);
  assert.match(lab, /not your station.s scan/i);
  assert.match(lab, /not proof that your change was deployed/i);
});

test("demo contains no committed credential-shaped values or non-synthetic pharmacy data", () => {
  const content = walk(demo).map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(content, /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/);
  assert.doesNotMatch(content, /client-secret:/i);
  assert.match(content, /Synthetic Alternative Inhaler/);
});

test("Windows Azure MSI launcher preserves arguments without a shell", () => {
  const invocation = azureMsiInvocation("C:\\Program Files\\Azure\\CLI2\\wbin\\az.cmd",
    ["webapp", "config", "set", "--startup-file", "npm start"]);
  assert.equal(invocation.file, "C:\\Program Files\\Azure\\CLI2\\python.exe");
  assert.deepEqual(invocation.args, ["-IBm", "azure.cli", "webapp", "config", "set", "--startup-file", "npm start"]);
});

test("Azure display location and canonical location match", () => {
  assert.equal(normalizeLocation("West Europe"), normalizeLocation("westeurope"));
  assert.notEqual(normalizeLocation("West US"), normalizeLocation("westeurope"));
});

test("stale successful CI cannot satisfy another head SHA", () => {
  const old = { databaseId: 1, headSha: "a".repeat(40), conclusion: "success", status: "completed" };
  const current = { databaseId: 2, headSha: "b".repeat(40), conclusion: "", status: "queued" };
  assert.equal(selectRunForSha([old], current.headSha), undefined);
  assert.equal(selectRunForSha([old, current], current.headSha), current);
  assert.notEqual(current.status, "completed");
  assert.equal(selectRunForSha([old], old.headSha, 1), undefined);
});

test("remote ownership requires this exact workshop run", () => {
  const config = { repository: "example/demo", workshopId: "td-check" };
  assert.throws(() => assertOwnedTopics(config, { names: ["workshop-trusted-delivery", "run-another"] }), /run-td-check/);
  assert.doesNotThrow(() => assertOwnedTopics(config, { names: ["workshop-trusted-delivery", "run-td-check"] }));
});
