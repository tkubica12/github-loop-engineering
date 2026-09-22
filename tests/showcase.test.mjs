import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root, sourceElement, sourceText } from "./validation.mjs";

const deckPath = join(root, "docs", "slides", "agentic-engineering-loop.html");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("one-hour storyline provides evidence and never substitutes file existence for event readiness", () => {
  const output = execFileSync(process.execPath, [
    join(root, "teacher", "demos", "agentic-engineering-loop", "scripts", "showcase.mjs"),
    "--mode",
    "rehearsal"
  ], { cwd: root, encoding: "utf8" });
  assert.match(output, /PASS 8 required artifacts/);
  assert.match(output, /58:00\s+Close/);
  assert.match(output, /NOT EVENT READINESS/);
  assert.match(output, /native CodeQL/);
  assert.match(output, /same-revision OpenCode/);
  assert.match(output, /LOOP CONTINUATION: NOT_EXECUTED/);
  assert.match(output, /maintenance is source-based post-review and predates deployment/);
});

test("the showcase deck pays off the fix early and announces slides without narrating the whole deck", () => {
  const deck = readFileSync(deckPath, "utf8");
  const payoff = sourceText(sourceElement(deck, "slide-4", "slide"));
  assert.match(payoff, /The fix exists\. Follow how it earned approval\./);
  assert.match(payoff, /00:06/);
  assert.match(payoff, /Recorded merged PR #2/);
  assert.match(read("docs", "guides", "security-remediation.html"), /pharmacy-agentic-loop-demo\/pull\/2\/files/);
  assert.doesNotMatch(deck, /<main[^>]*aria-live/);
  assert.match(sourceText(deck), /Sandbox self-approval does not prove independent separation of duties/);

  const slides = read("docs", "assets", "html-docs", "deck.js");
  assert.match(slides, /progress\.setAttribute\("aria-live", "polite"\)/);
  assert.match(slides, /slide\.setAttribute\("aria-roledescription", "slide"\)/);
  assert.match(slides, /slide\.setAttribute\("aria-label", `\$\{i \+ 1\} of \$\{slides\.length\}: \$\{slideLabel\(slide\)\}`\)/);
});

test("the close fallback points at the reveal slide that exists in the deck", () => {
  const state = JSON.parse(read("teacher", "demos", "agentic-engineering-loop",
    "fixtures", "showcase-state.json"));
  const close = state.scenes.find((scene) => scene.name === "Close");
  assert.deepEqual(state.deliveryModes, ["live", "recorded", "remediation-only"]);
  assert.deepEqual(state.requiresFreshLiveChainInModes, ["live"]);
  assert.equal(state.loopContinuation.defaultVerdict, "NOT_EXECUTED");
  assert.equal(state.loopContinuation.historicalFollowUpIsExecution, false);
  const requested = Number(close.fallback.match(/#slide-(\d+)$/)[1]);
  const deck = readFileSync(deckPath, "utf8");
  const closingSlide = sourceElement(deck, `slide-${requested}`, "slide");
  assert.ok(closingSlide, "The fallback alias must exist inside an actual slide");
  assert.match(sourceText(closingSlide), /Only one step was coding\./);
  assert.doesNotMatch(JSON.stringify(state), /operator-guide\.html#preflight/);
});

test("the runbook states delivery mode, approval limits and reusable capture naming honestly", () => {
  const guide = read("teacher", "demos", "agentic-engineering-loop", "operator-guide.html");
  assert.match(guide, /2026-09-12T19:18:37Z/);
  const preparation = sourceText(sourceElement(guide, "prepare", "card"));
  assert.match(preparation, /Recorded Announce before the deployment scene that the release and runtime evidence is a historical capture from a completed run/);
  assert.match(preparation, /Never call a recording a live check/);
  assert.match(guide, /remediation-only path/);
  assert.match(guide, /REPLACE-WITH-UNIQUE-RUN-NAME/);
  assert.doesNotMatch(guide, /\$\{|\$\(|%DATE%/);
  assert.match(guide, /not enforced separation of duties/);
  assert.match(guide, /observes the review but does not enforce a code-owner rule/);
  assert.match(guide, /distinct deployment-reviewer team/);
  assert.match(guide, /environment approval is enforced, but permits the initiator to approve/);
  assert.match(guide, /For live mode, run these additional checks in a second terminal/);
  assert.match(guide, /For announced recorded mode, require the retained/);
  assert.match(guide, /Run the continuation verifier live and read its result/);
  assert.match(guide, /reviewed PR head is <code>2d84da4<\/code>, not the workflow revision/);
  assert.match(guide, /public-chain\.recorded\.example\.json/);
  assert.match(guide, /Only for a separately announced simulation/);
  assert.match(guide, /OpenCode maintenance issue #3/);
  assert.match(guide, /node teacher\\demos\\security-remediation\\scripts\\verify-continuation\.mjs/);
  assert.doesNotMatch(guide, /matching mission scene|scene 1 or 8/);
  assert.match(guide, /Runbook recorded 6 September 2026 · Product state validated 5 September 2026/);
});
