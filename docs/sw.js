// Service Worker: macht die Browser-Version nach dem ersten Laden offline nutzbar.
// Eigene Dateien: erst Netz (für Updates), dann Cache. Bibliotheken vom CDN: Cache zuerst.
// Die KI-Modelle speichert WebLLM selbst im Browser-Cache.
const CACHE = "codetrainer-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function netzZuerst(req) {
  const cache = await caches.open(CACHE);
  try {
    const antwort = await fetch(req);
    if (antwort.ok) cache.put(req, antwort.clone());
    return antwort;
  } catch (err) {
    const treffer = await cache.match(req, { ignoreSearch: true });
    if (treffer) return treffer;
    throw err;
  }
}

async function cacheZuerst(req) {
  const cache = await caches.open(CACHE);
  const treffer = await cache.match(req);
  if (treffer) return treffer;
  const antwort = await fetch(req);
  if (antwort.ok) cache.put(req, antwort.clone());
  return antwort;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/api/")) return;
    e.respondWith(netzZuerst(req));
  } else if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(cacheZuerst(req));
  }
});
