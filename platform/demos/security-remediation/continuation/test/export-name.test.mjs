import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { buildServer } from "../src/server.mjs";

test("rejects malformed export name encoding", async () => {
  const server = buildServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/exports/%`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid export name" });
  } finally {
    const closed = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server.closeAllConnections();
    await closed;
  }
});
