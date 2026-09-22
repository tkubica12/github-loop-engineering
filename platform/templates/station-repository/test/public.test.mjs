import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.mjs";

async function withServer(run) {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("serves only the allowlisted user interface assets with correct MIME types", async () => {
  await withServer(async (baseUrl) => {
    for (const [path, contentType, contentPattern] of [
      ["/", /^text\/html/, /<!doctype html>/i],
      ["/app.js", /^text\/javascript/, /fetch\(/],
      ["/app.css", /^text\/css/, /:root/]
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), contentType);
      assert.match(await response.text(), contentPattern);
    }
  });
});

test("does not expose a generic static file route", async () => {
  await withServer(async (baseUrl) => {
    for (const path of ["/public/index.html", "/src/server.mjs", "/app.js?cache=1"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 404);
      assert.match(response.headers.get("content-type"), /^application\/json/);
      assert.deepEqual(await response.json(), { error: "route not found" });
    }
  });
});

test("keeps API responses JSON after serving the user interface", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/`);
    const response = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.deepEqual(await response.json(), { error: "invalid JSON" });
  });
});
