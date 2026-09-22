import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { transactLoop, resetLoop } from "../templates/station-repository/scripts/loop-state.mjs";

export async function main(args) {
  const [command, directory, inputPath] = args;
  if (!["step", "reset"].includes(command) || !directory || !inputPath) {
    throw new Error("Usage: node platform/scripts/loop.mjs step|reset OWNED_STATE_DIRECTORY INPUT_JSON");
  }
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const result = command === "reset" ? await resetLoop({ directory, identity: input.identity })
    : await transactLoop({ directory, identity: input.identity, input });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
