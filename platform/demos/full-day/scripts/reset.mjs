import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const platform = resolve(root, "platform", "scripts", "workshop.mjs");
const common = ["--profile", "sandbox", "--station", "instructor"];

execFileSync(process.execPath, [platform, "cleanup", ...common, "--apply"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [platform, "render", ...common], { cwd: root, stdio: "inherit" });
console.log("PASS full-day instructor station reset");
