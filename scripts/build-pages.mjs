import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const output = resolve("site");
const copiedPaths = [
  "app.js",
  "archive.js",
  "camera.js",
  "csg.js",
  "geometry.js",
  "index.html",
  "manifest.webmanifest",
  "math.js",
  "persistence.js",
  "renderer.js",
  "stl.js",
  "styles.css",
  "sw.js",
  "icons"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(copiedPaths.map((path) => cp(resolve(root, path), resolve(output, path), { recursive: true })));
await writeFile(resolve(output, ".nojekyll"), "");

console.log("Assembled static GitHub Pages artifact in site/.");
