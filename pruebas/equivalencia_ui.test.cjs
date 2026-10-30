"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {execFileSync} = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const moduleSource = readFileSync(path.join(root, "web/equivalencia.js"), "utf8");
const RULES = {mitades: "50/50", proporcional: "Según ingresos", proporcional_disponible: "Tras compromisos", igualar: "Igualar margen", manual: "Porcentaje fijo"};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"}[character]));
const eur = (value) => new Intl.NumberFormat("es-CL", {style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value / 100);

function movement(id, changes = {}) {
  return {id, concepto: id, tipo: "gasto", persona: "ella", pagador: "ella", importe: "1000", moneda: "EUR", fecha: "2026-01-01", modalidad: "unico", ...changes};
}

function fixture() {
  return {caso: {version: 2, es_ficticio: true, inicio: "2026-01", fin: "2026-01", clp_por_eur: "1000",
    personas: {el: {nombre: "Persona A", saldo_inicial_eur: "0"}, ella: {nombre: "Persona B", saldo_inicial_eur: "0"}},
    cuentas: [], transferencias: [], movimientos: [movement("Ingreso A", {tipo: "ingreso", persona: "el", importe: "2000"}),
      movement("Ingreso B", {tipo: "ingreso", importe: "2000"}), movement("Compromiso B"), movement("Común", {persona: "compartido", importe: "1500"})]},
    escenario: {id: "prueba", nombre: "Ficticio", regla: "proporcional_disponible", incluir_extra: true, porcentaje_el: "50"}};
}

function simulate(plan) {
  return JSON.parse(execFileSync("python3", ["-c", "import json,sys; from scripts.modelo import simular_plan; p=json.load(sys.stdin); print(json.dumps(simular_plan(p['caso'],p['escenario'])))"], {cwd: root, input: JSON.stringify(plan), encoding: "utf8"}));
}

function harness(plan = fixture()) {
  const callbacks = new Map(), changes = [], months = [];
  const element = {innerHTML: "", contains: () => false, querySelector: () => null,
    addEventListener(type, callback) { const list = callbacks.get(type) || []; list.push(callback); callbacks.set(type, list); }};
  const document = {activeElement: null, querySelector: (selector) => selector === "#equivalence-content" ? element : null};
  const sandbox = vm.createContext({window: {}, document, Intl});
  vm.runInContext(moduleSource, sandbox);
  const api = sandbox.window.FinanzasEquivalencia;
  const state = {...plan, selected: plan.caso.inicio, result: simulate(plan)};
  const context = {state, escapeHtml, eur, RULES, personName: (person) => state.caso.personas[person].nombre,
    monthLabel: (month) => month, changed: (options) => changes.push(JSON.parse(JSON.stringify(options))),
    selectMonth: (month) => {months.push(month); state.selected = month; api.render(context); }};
  const target = (selector, values = {}) => ({...values, closest: (candidate) => candidate === selector ? values : null});
  api.bind(context);
  api.render(context);
  return {api, context, state, element, document, changes, months, callbacks,
    emit(type, selector, values) { for (const callback of callbacks.get(type) || []) callback({target: target(selector, values)}); }};
}

test("muestra las dos tasas de CPython y el mismo excedente sin volver a calcular los importes", () => {
  const ui = harness(), value = ui.state.result.meses[0].reparto_equivalente;
  assert.match(ui.element.innerHTML, /66,666667\s*%/);
  assert.match(ui.element.innerHTML, /33,333333\s*%/);
  assert.match(ui.element.innerHTML, /40\s*%/);
  assert.match(ui.element.innerHTML, /60\s*%/);
  assert.match(ui.element.innerHTML, /E′ = E para cada persona/);
  for (const amount of [...Object.values(value.costos_originales_centimos_eur), ...Object.values(value.excedentes_originales_centimos_eur)]) {
    assert.ok(ui.element.innerHTML.includes(escapeHtml(eur(amount))));
  }
  const before = JSON.stringify(ui.state);
  ui.emit("click", "[data-eq-perspective]", {dataset: {eqPerspective: "unica"}});
  assert.match(ui.element.innerHTML, /data-eq-perspective="unica"[^>]+aria-pressed="true"/);
  assert.equal(JSON.stringify(ui.state), before, "La perspectiva no cambia movimientos, reglas, cuentas, transferencias ni resultados");
  assert.equal(ui.changes.length, 0);
});

test("un gasto sin descontar conserva su costo completo y no reduce la base proporcional", () => {
  const plan = fixture();
  plan.caso.movimientos[2].descontar_antes_reparto = false;
  const ui = harness(plan), value = ui.state.result.meses[0].reparto_equivalente;
  assert.deepEqual(value.gastos_previos_centimos_eur, {el: 0, ella: 100000});
  assert.deepEqual(value.gastos_descontados_centimos_eur, {el: 0, ella: 0});
  assert.deepEqual(value.base_reparto_centimos_eur, {el: 200000, ella: 200000});
  assert.deepEqual(value.costos_originales_centimos_eur, {el: 75000, ella: 175000});
  assert.deepEqual(value.excedentes_equivalentes_centimos_eur, {el: 125000, ella: 25000});
  assert.match(ui.element.innerHTML, /Descontados antes de repartir · D/);
  assert.match(ui.element.innerHTML, /D descuenta la parte ya asignada de los gastos marcados/);
  const assignedRow = ui.element.innerHTML.match(/<th scope="row">Gastos ya asignados · G<\/th>(.*?)<\/tr>/)[1];
  const discountedRow = ui.element.innerHTML.match(/<th scope="row">Descontados antes de repartir · D<\/th>(.*?)<\/tr>/)[1];
  assert.ok(assignedRow.includes(escapeHtml(eur(100000))));
  assert.ok(!discountedRow.includes(escapeHtml(eur(100000))));
  assert.match(ui.element.innerHTML, /30\s*%/);
  assert.match(ui.element.innerHTML, /70\s*%/);
  const before = JSON.stringify(ui.state);
  ui.emit("click", "[data-eq-perspective]", {dataset: {eqPerspective: "unica"}});
  assert.equal(JSON.stringify(ui.state), before);
  assert.equal(ui.changes.length, 0);
});

test("descontar un gasto modifica la base neta y conserva todos los gastos en la tasa única", () => {
  const plan = fixture();
  plan.caso.movimientos[2].descontar_antes_reparto = true;
  const ui = harness(plan), value = ui.state.result.meses[0].reparto_equivalente;
  assert.deepEqual(value.gastos_descontados_centimos_eur, {el: 0, ella: 100000});
  assert.deepEqual(value.base_reparto_centimos_eur, {el: 200000, ella: 100000});
  assert.deepEqual(value.costos_originales_centimos_eur, {el: 100000, ella: 150000});
  assert.deepEqual(value.excedentes_equivalentes_centimos_eur, {el: 100000, ella: 50000});
  assert.match(ui.element.innerHTML, /Neto de reparto es ingreso considerado menos gastos seleccionados/);
  assert.match(ui.element.innerHTML, /40\s*%/);
  assert.match(ui.element.innerHTML, /60\s*%/);
  ui.state.escenario.regla = "mitades";
  ui.state.result = simulate(plan);
  ui.api.render(ui.context);
  assert.doesNotMatch(ui.element.innerHTML, /Descontados antes de repartir · D|Neto de reparto es ingreso considerado menos gastos seleccionados/);
});

test("delegación única, selección de mes compartida y perspectiva persistente al recalcular", () => {
  const plan = fixture();
  plan.caso.fin = "2026-02";
  plan.caso.movimientos.forEach((record) => {record.modalidad = "recurrente"; record.intervalo_meses = 1;});
  const ui = harness(plan);
  ui.api.bind(ui.context);
  assert.equal(ui.callbacks.get("change").length, 1);
  assert.equal(ui.callbacks.get("click").length, 1);
  ui.emit("click", "[data-eq-perspective]", {dataset: {eqPerspective: "unica"}});
  ui.emit("change", "[data-eq-month]", {value: "2026-02"});
  assert.deepEqual(ui.months, ["2026-02"]);
  assert.equal(ui.state.selected, "2026-02");
  assert.match(ui.element.innerHTML, /data-eq-perspective="unica"[^>]+aria-pressed="true"/);
  assert.equal(ui.changes.length, 0);
});

test("la regla base pide recalcular pero conserva registros y resultados hasta recibir el nuevo cálculo", () => {
  const ui = harness(), before = JSON.stringify({caso: ui.state.caso, result: ui.state.result});
  for (const rule of Object.keys(RULES)) assert.ok(ui.element.innerHTML.includes(`value="${rule}"`));
  ui.emit("change", "[data-eq-rule]", {value: "mitades"});
  assert.equal(ui.state.escenario.regla, "mitades");
  assert.deepEqual(ui.changes, [{rerender: true}]);
  assert.equal(JSON.stringify({caso: ui.state.caso, result: ui.state.result}), before);
  ui.emit("change", "[data-eq-rule]", {value: "mitades"});
  ui.emit("change", "[data-eq-rule]", {value: "desconocida"});
  assert.equal(ui.changes.length, 1);
});

test("distingue 50/50 teórico del redondeo de un gasto de 1,01 EUR", () => {
  const plan = fixture();
  plan.escenario.regla = "mitades";
  plan.caso.movimientos = [movement("Común", {persona: "compartido", importe: "1.01"})];
  const ui = harness(plan);
  assert.match(ui.element.innerHTML, /α efectiva tras redondear los céntimos/);
  assert.match(ui.element.innerHTML, /50,49505\s*%/);
  assert.match(ui.element.innerHTML, /49,50495\s*%/);
  assert.ok(ui.element.innerHTML.includes(escapeHtml(eur(51))));
  assert.ok(ui.element.innerHTML.includes(escapeHtml(eur(50))));
  ui.emit("click", "[data-eq-perspective]", {dataset: {eqPerspective: "unica"}});
  assert.equal(ui.state.result.meses[0].reparto_equivalente.costos_equivalentes_centimos_eur.el, 51);
});

test("sin gastos no inventa una tasa única aunque el excedente sea calculable", () => {
  const plan = fixture();
  plan.caso.movimientos = plan.caso.movimientos.filter((record) => record.tipo === "ingreso");
  const ui = harness(plan);
  assert.match(ui.element.innerHTML, /Sin gastos: α′ no está definida/);
  assert.match(ui.element.innerHTML, /E′ = E para cada persona/);
  ui.emit("click", "[data-eq-perspective]", {dataset: {eqPerspective: "unica"}});
  assert.match(ui.element.innerHTML, /class="eq-rate">—<\/strong>/);
  assert.equal(ui.state.result.meses[0].reparto_equivalente.alpha_prima, null);
});

test("una redistribución sin gastos no se presenta como una equivalencia posible", () => {
  const plan = fixture();
  plan.escenario.regla = "igualar";
  plan.caso.movimientos = plan.caso.movimientos.filter((record) => record.tipo === "ingreso");
  plan.caso.movimientos[0].importe = "3000";
  const ui = harness(plan);
  assert.match(ui.element.innerHTML, /Una tasa sobre un gasto total de cero no puede representar/);
  assert.doesNotMatch(ui.element.innerHTML, /E′ = E para cada persona/);
  assert.equal(ui.state.result.meses[0].reparto_equivalente.costos_equivalentes_centimos_eur, null);
});

test("Igualar margen conserva tasas negativas y mayores de 100 %", () => {
  const plan = fixture();
  plan.escenario.regla = "igualar";
  plan.caso.movimientos[0].importe = "3000";
  plan.caso.movimientos[1].importe = "1000";
  plan.caso.movimientos.splice(2, 1);
  plan.caso.movimientos[2].importe = "100";
  const ui = harness(plan);
  assert.match(ui.element.innerHTML, /Hay tasas fuera de 0–100 %/);
  assert.match(ui.element.innerHTML, /1\.050\s*%/);
  assert.match(ui.element.innerHTML, /-950\s*%/);
  assert.ok(ui.element.innerHTML.includes(escapeHtml(eur(-95000))));
});

test("explica extras excluidos y repartos fijos sin reclasificar los movimientos", () => {
  const plan = fixture();
  plan.escenario.incluir_extra = false;
  plan.caso.movimientos.push(movement("Ingreso extra", {tipo: "ingreso", importe: "244", extra: true}));
  plan.caso.movimientos[3].reparto = "fijo";
  plan.caso.movimientos[3].porcentaje_el = "50";
  const ui = harness(plan);
  assert.match(ui.element.innerHTML, /Ingreso considerado para el reparto/);
  assert.match(ui.element.innerHTML, /Los ingresos excluidos del reparto siguen incluidos en el excedente/);
  assert.match(ui.element.innerHTML, /Los repartos fijos entran en G; usa Regla general en los gastos comunes/);
  assert.equal(ui.state.caso.movimientos[3].reparto, "fijo");
  assert.ok(ui.element.innerHTML.includes(escapeHtml(eur(224400))));
});

test("escapa nombres y mantiene el foco del control al actualizar", () => {
  const plan = fixture();
  plan.caso.personas.el.nombre = '<img src=x onerror="alert(1)">';
  const ui = harness(plan);
  assert.doesNotMatch(ui.element.innerHTML, /<img/);
  assert.match(ui.element.innerHTML, /&lt;img/);
  let focused = false;
  ui.document.activeElement = {dataset: {eqKey: "rule"}};
  ui.element.contains = () => true;
  ui.element.querySelector = (selector) => selector === '[data-eq-key="rule"]' ? {focus: () => {focused = true;}} : null;
  ui.api.render(ui.context);
  assert.equal(focused, true);
});
