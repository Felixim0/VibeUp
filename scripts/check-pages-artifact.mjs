import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const site = resolve("site");
const required = [
  ".nojekyll",
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
  "icons/vibe-up.svg",
  "icons/vibe-up-192.png",
  "icons/vibe-up-512.png"
];

await Promise.all(required.map((path) => access(resolve(site, path))));
const [icon192, icon512] = await Promise.all([
  stat(resolve(site, "icons/vibe-up-192.png")),
  stat(resolve(site, "icons/vibe-up-512.png"))
]);
const index = await readFile(resolve(site, "index.html"), "utf8");
const manifest = JSON.parse(await readFile(resolve(site, "manifest.webmanifest"), "utf8"));
const worker = await readFile(resolve(site, "sw.js"), "utf8");

if (!index.includes('href="./manifest.webmanifest"') || !index.includes('src="./app.js"')) {
  throw new Error("The Pages entry document must use relative manifest and module paths.");
}
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  throw new Error("The web manifest must remain relative for GitHub Pages project sites.");
}
if (!worker.includes('"./manifest.webmanifest"') || !worker.includes('"./icons/vibe-up-192.png"')) {
  throw new Error("The service worker is missing required Pages PWA assets.");
}
if (icon192.size < 500 || icon512.size < 500) {
  throw new Error("The Pages PWA icon assets are unexpectedly small.");
}

console.log("GitHub Pages artifact paths and PWA configuration are valid.");
