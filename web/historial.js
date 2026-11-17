/* Explicit monthly snapshots. Exploring another budget never edits saved months. */
(() => {
  "use strict";

  const people = ["el", "ella"];
  const bound = new WeakSet();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const validMonth = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const host = () => document.querySelector("#history-content");
  let context = null;
  let comparison = [];

  function normalizeHistory(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("El historial debe ser una lista de meses guardados.");
    const months = new Set();
    const result = value.map((item) => {
      if (!item || !validMonth(item.mes) || months.has(item.mes)) throw new Error("Cada mes del historial debe tener una fecha única válida.");
      if (!item.caso || typeof item.caso !== "object" || !item.escenario || typeof item.escenario !== "object" || !item.fila || item.fila.mes !== item.mes) {
        throw new Error("Un mes del historial requiere su presupuesto, criterio y balance.");
      }
      if (item.guardado_en !== undefined && (typeof item.guardado_en !== "string" || Number.isNaN(Date.parse(item.guardado_en)))) {
        throw new Error("La fecha de guardado del historial no es válida.");
      }
      months.add(item.mes);
      return copy({mes: item.mes, guardado_en: item.guardado_en || new Date().toISOString(), caso: item.caso, escenario: item.escenario, fila: item.fila});
    });
    return result.sort((a, b) => a.mes.localeCompare(b.mes));
  }

  function createSnapshot(ctx) {
    const {state} = ctx;
    const mes = state.selected || state.caso?.inicio;
    const fila = state.result?.meses?.find((row) => row.mes === mes);
    if (!fila) throw new Error("Calcula el presupuesto antes de guardar el mes.");
    const escenario = copy(state.escenario);
    const gamma = fila.presupuesto?.gamma ?? escenario.gamma_por_mes?.[mes] ?? escenario.gamma;
    if (gamma !== undefined) escenario.gamma_por_mes = {...escenario.gamma_por_mes, [mes]: String(gamma)};
    return copy({mes, guardado_en: new Date().toISOString(), caso: state.caso, escenario, fila});
  }

  function upsert(history, snapshot) {
    return normalizeHistory([...history.filter((item) => item.mes !== snapshot.mes), copy(snapshot)]);
  }

  function monthIndex(month) {
    const [year, number] = month.split("-").map(Number);
    return year * 12 + number - 1;
  }

  function dateInMonth(date, month) {
    const [year, number] = month.split("-").map(Number);
    const day = Math.min(Number(date.slice(8, 10)) || 1, new Date(Date.UTC(year, number, 0)).getUTCDate());
    return `${month}-${String(day).padStart(2, "0")}`;
  }

  function occursInMonth(record, month) {
    if (typeof record.fecha !== "string" || !validMonth(record.fecha.slice(0, 7))) return false;
    const delta = monthIndex(month) - monthIndex(record.fecha.slice(0, 7));
    if (record.modalidad !== "recurrente") return delta === 0;
    if (delta < 0 || delta % (record.intervalo_meses || 1)) return false;
    return !record.hasta || dateInMonth(record.fecha, month) <= record.hasta;
  }

  function cloneBudget(snapshot, targetMonth) {
    if (!validMonth(targetMonth)) throw new Error("Elige un mes válido para clonar el presupuesto.");
    const caso = copy(snapshot.caso), escenario = copy(snapshot.escenario);
    const records = [...(snapshot.fila.ingresos || []), ...(snapshot.fila.pagos || [])].filter((record) => !record.es_comision_cambio);
    const originals = new Map(caso.movimientos.map((record) => [record.id, record]));
    caso.movimientos = records.map((record) => {
      const original = originals.get(record.id);
      if (!original) throw new Error("Falta un registro del presupuesto que se quiere clonar.");
      const moneda = record.moneda_original || original.moneda;
      const importe = moneda === "CLP" ? String(record.importe_original) : moneyDecimal(record.importe_original);
      return {...copy(original), moneda, importe, fecha: dateInMonth(record.fecha, targetMonth), modalidad: "unico", hasta: "", cuotas: 1, cuotas_pagadas: 0, importe_tipo: "total", estado: "previsto", estados_por_mes: {}};
    });
    caso.transferencias = (caso.transferencias || []).filter((record) => occursInMonth(record, snapshot.mes)).map((record) => ({...record, fecha: dateInMonth(record.fecha, targetMonth), modalidad: "unico", hasta: "", estado: "previsto", estados_por_mes: {}}));
    caso.inicio = caso.fin = targetMonth;
    if (typeof caso.clp_por_eur === "object") caso.clp_por_eur = snapshot.fila.clp_por_eur || caso.clp_por_eur[snapshot.mes];
    for (const person of people) caso.personas[person].saldo_inicial_eur = "0.00";
    for (const account of caso.cuentas || []) account.saldo_inicial = account.moneda === "CLP" ? "0" : "0.00";
    escenario.gamma = String(snapshot.fila.presupuesto?.gamma ?? escenario.gamma_por_mes?.[snapshot.mes] ?? escenario.gamma ?? "1");
    escenario.gamma_por_mes = {[targetMonth]: escenario.gamma};
    return {version: 2, caso, escenario};
  }

  function fields(snapshot) {
    const row = snapshot.fila, budget = row.presupuesto, actual = row.ejecucion;
    return {
      gamma: budget?.gamma ?? snapshot.escenario.gamma_por_mes?.[snapshot.mes] ?? snapshot.escenario.gamma ?? "—",
      income: budget?.ingresos_centimos_eur ?? row.ingresos_reales_centimos_eur,
      recognized: budget?.gastos_socializados_centimos_eur ?? row.gastos_descontados_centimos_eur,
      contribution: budget ? budget.contribucion_centimos_eur : row.asignacion_comunes_centimos_eur,
      personal: budget?.personal_centimos_eur,
      paidIncome: actual?.ingresos_centimos_eur,
      paid: actual?.egresos_centimos_eur,
      personalPaid: actual?.gastos_personales_centimos_eur,
      balance: actual?.flujo_caja_centimos_eur ?? actual?.saldo_centimos_eur,
      agreementBalance: actual?.saldo_centimos_eur,
      closingCash: actual?.posicion_real_centimos_eur,
      pendingCompensation: actual?.compensacion_pendiente_centimos_eur,
      state: budget?.estado || "calculado"
    };
  }

  function total(values) {
    return values && people.every((person) => Number.isFinite(values[person])) ? values.el + values.ella : null;
  }

  function cell(value) {
    const numeric = typeof value === "number";
    let text = value === null || value === undefined ? "" : String(value);
    if (!numeric && /^\s*[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function moneyDecimal(value) {
    if (!Number.isSafeInteger(value)) return null;
    const integer = BigInt(value), absolute = integer < 0n ? -integer : integer;
    return `${integer < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  }

  function csvMoney(value) {
    const decimal = moneyDecimal(value);
    return decimal === null ? '""' : '"' + decimal + '"';
  }

  function toCsv(history) {
    const headers = ["Mes", "Gamma", "Regla", "Persona", "Ingreso presupuestado EUR", "Gastos socializados EUR", "Contribución común EUR", "Personal presupuestado EUR", "Ingreso cobrado EUR", "Egresos pagados EUR", "Gastos personales pagados EUR", "Flujo de caja mensual EUR", "Saldo tras reparto EUR", "Saldo real al cierre EUR", "Compensación pendiente EUR", "Estado presupuesto"];
    const rows = [headers];
    for (const snapshot of [...history].sort((a, b) => a.mes.localeCompare(b.mes))) {
      const values = fields(snapshot);
      for (const person of people) {
        rows.push([snapshot.mes, values.gamma, snapshot.escenario.regla, snapshot.caso.personas[person].nombre,
          ...[values.income, values.recognized, values.contribution, values.personal, values.paidIncome, values.paid, values.personalPaid, values.balance, values.agreementBalance, values.closingCash, values.pendingCompensation].map((pair) => ({money: pair?.[person]})), values.state]);
      }
    }
    return "\uFEFF" + rows.map((row) => row.map((value) => value && typeof value === "object" && Object.hasOwn(value, "money") ? csvMoney(value.money) : cell(value)).join(";")).join("\r\n") + "\r\n";
  }

  function amount(ctx, value) {
    return Number.isFinite(value) ? ctx.escapeHtml(ctx.eur(value, 2)) : "—";
  }

  function name(snapshot, person) {
    return snapshot.caso.personas?.[person]?.nombre || (person === "el" ? "Persona 1" : "Persona 2");
  }

  function monthTable(ctx, history) {
    const e = ctx.escapeHtml;
    return `<div class="table-wrap"><table class="hist-table"><caption class="visually-hidden">Balances guardados por mes · EUR</caption><thead><tr><th scope="col">Mes</th><th scope="col">γ</th><th scope="col">Ingreso previsto</th><th scope="col">Egresos pagados</th><th scope="col">Flujo de caja mensual</th><th scope="col">Acciones</th></tr></thead><tbody>${history.map((snapshot) => {
      const value = fields(snapshot), balance = total(value.balance);
      return `<tr><th scope="row">${e(ctx.monthLabel(snapshot.mes))}</th><td>${snapshot.escenario.regla === "progresivo" ? e(value.gamma) : "—"}</td><td>${amount(ctx, total(value.income))}</td><td>${amount(ctx, total(value.paid))}</td><td${balance < 0 ? ' class="negative"' : ""}>${amount(ctx, balance)}</td><td><div class="hist-actions"><button type="button" class="button ghost small" data-history-open="${snapshot.mes}">Abrir</button><button type="button" class="button ghost small" data-history-clone="${snapshot.mes}">Clonar</button></div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function comparisonTable(ctx, history) {
    if (history.length < 2) return "";
    const e = ctx.escapeHtml, months = new Set(history.map((item) => item.mes));
    if (!months.has(comparison[0])) comparison[0] = history[history.length - 2].mes;
    if (!months.has(comparison[1])) comparison[1] = history[history.length - 1].mes;
    const chosen = comparison.map((month) => history.find((item) => item.mes === month));
    const options = (selected) => history.map((item) => `<option value="${item.mes}" ${item.mes === selected ? "selected" : ""}>${e(ctx.monthLabel(item.mes))}</option>`).join("");
    const labels = [["Ingreso previsto", "income"], ["Gastos socializados", "recognized"], ["Aporte a comunes", "contribution"], ["Personal presupuestado", "personal"], ["Egresos pagados", "paid"], ["Flujo de caja mensual", "balance"], ["Saldo tras reparto", "agreementBalance"], ["Saldo real al cierre", "closingCash"]];
    return `<section class="card"><div class="card-heading hist-toolbar"><h2>Comparar meses</h2><div class="hist-compare-controls"><label><span class="visually-hidden">Primer mes</span><select data-history-compare="0" aria-label="Primer mes a comparar">${options(comparison[0])}</select></label><label><span class="visually-hidden">Segundo mes</span><select data-history-compare="1" aria-label="Segundo mes a comparar">${options(comparison[1])}</select></label></div></div><div class="table-wrap"><table><caption class="visually-hidden">Comparación de meses · EUR</caption><thead><tr><th scope="col">Concepto</th>${chosen.map((snapshot) => `<th scope="col">${e(ctx.monthLabel(snapshot.mes))}</th>`).join("")}<th scope="col">Variación</th></tr></thead><tbody>${labels.map(([label, key]) => {
      const values = chosen.map((item) => total(fields(item)[key]));
      const difference = values.every(Number.isFinite) ? values[1] - values[0] : null;
      return `<tr><th scope="row">${label}</th>${values.map((value) => `<td>${amount(ctx, value)}</td>`).join("")}<td${difference < 0 ? ' class="negative"' : ""}>${amount(ctx, difference)}</td></tr>`;
    }).join("")}${people.map((person) => `<tr><th scope="row">Aporte común · ${e(name(chosen[1], person))}</th>${chosen.map((snapshot) => `<td>${amount(ctx, fields(snapshot).contribution?.[person])}</td>`).join("")}<td>${amount(ctx, Number.isFinite(fields(chosen[0]).contribution?.[person]) && Number.isFinite(fields(chosen[1]).contribution?.[person]) ? fields(chosen[1]).contribution[person] - fields(chosen[0]).contribution[person] : null)}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function flowChart(ctx, history) {
    let accumulated = 0, complete = true;
    const points = history.map((snapshot) => {
      const monthly = total(fields(snapshot).balance);
      complete = complete && monthly !== null;
      if (!complete) return {snapshot, balance: null};
      accumulated += monthly;
      return {snapshot, balance: accumulated};
    });
    const scale = Math.max(1, ...points.map((point) => Math.abs(point.balance || 0)));
    return `<section class="card"><div class="card-heading"><h2>Ahorro acumulado</h2><span class="muted">EUR</span></div><div class="hist-flow-list" role="list">${points.map(({snapshot, balance}) => `<div class="hist-flow-row" role="listitem"><span>${ctx.escapeHtml(ctx.monthLabel(snapshot.mes, true))}</span><div class="hist-flow-track" aria-hidden="true"><span class="${balance < 0 ? "hist-flow-negative" : "hist-flow-positive"}" style="width:${Math.abs(balance || 0) / scale * 100}%"></span></div><strong${balance < 0 ? ' class="negative"' : ""}>${amount(ctx, balance)}</strong></div>`).join("")}</div><p class="hint hist-caption">Suma de los flujos de caja de los meses guardados. Los saldos iniciales y las revalorizaciones se registran por separado.</p></section>`;
  }

  function nextMonth(month) {
    const [year, number] = month.split("-").map(Number);
    return `${year + (number === 12 ? 1 : 0)}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
  }

  function render(ctx) {
    context = ctx;
    const element = host();
    if (!element || !ctx.state.caso) return;
    const existingDialog = element.querySelector("#history-clone-dialog");
    const dialogState = existingDialog?.open ? {
      source: existingDialog.querySelector('[name="source"]').value,
      target: existingDialog.querySelector('[name="target"]').value,
      focusTarget: document.activeElement?.name === "target"
    } : null;
    const history = [...(ctx.state.history || [])].sort((a, b) => a.mes.localeCompare(b.mes));
    const selected = ctx.state.selected || ctx.state.caso.inicio;
    const previous = history.find((item) => item.mes === selected);
    const e = ctx.escapeHtml;
    element.innerHTML = `<div class="hist-toolbar"><h2>Historial</h2><div class="hist-actions"><button type="button" class="button ghost small" data-history-csv ${history.length ? "" : "disabled"}>Exportar CSV</button><button type="button" class="button primary" data-history-save>${previous ? "Actualizar" : "Guardar"} ${e(ctx.monthLabel(selected, true))}</button></div></div>${history.length ? `${flowChart(ctx, history)}<section class="card">${monthTable(ctx, history)}</section>${comparisonTable(ctx, history)}` : '<p class="empty-state">Aún no hay meses guardados.</p>'}<dialog id="history-clone-dialog" class="hist-dialog"><form method="dialog" class="hist-clone-form"><h2>Clonar presupuesto</h2><input type="hidden" name="source"><label for="history-clone-target">Mes nuevo</label><input type="month" id="history-clone-target" name="target" required value="${nextMonth(selected)}"><p class="hint">Copia los importes de ese mes como previstos. Los saldos iniciales parten en cero.</p><div class="hist-actions"><button type="button" class="button ghost small" data-history-cancel>Cancelar</button><button type="submit" class="button primary">Crear mes</button></div></form></dialog>`;
    if (dialogState) {
      const dialog = element.querySelector("#history-clone-dialog");
      dialog.querySelector('[name="source"]').value = dialogState.source;
      dialog.querySelector('[name="target"]').value = dialogState.target;
      dialog.showModal();
      if (dialogState.focusTarget) dialog.querySelector('[name="target"]').focus({preventScroll: true});
    }
  }

  function bind(ctx) {
    context = ctx;
    const element = host();
    if (!element || bound.has(element)) return;
    bound.add(element);
    element.addEventListener("click", (event) => {
      const target = event.target;
      if (target.closest("[data-history-save]")) context.saveMonth?.();
      if (target.closest("[data-history-csv]")) context.exportCsv?.();
      const open = target.closest("[data-history-open]");
      if (open) context.openMonth?.(open.dataset.historyOpen);
      const clone = target.closest("[data-history-clone]");
      if (clone) {
        const dialog = element.querySelector("#history-clone-dialog");
        dialog.querySelector('[name="source"]').value = clone.dataset.historyClone;
        dialog.querySelector('[name="target"]').value = nextMonth(clone.dataset.historyClone);
        dialog.showModal();
      }
      if (target.closest("[data-history-cancel]")) element.querySelector("#history-clone-dialog").close();
    });
    element.addEventListener("change", (event) => {
      const select = event.target.closest("[data-history-compare]");
      if (!select) return;
      comparison[Number(select.dataset.historyCompare)] = select.value;
      render(context);
      element.querySelector(`[data-history-compare="${select.dataset.historyCompare}"]`)?.focus({preventScroll: true});
    });
    element.addEventListener("submit", (event) => {
      const form = event.target.closest(".hist-clone-form");
      if (!form) return;
      event.preventDefault();
      if (!form.checkValidity()) {form.reportValidity(); return;}
      const source = form.querySelector('[name="source"]').value, target = form.querySelector('[name="target"]').value;
      element.querySelector("#history-clone-dialog").close();
      context.cloneMonth?.(source, target);
    });
  }

  window.FinanzasHistorial = {render, bind, normalizeHistory, createSnapshot, upsert, cloneBudget, toCsv};
})();
