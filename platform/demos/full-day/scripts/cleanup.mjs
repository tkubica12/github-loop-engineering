import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const platform = resolve(root, "platform", "scripts", "workshop.mjs");

execFileSync(process.execPath, [platform, "cleanup", "--profile", "sandbox", "--station", "instructor", "--apply"], { cwd: root, stdio: "inherit" });
console.log("PASS full-day local demo artifacts cleaned");
