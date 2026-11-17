/* Only public application and pinned Python-runtime files enter this cache. */
const VERSION = "91273568d127";
const CACHE = "finanzas-pareja-shell-" + VERSION;
const ASSETS = ["./", "index.html", "styles.css?v=91273568d127", "app.js?v=91273568d127", "operativa.js?v=91273568d127", "equivalencia.js?v=91273568d127", "progresividad.js?v=91273568d127", "historial.js?v=91273568d127", "browser-model.js?v=91273568d127", "model-worker.js?v=91273568d127", "python/modelo.py?v=91273568d127", "python/operativa.py?v=91273568d127", "python/migracion.py?v=91273568d127", "python/simular_ejemplo.py?v=91273568d127", "ejemplos/caso_ficticio.json?v=91273568d127"];
const BASE = new URL("./", self.location.href);
const publicURLs = new Set(ASSETS.map((asset) => new URL(asset, BASE).href));
const RUNTIME = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const runtimeURLs = new Set(["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"].map((name) => RUNTIME + name));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.allSettled(keys.filter((key) => key.startsWith("finanzas-pareja-shell-") && key !== CACHE).map((key) => caches.delete(key))))
    .catch(() => {}).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (!publicURLs.has(request.url) && !runtimeURLs.has(request.url)) return;
  event.respondWith((async () => {
    let cache = null, cached = null;
    try {
      cache = await caches.open(CACHE);
      cached = await cache.match(request);
    } catch { /* La red sigue disponible si el navegador rechaza la caché. */ }
    if (cached && request.mode !== "navigate") return cached;
    try {
      const response = await fetch(request);
      if (!response.ok && cached) return cached;
      if (response.ok && cache) {
        try { await cache.put(request, response.clone()); }
        catch { /* Un límite de almacenamiento no invalida la respuesta de red. */ }
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      if (request.mode === "navigate" && cache) {
        try {
          const page = await cache.match(BASE.href);
          if (page) return page;
        } catch { /* Se conserva el error de red cuando no hay copia disponible. */ }
      }
      throw error;
    }
  })());
});
