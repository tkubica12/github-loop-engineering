const seed = [
  { sku: "MED-001", name: "Synthetic Analgesic", category: "pain-relief", available: 12 },
  { sku: "MED-002", name: "Synthetic Antibiotic", category: "antibiotic", available: 4 },
  { sku: "MED-003", name: "Synthetic Inhaler", category: "respiratory", available: 0 },
  { sku: "MED-004", name: "Synthetic Alternative Inhaler", category: "respiratory", available: 6 }
];

export function createInventory() {
  return new Map(seed.map((item) => [item.sku, { ...item }]));
}

export function listStock(inventory) {
  return [...inventory.values()].map((item) => ({ ...item }));
}

export function reserve(inventory, request) {
  if (!request || typeof request.sku !== "string") {
    return { status: 400, body: { error: "sku is required" } };
  }
  if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 5) {
    return { status: 400, body: { error: "quantity must be an integer from 1 to 5" } };
  }

  const item = inventory.get(request.sku);
  if (!item) {
    return { status: 404, body: { error: "medicine not found" } };
  }
  if (item.available < request.quantity) {
    const alternative = [...inventory.values()]
      .filter(
        (candidate) => candidate.category === item.category
          && candidate.sku !== item.sku
          && candidate.available >= request.quantity
      )
      .sort((left, right) => left.sku.localeCompare(right.sku))[0];
    return {
      status: 409,
      body: {
        error: "insufficient stock",
        available: item.available,
        ...(alternative ? {
          suggestion: {
            sku: alternative.sku,
            name: alternative.name,
            available: alternative.available
          }
        } : {})
      }
    };
  }

  item.available -= request.quantity;
  return {
    status: 201,
    body: {
      reservationId: `RSV-${request.sku}-${String(item.available).padStart(2, "0")}`,
      sku: request.sku,
      quantity: request.quantity,
      remaining: item.available
    }
  };
}
