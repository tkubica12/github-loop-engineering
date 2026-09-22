import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const platform = resolve(root, "platform", "scripts", "workshop.mjs");

execFileSync(process.execPath, [platform, "cleanup", "--profile", "sandbox", "--station", "demo01", "--apply"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [platform, "render", "--profile", "sandbox", "--station", "demo01"], { cwd: root, stdio: "inherit" });
console.log("PASS local demo station reset");
