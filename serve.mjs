import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";

const root = resolve(".");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

const server = createServer((request, response) => {
  let requestPath;
  try {
    requestPath = decodeURIComponent(request.url?.split("?")[0] ?? "/");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid path");
    return;
  }
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);

  if (pathFromRoot === ".." || pathFromRoot.startsWith("../") || pathFromRoot.startsWith("..\\") || pathFromRoot === "" || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`vibe-up is available at http://localhost:${port}`);
});
