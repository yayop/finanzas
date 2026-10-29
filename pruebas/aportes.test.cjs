"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {execFileSync} = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({window: {}, document: {querySelector: () => null}, Intl, Date});
vm.runInContext(readFileSync(path.join(root, "web/operativa.js"), "utf8"), context);
const calculate = context.window.FinanzasOperativa.equivalentContributions;
const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const caso = {version: 2, es_ficticio: true, inicio: "2026-11", fin: "2026-12", clp_por_eur: "1000", comision_cambio_eur: "5",
    personas: {el: {nombre: "Persona A", saldo_inicial_eur: "0"}, ella: {nombre: "Persona B", saldo_inicial_eur: "0"}},
    cuentas: [
      {id: "a", nombre: "A EUR", titular: "el", moneda: "EUR", saldo_inicial: "0"},
      {id: "b", nombre: "B EUR", titular: "ella", moneda: "EUR", saldo_inicial: "0"},
      {id: "j", nombre: "Común", titular: "compartido", moneda: "EUR", saldo_inicial: "0", porcentaje_el: "50"},
      {id: "c", nombre: "B CLP", titular: "ella", moneda: "CLP", saldo_inicial: "0"}
    ], movimientos: [], transferencias: []};
  const movement = (id, account, amount, currency, payer) => ({id, concepto: id, tipo: "gasto", persona: "compartido", pagador: payer,
    cuenta_id: account, importe: amount, moneda: currency, fecha: "2026-11-05", modalidad: "recurrente", intervalo_meses: 1,
    hasta: "", reparto: "fijo", porcentaje_el: "50", porcentaje_compartido: "100"});
  caso.movimientos.push(movement("Gasto conjunto", "j", "1000", "EUR", "el"), movement("Gasto externo", "c", "200000", "CLP", "ella"));
  const transfer = (id, origin, destination, amount) => ({id, concepto: id, origen: origin, destino: destination, importe: amount,
    fecha: "2026-11-01", modalidad: "recurrente", intervalo_meses: 1, hasta: ""});
  caso.transferencias.push(transfer("Aporte A", "a", "j", "500"), transfer("Aporte B", "b", "j", "500"), transfer("Conversión", "b", "c", "200"));
  return {caso, escenario: {id: "prueba", nombre: "Prueba ficticia", regla: "mitades", incluir_extra: true}};
}

function simulate(plan) {
  return JSON.parse(execFileSync("python3", ["-c", "import json,sys; from scripts.modelo import simular_plan; p=json.load(sys.stdin); print(json.dumps(simular_plan(p['caso'],p['escenario'])))"], {cwd: root, input: JSON.stringify(plan), encoding: "utf8"}));
}

function proposal(plan, result, index = 0) {
  return copy(calculate(plan.caso, result.meses[index], result.operativa.meses[index]));
}

test("un pago compartido cubierto por una persona reduce su aporte común, sin sumar dos veces la comisión", () => {
  const plan = fixture(), result = simulate(plan), before = JSON.stringify({plan, result});
  const value = proposal(plan, result);
  assert.equal(value.tipo, "conjunta");
  assert.deepEqual(value.objetivo_centimos_eur, {el: 60000, ella: 40000});
  assert.deepEqual(value.planificado_centimos_eur, {el: 50000, ella: 50000}, "Cada transferencia se cuenta una vez, aunque tenga dos eventos");
  assert.equal(value.necesidad_conjunta_centimos_eur, 100000);
  assert.equal(result.meses[0].pagos.filter((payment) => payment.es_comision_cambio).length, 1);
  assert.equal(JSON.stringify({plan, result}), before, "La propuesta no cambia el plan ni las transferencias");
});

test("cuando termina el gasto conjunto, el equivalente es una transferencia directa entre personas", () => {
  const plan = fixture();
  plan.caso.movimientos[0].hasta = "2026-11-30";
  plan.caso.transferencias.push({id: "Directa", concepto: "Directa", origen: "a", destino: "b", importe: "100", fecha: "2026-12-01", modalidad: "unico"});
  const value = proposal(plan, simulate(plan), 1);
  assert.equal(value.tipo, "directa");
  assert.deepEqual(value.objetivo_centimos_eur, {el: 10000, ella: -10000});
  assert.deepEqual(value.directo_planificado_centimos_eur, {el: 10000, ella: -10000});
  assert.equal(value.necesidad_conjunta_centimos_eur, 0);
});

test("cambiar el porcentaje modifica los aportes equivalentes y conserva el gasto total", () => {
  const totals = [];
  for (const percentage of [0, 25, 50, 75, 100]) {
    const plan = fixture();
    plan.caso.movimientos[1].porcentaje_el = String(percentage);
    const result = simulate(plan), value = proposal(plan, result);
    assert.deepEqual(value.objetivo_centimos_eur, {el: 50000 + 200 * percentage, ella: 50000 - 200 * percentage});
    totals.push(result.meses[0].hogar.flujo_libre_centimos_eur);
  }
  assert.deepEqual(totals, Array(5).fill(-120500));
});

test("los ingresos directos a la cuenta común reducen el aporte de quien los recibe y permiten recibir un excedente", () => {
  const plan = fixture();
  plan.caso.movimientos.push({id: "Ingreso", concepto: "Ingreso", tipo: "ingreso", persona: "el", pagador: "el", cuenta_id: "j",
    importe: "1500", moneda: "EUR", fecha: "2026-11-01", modalidad: "unico", extra: false});
  const value = proposal(plan, simulate(plan));
  assert.equal(value.tipo, "conjunta");
  assert.deepEqual(value.objetivo_centimos_eur, {el: -90000, ella: 40000});
  assert.equal(value.necesidad_conjunta_centimos_eur, -50000);
});

test("los aportes en CLP y retiros comunes se convierten exactamente y no duplican los dos lados de una transferencia", () => {
  const plan = fixture();
  plan.caso.clp_por_eur = "1.1e3";
  plan.caso.cuentas.push({id: "ac", nombre: "A CLP", titular: "el", moneda: "CLP", saldo_inicial: "0"});
  plan.caso.transferencias[0].origen = "ac";
  plan.caso.transferencias[0].importe = "550000";
  plan.caso.transferencias.push({id: "Retiro", concepto: "Retiro", origen: "j", destino: "c", importe: "100", fecha: "2026-11-02", modalidad: "unico"});
  const value = proposal(plan, simulate(plan));
  assert.deepEqual(value.planificado_centimos_eur, {el: 50000, ella: 40000});
});

test("los registros antiguos y comisiones sin cuenta directa conservan la equivalencia por sus metadatos", () => {
  const plan = fixture(), result = simulate(plan);
  for (const record of [...result.meses[0].pagos, ...result.meses[0].ingresos]) delete record.cuenta_id;
  assert.deepEqual(proposal(plan, result).objetivo_centimos_eur, {el: 60000, ella: 40000});
  assert.equal(calculate(plan.caso, null, null), null);
});
