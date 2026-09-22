import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const live = process.argv.includes("--live");
const args = [
  resolve(root, "platform", "scripts", "workshop.mjs"),
  "preflight",
  "--profile",
  "sandbox",
  ...(live ? ["--live"] : [])
];

execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [
  resolve(root, "teacher", "demos", "agentic-engineering-loop", "scripts", "showcase.mjs"),
  "--mode",
  "rehearsal"
], { cwd: root, stdio: "inherit" });
