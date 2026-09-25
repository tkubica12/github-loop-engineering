import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root } from "./validation.mjs";
import * as lab from "../docs/labs/02-intent-to-pr/artifacts/inventory.reference.mjs";
import * as delivery from "../platform/demos/trusted-delivery/fixture/repository/src/reservations.mjs";

test("delivery continues the same pharmacy behavior as the completed lab", () => {
  const labStock = lab.createInventory();
  const deliveryStock = delivery.createInventory();
  const requests = [
    { sku: "MED-003", quantity: 1 },
    { sku: "MED-004", quantity: 2 },
    { sku: "MED-002", quantity: 4 },
    { sku: "MED-002", quantity: 1 },
    { sku: "MED-001", quantity: 0 },
    { sku: "MED-001", quantity: 6 },
    { sku: "UNKNOWN", quantity: 1 },
    null
  ];
  for (const request of requests) {
    assert.deepEqual(delivery.createReservation(request, deliveryStock), lab.reserve(labStock, request));
    assert.deepEqual(delivery.listStock(deliveryStock), lab.listStock(labStock));
  }
});

test("the delivery red state changes only the zero-quantity comparison", () => {
  const fixture = join(root, "platform", "demos", "trusted-delivery", "fixture");
  const red = readFileSync(join(fixture, "red", "reservations.mjs"), "utf8").replaceAll("\r\n", "\n");
  const green = readFileSync(join(fixture, "repository", "src", "reservations.mjs"), "utf8").replaceAll("\r\n", "\n");
  assert.notEqual(red, green);
  assert.equal(red.replace("request.quantity < 0", "request.quantity <= 0"), green);
});
