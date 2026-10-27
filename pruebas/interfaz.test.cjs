"use strict";

const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {spawn} = require("node:child_process");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "web/app.js"), "utf8").replace(/\binitialize\(\);\s*$/, "");
const legacyCase = JSON.parse(readFileSync(path.join(root, "ejemplos/caso_ficticio.json"), "utf8"));
const copy = (value) => JSON.parse(JSON.stringify(value));
let server, baseURL;

before(async () => {
  server = spawn("python3", ["-u", "-c", "from scripts.servidor import crear_servidor; s=crear_servidor(0); print(s.server_port,flush=True); s.serve_forever()"], {cwd: root, stdio: ["ignore", "pipe", "pipe"]});
  baseURL = await new Promise((resolve, reject) => {
    let output = "", errors = "";
    const timeout = setTimeout(() => reject(new Error("El servidor de prueba no arrancó: " + errors)), 10000);
    server.stderr.on("data", (chunk) => { errors += chunk; });
    server.on("error", reject);
    server.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("\n")) {
        clearTimeout(timeout);
        resolve("http://127.0.0.1:" + Number(output.trim().split("\n")[0]));
      }
    });
    server.on("exit", (code) => { if (!baseURL) { clearTimeout(timeout); reject(new Error("Servidor terminado: " + code + " " + errors)); } });
  });
});

after(() => { server?.kill(); });

// The stub checks application wiring and API results; visual layout is outside this test.
function createApp(saved = {}) {
  const nodes = new Map(), storage = new Map(Object.entries(saved)), timers = new Map();
  let timerId = 0;
  function node(selector) {
    if (nodes.has(selector)) return nodes.get(selector);
    const classes = new Set();
    const value = {innerHTML: "", textContent: "", hidden: true, value: "", dataset: {}, style: {},
      classList: {add: (...items) => items.forEach((item) => classes.add(item)), remove: (...items) => items.forEach((item) => classes.delete(item)), contains: (item) => classes.has(item)},
      listeners: new Map(),
      setAttribute(name, value) { this[name] = String(value); },
      addEventListener(name, callback) { const callbacks = this.listeners.get(name) || []; callbacks.push(callback); this.listeners.set(name, callbacks); }, checkValidity: () => true,
      focus() {}, select() {}, click() {}, closest: () => null,
      querySelector: (child) => node(selector + " " + child), querySelectorAll: () => []};
    nodes.set(selector, value);
    return value;
  }
  const context = vm.createContext({
    document: {querySelector: node, querySelectorAll: () => [], body: node("body"), createElement: (tag) => node("created-" + tag)},
    window: {innerWidth: 1200},
    localStorage: {getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value))},
    fetch: (url, options) => fetch(new URL(url, baseURL), options), crypto: webcrypto,
    AbortController, URL, Blob, console,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  });
  vm.runInContext(source + "\nglobalThis.app = {state, initialize, preparePlan, requestCalculation, handleControl, handleArrayActions, calculate, importPlan, restoreSavedPlan};", context, {filename: "web/app.js"});
  return {...context.app, nodes, storage};
}

async function fire(app, selector, name = "click") {
  for (const callback of app.nodes.get(selector).listeners.get(name) || []) await callback({target: app.nodes.get(selector), preventDefault() {}});
}

async function loadExample(app) {
  await app.initialize();
  const input = JSON.stringify({version: 1, caso: copy(legacyCase), escenario: copy(legacyCase.escenarios[0])});
  await app.importPlan({size: input.length, text: async () => input});
  await fire(app, "#save-reference");
}

function edit(app, index, property, value) {
  const input = {dataset: {path: `caso.movimientos.${index}.${property}`, kind: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string"}, value: String(value), checked: value, type: "text", closest: (selector) => selector === "[data-path]" ? input : null};
  app.handleControl({target: input});
}

function editName(app, person, value) {
  const input = {dataset: {path: `caso.personas.${person}.nombre`, kind: "string"}, value, type: "text", closest: (selector) => selector === "[data-path]" ? input : null};
  app.handleControl({target: input});
}

function action(app, selector, dataset = {}) {
  const button = {dataset};
  app.handleArrayActions({target: {closest: (query) => query === selector ? button : null}});
}

function row(app, month = "2026-11") {
  return app.state.result.meses.find((item) => item.mes === month);
}

test("cada apertura inicia vacía, con saldos en cero y sin movimientos", async () => {
  const app = createApp();
  await app.initialize();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.deepEqual(copy(app.state.caso.movimientos), []);
  assert.equal(Number(app.state.caso.personas.el.saldo_inicial_eur), 0);
  assert.equal(Number(app.state.caso.personas.ella.saldo_inicial_eur), 0);
  assert.ok(app.state.result.meses.every((month) => month.hogar.flujo_libre_centimos_eur === 0 && month.hogar.saldo_final_centimos_eur === 0));
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  assert.equal(app.state.caso.inicio, current);
  assert.equal(app.state.result.meses.length, 12);
  assert.equal(app.storage.has("finanzas-pareja-plan-v2"), false);
});

test("abrir no recupera ni reemplaza automáticamente el último plan guardado", async () => {
  const serialized = JSON.stringify({version: 1, caso: copy(legacyCase), escenario: copy(legacyCase.escenarios[0])});
  const app = createApp({"finanzas-pareja-plan-v2": serialized});
  await app.initialize();
  assert.equal(app.state.caso.movimientos.length, 0);
  assert.equal(app.storage.get("finanzas-pareja-plan-v2"), serialized);
  assert.equal(app.nodes.get("#restore-plan").hidden, false);
  await app.restoreSavedPlan();
  assert.ok(app.state.caso.movimientos.length > 10);
  assert.equal(row(app).flujo_libre_centimos_eur.el, 165000);
});

test("Nuevo vacía el plan y la referencia sin borrar el último plan recuperable", async () => {
  const app = createApp();
  await loadExample(app);
  const saved = app.storage.get("finanzas-pareja-plan-v2");
  app.state.filter = "deuda";
  app.state.search = "universidad";
  app.state.undoMovement = {index: 0, movement: copy(app.state.caso.movimientos[0])};
  await fire(app, "#reset");
  assert.deepEqual(copy(app.state.caso.movimientos), []);
  assert.equal(app.state.reference, null);
  assert.equal(app.state.filter, "todos");
  assert.equal(app.state.search, "");
  assert.equal(app.state.undoMovement, null);
  assert.equal(app.storage.get("finanzas-pareja-plan-v2"), saved);
  assert.ok(app.state.result.meses.every((month) => month.hogar.saldo_final_centimos_eur === 0));
});

test("importar un ejemplo renderiza el editor y conserva sus resultados", async () => {
  const app = createApp();
  await loadExample(app);
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.equal(row(app).flujo_libre_centimos_eur.el, 165000);
  assert.equal(row(app).flujo_libre_centimos_eur.ella, 64000);
  assert.ok(app.state.caso.movimientos.length > 10);
  assert.match(app.nodes.get("#controls").innerHTML, /data-add-movement="deuda"/);
  assert.match(app.nodes.get("#movement-list").innerHTML, /data-summary-concept/);
  assert.match(app.nodes.get("#chart").innerHTML, /<svg/);
  assert.equal(JSON.parse(app.storage.get("finanzas-pareja-plan-v2")).version, 2);
});

test("los nombres iniciales aparecen en el editor, los movimientos y los resultados", async () => {
  const app = createApp();
  await loadExample(app);
  assert.equal(app.state.caso.personas.el.nombre, "Yayo");
  assert.equal(app.state.caso.personas.ella.nombre, "Fer");
  assert.match(app.nodes.get("#controls").innerHTML, /data-path="caso\.personas\.el\.nombre"/);
  assert.match(app.nodes.get("#controls").innerHTML, /data-path="caso\.personas\.ella\.nombre"/);
  assert.match(app.nodes.get("#movement-list").innerHTML, /value="el"[^>]*>Yayo<\/option>/);
  assert.match(app.nodes.get("#movement-list").innerHTML, /value="ella"[^>]*>Fer<\/option>/);
  assert.equal(app.nodes.get("#legend-el").textContent, "Yayo");
  assert.equal(app.nodes.get("#legend-ella").textContent, "Fer");
  for (const selector of ["#kpis", "#monthly-table", "#month-detail", "#comparison", "#chart"]) {
    assert.match(app.nodes.get(selector).innerHTML, /Yayo/, selector);
    assert.match(app.nodes.get(selector).innerHTML, /Fer/, selector);
  }
});

test("recuperar nombres guardados conserva importes y responsables", async () => {
  const app = createApp();
  await loadExample(app);
  const previousRows = copy(app.state.result.meses);
  const previousPeople = copy(app.state.caso.movimientos.map(({persona, pagador}) => ({persona, pagador})));
  editName(app, "el", "Yayo Pérez");
  editName(app, "ella", "Fer Soto");
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.equal(app.nodes.get("#legend-el").textContent, "Yayo Pérez");
  assert.equal(app.nodes.get("#legend-ella").textContent, "Fer Soto");
  assert.match(app.nodes.get("#monthly-table").innerHTML, /Yayo Pérez/);
  assert.match(app.nodes.get("#month-detail").innerHTML, /Fer Soto/);
  assert.deepEqual(copy(app.state.result.meses), previousRows);
  assert.deepEqual(copy(app.state.caso.movimientos.map(({persona, pagador}) => ({persona, pagador}))), previousPeople);
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  assert.equal(restored.state.caso.personas.el.nombre, "Yayo Pérez");
  assert.equal(restored.state.caso.personas.ella.nombre, "Fer Soto");
  assert.match(restored.nodes.get("#movement-list").innerHTML, /Yayo Pérez/);
  assert.match(restored.nodes.get("#movement-list").innerHTML, /Fer Soto/);
  assert.deepEqual(copy(restored.state.result.meses), previousRows);
});

test("migrar nombres genéricos aplica los iniciales y respeta nombres personalizados", async () => {
  const app = createApp(), caso = copy(legacyCase);
  caso.personas.el.nombre = "Él";
  caso.personas.ella.nombre = "Ella";
  const defaults = await app.preparePlan({caso, escenario: copy(caso.escenarios[0])});
  assert.equal(defaults.caso.personas.el.nombre, "Yayo");
  assert.equal(defaults.caso.personas.ella.nombre, "Fer");
  caso.personas.el.nombre = "Andrés";
  caso.personas.ella.nombre = "Fernanda";
  const personalized = await app.preparePlan({caso, escenario: copy(caso.escenarios[0])});
  assert.equal(personalized.caso.personas.el.nombre, "Andrés");
  assert.equal(personalized.caso.personas.ella.nombre, "Fernanda");
});

test("los nombres se muestran como texto aunque contengan caracteres HTML", async () => {
  const app = createApp();
  await loadExample(app);
  const name = 'Yayo <b>& "hola"';
  const escaped = "Yayo &lt;b&gt;&amp; &quot;hola&quot;";
  editName(app, "el", name);
  editName(app, "ella", "Fer <i>");
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.equal(app.nodes.get("#legend-el").textContent, name);
  for (const selector of ["#kpis", "#monthly-table", "#month-detail", "#comparison", "#chart"]) {
    assert.ok(app.nodes.get(selector).innerHTML.includes(escaped), selector);
    assert.ok(!app.nodes.get(selector).innerHTML.includes(name), selector);
  }
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  assert.ok(restored.nodes.get("#controls").innerHTML.includes(escaped));
  assert.ok(restored.nodes.get("#movement-list").innerHTML.includes(escaped));
  assert.ok(!restored.nodes.get("#movement-list").innerHTML.includes(name));
});

test("recupera un plan v1 editado y su referencia sin borrar el archivo guardado anterior", async () => {
  const caso = copy(legacyCase), reference = {caso: copy(legacyCase), escenario: copy(legacyCase.escenarios[0])};
  caso.ingresos[0].importe_eur = "2800.00";
  caso.es_ficticio = false;
  reference.caso.ingresos[0].importe_eur = "3100.00";
  const serialized = JSON.stringify({version: 1, caso, escenario: copy(caso.escenarios[0]), reference});
  const app = createApp({"finanzas-pareja-plan-v1": serialized});
  await app.initialize();
  await app.restoreSavedPlan();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.equal(row(app).flujo_libre_centimos_eur.el, 185000);
  assert.equal(app.state.reference.result.meses[0].flujo_libre_centimos_eur.el, 215000);
  assert.equal(app.storage.get("finanzas-pareja-plan-v1"), serialized);
  const saved = JSON.parse(app.storage.get("finanzas-pareja-plan-v2"));
  assert.equal(saved.caso.movimientos.find((item) => item.id === "sueldo_inicial").importe, "2800.00");
  assert.equal(saved.reference.caso.movimientos.find((item) => item.id === "sueldo_inicial").importe, "3100.00");
});

test("añadir y editar un gasto aplica moneda, fecha, persona y recurrencia al resultado real", async () => {
  const app = createApp();
  await loadExample(app);
  action(app, "[data-add-movement]", {addMovement: "gasto"});
  const i = app.state.caso.movimientos.length - 1;
  for (const [property, value] of Object.entries({concepto: "Matrícula adicional", persona: "ella", pagador: "ella", importe: "90000", moneda: "CLP", fecha: "2026-11-15", modalidad: "recurrente", intervalo_meses: 2, hasta: "2027-03-15"})) edit(app, i, property, value);
  app.nodes.get("#chart-tooltip").hidden = false;
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.equal(app.nodes.get("#chart-tooltip").hidden, true, "El gráfico no debe conservar un tooltip del cálculo anterior");
  assert.equal(row(app).flujo_libre_centimos_eur.ella, 55000);
  assert.equal(row(app, "2026-12").flujo_libre_centimos_eur.ella, 64000);
  assert.equal(row(app, "2027-01").flujo_libre_centimos_eur.ella, 47000);
  const payment = row(app).pagos.find((item) => item.concepto === "Matrícula adicional");
  assert.equal(payment.importe_centimos_eur, 9000);
  assert.equal(payment.pagador, "ella");
  edit(app, i, "moneda", "EUR");
  edit(app, i, "importe", "90.00");
  await app.calculate();
  assert.equal(row(app).flujo_libre_centimos_eur.ella, 55000);
  assert.match(app.nodes.get("#movement-list").innerHTML, /Matrícula adicional/);
});

test("duplicar, eliminar y deshacer conserva todos los parámetros del movimiento", async () => {
  const app = createApp();
  await loadExample(app);
  const index = app.state.caso.movimientos.findIndex((item) => item.tipo === "deuda");
  const original = copy(app.state.caso.movimientos[index]), count = app.state.caso.movimientos.length;
  action(app, "[data-duplicate-movement]", {duplicateMovement: String(index)});
  const duplicated = copy(app.state.caso.movimientos.at(-1));
  assert.notEqual(duplicated.id, original.id);
  assert.deepEqual({...duplicated, id: original.id, concepto: original.concepto}, original);
  assert.equal(duplicated.concepto, original.concepto + " (copia)");
  action(app, "[data-remove-movement]", {removeMovement: String(count)});
  assert.equal(app.state.caso.movimientos.length, count);
  action(app, "#undo-movement");
  assert.deepEqual(copy(app.state.caso.movimientos.at(-1)), duplicated);
  assert.equal(app.state.undoMovement, null);
  assert.deepEqual(copy(app.state.caso.movimientos[index]), original);
});

test("preparePlan materializa las opciones antiguas sin cambiar el cálculo", async () => {
  const app = createApp(), caso = copy(legacyCase);
  const escenario = {...caso.escenarios[0], universidad_compartida: true, cuotas_universidad: 6, sustituir_chomage_por_eur: "2675.43"};
  const oldResult = await app.requestCalculation(caso, escenario);
  const migrated = await app.preparePlan({caso, escenario});
  const newResult = await app.requestCalculation(migrated.caso, migrated.escenario);
  assert.deepEqual(copy(newResult.meses.map((item) => item.flujo_libre_centimos_eur)), copy(oldResult.meses.map((item) => item.flujo_libre_centimos_eur)));
  assert.equal(migrated.caso.movimientos.find((item) => item.id === "chomage").importe, "2675.43");
  assert.ok(migrated.caso.movimientos.filter((item) => item.id.startsWith("universidad_")).every((item) => item.cuotas === 6));
});

test("una importación pendiente respeta una edición hecha después de iniciarla", async () => {
  const app = createApp();
  await loadExample(app);
  const imported = JSON.stringify({version: 2, caso: app.state.caso, escenario: app.state.escenario});
  let release;
  const text = new Promise((resolve) => { release = resolve; });
  const pending = app.importPlan({size: imported.length, text: () => text});
  edit(app, 0, "concepto", "Sueldo cambiado durante la importación");
  release(imported);
  await pending;
  assert.equal(app.state.caso.movimientos[0].concepto, "Sueldo cambiado durante la importación");
});

test("un gasto común guardado deja de tener titular exclusivo sin alterar sus cuentas", async () => {
  const app = createApp(), caso = copy(legacyCase);
  const escenario = copy(caso.escenarios[0]);
  const oldResult = await app.requestCalculation(caso, escenario);
  const migrated = await app.preparePlan({caso, escenario});
  const household = migrated.caso.movimientos.find((item) => item.id === "hogar");
  assert.equal(household.persona, "compartido");
  assert.equal(household.reparto, "regla");
  const newResult = await app.requestCalculation(migrated.caso, migrated.escenario);
  assert.deepEqual(copy(newResult.meses.map((item) => item.flujo_libre_centimos_eur)), copy(oldResult.meses.map((item) => item.flujo_libre_centimos_eur)));
  assert.deepEqual(copy(newResult.totales.saldo_final_centimos_eur), copy(oldResult.totales.saldo_final_centimos_eur));
});

test("los gastos nuevos admiten responsabilidad compartida y un porcentaje fijo por persona", async () => {
  const app = createApp();
  await loadExample(app);
  action(app, "[data-add-movement]", {addMovement: "gasto"});
  const index = app.state.caso.movimientos.length - 1;
  const movement = app.state.caso.movimientos[index];
  assert.equal(movement.persona, "compartido");
  assert.equal(movement.pagador, "el");
  assert.equal(movement.reparto, "regla");
  assert.equal(movement.porcentaje_el, "50");
  const html = app.nodes.get("#movement-list").innerHTML;
  for (const [key, label] of [["el", "Yayo"], ["ella", "Fer"], ["compartido", "Compartido"]]) {
    assert.match(html, new RegExp(`value="${key}"[^>]*>${label}</option>`));
  }
  for (const [property, value] of Object.entries({concepto: "Internet compartido", importe: "100.00", fecha: "2026-11-01", modalidad: "unico", reparto: "fijo", porcentaje_el: "25"})) edit(app, index, property, value);
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  const november = row(app);
  assert.equal(november.flujo_libre_centimos_eur.el, 162500);
  assert.equal(november.flujo_libre_centimos_eur.ella, 56500);
  assert.equal(november.hogar.flujo_libre_centimos_eur, 219000);
  const payment = november.pagos.find((item) => item.concepto === "Internet compartido");
  assert.equal(payment.persona, "compartido");
  assert.equal(payment.pagador, "el");
  assert.deepEqual(copy(payment.importe_asignado_centimos_eur), {el: 2500, ella: 7500});
  assert.equal(row(app, "2026-12").flujo_libre_centimos_eur.el, 165000);
  assert.equal(row(app, "2026-12").flujo_libre_centimos_eur.ella, 64000);
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  const saved = restored.state.caso.movimientos.find((item) => item.id === movement.id);
  assert.equal(saved.persona, "compartido");
  assert.equal(saved.reparto, "fijo");
  assert.equal(saved.porcentaje_el, "25");
  assert.deepEqual(copy(row(restored).flujo_libre_centimos_eur), copy(november.flujo_libre_centimos_eur));
});

test("cambiar un gasto compartido a personal elimina su reparto anterior", async () => {
  const app = createApp();
  await loadExample(app);
  action(app, "[data-add-movement]", {addMovement: "gasto"});
  const index = app.state.caso.movimientos.length - 1;
  for (const [property, value] of Object.entries({importe: "100.00", modalidad: "unico", reparto: "fijo", porcentaje_el: "25"})) edit(app, index, property, value);
  edit(app, index, "persona", "el");
  await app.calculate();
  const movement = app.state.caso.movimientos[index];
  assert.equal(movement.persona, "el");
  assert.equal(Number(movement.porcentaje_compartido), 0);
  assert.equal(row(app).flujo_libre_centimos_eur.el, 155000);
  assert.equal(row(app).flujo_libre_centimos_eur.ella, 64000);
  edit(app, index, "persona", "compartido");
  edit(app, index, "tipo", "ingreso");
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  const income = app.state.caso.movimientos[index];
  assert.equal(income.persona, "el");
  assert.equal(income.pagador, "el");
  assert.equal(row(app).flujo_libre_centimos_eur.el, 175000);
  assert.equal(row(app).flujo_libre_centimos_eur.ella, 64000);
});

test("los repartos parciales existentes se conservan al abrir el editor", async () => {
  const app = createApp();
  await loadExample(app);
  const caso = copy(app.state.caso), escenario = copy(app.state.escenario);
  const personal = caso.movimientos.find((item) => item.id === "propios_ella");
  personal.porcentaje_compartido = "35";
  const before = await app.requestCalculation(caso, escenario);
  const prepared = await app.preparePlan({caso, escenario});
  const preserved = prepared.caso.movimientos.find((item) => item.id === personal.id);
  assert.equal(preserved.persona, "ella");
  assert.equal(preserved.porcentaje_compartido, "35");
  const after = await app.requestCalculation(prepared.caso, prepared.escenario);
  assert.deepEqual(copy(after.meses.map((item) => item.flujo_libre_centimos_eur)), copy(before.meses.map((item) => item.flujo_libre_centimos_eur)));
  assert.equal(after.meses[0].flujo_libre_centimos_eur.el, 162375);
  assert.equal(after.meses[0].flujo_libre_centimos_eur.ella, 66625);
});
