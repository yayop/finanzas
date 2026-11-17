"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {execFileSync} = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "web/progresividad.js"), "utf8");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"}[character]));
const eur = (value) => (value / 100).toFixed(2) + " €";

function load(document = {querySelector: () => null}) {
  const window = {addEventListener() {}};
  const sandbox = vm.createContext({window, document, Intl});
  vm.runInContext(source, sandbox);
  return {api: window.FinanzasProgresividad, sandbox};
}

function json(value) { return JSON.parse(JSON.stringify(value)); }

function plan() {
  const movement = (id, changes = {}) => ({id, concepto: id, tipo: "gasto", persona: "ella", pagador: "ella", importe: "100", moneda: "EUR", fecha: "2026-01-01", modalidad: "unico", estado: "previsto", descontar_antes_reparto: false, ...changes});
  return {caso: {version: 2, es_ficticio: true, inicio: "2026-01", fin: "2026-01", clp_por_eur: "1000",
    personas: {el: {nombre: "Persona A", saldo_inicial_eur: "0"}, ella: {nombre: "Persona B", saldo_inicial_eur: "0"}},
    cuentas: [], transferencias: [], movimientos: [movement("Ingreso A", {tipo: "ingreso", persona: "el", importe: "2000", estado: "pagado"}),
      movement("Ingreso B", {tipo: "ingreso", importe: "1000", estado: "pagado"}),
      movement("Obligación", {persona: "el", pagador: "el", importe: "200", descontar_antes_reparto: true}),
      movement("Común", {persona: "compartido", importe: "1200", reparto: "regla", estado: "pagado"}),
      movement("Personal", {importe: "50", estado: "pagado"})]},
    escenario: {id: "prueba", nombre: "Ficticio", regla: "progresivo", gamma: "1", incluir_extra: true, porcentaje_el: "50"}};
}

function simulate(value) {
  return JSON.parse(execFileSync("python3", ["-c", "import json,sys; from scripts.modelo import simular_plan; p=json.load(sys.stdin); print(json.dumps(simular_plan(p['caso'],p['escenario'])))"], {cwd: root, input: JSON.stringify(value), encoding: "utf8"}));
}

function harness(value = plan()) {
  const handlers = new Map(), updates = [];
  let html = "", replacements = 0;
  const fields = new Map();
  const simulator = {dataset: {}, contains: (node) => [...fields.values()].includes(node),
    get innerHTML() { return html; }, set innerHTML(value) { html = value; replacements++; },
    addEventListener(type, callback) { const list = handlers.get(type) || []; list.push(callback); handlers.set(type, list); },
    querySelector: (selector) => fields.get(selector) || null};
  const dashboard = {innerHTML: ""};
  const document = {activeElement: null, querySelector: (selector) => selector === "#dashboard-content" ? dashboard : selector === "#simulator-content" ? simulator : null};
  const {api} = load(document);
  const state = {...value, selected: value.caso.inicio, result: simulate(value)};
  const context = {state, escapeHtml, eur, monthLabel: (month) => month, personName: (person) => state.caso.personas[person].nombre,
    setGamma(gamma) { updates.push(gamma); state.escenario.gamma_por_mes ??= {}; state.escenario.gamma_por_mes[state.selected] = gamma; }};
  api.bind(context); api.render(context);
  return {api, state, context, simulator, dashboard, document, updates, fields, handlers,
    replacements: () => replacements,
    input(kind, value) {
      const input = {dataset: {gvGamma: kind, gvKey: kind}, value, checkValidity: () => Number(value) >= 0,
        closest: (selector) => selector === "[data-gv-gamma]" ? input : null};
      fields.set(`[data-gv-gamma="${kind}"]`, input);
      for (const callback of handlers.get("input") || []) callback({target: input});
      return input;
    }};
}

test("la vista previa resuelve el modelo implícito y conserva cada céntimo", () => {
  const {api} = load();
  const equal = api.solve(200000, 100000, 120000, 0);
  assert.deepEqual(json(equal.contribucion_centimos_eur), {el: 60000, ella: 60000});
  assert.deepEqual(json(equal.personal_centimos_eur), {el: 140000, ella: 40000});
  const proportional = api.solve(200000, 100000, 120000, 1);
  assert.equal(proportional.alpha.el, 2 / 3);
  assert.deepEqual(json(proportional.personal_centimos_eur), {el: 120000, ella: 60000});
  const progressive = api.solve(200000, 100000, 120000, 2);
  const alpha = progressive.alpha.el;
  const p1 = 200000 - alpha * 120000, p2 = 100000 - (1 - alpha) * 120000;
  assert.ok(Math.abs(Math.log(alpha / (1 - alpha)) - 2 * Math.log(p1 / p2)) < 1e-12);
  assert.ok(alpha > 2 / 3);
  assert.equal(progressive.personal_centimos_eur.el + progressive.personal_centimos_eur.ella, 180000);
});

test("la vista previa coincide con Python en bordes, déficit y progresividades altas", () => {
  const inputs = [[200000,100000,120000,0], [200000,100000,120000,0.35], [200000,100000,120000,1], [200000,100000,120000,2],
    [200000,100000,120000,20], [10000,30000,20000,0], [10000,30000,20000,0.05], [0,30000,20000,1], [30000,0,20000,2],
    [10000,30000,50000,0], [10000,30000,50000,1], [-10000,90000,10000,1], [10000,30000,40000,2], [0,0,0,1],
    [200000,100000,0,2], [200000,100000,0,1000], [0,10000,0,4], [10000,0,0,4], [1,10000,10000,4]];
  const expected = JSON.parse(execFileSync("python3", ["-c", "import json,sys; from scripts.modelo import resolver_progresividad; print(json.dumps([resolver_progresividad({'el':a,'ella':b},c,str(g)) for a,b,c,g in json.load(sys.stdin)]))"], {cwd: root, input: JSON.stringify(inputs), encoding: "utf8"}));
  const {api} = load();
  inputs.forEach((input, index) => {
    const actual = json(api.solve(...input)), reference = expected[index];
    assert.equal(actual.estado, reference.estado, String(input));
    assert.deepEqual(actual.contribucion_centimos_eur, reference.contribucion_centimos_eur, String(input));
    assert.deepEqual(actual.personal_centimos_eur, reference.personal_centimos_eur, String(input));
    if (reference.alpha) assert.ok(Math.abs(actual.alpha.el - reference.alpha.el) < 1e-12, String(input));
    else assert.equal(actual.alpha, null);
  });
});

test("Dashboard muestra presupuesto, ejecución y repartos exactos del motor sin mutarlos", () => {
  const ui = harness(), before = JSON.stringify(ui.state);
  assert.match(ui.dashboard.innerHTML, /Dinero personal/);
  assert.match(ui.dashboard.innerHTML, /Efectivamente realizado/);
  assert.match(ui.dashboard.innerHTML, /Ingresos pendientes/);
  assert.match(ui.dashboard.innerHTML, /Obligaciones pendientes/);
  assert.match(ui.dashboard.innerHTML, /Reparto por gasto/);
  const row = ui.state.result.meses[0];
  assert.match(ui.dashboard.innerHTML, /Saldo tras reparto · S/);
  assert.match(ui.dashboard.innerHTML, /Saldo efectivo al cierre/);
  assert.match(ui.dashboard.innerHTML, /Flujo efectivo de caja/);
  assert.match(ui.dashboard.innerHTML, /Compensación pendiente/);
  assert.notDeepEqual(row.ejecucion.posicion_real_centimos_eur, row.ejecucion.saldo_centimos_eur);
  for (const pair of [row.presupuesto.personal_centimos_eur, row.ejecucion.egresos_centimos_eur, row.ejecucion.saldo_centimos_eur, row.ejecucion.posicion_real_centimos_eur]) {
    for (const value of Object.values(pair)) assert.ok(ui.dashboard.innerHTML.includes(escapeHtml(eur(value))));
  }
  assert.equal(JSON.stringify(ui.state), before);
  assert.doesNotMatch(ui.dashboard.innerHTML, /NaN|Infinity/);
});

test("gamma se actualiza inmediatamente por el callback y mantiene el slider durante el recálculo", () => {
  const ui = harness();
  const output = {innerHTML: ""};
  ui.fields.set("[data-gv-results]", output);
  const before = JSON.stringify(ui.state.caso);
  const range = ui.input("range", "2.05");
  assert.deepEqual(ui.updates, ["2.05"]);
  assert.ok(output.innerHTML.includes("Dinero personal"));
  assert.equal(JSON.stringify(ui.state.caso), before);
  ui.document.activeElement = range;
  const replacements = ui.replacements();
  ui.api.render(ui.context);
  assert.equal(ui.replacements(), replacements, "Se conserva el elemento activo mientras se arrastra");
  assert.equal(ui.handlers.get("input").length, 1);
  ui.api.bind(ui.context);
  assert.equal(ui.handlers.get("input").length, 1);
});

test("acepta gamma mayor que cuatro y respeta el valor propio del mes", () => {
  const value = plan();
  value.escenario.gamma_por_mes = {"2026-01": "6.25"};
  const ui = harness(value);
  assert.match(ui.simulator.innerHTML, /data-gv-gamma="number"[^>]*value="6.25"/);
  assert.match(ui.simulator.innerHTML, /data-gv-gamma="range"[^>]*max="4"/);
  ui.input("number", "12.5");
  assert.deepEqual(ui.updates, ["12.5"]);
  ui.input("number", "");
  ui.input("number", "-1");
  assert.deepEqual(ui.updates, ["12.5"]);
});

test("el déficit permanece visible con tasas y montos indeterminados", () => {
  const value = plan();
  value.caso.movimientos[3].importe = "4000";
  const ui = harness(value);
  assert.match(ui.dashboard.innerHTML, /Déficit presupuestario/);
  assert.match(ui.dashboard.innerHTML, /No hay un reparto factible/);
  assert.match(ui.simulator.innerHTML, /No hay un reparto factible/);
  assert.doesNotMatch(ui.dashboard.innerHTML + ui.simulator.innerHTML, /NaN|Infinity|flex-basis:-/);
  assert.equal(ui.state.result.meses[0].presupuesto.alpha, null);
});

test("el gráfico permite seleccionar gamma con ratón y teclado usando las dos curvas", () => {
  const ui = harness(), points = [];
  const painter = {setTransform() {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {}, setLineDash() {},
    moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }, arc(x, y) { points.push([x, y]); }, fillText() {}};
  const canvas = {dataset: {gvKey: "chart"}, getContext: () => painter, getBoundingClientRect: () => ({left: 100, width: 800}),
    closest: (selector) => selector === "#gamma-chart" ? canvas : null};
  ui.fields.set("#gamma-chart", canvas);
  ui.api.render(ui.context);
  assert.ok(points.length > 320, "Se trazan ambas curvas con valores muestreados");
  assert.ok(points.every((point) => point.every(Number.isFinite)));
  for (const callback of ui.handlers.get("click") || []) callback({target: canvas, clientX: 528});
  assert.equal(ui.updates.at(-1), "2");
  let prevented = false;
  for (const callback of ui.handlers.get("keydown") || []) callback({target: canvas, key: "ArrowRight", preventDefault() { prevented = true; }});
  assert.equal(ui.updates.at(-1), "2.05");
  assert.equal(prevented, true);
});
