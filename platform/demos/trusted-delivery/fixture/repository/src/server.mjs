import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReservation, listStock } from "./reservations.mjs";

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "release-manifest.json");
const release = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
if (release && (!/^[0-9a-f]{40}$/.test(release.commit) || !/^\d+$/.test(release.runId))) {
  throw new Error("Invalid release identity in the deployed package");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, {
      service: "synthetic-pharmacy-reservations",
      status: "ok",
      ...(release ? { commit: release.commit, runId: release.runId } : {})
    });
  }
  if (request.method === "GET" && request.url === "/stock") {
    return json(response, 200, { items: listStock() });
  }
  if (request.method === "POST" && request.url === "/reservations") {
    let raw = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (!tooLarge) {
        raw += chunk;
        tooLarge = Buffer.byteLength(raw) > 16_384;
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        json(response, 413, { error: "request_too_large" });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        json(response, 400, { error: "invalid_json" });
        return;
      }
      const result = createReservation(payload);
      json(response, result.status, result.body);
    });
    return;
  }
  json(response, 404, { error: "not_found" });
});

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`synthetic pharmacy listening on ${port}`));
}
