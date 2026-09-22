import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(demo, "..", "..", "..");
export const continuationProposal = join(demo, "continuation", "test", "export-name.test.mjs");
const digest = (content) => createHash("sha256").update(String(content).replaceAll("\r\n", "\n")).digest("hex");
const snapshotPaths = [
  "fixture/repository/src/inventory.mjs",
  "fixture/repository/data/stock.json",
  "fixture/repository/package.json",
  "solution/src/server.mjs",
  "solution/test/server.test.mjs"
];

export function verifyContinuation(proposal = continuationProposal) {
  const historicalPath = join(demo, "evidence", "maintenance.json");
  const historical = JSON.parse(readFileSync(historicalPath, "utf8"));
  const snapshot = Object.fromEntries(snapshotPaths.map((path) => [
    path, digest(readFileSync(join(demo, path)))
  ]));
  const receipt = {
    schemaVersion: 1,
    kind: "local-maintenance-verification",
    sourceHashFormat: "sha256-utf8-lf",
    capturedAt: new Date().toISOString(),
    producer: {
      kind: "retained-historical-github-recommendation",
      repository: historical.repository,
      issueUrl: historical.issue.url,
      reviewedCommit: historical.reviewedCommit,
      workflowRunUrl: historical.workflow.url,
      receiptSha256: digest(readFileSync(historicalPath))
    },
    localSnapshot: snapshot,
    proposal: {
      path: relative(repository, proposal).split("\\").join("/"),
      sha256: existsSync(proposal) ? digest(readFileSync(proposal)) : null
    },
    checks: [],
    verdict: "blocked",
    reason: "",
    authority: "Local deterministic verification only; not GitHub CI, human approval, merge or deployment."
  };
  const workspaceRoot = join(repository, ".workshop");
  mkdirSync(workspaceRoot, { recursive: true });
  const temporary = mkdtempSync(join(workspaceRoot, "pharmacy-continuation-"));
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  function check(id, args, expectedExitCode) {
    const started = performance.now();
    const result = spawnSync(process.execPath, args, {
      cwd: temporary, encoding: "utf8", env, timeout: 30_000, maxBuffer: 1024 * 1024
    });
    const record = {
      id, command: `node ${args.join(" ")}`, expectedExitCode,
      exitCode: result.status, signal: result.signal,
      durationMs: Math.round(performance.now() - started),
      stdout: result.stdout ?? "", stderr: result.stderr ?? "",
      ...(result.error ? { executionError: result.error.message } : {})
    };
    record.passed = !result.error && result.signal === null && result.status === expectedExitCode;
    receipt.checks.push(record);
    return record.passed;
  }
  try {
    cpSync(join(demo, "fixture", "repository"), temporary, { recursive: true });
    cpSync(join(demo, "solution"), temporary, { recursive: true });
    if (!check("original-suite", ["--test", "--test-reporter=tap"], 0)) {
      receipt.reason = "The original local solution suite failed; do not delegate from unknown baseline evidence.";
      return receipt;
    }
    if (!existsSync(proposal)) {
      receipt.reason = "The maintenance regression proposal is absent; passing original tests do not complete this task.";
      return receipt;
    }
    cpSync(proposal, join(temporary, "test", "export-name.test.mjs"));
    if (!check("proposal-suite", ["--test", "--test-reporter=tap"], 0)) {
      receipt.verdict = "failed";
      receipt.reason = "The original external suite plus the proposed regression does not pass.";
      return receipt;
    }
    const serverPath = join(temporary, "src", "server.mjs");
    const original = readFileSync(serverPath, "utf8");
    const branch = 'json(response, 400, { error: "invalid export name" });';
    if (original.split(branch).length !== 2) {
      receipt.reason = "The bounded malformed-name branch is not uniquely identifiable; inspect the changed source.";
      return receipt;
    }
    for (const [id, replacement] of [
      ["detects-wrong-status", 'json(response, 500, { error: "invalid export name" });'],
      ["detects-wrong-body", 'json(response, 400, { error: "incorrect export error" });']
    ]) {
      writeFileSync(serverPath, original.replace(branch, replacement));
      if (!check(id, ["--test", "--test-reporter=tap", "test/export-name.test.mjs"], 1)) {
        receipt.verdict = "failed";
        receipt.reason = `The new regression does not reject ${id}; the named criterion is not adequately verified.`;
        return receipt;
      }
    }
    receipt.verdict = "verified";
    receipt.reason = "Original behavior passes; the new regression rejects both wrong status and wrong body in owned disposable copies.";
    return receipt;
  } finally {
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--report")) {
    throw new Error("Usage: node verify-continuation.mjs [--report <new-report.json>]");
  }
  const reportPath = args.length ? resolve(args[1]) : null;
  if (reportPath && existsSync(reportPath)) throw new Error("Report already exists; preserve the prior execution receipt.");
  const receipt = verifyContinuation();
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  console.log(`${receipt.verdict.toUpperCase()} local maintenance verification: ${receipt.reason}`);
  for (const check of receipt.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.command} (exit ${check.exitCode})`);
  }
  if (receipt.verdict !== "verified") process.exitCode = 1;
}
