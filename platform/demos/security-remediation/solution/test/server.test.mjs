import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { buildServer } from "../src/server.mjs";

async function withServer(action) {
  const server = buildServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await action(`http://127.0.0.1:${server.address().port}`);
  } finally {
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
}

test("serves the synthetic health and seed snapshot", () => withServer(async (url) => {
  assert.equal((await (await fetch(`${url}/health`)).json()).service, "synthetic-pharmacy");
  const response = await fetch(`${url}/exports/stock.json`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.synthetic, true);
  assert.equal(snapshot.snapshot, "training-seed");
  assert.equal(snapshot.items.length, 4);
}));

test("rejects unknown export names", () => withServer(async (url) => {
  const response = await fetch(`${url}/exports/unknown.json`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "export not found" });
}));

test("rejects encoded traversal export names", () => withServer(async (url) => {
  const response = await fetch(`${url}/exports/%2e%2e%2fpackage.json`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "export not found" });
}));

test("a suggestion changes no stock and explicit reservation decrements stock", () => withServer(async (url) => {
  const before = await (await fetch(`${url}/stock`)).json();
  const conflict = await fetch(`${url}/reservations`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "MED-003", quantity: 1 })
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).suggestion.sku, "MED-004");
  assert.deepEqual(await (await fetch(`${url}/stock`)).json(), before);
  const accepted = await fetch(`${url}/reservations`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "MED-004", quantity: 1 })
  });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).remaining, 5);
}));

test("rejects malformed JSON without stopping the service", () => withServer(async (url) => {
  const bad = await fetch(`${url}/reservations`, { method: "POST", body: "{invalid" });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${url}/health`)).status, 200);
}));
