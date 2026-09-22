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
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("serves health and synthetic stock", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    const stock = await fetch(`${baseUrl}/stock`).then((response) => response.json());
    assert.equal(health.status, "ready");
    assert.equal(stock.items.length, 4);
    assert.equal(stock.items.find((item) => item.sku === "MED-003").available, 0);
  });
});

test("serves the user interface from exact allowlisted routes", async () => {
  await withServer(async (baseUrl) => {
    for (const [path, contentType, marker] of [
      ["/", /^text\/html/, /<!doctype html>/i],
      ["/app.js", /^text\/javascript/, /\/reservations/],
      ["/app.css", /^text\/css/, /:root/]
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), contentType);
      assert.match(await response.text(), marker);
    }
  });
});

test("returns an explicit conflict for unavailable stock", async () => {
  await withServer(async (baseUrl) => {
    const before = await fetch(`${baseUrl}/stock`).then((response) => response.json());
    const response = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "MED-003", quantity: 1 })
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "insufficient stock");
    assert.equal(body.available, 0);
    assert.deepEqual(await fetch(`${baseUrl}/stock`).then((result) => result.json()), before);
  });
});

test("creates a reservation and exposes the decremented stock", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "MED-001", quantity: 2 })
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).remaining, 10);
    const stock = await fetch(`${baseUrl}/stock`).then((result) => result.json());
    assert.equal(stock.items.find((item) => item.sku === "MED-001").available, 10);
  });
});

test("preserves validation and not-found HTTP contracts", async () => {
  await withServer(async (baseUrl) => {
    for (const [payload, expectedStatus, expectedError] of [
      [{ sku: "MED-001", quantity: 0 }, 400, "quantity must be an integer from 1 to 5"],
      [{ sku: "MED-999", quantity: 1 }, 404, "medicine not found"]
    ]) {
      const response = await fetch(`${baseUrl}/reservations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      assert.equal(response.status, expectedStatus);
      assert.equal((await response.json()).error, expectedError);
    }
  });
});

test("rejects invalid JSON", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/reservations`, {
      method: "POST",
      body: "{"
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid JSON" });
  });
});

test("returns JSON for an unknown route", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.deepEqual(await response.json(), { error: "route not found" });
  });
});
