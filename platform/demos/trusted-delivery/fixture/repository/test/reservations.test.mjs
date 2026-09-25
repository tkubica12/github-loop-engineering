import assert from "node:assert/strict";
import test from "node:test";
import { createInventory, createReservation, listStock } from "../src/reservations.mjs";

test("lists the shared synthetic pharmacy stock", () => {
  const inventory = createInventory();
  assert.deepEqual(listStock(inventory).map(({ sku, available }) => ({ sku, available })), [
    { sku: "MED-001", available: 12 }, { sku: "MED-002", available: 4 },
    { sku: "MED-003", available: 0 }, { sku: "MED-004", available: 6 }
  ]);
  const snapshot = listStock(inventory);
  snapshot[0].available = 0;
  assert.equal(inventory.get("MED-001").available, 12);
});

test("creates a bounded reservation and decrements real in-memory stock", () => {
  const inventory = createInventory();
  assert.deepEqual(createReservation({ sku: "MED-001", quantity: 2 }, inventory), {
    status: 201,
    body: { reservationId: "RSV-MED-001-10", sku: "MED-001", quantity: 2, remaining: 10 }
  });
  assert.equal(inventory.get("MED-001").available, 10);
});

test("rejects the zero-quantity boundary", () => {
  const inventory = createInventory();
  assert.deepEqual(createReservation({ sku: "MED-001", quantity: 0 }, inventory), {
    status: 400,
    body: { error: "quantity must be an integer from 1 to 5" }
  });
  assert.equal(inventory.get("MED-001").available, 12);
});

test("preserves the reviewed suggestion without reserving the alternative", () => {
  const inventory = createInventory();
  const before = listStock(inventory);
  assert.deepEqual(createReservation({ sku: "MED-003", quantity: 1 }, inventory), {
    status: 409,
    body: { error: "insufficient stock", available: 0, suggestion: {
      sku: "MED-004", name: "Synthetic Alternative Inhaler", available: 6
    } }
  });
  assert.deepEqual(listStock(inventory), before);
});

test("rejects unknown stock, invalid inputs and overselling", () => {
  const inventory = createInventory();
  assert.equal(createReservation({ sku: "UNKNOWN", quantity: 1 }, inventory).status, 404);
  for (const payload of [null, {}, { sku: "MED-001", quantity: 6 }, { sku: "MED-001", quantity: -1 }]) {
    assert.equal(createReservation(payload, inventory).status, 400);
  }
  assert.equal(createReservation({ sku: "MED-002", quantity: 4 }, inventory).status, 201);
  assert.equal(createReservation({ sku: "MED-002", quantity: 1 }, inventory).status, 409);
  assert.equal(inventory.get("MED-002").available, 0);
});
