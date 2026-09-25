import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInventory, listStock, reserve } from "./inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = join(root, "data");
const releasePath = join(root, "release-manifest.json");
const release = existsSync(releasePath) ? JSON.parse(readFileSync(releasePath, "utf8")) : null;
if (release && (!/^[a-f0-9]{40}$/.test(release.commit) || !/^\d+$/.test(release.runId))) {
  throw new Error("Invalid packaged release identity");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function buildServer() {
  const inventory = createInventory();
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { service: "synthetic-pharmacy", status: "ok",
        ...(release ? { commit: release.commit, runId: release.runId } : {}) });
      return;
    }
    if (request.method === "GET" && request.url === "/stock") {
      json(response, 200, { items: listStock(inventory) });
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/exports/")) {
      let filename;
      try {
        filename = decodeURIComponent(request.url.slice(9)); // "/exports/" prefix
      } catch {
        json(response, 400, { error: "invalid export name" });
        return;
      }
      if (filename !== "stock.json") {
        json(response, 404, { error: "export not found" });
        return;
      }
      try {
        const content = readFileSync(join(dataDirectory, "stock.json"), "utf8");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(content);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") {
          json(response, 404, { error: "export not found" });
        } else {
          console.error("Export request failed");
          json(response, 500, { error: "export unavailable" });
        }
      }
      return;
    }
    if (request.method === "POST" && request.url === "/reservations") {
      let raw = "";
      try {
        for await (const chunk of request) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 16_384) {
            json(response, 413, { error: "request too large" });
            return;
          }
        }
      } catch {
        console.error("Reservation request body was interrupted");
        if (!response.destroyed) json(response, 400, { error: "request interrupted" });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        json(response, 400, { error: "invalid JSON" });
        return;
      }
      const result = reserve(inventory, payload);
      json(response, result.status, result.body);
      return;
    }
    json(response, 404, { error: "route not found" });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = buildServer();
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1", () => {
    console.log(`Synthetic pharmacy listening on port ${server.address().port}`);
  });
}
