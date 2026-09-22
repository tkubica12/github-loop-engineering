import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const identityKeys = ["profile", "station", "repository", "objectiveId", "contractVersion"];
const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const statuses = new Set(["new", "reserved", "failed", "accepted", "publication-pending", "waiting-human", "escalated", "stopped"]);
const decisions = new Set(["delegate", "retry", "report", "no-op", "waiting-human", "blocked", "escalated", "stopped"]);
export const LOOP_LIMITS = Object.freeze({ maxAttempts: 2, deadlineHours: 24 });
export const digest = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const text = (value) => typeof value === "string" && value.trim().length > 0;

export function loopLimits(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid loop limits");
  const maxAttempts = input.maxAttempts === undefined ? LOOP_LIMITS.maxAttempts : input.maxAttempts;
  const deadlineHours = input.deadlineHours !== undefined ? input.deadlineHours
    : input.escalationAfterHours !== undefined ? input.escalationAfterHours : LOOP_LIMITS.deadlineHours;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 ||
      !Number.isFinite(deadlineHours) || deadlineHours <= 0 ||
      !Number.isSafeInteger(deadlineHours * 3600000) ||
      (input.deadlineHours !== undefined && input.escalationAfterHours !== undefined &&
        input.deadlineHours !== input.escalationAfterHours)) throw new Error("Invalid loop maxAttempts/deadlineHours limits");
  return { maxAttempts, deadlineHours };
}

export function workId(identity) {
  if (!identity || identity.contractVersion !== 1 ||
      identityKeys.slice(0, -1).some((key) => typeof identity[key] !== "string" || !identity[key].trim())) {
    throw new Error("Unsupported loop contract or incomplete station/work identity");
  }
  return digest(identityKeys.map((key) => identity[key]));
}

function validReceipt(receipt, state, attempt = state.attempts) {
  return Boolean(receipt && receipt.trusted === true && receipt.kind === "task" &&
    receipt.workId === state.workId && receipt.applicationRevision === state.applicationRevision &&
    receipt.evidenceDigest === state.evidenceDigest && receipt.attempt === attempt &&
    text(receipt.command) && Number.isSafeInteger(receipt.exitCode) && receipt.exitCode >= 0 &&
    receipt.scopeValid === true && (receipt.stale === undefined || receipt.stale === false));
}

export function validateLoopState(state, identity = state?.identity) {
  const invalid = () => { throw new Error("Invalid, unsupported, or wrong-identity persisted loop state"); };
  if (!state || state.schemaVersion !== 1 || state.workId !== workId(identity) ||
      workId(state.identity) !== state.workId || !statuses.has(state.status) ||
      !text(state.owner) || !revisionPattern.test(state.applicationRevision ?? "") ||
      !digestPattern.test(state.evidenceDigest ?? "")) invalid();
  // Existing v1 reservations had no stored policy; their only valid policy remains exactly 2/24.
  const legacy = state.policyVersion === undefined && state.limits === undefined;
  if (!legacy && (state.policyVersion !== 1 || !state.limits ||
      Object.keys(state.limits).sort().join("|") !== "deadlineHours|maxAttempts")) invalid();
  const limits = loopLimits(legacy ? LOOP_LIMITS : state.limits);
  if (!Number.isInteger(state.attempts) || state.attempts < 0 || state.attempts > limits.maxAttempts ||
      !Number.isFinite(Date.parse(state.startedAt)) || !Number.isFinite(Date.parse(state.deadline)) ||
      Date.parse(state.deadline) - Date.parse(state.startedAt) !== limits.deadlineHours * 3600000 ||
      !Array.isArray(state.history) || !state.history.length ||
      !decisions.has(state.decision) || !text(state.reason)) invalid();
  let previousAttempt = 0;
  for (const entry of state.history) {
    if (!decisions.has(entry.decision) || !text(entry.reason) || !Number.isFinite(Date.parse(entry.at)) ||
        !Number.isInteger(entry.attempt) || entry.attempt < previousAttempt || entry.attempt > state.attempts) invalid();
    previousAttempt = entry.attempt;
  }
  const last = state.history.at(-1);
  if (last.decision !== state.decision || last.reason !== state.reason || last.attempt !== state.attempts) invalid();
  const statusDecisions = {
    new: ["blocked"], reserved: ["delegate", "retry", "blocked"], failed: ["retry", "blocked"],
    accepted: ["report", "no-op", "blocked"], "publication-pending": ["report", "blocked"],
    "waiting-human": ["waiting-human", "blocked"], escalated: ["escalated", "blocked"], stopped: ["stopped", "blocked"]
  };
  if (!statusDecisions[state.status].includes(state.decision)) invalid();
  if (state.status === "new" && state.attempts !== 0) invalid();
  if (["reserved", "failed", "accepted", "publication-pending"].includes(state.status) && state.attempts < 1) invalid();
  if (state.receipt !== undefined &&
      (!Number.isInteger(state.receipt?.attempt) || state.receipt.attempt < 1 || state.receipt.attempt > state.attempts ||
        !validReceipt(state.receipt, state, state.receipt.attempt))) invalid();
  if (state.status === "failed" && (!validReceipt(state.receipt, state) || state.receipt.exitCode === 0 ||
      state.attempts >= limits.maxAttempts)) invalid();
  if (state.status === "reserved" && state.attempts > 1 &&
      (!validReceipt(state.receipt, state, state.attempts - 1) || state.receipt.exitCode === 0)) invalid();
  if (["accepted", "publication-pending"].includes(state.status) &&
      (!validReceipt(state.receipt, state) || state.receipt.exitCode !== 0 ||
        state.publicationKey !== digest([state.workId, state.applicationRevision, state.evidenceDigest]))) invalid();
  if (state.publication !== undefined && (state.publication?.key !== state.publicationKey ||
      state.publication?.reconciled !== true || !text(state.publication?.reference))) invalid();
  if (state.status === "publication-pending" && state.publication !== undefined) invalid();
  return state;
}

/** Pure controller. trusted receipts must be constructed by an external verifier adapter, never the worker. */
export function reconcileLoop(prior, input) {
  const id = workId(input.identity);
  const now = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid controller clock");
  if (prior) validateLoopState(prior, input.identity);
  const limits = prior ? loopLimits(prior.limits) : loopLimits(input.limits);
  if (!prior && (!text(input.owner) || !revisionPattern.test(input.applicationRevision ?? "") ||
      !digestPattern.test(input.evidenceDigest ?? ""))) {
    return { state: null, decision: "blocked", reason: "Missing or invalid owner, exact application revision, or trusted intake evidence", dispatch: false };
  }
  const state = prior ? structuredClone(prior) : {
    schemaVersion: 1, identity: structuredClone(input.identity), workId: id,
    applicationRevision: input.applicationRevision, evidenceDigest: input.evidenceDigest,
    attempts: 0, startedAt: now,
    deadline: new Date(Date.parse(now) + limits.deadlineHours * 3600000).toISOString(),
    owner: input.owner, status: "new", history: []
  };
  state.policyVersion = 1;
  state.limits = limits;
  const finish = (decision, reason, dispatch = false) => {
    state.decision = decision;
    state.reason = reason;
    const entry = { decision, reason, attempt: state.attempts, at: now };
    if (state.history.at(-1)?.decision !== decision || state.history.at(-1)?.reason !== reason ||
        state.history.at(-1)?.attempt !== state.attempts) state.history.push(entry);
    return { state, decision, reason, dispatch };
  };
  if (input.limits !== undefined && digest(loopLimits(input.limits)) !== digest(limits)) {
    return finish("blocked", "Configured limits differ from persisted work policy; owner reconciliation required, never reset or extend a budget");
  }
  if (input.event === "stop") {
    state.status = "stopped";
    return finish("stopped", `Cancelled; owner: ${state.owner ?? "unassigned"}`);
  }
  if (!revisionPattern.test(input.applicationRevision ?? "") ||
      !digestPattern.test(input.evidenceDigest ?? "") || input.evidenceValid === false) {
    return finish("blocked", "Missing or invalid owner, exact application revision, or trusted intake evidence");
  }
  if (input.owner !== undefined && input.owner !== state.owner) return finish("blocked", "Owner differs from persisted work identity");
  if (state.applicationRevision !== input.applicationRevision || state.evidenceDigest !== input.evidenceDigest) {
    return finish("blocked", "Stale or changed application/evidence; owner must reconcile this work, not reset its budget");
  }
  if (Date.parse(now) < Date.parse(state.startedAt)) return finish("blocked", "Controller clock predates persisted work");
  if (state.status === "stopped") return finish("stopped", `Cancelled; owner: ${state.owner}`);
  if (state.status === "escalated") return finish("escalated", `Attempt/deadline limit; owner: ${state.owner}`);
  if (state.status === "accepted" && input.event === "intake") return finish("no-op", "Verified identical work already accepted; no new output or worker");
  if (Date.parse(now) >= Date.parse(state.deadline)) {
    state.status = "escalated";
    return finish("escalated", `Deadline exhausted; owner: ${state.owner}`);
  }
  if (input.event === "waiting-human") {
    state.status = "waiting-human";
    return finish("waiting-human", `Human decision required; owner: ${state.owner}`);
  }
  if (state.status === "waiting-human") return finish("waiting-human", `Human decision required; owner: ${state.owner}`);
  if (input.event === "verify") {
    const receipt = input.receipt;
    if (state.status !== "reserved" || !validReceipt(receipt, state)) {
      return finish("blocked", "Missing, invalid, setup, stale, wrong-revision, or unauthorized-scope task receipt");
    }
    state.receipt = structuredClone(receipt);
    if (receipt.exitCode !== 0) {
      state.status = state.attempts >= limits.maxAttempts ? "escalated" : "failed";
      return finish(state.status === "failed" ? "retry" : "escalated",
        state.status === "failed" ? `Trusted task failure: ${receipt.command}` : `Repair exhausted; owner: ${state.owner}`);
    }
    state.status = input.publicationRequired ? "publication-pending" : "accepted";
    state.publicationKey = digest([id, state.applicationRevision, state.evidenceDigest]);
    return finish("report", input.publicationRequired ? "Verified; reconcile marked publication before publishing" : "Externally verified local outcome; human review remains required");
  }
  if (input.event === "publication") {
    if (state.status !== "publication-pending" || input.publication?.key !== state.publicationKey ||
        input.publication?.reconciled !== true || typeof input.publication?.reference !== "string" ||
        !input.publication.reference) return finish("blocked", "Publication must be reconciled against the exact owned marker");
    state.publication = structuredClone(input.publication);
    state.status = "accepted";
    return finish("report", "Verified publication reconciled and recorded; human review remains required");
  }
  if (input.event !== "intake") return finish("blocked", "Unsupported loop event");
  if (state.status === "publication-pending") return finish("blocked", "Reconcile pending publication before any worker or new output");
  if (state.status === "reserved") return finish("blocked", "Interrupted/reserved attempt requires its exact external task receipt; never blindly redispatch");
  if (!["new", "failed"].includes(state.status)) return finish("blocked", "Persisted work is not eligible for dispatch");
  if (state.attempts >= limits.maxAttempts) {
    state.status = "escalated";
    return finish("escalated", `Attempt budget exhausted; owner: ${state.owner}`);
  }
  state.attempts += 1;
  state.status = "reserved";
  return finish(state.attempts === 1 ? "delegate" : "retry", "Attempt reserved before worker execution", true);
}

async function withOwnedLock(directory, identity, action) {
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true });
  const id = workId(identity);
  const lockPath = join(dir, `${id}.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Loop is locked: another invocation or interrupted owner requires explicit operator reconciliation");
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ workId: id, pid: process.pid }));
    return await action(join(dir, `${id}.json`));
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

export async function readLoop({ directory, identity }) {
  try {
    const text = await readFile(join(resolve(directory), `${workId(identity)}.json`), "utf8");
    const state = JSON.parse(text);
    validateLoopState(state, identity);
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function transactLoop({ directory, identity, input }) {
  if (workId(identity) !== workId(input.identity)) throw new Error("Adapter/input identity mismatch");
  return withOwnedLock(directory, identity, async (filename) => {
    const prior = await readLoop({ directory, identity });
    const result = reconcileLoop(prior, input);
    if (result.state) {
      validateLoopState(result.state, identity);
      await atomicSave(filename, result.state);
    }
    return { ...result, priorDigest: prior ? digest(prior) : null, stateDigest: result.state ? digest(result.state) : null };
  });
}

async function atomicSave(filename, state) {
  const staging = `${filename}.${randomUUID()}.staging`;
  try {
    const file = await open(staging, "wx");
    try { await file.writeFile(`${JSON.stringify(state, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    await rename(staging, filename);
  } finally { await rm(staging, { force: true }); }
}

export async function resetLoop({ directory, identity }) {
  return withOwnedLock(directory, identity, async (filename) => {
    const prior = await readLoop({ directory, identity });
    await rm(filename, { force: true });
    return { removed: Boolean(prior), workId: workId(identity) };
  });
}

/** Import verified accepted evidence into an empty local replay store; never reset existing work. */
export async function importAcceptedLoop({ directory, identity, state }) {
  validateLoopState(state, identity);
  if (state.status !== "accepted") throw new Error("Only externally verified accepted state can seed recorded replay");
  return withOwnedLock(directory, identity, async (filename) => {
    if (await readLoop({ directory, identity })) throw new Error("Recorded replay cannot replace existing work state");
    await atomicSave(filename, state);
    return { workId: state.workId, stateDigest: digest(state), attempts: state.attempts, dispatch: false, imported: true };
  });
}

/** Recover a crash between remote publication and local state commit using the owned marker. */
export async function reconcilePublication({ state, find, publish }) {
  validateLoopState(state);
  if (state.status !== "publication-pending") throw new Error("No pending publication");
  const existing = await find(state.publicationKey);
  if (existing.length > 1) throw new Error("Ambiguous owned publications; escalate to owner");
  const reference = existing[0] ?? await publish(state.publicationKey);
  return { key: state.publicationKey, reference, reconciled: true };
}

/** Single-host serialized publication. Remote ambiguity still requires an owner; not distributed exactly-once. */
export async function publishLoop({ directory, identity, input, find, publish }) {
  if (workId(identity) !== workId(input.identity)) throw new Error("Adapter/input identity mismatch");
  return withOwnedLock(directory, identity, async (filename) => {
    const prior = await readLoop({ directory, identity });
    if (!prior) throw new Error("Missing pending publication state");
    if (prior.status === "accepted") {
      const result = reconcileLoop(prior, { ...input, event: "intake" });
      validateLoopState(result.state, identity);
      await atomicSave(filename, result.state);
      return { ...result, priorDigest: digest(prior), stateDigest: digest(result.state) };
    }
    const checked = reconcileLoop(prior, { ...input, event: "intake" });
    if (checked.state.status !== "publication-pending" ||
        checked.reason !== "Reconcile pending publication before any worker or new output") {
      throw new Error(`Publication blocked: ${checked.reason}`);
    }
    const publication = await reconcilePublication({ state: prior, find, publish });
    const result = reconcileLoop(prior, { ...input, event: "publication", publication });
    await atomicSave(filename, result.state);
    return { ...result, priorDigest: digest(prior), stateDigest: digest(result.state) };
  });
}
