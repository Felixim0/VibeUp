const CACHE_NAME = "vibe-up-static-v18";
const CACHE_PREFIX = "vibe-up-static-";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./math.js",
  "./geometry.js",
  "./camera.js",
  "./archive.js",
  "./stl.js",
  "./persistence.js",
  "./renderer.js",
  "./csg.js",
  "./manifest.webmanifest",
  "./icons/vibe-up.svg",
  "./icons/vibe-up-192.png",
  "./icons/vibe-up-512.png",
  "./icons/cursor-select.svg",
  "./icons/cursor-move.svg",
  "./icons/cursor-rotate.svg",
  "./icons/cursor-draw.svg",
  "./icons/cursor-measure.svg",
  "./icons/cursor-paint.svg",
  "./icons/cursor-erase.svg",
  "./icons/cursor-pushpull.svg",
  "./icons/cursor-orbit.svg",
  "./icons/cursor-pan.svg",
  "./icons/cursor-zoom.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .catch(() => caches.match("./index.html"));
    })
  );
});
