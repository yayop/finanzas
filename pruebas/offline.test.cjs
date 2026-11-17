"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const base = "https://example.github.io/finanzas/";
const version = "abcdef123456";
const cacheName = "finanzas-pareja-shell-" + version;
const assets = ["./", "index.html", ...["app.js", "styles.css", "browser-model.js", "model-worker.js", "python/modelo.py", "python/operativa.py", "ejemplos/caso_ficticio.json"].map((name) => name + "?v=" + version)];
const runtime = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const source = readFileSync(path.join(root, "web/service-worker.js"), "utf8")
  .replace("__FINANZAS_VERSION__", version).replace("__FINANZAS_ASSETS__", JSON.stringify(assets));

function offlineWorker(options = {}) {
  const handlers = new Map(), stores = new Map(), network = [], added = [], deleted = [];
  let offline = false, skipped = 0, claimed = 0;
  const key = (request) => new URL(typeof request === "string" ? request : request.url, base).href;
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  async function fetch(request) {
    const url = key(request);
    network.push(url);
    if (offline) throw new Error("Offline");
    return new Response("Network " + url, {status: options.status || 200});
  }
  const caches = {
    async open(name) {
      if (options.openFailure) throw new Error("Cache unavailable");
      const entries = store(name);
      return {
        async addAll(values) {
          added.push(...values);
          for (const value of values) entries.set(key(value), await fetch(value));
        },
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) {
          if (options.putFailure) throw new Error("Quota exceeded");
          entries.set(key(request), response.clone());
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deleted.push(name); return stores.delete(name); }
  };
  const self = {location: {href: base + "service-worker.js"},
    addEventListener(name, callback) { handlers.set(name, callback); },
    async skipWaiting() { skipped++; }, clients: {async claim() { claimed++; }}
  };
  vm.runInNewContext(source, {self, caches, fetch, URL, Set}, {filename: "web/service-worker.js"});
  function lifecycle(name) {
    let pending;
    handlers.get(name)({waitUntil(value) { pending = value; }});
    return pending;
  }
  function request(url, {method = "GET", mode = "cors"} = {}) {
    let result;
    handlers.get("fetch")({request: {url: new URL(url, base).href, method, mode}, respondWith(value) { result = value; }});
    return result;
  }
  return {request, lifecycle, stores, added, deleted, network, setOffline(value) { offline = value; }, store,
    get skipped() { return skipped; }, get claimed() { return claimed; }};
}

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function offlineTransport({registerPending = false, readyPending = false, registerFailure = false} = {}) {
  const workers = [], network = [], timers = new Map(), listeners = new Map(), registrations = [];
  let sequence = 0;
  const never = new Promise(() => {});
  const serviceWorker = {
    controller: null,
    ready: readyPending ? never : Promise.resolve({}),
    register(url, options) {
      registrations.push({url: String(url), options});
      if (registerFailure) return Promise.reject(new Error("Install failed"));
      return registerPending ? never : Promise.resolve({});
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); }
  };
  class Worker {
    constructor(url) { this.url = String(url); this.messages = []; this.listeners = new Map(); workers.push(this); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    postMessage(message) { this.messages.push(message); }
    respond() { const message = this.messages[0]; this.listeners.get("message")({data: {id: message.id, status: 200, body: "{}"}}); }
  }
  const window = {fetch(...args) { network.push(args); return Promise.resolve(new Response("Network")); }};
  const context = {window, navigator: {serviceWorker}, document: {baseURI: base, currentScript: {src: base + "browser-model.js?v=" + version}},
    Worker, URL, Response, DOMException,
    setTimeout(callback, delay) { timers.set(++sequence, {callback, delay}); return sequence; }, clearTimeout(id) { timers.delete(id); }};
  vm.runInNewContext(readFileSync(path.join(root, "web/browser-model.js"), "utf8"), context, {filename: "web/browser-model.js"});
  function timeout(delay) {
    const timer = [...timers.values()].find((value) => value.delay === delay);
    assert.ok(timer, "Expected timeout " + delay);
    timer.callback();
  }
  return {api: window.finanzasApi, workers, network, timers, listeners, serviceWorker, registrations, timeout};
}

test("la instalación almacena únicamente la lista pública y conserva el shell para abrir sin conexión", async () => {
  const worker = offlineWorker();
  await worker.lifecycle("install");
  assert.deepEqual(worker.added, assets);
  assert.equal(worker.skipped, 1);
  assert.deepEqual([...worker.store(cacheName).keys()].sort(), assets.map((asset) => new URL(asset, base).href).sort());
  worker.setOffline(true);
  assert.match(await (await worker.request("./", {mode: "navigate"})).text(), /Network .*finanzas\/$/);
  const calls = worker.network.length;
  assert.match(await (await worker.request("app.js?v=" + version)).text(), /app\.js/);
  assert.match(await (await worker.request("python/modelo.py?v=" + version)).text(), /modelo\.py/);
  assert.equal(worker.network.length, calls, "Los recursos instalados salen de caché");
});

test("el runtime Python fijado queda disponible sin conexión después de su primera carga", async () => {
  const worker = offlineWorker();
  for (const file of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"]) {
    assert.equal((await worker.request(runtime + file)).ok, true);
  }
  const calls = worker.network.length;
  worker.setOffline(true);
  for (const file of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"]) {
    assert.equal((await worker.request(runtime + file)).ok, true);
  }
  assert.equal(worker.network.length, calls);
});

test("la caché excluye datos financieros, API, URL desconocidas y otros dominios", () => {
  const worker = offlineWorker();
  const ignored = [
    ["api/simular", {method: "POST"}], ["api/migrar", {method: "POST"}], ["api/inicial"],
    ["api/simular?importe=123"], ["datos/plan_privado.json"], ["outputs/resultado.json"],
    ["app.js?v=" + version, {method: "POST"}], ["app.js?importe=123"],
    ["https://other.example/app.js?v=" + version],
    [runtime.replace("314.0.7", "314.0.8") + "pyodide.mjs"],
    [runtime + "unknown.json"], [runtime + "pyodide.mjs?privado=123"]
  ];
  for (const [url, options] of ignored) assert.equal(worker.request(url, options), undefined, url);
  assert.equal(worker.network.length, 0);
  assert.equal(worker.stores.size, 0);
});

test("activar una versión elimina solo cachés anteriores de esta aplicación", async () => {
  const worker = offlineWorker();
  worker.store("finanzas-pareja-shell-old"); worker.store(cacheName); worker.store("other-application");
  await worker.lifecycle("activate");
  assert.deepEqual(worker.deleted, ["finanzas-pareja-shell-old"]);
  assert.equal(worker.stores.has(cacheName), true);
  assert.equal(worker.stores.has("other-application"), true);
  assert.equal(worker.claimed, 1);
});

test("los fallos de almacenamiento permiten seguir cargando el motor desde la red", async () => {
  for (const options of [{openFailure: true}, {putFailure: true}]) {
    const worker = offlineWorker(options);
    const response = await worker.request(runtime + "pyodide.asm.wasm");
    assert.equal(response.ok, true);
    assert.match(await response.text(), /pyodide\.asm\.wasm/);
    assert.equal(worker.network.length, 1);
  }
});

test("una navegación fallida usa el shell guardado, sin convertir fallos en páginas vacías", async () => {
  const worker = offlineWorker();
  worker.store(cacheName).set(base, new Response("Stored page"));
  worker.setOffline(true);
  assert.equal(await (await worker.request("index.html", {mode: "navigate"})).text(), "Stored page");
  const missing = offlineWorker();
  missing.setOffline(true);
  await assert.rejects(missing.request("./", {mode: "navigate"}), /Offline/);
});

test("una instalación o activación que no termina libera el cálculo al vencer la espera", async () => {
  for (const options of [{registerPending: true}, {readyPending: true}]) {
    const browser = offlineTransport(options);
    const pending = browser.api("api/simular", {method: "POST", body: "privado"});
    await settle();
    assert.equal(browser.workers.length, 0);
    browser.timeout(4000);
    await settle();
    assert.equal(browser.workers.length, 1);
    assert.equal(browser.workers[0].messages[0].body, "privado");
    assert.equal(browser.network.length, 0);
    browser.workers[0].respond();
    assert.equal((await pending).ok, true);
    assert.equal(browser.timers.size, 0);
    assert.equal(browser.listeners.size, 0);
  }
});

test("el primer cálculo espera a que el Service Worker controle la página y limpia la espera", async () => {
  const browser = offlineTransport();
  const pending = browser.api("api/simular", {method: "POST", body: "{}"});
  await settle();
  assert.equal(browser.workers.length, 0);
  assert.equal(browser.registrations[0].url, base + "service-worker.js");
  assert.equal(browser.registrations[0].options.scope, "./");
  browser.serviceWorker.controller = {};
  browser.listeners.get("controllerchange")();
  await settle();
  assert.equal(browser.workers.length, 1);
  browser.workers[0].respond();
  await pending;
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.listeners.size, 0);
});

test("una instalación rechazada conserva el cálculo online y una cancelación evita iniciarlo", async () => {
  const rejected = offlineTransport({registerFailure: true});
  const pending = rejected.api("api/simular");
  await settle();
  assert.equal(rejected.workers.length, 1);
  rejected.workers[0].respond();
  await pending;
  assert.equal(rejected.timers.size, 0);
  const cancelled = offlineTransport({readyPending: true}), controller = new AbortController();
  const result = cancelled.api("api/simular", {signal: controller.signal});
  const assertion = assert.rejects(result, {name: "AbortError"});
  controller.abort();
  await assertion;
  cancelled.timeout(4000);
  await settle();
  assert.equal(cancelled.workers.length, 0);
  assert.equal(cancelled.timers.size, 0);
});
