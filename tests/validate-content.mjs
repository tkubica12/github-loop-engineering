import { validateRepository } from "./validation.mjs";

const result = validateRepository();
if (result.errors.length) {
  for (const error of result.errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(`PASS ${result.htmlCount} HTML files and all local references`);
console.log("PASS linked agenda, combined lab presentations, and workflow pinning");
