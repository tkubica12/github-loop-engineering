import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { digest, workId, reconcileLoop, transactLoop, readLoop, resetLoop, reconcilePublication, publishLoop, loopLimits, validateLoopState, LOOP_LIMITS } from "../platform/templates/station-repository/scripts/loop-state.mjs";
import { validateTelemetry } from "../platform/templates/station-repository/scripts/loop-intake.mjs";
import { markedIssueBody, reconcileMarkedIssue } from "../platform/templates/station-repository/scripts/loop-issue-adapter.mjs";

const identity = { profile: "sandbox", station: "controller-test", repository: "owner/test", objectiveId: "malformed-export", contractVersion: 1 };
const base = { identity, applicationRevision: "a".repeat(40), evidenceDigest: digest("trusted task"), owner: "station maintainer", now: "2026-09-15T12:00:00Z", event: "intake" };
const receipt = (state, exitCode = 0) => ({ trusted: true, kind: "task", workId: state.workId, applicationRevision: state.applicationRevision, evidenceDigest: state.evidenceDigest, attempt: state.attempts, command: "node --test trusted-test.mjs", exitCode, scopeValid: true });
const verify = (state, exitCode = 0, extra = {}) => reconcileLoop(state, { ...base, event: "verify", receipt: receipt(state, exitCode), ...extra });
async function owned(t) {
  const root = resolve(".workshop", "loop-controller-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("controller defaults match compact policy and explicit contract limits are persisted", async () => {
  const contract = JSON.parse(await readFile(resolve("templates", "loop-contract.json"), "utf8"));
  const declared = { maxAttempts: contract.limits.maxAttempts, deadlineHours: contract.limits.escalationAfterHours };
  assert.deepEqual(LOOP_LIMITS, declared, "Changing teaching defaults requires updating and validating runtime defaults");
  assert.deepEqual(loopLimits(contract.limits), declared);
  const result = reconcileLoop(null, { ...base, limits: contract.limits });
  assert.equal(result.dispatch, true);
  assert.deepEqual(result.state.limits, declared);
  assert.equal(Date.parse(result.state.deadline) - Date.parse(result.state.startedAt), declared.deadlineHours * 3600000);
});

test("reserve before dispatch, externally verify, and accepted duplicate is no-op without output or attempts", () => {
  const first = reconcileLoop(null, base);
  assert.equal(first.dispatch, true);
  assert.equal(first.state.attempts, 1);
  const accepted = verify(first.state);
  assert.equal(accepted.decision, "report");
  const replay = reconcileLoop(accepted.state, { ...base, workflowRevision: "b".repeat(40) });
  assert.equal(replay.decision, "no-op");
  assert.equal(replay.dispatch, false);
  assert.equal(replay.state.attempts, 1);
  const again = reconcileLoop(replay.state, base);
  assert.deepEqual(again.state, replay.state);
});

test("only exact trusted task failure authorizes one repair, then accountable escalation", () => {
  const first = reconcileLoop(null, base).state;
  const failed = verify(first, 1);
  assert.equal(failed.decision, "retry");
  assert.equal(failed.dispatch, false);
  const repair = reconcileLoop(failed.state, base);
  assert.equal(repair.dispatch, true);
  assert.equal(repair.state.attempts, 2);
  const exhausted = verify(repair.state, 1);
  assert.equal(exhausted.decision, "escalated");
  assert.match(exhausted.reason, /station maintainer/);
  assert.equal(reconcileLoop(exhausted.state, base).dispatch, false);
});

test("invalid, missing, setup, stale, wrong SHA and tampered scope evidence never authorize repair", () => {
  const state = reconcileLoop(null, base).state;
  for (const patch of [{ trusted: false }, { kind: "setup" }, { applicationRevision: "b".repeat(40) },
    { scopeValid: false }, { scopeValid: undefined }, { scopeValid: "true" }, { stale: true }, { stale: "false" },
    { attempt: 0 }, { evidenceDigest: digest("other") },
    { workId: digest("other") }, { command: "" }, { exitCode: null }]) {
    const result = verify(state, 1, { receipt: { ...receipt(state, 1), ...patch } });
    assert.equal(result.decision, "blocked");
    assert.equal(reconcileLoop(result.state, base).dispatch, false);
  }
  assert.equal(verify(state, 1, { receipt: null }).decision, "blocked");
  assert.equal(reconcileLoop(null, { ...base, evidenceDigest: null }).decision, "blocked");
  assert.equal(reconcileLoop(state, { ...base, applicationRevision: "b".repeat(40) }).decision, "blocked");
});

test("waiting, cancellation and deadline spend no additional attempts", () => {
  const waiting = reconcileLoop(null, { ...base, event: "waiting-human" });
  assert.equal(waiting.state.attempts, 0);
  assert.equal(reconcileLoop(waiting.state, base).decision, "waiting-human");
  const expired = reconcileLoop(waiting.state, { ...base, now: "2026-09-16T12:00:00Z" });
  assert.equal(expired.decision, "escalated");
  assert.match(expired.reason, /owner: station maintainer/);
  const stopped = reconcileLoop(waiting.state, { ...base, event: "stop" });
  assert.equal(reconcileLoop(stopped.state, base).decision, "stopped");
});

test("fresh process reads reservation, accepted receipt and replay without resetting budget", async (t) => {
  const directory = await owned(t);
  const inputFile = join(directory, "input.json");
  const invoke = async (input, command = "step") => {
    await writeFile(inputFile, JSON.stringify(input));
    return JSON.parse(execFileSync(process.execPath, ["platform/scripts/loop.mjs", command, directory, inputFile], { encoding: "utf8" }));
  };
  const first = await invoke(base);
  const interrupted = await invoke(base);
  assert.equal(interrupted.decision, "blocked");
  assert.equal(interrupted.priorDigest, first.stateDigest);
  const fail = await invoke({ ...base, event: "verify", receipt: receipt(first.state, 1) });
  const repair = await invoke(base);
  assert.equal(fail.decision, "retry");
  assert.equal(repair.state.attempts, 2);
  await invoke({ ...base, event: "verify", receipt: receipt(repair.state) });
  const replay = await invoke({ ...base, workflowRevision: "changed-only-workflow" });
  assert.equal(replay.decision, "no-op");
  assert.equal(replay.state.attempts, 2);
  await writeFile(join(directory, "learner-file"), "preserve");
  assert.equal((await invoke(base, "reset")).removed, true);
  assert.equal(await readFile(join(directory, "learner-file"), "utf8"), "preserve");
  assert.equal((await invoke(base)).state.attempts, 1);
});

test("two stations are isolated, serialization rejects concurrent duplicate, corrupt state fails explicit", async (t) => {
  const directory = await owned(t);
  const outcomes = await Promise.allSettled([1, 2].map(() => transactLoop({ directory, identity, input: base })));
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  const secondIdentity = { ...identity, station: "another-station" };
  const second = await transactLoop({ directory, identity: secondIdentity, input: { ...base, identity: secondIdentity } });
  assert.equal(second.state.attempts, 1);
  assert.notEqual(second.state.workId, workId(identity));
  await resetLoop({ directory, identity });
  assert.equal((await readLoop({ directory, identity: secondIdentity })).attempts, 1);
  await writeFile(join(directory, `${workId(identity)}.json`), JSON.stringify(second.state));
  await assert.rejects(transactLoop({ directory, identity, input: base }), /wrong-identity/);
  await writeFile(join(directory, `${workId(identity)}.json`), "{");
  await assert.rejects(readLoop({ directory, identity }));
});

test("interrupted side-effect publication reconciles owned existing marker without new output", async () => {
  const pending = verify(reconcileLoop(null, base).state, 0, { publicationRequired: true }).state;
  const remote = new Map();
  let publications = 0;
  const adapter = { state: pending, find: async (key) => remote.has(key) ? [remote.get(key)] : [],
    publish: async (key) => { publications++; remote.set(key, "mock:issue/1"); return "mock:issue/1"; } };
  await reconcilePublication(adapter); // Remote success; simulate interruption before local commit.
  assert.equal(reconcileLoop(pending, base).dispatch, false);
  const publication = await reconcilePublication(adapter);
  const committed = reconcileLoop(pending, { ...base, event: "publication", publication });
  assert.equal(committed.state.status, "accepted");
  assert.equal(publications, 1);
  assert.equal(reconcileLoop(committed.state, base).decision, "no-op");
  await assert.rejects(reconcilePublication({ ...adapter, find: async () => ["mock:1", "mock:2"] }), /Ambiguous/);
});

test("serialized persisted publication recovers remote success/local interruption before accepting", async (t) => {
  const directory = await owned(t);
  const reserved = await transactLoop({ directory, identity, input: base });
  await transactLoop({ directory, identity, input: { ...base, event: "verify", receipt: receipt(reserved.state), publicationRequired: true } });
  const remote = [];
  let calls = 0;
  const adapter = { directory, identity, input: base, find: async () => remote, publish: async () => {
    calls++; remote.push("mock:owned-issue/4"); throw new Error("connection lost after remote publication");
  } };
  await assert.rejects(publishLoop(adapter), /connection lost/);
  assert.equal((await readLoop({ directory, identity })).status, "publication-pending");
  const recovered = await publishLoop(adapter);
  assert.equal(recovered.state.status, "accepted");
  assert.equal(calls, 1);
  const replay = await publishLoop(adapter);
  assert.equal(replay.decision, "no-op");
  const persisted = await readLoop({ directory, identity });
  assert.equal(persisted.history.at(-1).decision, "no-op");
  assert.equal(digest(persisted), replay.stateDigest);
  assert.deepEqual((await publishLoop(adapter)).state, persisted);
});

test("persisted accepted/pending/failed state requires exact trusted receipts and a valid policy", async (t) => {
  const directory = await owned(t);
  const accepted = verify(reconcileLoop(null, base).state).state;
  const filename = join(directory, `${workId(identity)}.json`);
  for (const corrupt of [
    (s) => { delete s.receipt; },
    (s) => { delete s.receipt.scopeValid; },
    (s) => { s.receipt.exitCode = 1; },
    (s) => { s.receipt.applicationRevision = "b".repeat(40); },
    (s) => { s.receipt.attempt = 0; },
    (s) => { s.receipt.kind = "setup"; },
    (s) => { s.status = "unknown-status"; },
    (s) => { s.owner = " "; },
    (s) => { s.applicationRevision = "not-a-revision"; },
    (s) => { s.evidenceDigest = "missing"; },
    (s) => { s.limits.maxAttempts = 0; },
    (s) => { delete s.limits; },
    (s) => { s.limits.deadlineHours = 25; },
    (s) => { s.deadline = "2026-09-18T12:00:00Z"; },
    (s) => { s.publicationKey = digest("another"); },
    (s) => { s.publication = { key: s.publicationKey, reference: "mock:1", reconciled: false }; },
    (s) => { s.history = []; },
    (s) => { s.history.at(-1).attempt = 0; }
  ]) {
    const state = structuredClone(accepted);
    corrupt(state);
    assert.throws(() => reconcileLoop(state, base), /Invalid/);
    await writeFile(filename, JSON.stringify(state));
    await assert.rejects(readLoop({ directory, identity }), /Invalid/);
    await assert.rejects(publishLoop({ directory, identity, input: base, find: () => assert.fail("must not read remote"), publish: () => assert.fail("must not publish") }), /Invalid/);
  }
  for (const state of [
    verify(reconcileLoop(null, base).state, 0, { publicationRequired: true }).state,
    verify(reconcileLoop(null, base).state, 1).state
  ]) {
    delete state.receipt;
    assert.throws(() => validateLoopState(state), /Invalid/);
  }
});

test("configured total attempts and deadline are persisted, validated and cannot change on resume", async (t) => {
  const directory = await owned(t);
  const configured = { ...base, limits: { maxAttempts: 3, escalationAfterHours: 1, workerTimeoutMinutes: 8 } };
  let result = await transactLoop({ directory, identity, input: configured });
  assert.deepEqual(result.state.limits, { maxAttempts: 3, deadlineHours: 1 });
  assert.equal(result.state.deadline, "2026-09-15T13:00:00.000Z");
  for (const limits of [{ maxAttempts: 4, deadlineHours: 1 }, { maxAttempts: 2, deadlineHours: 1 },
    { maxAttempts: 3, deadlineHours: 2 }]) {
    const changed = await transactLoop({ directory, identity, input: { ...base, limits } });
    assert.equal(changed.decision, "blocked");
    assert.equal(changed.dispatch, false);
    assert.deepEqual(changed.state.limits, result.state.limits);
    assert.equal(changed.state.attempts, 1);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const state = await readLoop({ directory, identity });
    result = await transactLoop({ directory, identity, input: { ...base, event: "verify", receipt: receipt(state, 1) } });
    assert.equal(result.decision, attempt < 3 ? "retry" : "escalated");
    if (attempt < 3) {
      result = await transactLoop({ directory, identity, input: base });
      assert.equal(result.state.attempts, attempt + 1);
      assert.equal(result.dispatch, true);
    }
  }
  assert.equal((await transactLoop({ directory, identity, input: base })).dispatch, false);
  const initial = reconcileLoop(null, configured).state;
  assert.equal(reconcileLoop(initial, { ...base, now: "2026-09-15T13:00:00Z" }).decision, "escalated");
  const single = reconcileLoop(null, { ...base, limits: { maxAttempts: 1, deadlineHours: 24 } }).state;
  assert.equal(verify(single, 1).decision, "escalated");
  for (const limits of [null, { maxAttempts: 0 }, { maxAttempts: 1.5 }, { maxAttempts: null }, { deadlineHours: null },
    { deadlineHours: 0 }, { deadlineHours: Infinity }, { deadlineHours: 1, escalationAfterHours: 2 }]) {
    assert.throws(() => loopLimits(limits), /Invalid/);
  }
});

test("legacy active reservations preserve hashes on read and retain only the original 2/24 limits", async (t) => {
  const directory = await owned(t);
  const legacy = reconcileLoop(null, base).state;
  delete legacy.limits;
  delete legacy.policyVersion;
  const beforeDigest = digest(legacy);
  await writeFile(join(directory, `${workId(identity)}.json`), JSON.stringify(legacy));
  assert.equal(digest(await readLoop({ directory, identity })), beforeDigest);
  const mismatch = reconcileLoop(legacy, { ...base, limits: { maxAttempts: 3, deadlineHours: 24 } });
  assert.equal(mismatch.decision, "blocked");
  assert.deepEqual(mismatch.state.limits, { maxAttempts: 2, deadlineHours: 24 });
  const accepted = await transactLoop({ directory, identity, input: { ...base, event: "verify", receipt: receipt(legacy) } });
  assert.equal(accepted.priorDigest, beforeDigest);
  assert.equal(accepted.state.status, "accepted");
  assert.deepEqual(accepted.state.limits, { maxAttempts: 2, deadlineHours: 24 });
});

test("fresh-process interruption, configuration override and corrupt acceptance cannot bypass authority", async (t) => {
  const directory = await owned(t);
  const inputFile = join(directory, "input.json");
  const command = ["platform/scripts/loop.mjs", "step", directory, inputFile];
  const invoke = async (input) => {
    await writeFile(inputFile, JSON.stringify(input));
    return JSON.parse(execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  };
  const first = await invoke(base);
  const interrupted = await invoke(base);
  assert.equal(interrupted.decision, "blocked");
  assert.equal(interrupted.dispatch, false);
  assert.equal(interrupted.state.attempts, 1);
  assert.equal(interrupted.priorDigest, first.stateDigest);
  const accepted = await invoke({ ...base, event: "verify", receipt: receipt(first.state) });
  assert.equal(accepted.state.status, "accepted");
  for (const limits of [{ maxAttempts: 3, deadlineHours: 48 }, { maxAttempts: 1, deadlineHours: 24 }]) {
    const override = await invoke({ ...base, limits });
    assert.equal(override.decision, "blocked");
    assert.equal(override.dispatch, false);
    assert.equal(override.state.attempts, 1);
    assert.deepEqual(override.state.limits, { maxAttempts: 2, deadlineHours: 24 });
  }
  const noOp = await invoke(base);
  assert.equal(noOp.decision, "no-op");
  assert.equal(noOp.dispatch, false);
  const corrupt = structuredClone(noOp.state);
  delete corrupt.receipt;
  const stateFile = join(directory, `${workId(identity)}.json`);
  const corruptBytes = JSON.stringify(corrupt);
  await writeFile(stateFile, corruptBytes);
  await writeFile(inputFile, JSON.stringify(base));
  assert.throws(() => execFileSync(process.execPath, command, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }), /Invalid, unsupported, or wrong-identity persisted loop state/);
  assert.equal(await readFile(stateFile, "utf8"), corruptBytes);
});

test("invalid new intake persists no malformed state and owner changes cannot authorize work", async (t) => {
  const directory = await owned(t);
  const blocked = await transactLoop({ directory, identity, input: { ...base, evidenceDigest: null } });
  assert.equal(blocked.decision, "blocked");
  assert.equal(blocked.state, null);
  assert.equal(await readLoop({ directory, identity }), null);
  const valid = await transactLoop({ directory, identity, input: base });
  const changed = reconcileLoop(valid.state, { ...base, owner: "another owner" });
  assert.equal(changed.decision, "blocked");
  assert.equal(changed.state.attempts, 1);
});

test("synthetic telemetry distinguishes above, below, missing, malformed, mismatch and addressed", () => {
  const sample = { synthetic: true, identity, window: "2026-07-20/2026-07-26", reservationRequests: 240,
    zeroStockResponses: 36, zeroStockRate: 0.15, reviewThreshold: 0.1, topZeroStockSku: "MED-003" };
  const options = { identity, expectedWindow: sample.window };
  assert.equal(validateTelemetry(sample, options).reason, "above-threshold");
  assert.equal(validateTelemetry({ ...sample, reviewThreshold: 0.2 }, options).reason, "below-or-at-threshold");
  assert.equal(validateTelemetry(sample, { ...options, alreadyAddressed: true }).reason, "already-addressed");
  for (const value of [null, { ...sample, synthetic: false }, { ...sample, reservationRequests: 0 },
    { ...sample, zeroStockResponses: 241 }, { ...sample, zeroStockRate: 0.2 }, { ...sample, reviewThreshold: 2 },
    { ...sample, window: "2026-02-30/2026-03-01" }, { ...sample, identity: { ...identity, station: "other" } }]) {
    assert.equal(validateTelemetry(value, options).decision, "blocked");
  }
});

test("marked-issue adapter reconciles only complete bot-owned identity state and preserves counters", () => {
  const accepted = verify(reconcileLoop(null, base).state).state;
  const issue = { number: 3, state: "open", user: { login: "github-actions[bot]", type: "Bot" },
    body: markedIssueBody(identity, accepted, "Verified synthetic task; waiting for human review.") };
  const options = { identity, issues: [issue], complete: true, input: base };
  const result = reconcileMarkedIssue(options);
  assert.equal(result.decision, "no-op");
  assert.equal(result.publication, "none");
  assert.equal(result.state.attempts, 1);
  assert.throws(() => reconcileMarkedIssue({ ...options, complete: false }), /truncated/);
  assert.throws(() => reconcileMarkedIssue({ ...options, issues: [issue, issue] }), /Ambiguous/);
  assert.throws(() => reconcileMarkedIssue({ ...options, issues: [{ ...issue, user: { login: "person", type: "User" } }] }), /configured bot/);
  const waiting = reconcileMarkedIssue({ ...options, issues: [{ ...issue, state: "closed",
    body: markedIssueBody(identity, reconcileLoop(null, base).state, "Owner closed unfinished work") }] });
  assert.equal(waiting.decision, "waiting-human");
  assert.equal(waiting.dispatch, false);
});

test("marked-issue adapter never plans publication for invalid first intake", () => {
  for (const invalid of [{ evidenceDigest: "" }, { applicationRevision: "invalid" }, { owner: "" }]) {
    const result = reconcileMarkedIssue({ identity, issues: [], complete: true, input: { ...base, ...invalid } });
    assert.equal(result.decision, "blocked");
    assert.equal(result.state, null);
    assert.equal(result.dispatch, false);
    assert.equal(result.publication, "none");
    assert.equal(result.issueNumber, null);
  }
});
