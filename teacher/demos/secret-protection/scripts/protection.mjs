#!/usr/bin/env node
import {
  DemoError, GhApi, exercise, parseCli, preflight, redact, validateConfig,
  validateNewOutput, writeEvidence
} from "./lib.mjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function main(argv = process.argv.slice(2), io = console, api = new GhApi()) {
  const { command, options } = parseCli(argv);
  if (command === "plan" || command === "cleanup" || (command === "exercise" && !options.apply)) {
    const config = validateConfig(options);
    io.log(command === "cleanup" ? "Secret Protection cleanup plan" : "Secret Protection plan (local only; no GitHub API call)");
    io.log(`  repository: ${redact(config.repository)}`);
    io.log(`  ownership:  workshop-synthetic-pharmacy + ${redact(config.runTopic)}`);
    io.log("  remote:     no refs, commits, policies, features, pipelines, or cloud resources are changed");
    io.log("  apply:      one blocked inactive sample request, then one safe unreferenced Git blob");
    io.log("  cleanup:    no remote cleanup; rerun with a new output name; remove local evidence when finished");
    return 0;
  }
  const config = validateConfig(options, { needsOutput: command === "exercise" });
  if (command === "preflight") {
    const result = preflight(api, config);
    io.log(`PASS ${result.repository.fullName} has native push protection and exact ownership topics`);
    io.log(`PASS default branch ${result.branch.name} is ${result.branch.before}`);
    return 0;
  }
  validateNewOutput(config.output);
  try {
    const evidence = await exercise(api, config);
    writeEvidence(config.output, evidence);
    io.log(`PASS native push protection blocked the inactive sample (HTTP ${evidence.blockedAttempt.httpStatus})`);
    io.log(`PASS safe remediation bytes verified; default branch remained ${evidence.branch.after}`);
    io.log(`Evidence: ${redact(config.output)}`);
    return 0;
  } catch (error) {
    const evidence = error instanceof DemoError ? error.details?.evidence : null;
    if (evidence) writeEvidence(config.output, evidence);
    io.error(`FAIL ${redact(error?.message)}`);
    if (evidence) io.error(`Evidence: ${redact(config.output)}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`FAIL ${redact(error?.message)}`);
    process.exitCode = 1;
  }
}
