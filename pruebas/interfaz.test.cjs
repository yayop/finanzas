"use strict";

const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {spawn} = require("node:child_process");
const {readFileSync, existsSync} = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "web/app.js"), "utf8").replace(/\binitialize\(\);\s*$/, "");
const operationPath = path.join(root, "web/operativa.js");
const operationSource = existsSync(operationPath) ? readFileSync(operationPath, "utf8") : "";
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
  let document;
  let timerId = 0;
  function node(selector) {
    if (nodes.has(selector)) return nodes.get(selector);
    const classes = new Set();
    const value = {selector, innerHTML: "", textContent: "", hidden: true, value: "", dataset: {}, style: {},
      classList: {add: (...items) => items.forEach((item) => classes.add(item)), remove: (...items) => items.forEach((item) => classes.delete(item)), contains: (item) => classes.has(item)},
      listeners: new Map(),
      setAttribute(name, value) { this[name] = String(value); },
      addEventListener(name, callback) { const callbacks = this.listeners.get(name) || []; callbacks.push(callback); this.listeners.set(name, callbacks); }, checkValidity: () => true,
      focus() { document.activeElement = this; }, select() {}, click() {}, closest: () => null,
      contains(other) { return Boolean(other && (other === this || other.selector?.startsWith(selector + " "))); },
      matches(query) { return query === "[data-op-month]" && this.dataset.opMonth !== undefined; },
      querySelector: (child) => node(selector + " " + child), querySelectorAll: () => []};
    nodes.set(selector, value);
    return value;
  }
  document = {querySelector: node, querySelectorAll: (selector) => {
    if (selector === "[data-tab]") return ["records", "sharing", "projection", "operations"].map((name) => {
      const tab = node("#tab-" + name); tab.dataset.tab = name; return tab;
    });
    return [];
  }, activeElement: null, body: node("body"), createElement: (tag) => node("created-" + tag)};
  const context = vm.createContext({
    document,
    window: {innerWidth: 1200},
    localStorage: {getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value))},
    fetch: (url, options) => fetch(new URL(url, baseURL), options), crypto: webcrypto,
    AbortController, URL, Blob, console,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  });
  if (operationSource) vm.runInContext(operationSource, context, {filename: "web/operativa.js"});
  vm.runInContext(readFileSync(path.join(root, "web/equivalencia.js"), "utf8"), context, {filename: "web/equivalencia.js"});
  vm.runInContext(source + "\nglobalThis.app = {state, initialize, preparePlan, requestCalculation, handleControl, handleArrayActions, calculate, importPlan, restoreSavedPlan, handleAdjustment, setTab, expenseSeries, chartData, exportablePlan};", context, {filename: "web/app.js"});
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

function edit(app, index, property, value, options = {}) {
  const input = {dataset: {path: `caso.movimientos.${index}.${property}`, kind: options.kind || (typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string")}, value: String(value), checked: value, type: options.type || "text", tagName: options.tagName || "INPUT", closest: (selector) => selector === "[data-path]" ? input : null};
  const movement = app.state.caso.movimientos[index];
  const inSharing = movement.tipo !== "ingreso" && ["persona", "reparto", "porcentaje_el", "porcentaje_compartido", "descontar_antes_reparto"].includes(property);
  if (inSharing) {
    const event = {target: input};
    const name = input.tagName === "SELECT" ? "change" : "input";
    for (const callback of app.nodes.get("#adjustments-content").listeners.get(name) || []) callback(event);
  } else app.handleControl({target: input});
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

function movement(id, overrides = {}) {
  return {id, concepto: id, tipo: "gasto", persona: "compartido", pagador: "el", importe: "100.00", moneda: "EUR", fecha: "2026-11-01", modalidad: "recurrente", intervalo_meses: 1, hasta: "", cuotas: 12, cuotas_pagadas: 0, importe_tipo: "total", extra: false, porcentaje_compartido: "100", reparto: "fijo", porcentaje_el: "50", grupo: "", etiquetas: [], cuenta_id: "", ...overrides};
}

function plan(movements, accounts = []) {
  return {version: 2, caso: {version: 2, es_ficticio: true, inicio: "2026-11", fin: "2027-01", clp_por_eur: "1000", personas: {el: {nombre: "Yayo", saldo_inicial_eur: "0.00"}, ella: {nombre: "Fer", saldo_inicial_eur: "0.00"}}, movimientos: movements, cuentas: accounts, transferencias: []}, escenario: {id: "test", nombre: "50/50", regla: "mitades", incluir_extra: true, porcentaje_el: "50"}};
}

function incomes() {
  return [movement("sueldo-yayo", {tipo: "ingreso", persona: "el", importe: "1000.00", porcentaje_compartido: "0"}), movement("sueldo-fer", {tipo: "ingreso", persona: "ella", pagador: "ella", importe: "1000.00", porcentaje_compartido: "0"})];
}

async function loadPlan(app, input) {
  await app.initialize();
  const text = JSON.stringify(input);
  await app.importPlan({size: text.length, text: async () => text});
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
}

function adjust(app, index, percentage) {
  const input = {dataset: {adjustIndex: String(index)}, type: "range", value: String(percentage), closest: (selector) => selector === "[data-adjust-index]" ? input : null};
  app.handleAdjustment({target: input});
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
  assert.equal(app.state.tab, "records");
  assert.equal(app.nodes.get("#panel-records").hidden, false);
  assert.equal(app.nodes.get("#panel-projection").hidden, true);
  assert.match(app.nodes.get("#equivalence-content").innerHTML, /Sin gastos: α′ no está definida/);
});

test("Reparto reúne la regla, el mes y la equivalencia conservando el plan al cambiar de presentación", async () => {
  const app = createApp();
  const input = plan([...incomes().map((item) => ({...item, importe: "2000.00"})),
    movement("compromiso", {persona: "ella", pagador: "ella", importe: "1000.00", porcentaje_compartido: "0"}),
    movement("comun", {importe: "1500.00", reparto: "regla"})]);
  await loadPlan(app, input);
  await fire(app, "#tab-sharing");
  assert.equal(app.nodes.get("#panel-sharing").hidden, false);
  assert.equal(app.nodes.get("#panel-projection").hidden, true);
  assert.match(app.nodes.get("#sharing-controls").innerHTML, /data-path="escenario\.regla"/);
  assert.match(app.nodes.get("#sharing-controls").innerHTML, /data-path="escenario\.incluir_extra"/);
  assert.doesNotMatch(app.nodes.get("#controls").innerHTML, /data-path="escenario\./);
  assert.doesNotMatch(app.nodes.get("#equivalence-content").innerHTML, /data-eq-(?:month|rule)/);
  const initialPlan = copy(app.exportablePlan()), initialRows = copy(app.state.result);
  const button = {dataset: {eqPerspective: "unica"}};
  for (const callback of app.nodes.get("#equivalence-content").listeners.get("click")) {
    callback({target: {closest: (selector) => selector === "[data-eq-perspective]" ? button : null}});
  }
  assert.deepEqual(copy(app.exportablePlan()), initialPlan);
  assert.deepEqual(copy(app.state.result), initialRows);
  assert.match(app.nodes.get("#equivalence-content").innerHTML, /α′ de todos los gastos/);
  app.nodes.get("#sharing-month").value = "2026-12";
  await fire(app, "#sharing-month", "change");
  assert.equal(app.state.selected, "2026-12");
  assert.match(app.nodes.get("#month-detail").innerHTML, /diciembre de 2026/);
  assert.deepEqual(copy(app.exportablePlan()), initialPlan);
  assert.deepEqual(copy(app.state.result), initialRows);
  const rule = {value: "proporcional_disponible", dataset: {path: "escenario.regla"}, tagName: "SELECT", type: "select-one", closest: (selector) => selector === "[data-path]" ? rule : null};
  for (const callback of app.nodes.get("#sharing-controls").listeners.get("change")) {
    callback({target: rule});
  }
  await app.calculate();
  assert.equal(app.state.escenario.regla, "proporcional_disponible");
  assert.deepEqual(copy(row(app).flujo_libre_centimos_eur), {el: 100000, ella: 50000});
  assert.deepEqual(copy(row(app).reparto_equivalente.excedentes_equivalentes_centimos_eur), {el: 100000, ella: 50000});
  assert.deepEqual(copy(app.state.caso), {...initialPlan.caso, es_ficticio: false});
  assert.equal(JSON.parse(app.storage.get("finanzas-pareja-plan-v2")).escenario.regla, "proporcional_disponible");
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
  assert.equal(app.state.tab, "records");
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
  assert.match(app.nodes.get("#controls").innerHTML, /data-add-movement="gasto"/);
  assert.doesNotMatch(app.nodes.get("#controls").innerHTML, /data-(?:add-movement|filter)="deuda"/);
  assert.match(app.nodes.get("#movement-list").innerHTML, /data-summary-concept/);
  assert.match(app.nodes.get("#chart").innerHTML, /<svg/);
  assert.equal(JSON.parse(app.storage.get("finanzas-pareja-plan-v2")).version, 2);
});

test("un gasto nuevo admite cuotas y descuento opcional sin categoría separada de deuda", async () => {
  const app = createApp();
  await loadPlan(app, plan(incomes()));
  action(app, "[data-add-movement]", {addMovement: "gasto"});
  const index = app.state.caso.movimientos.length - 1;
  assert.equal(app.state.caso.movimientos[index].descontar_antes_reparto, false);
  assert.equal(app.state.caso.movimientos[index].persona, "el");
  assert.equal(app.state.caso.movimientos[index].porcentaje_compartido, "0");
  assert.doesNotMatch(app.nodes.get("#movement-list").innerHTML, /Descontar antes de repartir|data-share-toggle|Responsabilidad/);
  for (const [property, value] of Object.entries({concepto: "Compra en cuotas", persona: "ella", pagador: "ella", importe: "300.01", modalidad: "cuotas", cuotas: 3, cuotas_pagadas: 1, fecha: "2026-11-01"})) edit(app, index, property, value);
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.equal(app.state.caso.movimientos[index].tipo, "gasto");
  assert.equal(row(app).cuotas_centimos_eur, 10000);
  assert.equal(row(app, "2026-12").cuotas_centimos_eur, 10001);
  assert.equal(row(app, "2027-01").cuotas_centimos_eur, 0);
  const html = app.nodes.get("#movement-list").innerHTML;
  assert.doesNotMatch(html, /Descontar antes de repartir|data-share-toggle|Responsabilidad/);
  const sharingHTML = app.nodes.get("#adjustments-content").innerHTML;
  assert.match(sharingHTML, /Descontar antes de repartir/);
  assert.match(sharingHTML, new RegExp(`data-path="caso\\.movimientos\\.${index}\\.descontar_antes_reparto" data-kind="boolean"`));
  assert.match(html, /Cuotas totales/);
  assert.doesNotMatch(html, /<option value="deuda"/);
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  const expense = restored.state.caso.movimientos[index];
  assert.equal(expense.tipo, "gasto");
  assert.equal(expense.modalidad, "cuotas");
  assert.equal(expense.cuotas_pagadas, 1);
  assert.equal(expense.descontar_antes_reparto, false);
});

test("descontar un gasto cambia el reparto neto, conserva pagos y se guarda al recuperar", async () => {
  const app = createApp();
  const input = plan([...incomes().map((item) => ({...item, importe: "2000.00"})),
    movement("compromiso", {persona: "ella", pagador: "ella", importe: "1000.00", porcentaje_compartido: "0", descontar_antes_reparto: false}),
    movement("comun", {importe: "1500.00", reparto: "regla", descontar_antes_reparto: false})]);
  input.escenario.regla = "proporcional_disponible";
  await loadPlan(app, input);
  const before = copy(row(app));
  assert.deepEqual(before.flujo_libre_centimos_eur, {el: 125000, ella: 25000});
  edit(app, 2, "descontar_antes_reparto", true, {type: "checkbox"});
  await app.calculate();
  const after = row(app);
  assert.equal(app.state.escenario.regla, "proporcional_disponible");
  assert.deepEqual(copy(after.flujo_libre_centimos_eur), {el: 100000, ella: 50000});
  assert.deepEqual(copy(after.pagos_externos_centimos_eur), before.pagos_externos_centimos_eur);
  assert.deepEqual(copy(after.gastos_descontados_centimos_eur), {el: 0, ella: 100000});
  assert.equal(after.hogar.pagos_externos_centimos_eur, before.hogar.pagos_externos_centimos_eur);
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  assert.equal(restored.state.caso.movimientos[2].descontar_antes_reparto, true);
  assert.deepEqual(copy(row(restored).flujo_libre_centimos_eur), copy(after.flujo_libre_centimos_eur));
  restored.state.escenario.regla = "mitades";
  edit(restored, 2, "descontar_antes_reparto", false, {type: "checkbox"});
  await restored.calculate();
  assert.equal(restored.state.escenario.regla, "mitades");
  assert.deepEqual(copy(row(restored).flujo_libre_centimos_eur), {el: 125000, ella: 25000});
});

test("el slider activa y desactiva el descuento al pasar por 100 % sin reemplazar su tarjeta", async () => {
  const app = createApp();
  await loadPlan(app, plan([...incomes(), movement("parcial", {persona: "ella", porcentaje_compartido: "100", descontar_antes_reparto: true})]));
  const hint = {textContent: "Ya se reparte como gasto socializado."};
  const deduction = {disabled: true, checked: true, closest: (selector) => selector === ".toggle-row" ? {querySelector: () => hint} : null};
  const summary = Object.fromEntries(["concept", "schedule", "amount"].map((key) => [`[data-summary-${key}]`, {textContent: ""}]));
  const card = {querySelector: (selector) => selector === '[data-path="caso.movimientos.2.descontar_antes_reparto"]' ? deduction : summary[selector] || null};
  const output = {textContent: "100 %"};
  const range = {dataset: {path: "caso.movimientos.2.porcentaje_compartido", kind: "string"}, type: "range", value: "50", closest: (selector) => selector === "[data-path]" ? range : selector === ".adjustment-card" ? card : selector === ".sharing-control" ? {querySelector: () => output} : null};
  const list = app.nodes.get("#adjustments-content");
  const originalHTML = list.innerHTML;
  let replacements = 0;
  Object.defineProperty(list, "innerHTML", {get: () => originalHTML, set: () => { replacements++; }});
  app.handleControl({target: range});
  assert.equal(deduction.disabled, false);
  assert.match(hint.textContent, /Solo con Tras compromisos/);
  assert.equal(app.state.caso.movimientos[2].porcentaje_compartido, "50");
  assert.equal(output.textContent, "50 %");
  range.value = "100";
  app.handleControl({target: range});
  assert.equal(deduction.disabled, true);
  assert.match(hint.textContent, /Ya se reparte como gasto socializado/);
  assert.equal(app.state.caso.movimientos[2].porcentaje_compartido, "100");
  assert.equal(output.textContent, "100 %");
  assert.equal(deduction.checked, true);
  assert.equal(app.state.caso.movimientos[2].descontar_antes_reparto, true);
  assert.equal(replacements, 0);
});

test("importar una deuda antigua la presenta como gasto conservando cuotas y descuento previo", async () => {
  const app = createApp();
  const old = movement("deuda-antigua", {tipo: "deuda", persona: "ella", pagador: "ella", importe: "100.01", porcentaje_compartido: "0", modalidad: "cuotas", importe_tipo: "cuota", cuotas: 46, cuotas_pagadas: 4});
  await loadPlan(app, plan([...incomes(), old]));
  const expense = app.state.caso.movimientos[2];
  assert.equal(expense.tipo, "gasto");
  assert.equal(expense.persona, "ella");
  assert.equal(expense.pagador, "ella");
  assert.equal(expense.modalidad, "cuotas");
  assert.equal(expense.cuotas, 46);
  assert.equal(expense.cuotas_pagadas, 4);
  assert.equal(expense.importe, "100.01");
  assert.equal(expense.descontar_antes_reparto, true);
  assert.ok(app.state.result.meses.every((month) => month.cuotas_centimos_eur === 10001));
  assert.equal(JSON.parse(app.storage.get("finanzas-pareja-plan-v2")).caso.movimientos[2].tipo, "gasto");
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
  const index = app.state.caso.movimientos.findIndex((item) => item.modalidad === "cuotas");
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

test("un gasto se declara personal y puede socializarse desde Reparto sin alterar su pago", async () => {
  const app = createApp();
  await loadExample(app);
  app.state.caso.cuentas.push({id: "cuenta-yayo", nombre: "Banco Yayo", titular: "el", moneda: "EUR", saldo_inicial: "0.00", porcentaje_el: "50"});
  action(app, "[data-add-movement]", {addMovement: "gasto"});
  const index = app.state.caso.movimientos.length - 1;
  const movement = app.state.caso.movimientos[index];
  assert.equal(movement.persona, "el");
  assert.equal(movement.porcentaje_compartido, "0");
  assert.equal(movement.pagador, "el");
  assert.equal(movement.reparto, "regla");
  assert.equal(movement.porcentaje_el, "50");
  const declaration = app.nodes.get("#movement-list").innerHTML;
  assert.doesNotMatch(declaration, new RegExp(`data-path="caso\\.movimientos\\.${index}\\.(?:persona|reparto|porcentaje_el|porcentaje_compartido|descontar_antes_reparto)"`));
  const html = app.nodes.get("#adjustments-content").innerHTML;
  assert.match(html, /id="socialization-controls"/);
  for (const [key, label] of [["el", "Yayo"], ["ella", "Fer"], ["compartido", "Socializado"]]) {
    assert.match(html, new RegExp(`value="${key}"[^>]*>${label}</option>`));
  }
  for (const [property, value] of Object.entries({concepto: "Internet socializado", importe: "100.00", fecha: "2026-11-01", modalidad: "unico", cuenta_id: "cuenta-yayo"})) edit(app, index, property, value);
  const paymentBefore = Object.fromEntries(["importe", "moneda", "fecha", "modalidad", "pagador", "cuenta_id"].map((key) => [key, movement[key]]));
  for (const [property, value] of Object.entries({persona: "compartido", reparto: "fijo", porcentaje_el: "25"})) edit(app, index, property, value);
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  const november = row(app);
  assert.equal(november.flujo_libre_centimos_eur.el, 162500);
  assert.equal(november.flujo_libre_centimos_eur.ella, 56500);
  assert.equal(november.hogar.flujo_libre_centimos_eur, 219000);
  const payment = november.pagos.find((item) => item.concepto === "Internet socializado");
  assert.equal(payment.persona, "compartido");
  assert.equal(payment.pagador, "el");
  assert.deepEqual(copy(Object.fromEntries(Object.keys(paymentBefore).map((key) => [key, movement[key]]))), paymentBefore);
  assert.equal(payment.cuenta_id, "cuenta-yayo");
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
  for (const [property, value] of Object.entries({importe: "100.00", modalidad: "unico", persona: "compartido", reparto: "fijo", porcentaje_el: "25"})) edit(app, index, property, value);
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

test("el slider redistribuye un gasto sin cambiar quién paga, su cuenta ni el costo del hogar", async () => {
  const app = createApp();
  const accounts = [{id: "banco-yayo", nombre: "Cuenta Yayo", titular: "el", moneda: "EUR", saldo_inicial: "0.00", porcentaje_el: "50"}];
  await loadPlan(app, plan([...incomes(), movement("internet", {porcentaje_el: "25", cuenta_id: "banco-yayo"})], accounts));
  const before = copy(row(app));
  const index = app.state.caso.movimientos.findIndex((item) => item.id === "internet");
  adjust(app, index, 80);
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  const changed = app.state.caso.movimientos[index], after = row(app);
  assert.equal(changed.persona, "compartido");
  assert.equal(changed.reparto, "fijo");
  assert.equal(changed.porcentaje_el, "80");
  assert.equal(changed.pagador, "el");
  assert.equal(changed.cuenta_id, "banco-yayo");
  assert.equal(changed.importe, "100.00");
  assert.deepEqual(copy(after.flujo_libre_centimos_eur), {el: 92000, ella: 98000});
  assert.equal(after.hogar.flujo_libre_centimos_eur, before.hogar.flujo_libre_centimos_eur);
  assert.equal(after.hogar.saldo_final_centimos_eur, before.hogar.saldo_final_centimos_eur);
  assert.deepEqual(copy(after.pagos_externos_centimos_eur), before.pagos_externos_centimos_eur);
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  assert.equal(restored.state.caso.movimientos[index].porcentaje_el, "80");
  assert.deepEqual(copy(row(restored).flujo_libre_centimos_eur), copy(after.flujo_libre_centimos_eur));
});

test("el slider de una deuda personal cambia solo la parte compartida y conserva titular y cuenta", async () => {
  const app = createApp();
  const accounts = [{id: "banco-fer", nombre: "Cuenta Fer", titular: "ella", moneda: "EUR", saldo_inicial: "0.00", porcentaje_el: "50"}];
  await loadPlan(app, plan([...incomes(), movement("deuda-personal", {
    tipo: "deuda", persona: "ella", pagador: "ella", cuenta_id: "banco-fer",
    modalidad: "cuotas", importe_tipo: "cuota", cuotas: 3,
    porcentaje_compartido: "20", reparto: "regla"
  })], accounts));
  const before = copy(row(app));
  assert.deepEqual(before.flujo_libre_centimos_eur, {el: 99000, ella: 91000});
  adjust(app, 2, 80);
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  const debt = app.state.caso.movimientos[2], after = row(app);
  assert.equal(debt.porcentaje_compartido, "80");
  assert.equal(debt.persona, "ella");
  assert.equal(debt.pagador, "ella");
  assert.equal(debt.cuenta_id, "banco-fer");
  assert.equal(debt.reparto, "regla");
  assert.equal(debt.importe, "100.00");
  assert.deepEqual(copy(after.flujo_libre_centimos_eur), {el: 96000, ella: 94000});
  assert.deepEqual(copy(after.pagos_externos_centimos_eur), before.pagos_externos_centimos_eur);
  assert.equal(after.hogar.flujo_libre_centimos_eur, before.hogar.flujo_libre_centimos_eur);
  assert.equal(after.hogar.saldo_final_centimos_eur, before.hogar.saldo_final_centimos_eur);
});

test("pagar desde la otra cuenta cambia la caja y la compensación pero conserva el acuerdo", async () => {
  const app = createApp();
  const accounts = ["el", "ella"].map((person) => ({id: "banco-" + person, nombre: "Cuenta " + person, titular: person, moneda: "EUR", saldo_inicial: "0.00", porcentaje_el: "50"}));
  const salaries = incomes().map((item) => ({...item, cuenta_id: "banco-" + item.persona}));
  await loadPlan(app, plan([...salaries, movement("arriendo", {cuenta_id: "banco-el"})], accounts));
  const before = copy(row(app));
  assert.deepEqual(before.compensacion_neta_centimos_eur, {el: 5000, ella: -5000});
  edit(app, 2, "cuenta_id", "banco-ella", {tagName: "SELECT"});
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  const after = row(app);
  assert.equal(app.state.caso.movimientos[2].pagador, "ella");
  assert.deepEqual(copy(after.compensacion_neta_centimos_eur), {el: -5000, ella: 5000});
  assert.deepEqual(copy(after.pagos_externos_centimos_eur), {el: 0, ella: 10000});
  assert.deepEqual(copy(after.flujo_libre_centimos_eur), before.flujo_libre_centimos_eur);
  assert.deepEqual(copy(after.saldo_final_centimos_eur), before.saldo_final_centimos_eur);
  const operational = app.state.result.operativa.meses[0];
  assert.equal(operational.cuentas.find((item) => item.cuenta_id === "banco-el").saldo_final_unidades, 100000);
  assert.equal(operational.cuentas.find((item) => item.cuenta_id === "banco-ella").saldo_final_unidades, 90000);
  assert.deepEqual(copy(operational.compensacion_pendiente_centimos_eur), {el: -5000, ella: 5000});
});

test("los grupos y etiquetas siguen importes y calendarios, se conservan al importar y excluyen ingresos", async () => {
  const app = createApp();
  const salaries = incomes().map((item) => ({...item, grupo: "Hogar", etiquetas: ["fijo"]}));
  await loadPlan(app, plan([...salaries,
    movement("arriendo", {importe: "900.00", grupo: "Hogar", etiquetas: ["fijo", "esencial"]}),
    movement("internet", {importe: "100.00", intervalo_meses: 2, grupo: "Hogar"}),
    movement("matrícula", {importe: "100000", moneda: "CLP", fecha: "2026-12-02", modalidad: "unico", grupo: "Estudios", etiquetas: ["universidad"]})
  ]));
  edit(app, 3, "etiquetas", "fijo, internet, fijo,  ", {kind: "csv"});
  await app.calculate();
  assert.equal(app.nodes.get("#error").hidden, true, app.nodes.get("#error").textContent);
  assert.deepEqual(copy(app.state.caso.movimientos[3].etiquetas), ["fijo", "internet"]);
  const groups = app.expenseSeries("grupos");
  assert.deepEqual(copy(groups.find((item) => item.label === "Hogar").values), [100000, 90000, 100000]);
  assert.deepEqual(copy(groups.find((item) => item.label === "Estudios").values), [0, 10000, 0]);
  assert.equal(groups.some((item) => item.label.includes("sueldo")), false);
  const tags = app.expenseSeries("etiquetas");
  assert.deepEqual(copy(tags.find((item) => item.label === "fijo").values), [100000, 90000, 100000]);
  assert.deepEqual(copy(tags.find((item) => item.label === "internet").values), [10000, 0, 10000]);
  app.state.metric = "saldo";
  assert.deepEqual(copy(app.expenseSeries("grupos").find((item) => item.label === "Hogar").values), [100000, 190000, 290000]);
  const serialized = JSON.stringify({version: 2, caso: app.state.caso, escenario: app.state.escenario});
  const imported = createApp();
  await imported.initialize();
  await imported.importPlan({size: serialized.length, text: async () => serialized});
  assert.deepEqual(copy(imported.state.caso.movimientos[3].etiquetas), ["fijo", "internet"]);
  assert.equal(imported.state.caso.movimientos[3].grupo, "Hogar");
  assert.deepEqual(copy(imported.expenseSeries("grupos").find((item) => item.label === "Hogar").values), [100000, 90000, 100000]);
});

test("el saldo de cada cuenta se suma una sola vez al dinero sin cuenta y permanece al recuperar", async () => {
  const app = createApp();
  const input = plan([], [
    {id: "personal", nombre: "Banco", titular: "el", moneda: "EUR", saldo_inicial: "100.00", porcentaje_el: "50"},
    {id: "común", nombre: "Fondo común", titular: "compartido", moneda: "CLP", saldo_inicial: "200000", porcentaje_el: "25"}
  ]);
  input.caso.personas.el.saldo_inicial_eur = "10.00";
  input.caso.personas.ella.saldo_inicial_eur = "20.00";
  await loadPlan(app, input);
  assert.deepEqual(copy(row(app).saldo_inicial_centimos_eur), {el: 16000, ella: 17000});
  assert.equal(row(app).hogar.saldo_final_centimos_eur, 33000);
  const restored = createApp(Object.fromEntries(app.storage));
  await restored.initialize();
  await restored.restoreSavedPlan();
  assert.equal(Number(restored.state.caso.personas.el.saldo_inicial_eur), 10);
  assert.equal(Number(restored.state.caso.personas.ella.saldo_inicial_eur), 20);
  assert.equal(row(restored).hogar.saldo_final_centimos_eur, 33000);
  assert.equal(row(restored, "2027-01").hogar.saldo_final_centimos_eur, 33000);
});

test("cambiar de pestaña y perspectiva conserva el plan, los saldos y la referencia", async () => {
  const app = createApp();
  await loadExample(app);
  const planBefore = copy({caso: app.state.caso, escenario: app.state.escenario, reference: app.state.reference});
  const resultBefore = copy(app.state.result);
  for (const tab of ["sharing", "projection", "operations", "records"]) {
    app.setTab(tab);
    assert.equal(app.nodes.get("#tab-" + tab)["aria-selected"], "true");
    for (const panel of ["records", "sharing", "projection", "operations"]) assert.equal(app.nodes.get("#panel-" + panel).hidden, panel !== tab);
  }
  const navigate = (tab, key) => {
    for (const callback of app.nodes.get("#tab-" + tab).listeners.get("keydown")) callback({key, preventDefault() {}});
    return app.state.tab;
  };
  assert.equal(navigate("records", "ArrowRight"), "sharing");
  assert.equal(navigate("sharing", "ArrowRight"), "projection");
  assert.equal(navigate("projection", "ArrowRight"), "operations");
  assert.equal(navigate("operations", "ArrowRight"), "records");
  assert.equal(navigate("records", "ArrowLeft"), "operations");
  assert.equal(navigate("operations", "Home"), "records");
  assert.equal(navigate("records", "End"), "operations");
  assert.equal(navigate("operations", "Home"), "records");
  const monthButton = {dataset: {month: "2026-12"}};
  for (const callback of app.nodes.get("#monthly-table").listeners.get("click")) {
    callback({target: {closest: (selector) => selector === "[data-month]" ? monthButton : null}});
  }
  assert.equal(app.state.selected, "2026-12");
  assert.equal(app.state.tab, "sharing");
  assert.match(app.nodes.get("#month-detail").innerHTML, /diciembre de 2026/);
  app.setTab("projection");
  app.state.chartView = "grupos";
  app.chartData();
  app.state.chartView = "etiquetas";
  app.chartData();
  assert.deepEqual(copy({caso: app.state.caso, escenario: app.state.escenario, reference: app.state.reference}), planBefore);
  assert.deepEqual(copy(app.state.result), resultBefore);
  assert.equal(app.state.tab, "projection");
});


test("exportar e importar conserva la referencia independiente para comparar repartos", async () => {
  const original = createApp();
  await loadExample(original);
  const base = copy(original.state.reference.result.meses);
  const shared = original.state.caso.movimientos.findIndex((item) => item.persona === "compartido");
  const input = {dataset: {adjustIndex: String(shared)}, value: "25", closest: (selector) => selector === "[data-adjust-index]" ? input : null};
  original.handleAdjustment({target: input});
  await original.calculate();
  const serialized = JSON.stringify(original.exportablePlan());
  const restored = createApp();
  await restored.initialize();
  await restored.importPlan({size: serialized.length, text: async () => serialized});
  assert.equal(restored.nodes.get("#error").hidden, true);
  assert.deepEqual(copy(restored.state.result.meses), copy(original.state.result.meses));
  assert.deepEqual(copy(restored.state.reference.result.meses), base);
  assert.notDeepEqual(copy(restored.state.result.meses), base);
  assert.equal(JSON.parse(restored.storage.get("finanzas-pareja-plan-v2")).reference.caso.movimientos[shared].reparto, "regla");
});
