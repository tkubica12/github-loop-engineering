import assert from "node:assert/strict";
import test from "node:test";
import { createInventory, listStock, reserve } from "../src/inventory.mjs";

test("reserves available synthetic stock", () => {
  const result = reserve(createInventory(), { sku: "MED-001", quantity: 2 });
  assert.equal(result.status, 201);
  assert.equal(result.body.remaining, 10);
  assert.match(result.body.reservationId, /^RSV-MED-001-/);
});

test("rejects an out-of-stock request without overselling", () => {
  const inventory = createInventory();
  const before = listStock(inventory);
  const result = reserve(inventory, { sku: "MED-003", quantity: 1 });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "insufficient stock");
  assert.equal(result.body.available, 0);
  assert.deepEqual(listStock(inventory), before);
});

test("rejects every quantity outside the integer range 1 to 5", () => {
  for (const quantity of [undefined, null, 0, 1.5, 6, "1"]) {
    assert.deepEqual(reserve(createInventory(), { sku: "MED-001", quantity }), {
      status: 400,
      body: { error: "quantity must be an integer from 1 to 5" }
    });
  }
});

test("requires a string SKU and preserves unknown-SKU behavior", () => {
  assert.deepEqual(reserve(createInventory(), { quantity: 1 }), {
    status: 400,
    body: { error: "sku is required" }
  });
  assert.deepEqual(reserve(createInventory(), { sku: "MED-999", quantity: 1 }), {
    status: 404,
    body: { error: "medicine not found" }
  });
});

test("returns defensive stock snapshots", () => {
  const inventory = createInventory();
  const snapshot = listStock(inventory);
  snapshot[0].available = 0;
  assert.equal(inventory.get("MED-001").available, 12);
});
