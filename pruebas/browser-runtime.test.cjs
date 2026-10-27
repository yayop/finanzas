"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, rmSync} = require("node:fs");
const {execFileSync} = require("node:child_process");
const {tmpdir} = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const transportSource = readFileSync(path.join(root, "web/browser-model.js"), "utf8");

function browserTransport({workerFailure, revision = ""} = {}) {
  const workers = [], network = [], timers = new Map();
  let timerID = 0;
  class Worker {
    constructor(url, options) {
      if (workerFailure) throw workerFailure;
      this.url = String(url);
      this.options = options;
      this.listeners = new Map();
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    respond(message) { this.listeners.get("message")({data: message}); }
    fail() {
      const event = {prevented: false, preventDefault() { this.prevented = true; }};
      this.listeners.get("error")(event);
      return event;
    }
  }
  const window = {fetch: async (...args) => {
    network.push(args);
    return new Response("asset");
  }};
  const context = vm.createContext({
    window, document: {baseURI: "https://example.github.io/finanzas/", currentScript: {src: "https://example.github.io/finanzas/browser-model.js" + revision}},
    Worker, URL, Response, DOMException,
    setTimeout(callback) { timers.set(++timerID, callback); return timerID; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(transportSource, context, {filename: "web/browser-model.js"});
  return {api: window.finanzasApi, workers, network, timers};
}

test("las entradas financieras viajan al Worker, sin peticiones HTTP, desde una ruta de Pages", async () => {
  const browser = browserTransport();
  assert.equal(browser.workers.length, 0, "El motor se inicia solo al calcular");
  const body = JSON.stringify({caso: {movimientos: [{concepto: "Prueba privada", importe: "123.45"}]}, escenario: {regla: "mitades"}});
  const pending = browser.api("/api/simular", {method: "POST", body});
  const worker = browser.workers[0];
  assert.equal(worker.url, "https://example.github.io/finanzas/model-worker.js");
  assert.equal(worker.options.type, "module");
  assert.equal(browser.network.length, 0);
  assert.equal(worker.messages.length, 1);
  const request = worker.messages[0];
  assert.equal(request.route, "/api/simular");
  assert.equal(request.method, "POST");
  assert.equal(request.body, body);
  worker.respond({id: request.id, status: 200, body: JSON.stringify({meses: [{mes: "2026-11"}]})});
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), {meses: [{mes: "2026-11"}]});
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.network.length, 0);
});

test("las rutas relativas conservan errores de validación y separan respuestas concurrentes", async () => {
  const browser = browserTransport();
  const first = browser.api("api/migrar", {method: "POST", body: "{}"});
  const second = browser.api("/finanzas/api/simular", {method: "POST", body: "{}"});
  assert.equal(browser.workers.length, 1);
  const worker = browser.workers[0], [a, b] = worker.messages;
  assert.notEqual(a.id, b.id);
  assert.equal(a.route, "/api/migrar");
  assert.equal(b.route, "/api/simular");
  worker.respond({id: b.id, status: 400, body: JSON.stringify({error: "Importe inválido"})});
  worker.respond({id: a.id, status: 200, body: JSON.stringify({version: 2})});
  assert.deepEqual(await (await first).json(), {version: 2});
  const invalid = await second;
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {error: "Importe inválido"});
  assert.equal(browser.network.length, 0);
  assert.equal(browser.timers.size, 0);
});

test("los recursos que no son API usan fetch sin iniciar el motor", async () => {
  const browser = browserTransport();
  const options = {cache: "no-store"};
  const response = await browser.api("styles.css", options);
  assert.equal(await response.text(), "asset");
  assert.equal(browser.workers.length, 0);
  assert.equal(browser.network.length, 1);
  assert.equal(browser.network[0][0], "styles.css");
  assert.equal(browser.network[0][1], options);
});

test("una señal ya cancelada no inicia el motor ni transmite datos", async () => {
  const browser = browserTransport(), controller = new AbortController();
  controller.abort();
  await assert.rejects(browser.api("/api/simular", {method: "POST", body: "privado", signal: controller.signal}), {name: "AbortError"});
  assert.equal(browser.workers.length, 0);
  assert.equal(browser.network.length, 0);
  assert.equal(browser.timers.size, 0);
});

test("cancelar un cálculo ignora su respuesta tardía y permite el siguiente", async () => {
  const browser = browserTransport(), controller = new AbortController();
  const pending = browser.api("/api/simular", {signal: controller.signal});
  const cancelled = assert.rejects(pending, {name: "AbortError"});
  const worker = browser.workers[0], first = worker.messages[0];
  controller.abort();
  await cancelled;
  assert.equal(browser.timers.size, 0);
  worker.respond({id: first.id, status: 200, body: "{}"});
  const next = browser.api("/api/simular");
  const second = worker.messages[1];
  worker.respond({id: second.id, status: 200, body: JSON.stringify({actual: true})});
  assert.deepEqual(await (await next).json(), {actual: true});
  assert.equal(browser.network.length, 0);
  assert.equal(browser.timers.size, 0);
});

test("un fallo del Worker rechaza pendientes y permite reiniciar el motor", async () => {
  const browser = browserTransport();
  const first = browser.api("/api/inicial");
  const second = browser.api("/api/simular", {method: "POST", body: "{}"});
  const failureA = assert.rejects(first, /No se pudo iniciar el cálculo/);
  const failureB = assert.rejects(second, /No se pudo iniciar el cálculo/);
  const worker = browser.workers[0];
  assert.equal(worker.fail().prevented, true);
  await Promise.all([failureA, failureB]);
  assert.equal(worker.terminated, true);
  assert.equal(browser.timers.size, 0);
  const retry = browser.api("/api/inicial");
  assert.equal(browser.workers.length, 2);
  const fresh = browser.workers[1], request = fresh.messages[0];
  fresh.respond({id: request.id, status: 200, body: "{}"});
  assert.equal((await retry).ok, true);
  assert.equal(browser.network.length, 0);
});

test("un motor que no responde vence sin dejar una solicitud pendiente", async () => {
  const browser = browserTransport();
  const pending = browser.api("/api/simular");
  const rejected = assert.rejects(pending, /tardando demasiado/);
  const timeout = [...browser.timers.values()][0];
  timeout();
  await rejected;
  assert.equal(browser.timers.size, 0);
  const worker = browser.workers[0];
  worker.respond({id: worker.messages[0].id, status: 200, body: "{}"});
  assert.equal(browser.network.length, 0);
});

test("un error al crear el Worker limpia el temporizador", async () => {
  const browser = browserTransport({workerFailure: new Error("Worker bloqueado")});
  await assert.rejects(browser.api("/api/simular"), /Worker bloqueado/);
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.network.length, 0);
});

test("el build estático incluye solo archivos permitidos y carga operativa y transporte antes del editor", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "finanzas-pages-test-"));
  try {
    const assets = [
      ...["index.html", "styles.css", "app.js", "operativa.js", "browser-model.js", "model-worker.js"].map((name) => "web/" + name),
      ...["modelo.py", "operativa.py", "migracion.py", "simular_ejemplo.py"].map((name) => "scripts/" + name),
      "ejemplos/caso_ficticio.json"
    ];
    for (const asset of assets) {
      const destination = path.join(temporary, asset);
      mkdirSync(path.dirname(destination), {recursive: true});
      copyFileSync(path.join(root, asset), destination);
    }
    for (const folder of ["datos", "resultados", "outputs"]) {
      mkdirSync(path.join(temporary, folder));
      writeFileSync(path.join(temporary, folder, "privado.json"), "NO PUBLICAR");
    }
    writeFileSync(path.join(temporary, ".env"), "NO PUBLICAR");
    execFileSync("python3", ["-c", "import runpy, sys; from pathlib import Path; m=runpy.run_path(sys.argv[1]); f=m['preparar']; f.__globals__['RAIZ']=Path(sys.argv[2]); f.__globals__['DESTINO']=Path(sys.argv[2])/'dist'; f()", path.join(root, "scripts/preparar_pages.py"), temporary], {encoding: "utf8"});
    const dist = path.join(temporary, "dist");
    function files(directory) {
      return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)).map((name) => entry.name + "/" + name) : [entry.name]).sort();
    }
    assert.deepEqual(files(dist), [".nojekyll", "app.js", "browser-model.js", "ejemplos/caso_ficticio.json", "index.html", "model-worker.js", "operativa.js", "python/migracion.py", "python/modelo.py", "python/operativa.py", "python/simular_ejemplo.py", "styles.css"]);
    const html = readFileSync(path.join(dist, "index.html"), "utf8");
    const version = html.match(/browser-model\.js\?v=([a-f0-9]{12})/)[1];
    const transport = `<script src="browser-model.js?v=${version}" defer></script>`;
    const operations = `<script src="operativa.js?v=${version}" defer></script>`;
    const app = `<script src="app.js?v=${version}" defer></script>`;
    assert.ok(html.includes(transport));
    assert.ok(html.includes(operations));
    assert.ok(html.indexOf(transport) < html.indexOf(app));
    assert.ok(html.indexOf(operations) < html.indexOf(app));
    assert.doesNotMatch(html, /(?:src|href)="\/(?:app\.js|styles\.css|browser-model\.js|operativa\.js)/);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});


test("el Worker conserva la versión del despliegue para evitar código antiguo en caché", async () => {
  const browser = browserTransport({revision: "?v=123abc456def"});
  const pending = browser.api("/api/simular", {method: "POST", body: "{}"});
  const worker = browser.workers[0];
  assert.equal(worker.url, "https://example.github.io/finanzas/model-worker.js?v=123abc456def");
  worker.respond({id: worker.messages[0].id, status: 200, body: "{}"});
  assert.equal((await pending).ok, true);
});
