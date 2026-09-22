import { loadConfig, parseArgs, printPlan } from "./lib.mjs";

const config = loadConfig(parseArgs());
printPlan(config);
console.log("");
console.log("Next: run preflight.mjs --live with the same arguments, then setup.mjs --target github --apply.");
