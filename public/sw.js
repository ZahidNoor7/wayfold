/*
 * Wayfold service worker.
 *
 * A service worker is scoped to one origin, and every tenant storefront is its
 * own origin, so caches can never be shared between tenants or with the
 * dashboard. Within an origin the rules are deliberately conservative:
 *
 *   - HTML, data and anything authenticated always come from the network and
 *     are never stored. Offline, a navigation shows /offline.html.
 *   - Only content-hashed build assets under /_next/static are cached; their
 *     URLs change whenever their content does.
 *   - Requests that are not same-origin GETs are not touched at all.
 */
const VERSION = "wf-v1";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  // The page asks for this after the user accepts an update.
  if (type === "SKIP_WAITING") self.skipWaiting();
  // Sent on sign-out and workspace switch: drop everything fetched so far.
  if (type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name !== SHELL_CACHE).map((name) => caches.delete(name)));
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      })(),
    );
  }
  // Everything else: straight to the network, nothing stored.
});
