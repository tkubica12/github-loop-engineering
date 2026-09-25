import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { materialFiles, root } from "./validation.mjs";

const args = process.argv.slice(2);
const viewportFlag = args.indexOf("--viewport");
const viewport = viewportFlag === -1 ? "1440x900" : args[viewportFlag + 1];
if (!/^\d+x\d+$/.test(viewport ?? "")) throw new Error("Use --viewport WIDTHxHEIGHT.");
const selected = args.filter((arg, index) =>
  viewportFlag === -1 || (index !== viewportFlag && index !== viewportFlag + 1));
const files = selected.length ? selected.map((file) => join(root, file))
  : materialFiles();
const runtime = join(root, "docs", "assets", "html-docs");

function run(script, arguments_) {
  const result = spawnSync(process.execPath, [join(runtime, script), ...arguments_], {
    cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE || join(root, "node_modules", "playwright") }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout || ""}${result.stderr || ""}`);
    throw new Error(`${script} failed with exit ${result.status} for ${arguments_.join(" ")}`);
  }
  return result.stdout.trim();
}

run("sync-head.js", ["--check", ...files]);
for (const file of files) {
  console.log(`VALIDATE ${relative(root, file)} ${viewport}`);
  console.log(run("validate.js", [file, "--viewport", viewport]).split(/\r?\n/).at(-1));
}
console.log(`PASS ${files.length} materials at ${viewport}: six palettes, offline, navigation and no-JS reference.`);
