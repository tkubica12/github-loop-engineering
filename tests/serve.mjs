import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { root } from "./validation.mjs";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const server = createServer((request, response) => {
  let requested;
  try {
    requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    response.writeHead(400).end("Invalid path");
    return;
  }
  const relativePath = normalize(requested).replace(/^([/\\])+/, "");
  let path = resolve(root, relativePath || "docs/index.html");
  const parts = relativePath.split(sep);
  if ((path !== root && !path.startsWith(`${root}${sep}`)) ||
      parts.some((part) => part.startsWith(".") || part === "node_modules")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`Workshop available at http://127.0.0.1:${server.address().port}/docs/`);
});
