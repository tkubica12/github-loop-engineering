import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const platform = resolve(root, "platform", "scripts", "workshop.mjs");

function runNpm(args) {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec, ["/d", "/s", "/c", ["npm", ...args].join(" ")], { cwd: root, stdio: "inherit" });
  } else {
    execFileSync("npm", args, { cwd: root, stdio: "inherit" });
  }
}

execFileSync(process.execPath, [platform, "preflight", "--profile", "sandbox"], { cwd: root, stdio: "inherit" });
runNpm(["test"]);
runNpm(["run", "validate"]);
runNpm(["run", "validate:workflows"]);
runNpm(["run", "validate:html"]);
console.log("PREFLIGHT full-day: repository gates pass.");
console.log("NEXT: confirm every station repository exists, is reachable, and grants the attendee write access.");
console.log("NEXT: confirm which preview capabilities are enabled, and announce the stated fallback for any that are not.");
