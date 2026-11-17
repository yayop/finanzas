"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {execFileSync} = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "web/historial.js"), "utf8");
const copy = (value) => JSON.parse(JSON.stringify(value));
const e = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));

function load() {
  const listeners = new Map();
  const element = {innerHTML: "", addEventListener: (type, callback) => listeners.set(type, callback), querySelector: () => null};
  const sandbox = vm.createContext({window: {}, document: {querySelector: (selector) => selector === "#history-content" ? element : null}, Intl, Date});
  vm.runInContext(source, sandbox);
  return {api: sandbox.window.FinanzasHistorial, element, listeners};
}

function fixture() {
  const movement = (id, values) => ({id, concepto: id, tipo: "gasto", persona: "el", pagador: "el", importe: "100", moneda: "EUR", fecha: "2026-11-30", modalidad: "recurrente", intervalo_meses: 1, cuenta_id: "a", descontar_antes_reparto: false, ...values});
  return {caso: {version: 2, es_ficticio: true, inicio: "2026-11", fin: "2027-01", clp_por_eur: "1000", comision_cambio_eur: "5",
    personas: {el: {nombre: "Persona A", saldo_inicial_eur: "20"}, ella: {nombre: "Persona B", saldo_inicial_eur: "40"}},
    cuentas: [{id: "a", nombre: "Cuenta A", titular: "el", moneda: "EUR", saldo_inicial: "100"}, {id: "b", nombre: "Cuenta B", titular: "ella", moneda: "EUR", saldo_inicial: "200"}, {id: "clp", nombre: "Cuenta CLP", titular: "el", moneda: "CLP", saldo_inicial: "50000"}],
    transferencias: [{id: "cambio", concepto: "Cambio", origen: "a", destino: "clp", importe: "10", fecha: "2026-11-30", modalidad: "recurrente", intervalo_meses: 1, hasta: "2027-01-31", estado: "pagado", estados_por_mes: {"2026-12": "previsto"}}],
    movimientos: [movement("sueldo-a", {tipo: "ingreso", importe: "1000", estado: "pagado"}), movement("sueldo-b", {tipo: "ingreso", persona: "ella", pagador: "ella", cuenta_id: "b", importe: "800"}),
      movement("cuota", {modalidad: "cuotas", importe: "300.01", importe_tipo: "total", cuotas: 3, cuotas_pagadas: 0}),
      movement("arriendo", {persona: "compartido", importe: "450", reparto: "regla"})]},
    escenario: {id: "prueba", nombre: "Ficticio", regla: "proporcional_disponible", incluir_extra: true, porcentaje_el: "50", gamma: "1", gamma_por_mes: {"2027-01": "2"}}};
}

function simulate(plan) {
  return JSON.parse(execFileSync("python3", ["-c", "import json,sys; from scripts.modelo import simular_plan; p=json.load(sys.stdin); print(json.dumps(simular_plan(p['caso'],p['escenario'])))"], {cwd: root, input: JSON.stringify(plan), encoding: "utf8"}));
}

function snapshot(plan = fixture(), month = "2027-01") {
  const {api} = load();
  return api.createSnapshot({state: {...plan, selected: month, result: simulate(plan)}});
}

test("un mes guardado conserva gamma, registros y balance al explorar otro presupuesto", () => {
  const {api} = load(), plan = fixture();
  const state = {...plan, selected: "2027-01", result: simulate(plan)};
  const saved = api.createSnapshot({state}), before = JSON.stringify(saved);
  state.escenario.gamma = "4";
  state.escenario.gamma_por_mes["2027-01"] = "3.5";
  state.caso.movimientos[0].importe = "1";
  state.result.meses[2].ingresos_reales_centimos_eur.el = 1;
  assert.equal(JSON.stringify(saved), before);
  assert.equal(saved.escenario.gamma_por_mes["2027-01"], "2");
  assert.equal(saved.caso.movimientos[0].importe, "1000");
  assert.equal(saved.fila.ingresos_reales_centimos_eur.el, 100000);
  const history = api.upsert([], saved);
  saved.escenario.gamma = "9";
  assert.equal(history[0].escenario.gamma, "1");
});

test("actualizar un mes reemplaza solo su copia explícita y conserva los demás", () => {
  const {api} = load(), first = snapshot(fixture(), "2026-11"), second = snapshot();
  const original = [first, second], before = JSON.stringify(original);
  const edited = copy(first);
  edited.escenario.gamma = "3";
  const result = api.upsert(original, edited);
  assert.equal(result.length, 2);
  assert.equal(result[0].escenario.gamma, "3");
  assert.equal(JSON.stringify(result[1]), JSON.stringify(second));
  assert.equal(JSON.stringify(original), before);
  result[1].caso.movimientos[0].importe = "2";
  assert.equal(second.caso.movimientos[0].importe, "1000");
});

test("clonar copia la cuota del mes una vez, reinicia pagos y no duplica comisiones", () => {
  const {api} = load(), saved = snapshot(), before = JSON.stringify(saved);
  const cloned = api.cloneBudget(saved, "2027-02");
  assert.equal(cloned.caso.inicio, "2027-02");
  assert.equal(cloned.caso.fin, "2027-02");
  assert.equal(cloned.escenario.gamma, "2");
  assert.deepEqual(copy(cloned.escenario.gamma_por_mes), {"2027-02": "2"});
  assert.equal(cloned.caso.movimientos.length, 4);
  const installment = cloned.caso.movimientos.find((record) => record.id === "cuota");
  assert.equal(installment.importe, "100.01");
  assert.equal(installment.modalidad, "unico");
  assert.equal(installment.fecha, "2027-02-28");
  assert.equal(installment.cuotas_pagadas, 0);
  assert.equal(installment.estado, "previsto");
  assert.equal(installment.cuenta_id, "a");
  assert.equal(cloned.caso.transferencias.length, 1);
  assert.equal(cloned.caso.transferencias[0].fecha, "2027-02-28");
  assert.equal(cloned.caso.transferencias[0].estado, "previsto");
  assert.deepEqual(copy(cloned.caso.transferencias[0].estados_por_mes), {});
  assert.ok(cloned.caso.cuentas.every((account) => Number(account.saldo_inicial) === 0));
  assert.ok(Object.values(cloned.caso.personas).every((person) => Number(person.saldo_inicial_eur) === 0));
  const result = simulate(cloned);
  assert.equal(result.meses.length, 1);
  assert.equal(result.meses[0].pagos.filter((record) => record.es_comision_cambio).length, 1);
  assert.equal(result.meses[0].pagos.find((record) => record.id === "cuota").importe_centimos_eur, 10001);
  assert.deepEqual(result.meses[0].ejecucion.posicion_real_centimos_eur, {el: 0, ella: 0});
  assert.equal(result.operativa_real.meses[0].eventos.filter((record) => record.tipo === "transferencia").length, 0);
  assert.equal(JSON.stringify(saved), before);
});

test("clonar omite transferencias fuera de ese mes y congela el cambio mensual", () => {
  const {api} = load(), saved = snapshot();
  saved.caso.transferencias.push({...saved.caso.transferencias[0], id: "futura", fecha: "2027-05-01", modalidad: "unico"});
  saved.caso.transferencias.push({...saved.caso.transferencias[0], id: "terminada", hasta: "2026-12-01"});
  saved.caso.clp_por_eur = {"2027-01": "1100"};
  saved.fila.clp_por_eur = "1100";
  const cloned = api.cloneBudget(saved, "2027-02");
  assert.equal(cloned.caso.transferencias.length, 1);
  assert.equal(cloned.caso.clp_por_eur, "1100");
});

test("CSV conserva negativos y céntimos, escapa nombres y deja sin dato un reparto inviable", () => {
  const {api} = load(), saved = snapshot();
  saved.caso.personas.el.nombre = '=HYPERLINK("bad");\nNombre';
  saved.fila.presupuesto = {estado: "deficit", gamma: "2", ingresos_centimos_eur: {el: 100001, ella: 200000}, gastos_socializados_centimos_eur: {el: 10000, ella: 20000}, contribucion_centimos_eur: null, personal_centimos_eur: null};
  saved.fila.ejecucion = {ingresos_centimos_eur: {el: 100001, ella: 200000}, egresos_centimos_eur: {el: 200002, ella: 20000}, gastos_personales_centimos_eur: {el: 3, ella: 4}, saldo_centimos_eur: {el: -100001, ella: 180000}};
  const csv = api.toCsv([saved]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"");\nNombre"'));
  assert.ok(csv.includes('"1000.01"'));
  assert.ok(csv.includes('"-1000.01"'));
  assert.ok(csv.includes('"0.03"'));
  assert.ok(csv.includes('"100.00";"";""'));
  assert.ok(!csv.includes("NaN"));
});

test("importar historial rechaza meses duplicados y normaliza sin compartir referencias", () => {
  const {api} = load(), saved = snapshot();
  assert.throws(() => api.normalizeHistory([saved, saved]), /única válida/);
  assert.throws(() => api.normalizeHistory([{...saved, mes: "2027-13"}]), /única válida/);
  assert.throws(() => api.normalizeHistory([{...saved, fila: {mes: "2026-01"}}]), /presupuesto/);
  const normalized = api.normalizeHistory([saved]);
  normalized[0].caso.personas.el.nombre = "Cambiado";
  assert.equal(saved.caso.personas.el.nombre, "Persona A");
});

test("la vista de historial renderiza déficits, guarda mediante callback y no muta meses", () => {
  const {api, element, listeners} = load(), saved = snapshot(), second = copy(saved);
  second.mes = second.fila.mes = "2027-02";
  saved.fila.ejecucion = {saldo_centimos_eur: {el: -10000, ella: 2000}, egresos_centimos_eur: {el: 200000, ella: 20000}};
  second.fila.ejecucion = {saldo_centimos_eur: {el: 3000, ella: 2000}, egresos_centimos_eur: {el: 100000, ella: 20000}};
  const history = [saved, second], before = JSON.stringify(history), calls = [];
  const ctx = {state: {caso: saved.caso, selected: saved.mes, history}, escapeHtml: e, monthLabel: (month) => month, eur: (amount) => `${(amount / 100).toFixed(2)} €`, saveMonth: () => calls.push("save"), openMonth: (month) => calls.push(month), exportCsv: () => calls.push("csv")};
  api.bind(ctx);
  api.bind(ctx);
  api.render(ctx);
  assert.match(element.innerHTML, /Actualizar 2027-01/);
  assert.match(element.innerHTML, /hist-flow-negative/);
  assert.match(element.innerHTML, /-80.00 €/);
  assert.match(element.innerHTML, /-30.00 €/);
  assert.match(element.innerHTML, /Comparar meses/);
  for (const [selector, values] of [["[data-history-save]", {}], ["[data-history-open]", {dataset: {historyOpen: "2027-02"}}], ["[data-history-csv]", {}]]) {
    listeners.get("click")({target: {closest: (candidate) => candidate === selector ? values : null}});
  }
  assert.deepEqual(calls, ["save", "2027-02", "csv"]);
  assert.equal(JSON.stringify(history), before);
});


test("recalcular conserva el diálogo de clonación abierto y su mes en edición", () => {
  const current = {source: {value: "2027-01"}, target: {value: "2027-09", name: "target"}};
  const restored = {source: {value: ""}, target: {value: "", focus: () => {focused = true;}}};
  let rendered = false, shown = false, focused = false;
  const dialog = (fields, open) => ({open, querySelector: (selector) => fields[selector.includes("source") ? "source" : "target"], showModal: () => {shown = true;}});
  const initialDialog = dialog(current, true), nextDialog = dialog(restored, false);
  const element = {querySelector: () => rendered ? nextDialog : initialDialog, set innerHTML(value) {rendered = true;}};
  const sandbox = vm.createContext({window: {}, document: {activeElement: current.target, querySelector: () => element}, Intl, Date});
  vm.runInContext(source, sandbox);
  const saved = snapshot();
  sandbox.window.FinanzasHistorial.render({state: {caso: saved.caso, selected: saved.mes, history: [saved]}, escapeHtml: e, monthLabel: (month) => month, eur: (amount) => String(amount)});
  assert.equal(shown, true);
  assert.equal(focused, true);
  assert.equal(restored.source.value, "2027-01");
  assert.equal(restored.target.value, "2027-09");
});


test("el historial muestra caja real y mantiene el saldo del acuerdo en otra columna del CSV", () => {
  const {api, element} = load(), saved = snapshot();
  saved.fila.ejecucion = {ingresos_centimos_eur: {el: 100000, ella: 80000}, egresos_centimos_eur: {el: 30000, ella: 40000},
    gastos_personales_centimos_eur: {el: 1000, ella: 2000}, saldo_centimos_eur: {el: 70000, ella: 40000},
    flujo_caja_centimos_eur: {el: 30000, ella: 80000}, posicion_real_centimos_eur: {el: 150000, ella: 120000}, compensacion_pendiente_centimos_eur: {el: 40000, ella: -40000}};
  api.render({state: {caso: saved.caso, selected: saved.mes, history: [saved]}, escapeHtml: e, monthLabel: (month) => month, eur: (amount) => `${(amount / 100).toFixed(2)} €`});
  assert.match(element.innerHTML, /Flujo de caja mensual/);
  assert.match(element.innerHTML, /<td>—<\/td>/);
  const csv = api.toCsv([saved]);
  assert.ok(csv.includes('"Saldo tras reparto EUR"'));
  assert.ok(csv.includes('"Saldo real al cierre EUR"'));
  assert.ok(csv.includes('"Compensación pendiente EUR"'));
  assert.ok(csv.includes('"300.00";"700.00";"1500.00";"400.00"'));
  assert.ok(csv.includes('"800.00";"400.00";"1200.00";"-400.00"'));
  assert.ok(csv.includes('"2";"proporcional_disponible"'));
});
