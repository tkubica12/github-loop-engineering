import assert from "node:assert/strict";
import test from "node:test";
import { createInventory, createReservation, listStock } from "../src/reservations.mjs";

test("the quantity contract rejects non-integers and keeps rejected stock unchanged", () => {
  for (const quantity of [0, -1, 6, 1.5, "1", true, null]) {
    const inventory = createInventory();
    const before = listStock(inventory);
    assert.equal(createReservation({ sku: "MED-001", quantity }, inventory).status, 400);
    assert.deepEqual(listStock(inventory), before);
  }
});

test("the inclusive upper boundary reserves exactly five items", () => {
  const inventory = createInventory();
  const result = createReservation({ sku: "MED-001", quantity: 5 }, inventory);
  assert.equal(result.status, 201);
  assert.equal(result.body.remaining, 7);
  assert.equal(inventory.get("MED-001").available, 7);
});
