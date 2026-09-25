import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const demo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "pharmacy-security-rehearsal-"));
const request = (url, path) => fetch(`${url}${path}`, { signal: AbortSignal.timeout(5000) });
try {
  for (const phase of ["starter", "solution"]) {
    const directory = join(temporary, phase);
    cpSync(join(demo, "fixture", "repository"), directory, { recursive: true });
    if (phase === "solution") cpSync(join(demo, "solution"), directory, { recursive: true });
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    execFileSync(process.execPath, ["--test"], { cwd: directory, env, timeout: 30_000, stdio: "pipe" });
    const { buildServer } = await import(pathToFileURL(join(directory, "src", "server.mjs")).href);
    const server = buildServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const normal = await request(url, "/exports/stock.json");
      assert.equal(normal.status, 200);
      assert.deepEqual(await normal.json(), JSON.parse(readFileSync(join(directory, "data", "stock.json"), "utf8")));
      const traversal = await request(url, "/exports/%2e%2e%2fpackage.json");
      assert.equal(traversal.status, phase === "starter" ? 200 : 404);
      if (phase === "starter") {
        assert.equal((await traversal.json()).name, "synthetic-pharmacy-security-demo");
        console.log("PASS starter: harmless app manifest exposure reproduced on loopback only");
      } else {
        assert.deepEqual(await traversal.json(), { error: "export not found" });
        for (const path of ["/exports/%252e%252e%252fpackage.json", "/exports/stock.json%00",
          "/exports/unknown.json", "/exports/%2e%2e%5cpackage.json"]) {
          const rejected = await request(url, path);
          assert.equal(rejected.status, 404, path);
        }
        assert.equal((await request(url, "/exports/%ZZ")).status, 400);
        assert.equal((await request(url, "/health")).status, 200);
        console.log("PASS solution: traversal, double encoding, null byte, separator and unknown names rejected");
      }
    } finally {
      const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
  console.log("PASS valid export and reservation tests preserved; no external calls, real secrets, or system files used");
  console.log("LOCAL ONLY: this exercise does not establish GitHub CodeQL status or human approval");
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
