/* Accounts and planned money movements. No banking connection is used. */
(() => {
  "use strict";

  let context = null;
  let perspective = "reparto";
  let undo = null;
  let planIdentity = null;
  const bound = new WeakSet();
  const host = () => document.querySelector("#operations-content");
  const money = (units, currency, ctx) => currency === "EUR" ? ctx.eur(units, 2) : ctx.originalMoney(units, "CLP");
  const monthName = (month) => new Intl.DateTimeFormat("es-CL", {month: "long", year: "numeric", timeZone: "UTC"}).format(new Date(month + "-01T12:00:00Z"));
  const dateName = (date) => new Intl.DateTimeFormat("es-CL", {day: "numeric", month: "short", timeZone: "UTC"}).format(new Date(date + "T12:00:00Z"));
  const uuid = (prefix) => prefix + crypto.randomUUID();

  function normalize(caso) {
    caso.cuentas ??= [];
    caso.transferencias ??= [];
    caso.comision_cambio_eur ??= "0.00";
    if (Array.isArray(caso.cuentas)) caso.cuentas.forEach((account) => { account.porcentaje_el ??= "50"; });
    if (Array.isArray(caso.transferencias)) caso.transferencias.forEach((transfer) => {
      transfer.modalidad ??= "unico";
      transfer.intervalo_meses ??= 1;
      transfer.hasta ??= "";
    });
    for (const movement of caso.movimientos || []) movement.cuenta_id ??= "";
  }

  function input(ctx, kind, index, property, label, value, options = {}) {
    const e = ctx.escapeHtml;
    const key = `${kind}-${index}-${property}`;
    const {type = "text", min, max, step, required = true, suffix = "", wide = false} = options;
    return `<div class="field${wide ? " wide" : ""}"><label for="op-${key}">${e(label)}</label><div class="input-wrap"><input id="op-${key}" data-op-key="${key}" data-op-kind="${kind}" data-op-index="${index}" data-op-field="${property}" type="${type}" value="${e(value ?? "")}" ${required ? "required" : ""} ${min === undefined ? "" : `min="${min}"`} ${max === undefined ? "" : `max="${max}"`} ${step === undefined ? "" : `step="${step}"`} ${type === "text" ? 'maxlength="100"' : ""}>${suffix ? `<span class="suffix">${e(suffix)}</span>` : ""}</div></div>`;
  }

  function select(ctx, kind, index, property, label, value, options, wide = false) {
    const e = ctx.escapeHtml, key = `${kind}-${index}-${property}`;
    return `<div class="field${wide ? " wide" : ""}"><label for="op-${key}">${e(label)}</label><select id="op-${key}" data-op-key="${key}" data-op-kind="${kind}" data-op-index="${index}" data-op-field="${property}">${options.map(([id, name]) => `<option value="${e(id)}" ${id === value ? "selected" : ""}>${e(name)}</option>`).join("")}</select></div>`;
  }

  function accountForm(account, index, ctx) {
    const e = ctx.escapeHtml;
    const owner = account.titular === "compartido" ? "Conjunta" : ctx.personName(account.titular);
    return `<details class="account-card" data-op-detail="account-${e(account.id)}"><summary class="account-heading"><strong>${e(account.nombre || "Sin nombre")}</strong><span class="account-meta">${e(owner)} · ${e(account.moneda)}</span></summary><div class="operation-form"><div class="field-grid">${input(ctx, "account", index, "nombre", "Nombre", account.nombre, {wide: true})}${select(ctx, "account", index, "titular", "Titular", account.titular, [["el", ctx.personName("el")], ["ella", ctx.personName("ella")], ["compartido", "Conjunta"]])}${select(ctx, "account", index, "moneda", "Moneda", account.moneda, [["EUR", "EUR"], ["CLP", "CLP"]])}${input(ctx, "account", index, "saldo_inicial", "Saldo inicial", account.saldo_inicial, {type: "number", step: account.moneda === "CLP" ? "1" : "0.01", suffix: account.moneda === "EUR" ? "€" : "CLP", wide: true})}${account.titular === "compartido" ? input(ctx, "account", index, "porcentaje_el", "Parte de " + ctx.personName("el"), account.porcentaje_el, {type: "number", min: 0, max: 100, step: "any", suffix: "%", wide: true}) : ""}</div><div class="operation-actions"><button class="button ghost small danger" data-op-delete-account="${index}" type="button">Eliminar</button></div></div></details>`;
  }

  function transferForm(transfer, index, ctx) {
    const e = ctx.escapeHtml, accounts = ctx.state.caso.cuentas;
    const origin = accounts.find((account) => account.id === transfer.origen);
    const destination = accounts.find((account) => account.id === transfer.destino);
    const recurring = transfer.modalidad === "recurrente";
    const route = `${origin?.nombre || "Sin origen"} → ${destination?.nombre || "Sin destino"}`;
    const crossCurrency = origin && destination && origin.moneda !== destination.moneda;
    const fee = ctx.eur(Math.round(Number(ctx.state.caso.comision_cambio_eur) * 100), 2);
    const accountOptions = accounts.map((account) => [account.id, account.nombre + " · " + account.moneda]);
    return `<details class="transfer-card" data-op-detail="transfer-${e(transfer.id)}"><summary class="account-heading"><strong>${e(transfer.concepto || "Transferencia")}</strong><span class="account-meta">${e(route)}</span></summary><div class="operation-form"><div class="field-grid">${input(ctx, "transfer", index, "concepto", "Concepto", transfer.concepto, {wide: true})}${select(ctx, "transfer", index, "origen", "Desde", transfer.origen, accountOptions, true)}${select(ctx, "transfer", index, "destino", "Hacia", transfer.destino, accountOptions.filter(([id]) => id !== transfer.origen), true)}${input(ctx, "transfer", index, "importe", "Importe de origen", transfer.importe, {type: "number", min: 0, step: origin?.moneda === "CLP" ? "1" : "0.01", suffix: origin?.moneda === "CLP" ? "CLP" : "€", wide: true})}${select(ctx, "transfer", index, "modalidad", "Frecuencia", transfer.modalidad, [["unico", "Una vez"], ["recurrente", "Recurrente"]], true)}${input(ctx, "transfer", index, "fecha", recurring ? "Desde" : "Fecha", transfer.fecha, {type: "date", wide: !recurring})}${recurring ? input(ctx, "transfer", index, "intervalo_meses", "Cada (meses)", transfer.intervalo_meses, {type: "number", min: 1, max: 12, step: 1}) + input(ctx, "transfer", index, "hasta", "Fin (opcional)", transfer.hasta, {type: "date", required: false, wide: true}) : ""}</div>${crossCurrency ? `<p class="operation-note">Cambio del plan; comisión ${e(fee)} en origen.</p>` : ""}<div class="operation-actions"><button class="button ghost small danger" data-op-delete-transfer="${index}" type="button">Eliminar</button></div></div></details>`;
  }

  function assignmentOptions(movement, accounts, ctx) {
    const person = movement.tipo === "ingreso" ? movement.persona : null;
    return accounts.filter((account) => account.moneda === movement.moneda && (!person || account.titular === "compartido" || account.titular === person)).map((account) => [account.id, account.nombre]);
  }

  function assignments(ctx) {
    const e = ctx.escapeHtml, movements = ctx.state.caso.movimientos;
    if (!movements.length) return '<p class="operation-empty">Sin registros</p>';
    return `<div class="table-wrap"><table><thead><tr><th>Registro</th><th>Tipo</th><th>Cuenta</th></tr></thead><tbody>${movements.map((movement, index) => `<tr><th scope="row">${e(movement.concepto)}</th><td>${e(movement.tipo === "ingreso" ? "Ingreso" : "Gasto")}</td><td><select class="operation-table-select" aria-label="Cuenta de ${e(movement.concepto)}" data-op-key="movement-${index}-cuenta_id" data-op-kind="movement" data-op-index="${index}" data-op-field="cuenta_id"><option value="">Sin cuenta</option>${assignmentOptions(movement, ctx.state.caso.cuentas, ctx).map(([id, name]) => `<option value="${e(id)}" ${id === movement.cuenta_id ? "selected" : ""}>${e(name)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
  }

  function eventEUR(units, currency, rate) {
    if (!Number.isSafeInteger(units)) return null;
    if (currency === "EUR") return units;
    const match = String(rate).trim().match(/^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    if (!match) return null;
    const scale = (match[2] || "").length - Number(match[3] || 0);
    if (!Number.isSafeInteger(scale) || Math.abs(scale) > 1000) return null;
    let numerator = BigInt(match[1] + (match[2] || "")), denominator = 1n;
    if (scale >= 0) denominator = 10n ** BigInt(scale); else numerator *= 10n ** BigInt(-scale);
    if (numerator <= 0n) return null;
    const value = BigInt(Math.abs(units)) * 100n * denominator;
    const rounded = value / numerator + ((value % numerator) * 2n >= numerator ? 1n : 0n);
    const result = Number(rounded) * Math.sign(units);
    return Number.isSafeInteger(result) ? result : null;
  }

  function equivalentContributions(caso, row, operation) {
    if (!row?.pagos_personales_centimos_eur || !row.asignacion_comunes_centimos_eur || !Array.isArray(row.pagos) || !Array.isArray(row.ingresos)) return null;
    const people = ["el", "ella"], accounts = new Map((caso.cuentas || []).map((account) => [account.id, account]));
    const movements = new Map((caso.movimientos || []).map((movement) => [movement.id, movement]));
    const transfers = new Map((caso.transferencias || []).map((transfer) => [transfer.id, transfer]));
    const accountFor = (record) => accounts.get(record.cuenta_id || movements.get(record.id)?.cuenta_id || transfers.get(record.transferencia_id)?.origen || record.origen);
    const paid = {el: 0, ella: 0}, jointIncome = {el: 0, ella: 0};
    for (const payment of row.pagos) {
      if (!Number.isSafeInteger(payment.importe_centimos_eur)) return null;
      const account = accountFor(payment);
      if (account?.titular === "compartido") continue;
      const person = account?.titular || payment.pagador;
      if (!people.includes(person)) return null;
      paid[person] += payment.importe_centimos_eur;
    }
    for (const income of row.ingresos) {
      if (accountFor(income)?.titular !== "compartido") continue;
      if (!people.includes(income.persona) || !Number.isSafeInteger(income.importe_centimos_eur)) return null;
      jointIncome[income.persona] += income.importe_centimos_eur;
    }
    const target = Object.fromEntries(people.map((person) => [person, row.pagos_personales_centimos_eur[person] + row.asignacion_comunes_centimos_eur[person] - paid[person] - jointIncome[person]]));
    if (!Object.values(target).every(Number.isSafeInteger)) return null;
    const planned = {el: 0, ella: 0}, direct = {el: 0, ella: 0};
    for (const event of operation?.eventos || []) {
      if (event.tipo !== "transferencia" || !(event.importe_unidades < 0)) continue;
      const origin = accounts.get(event.cuenta_id), destination = accounts.get(event.contracuenta_id);
      if (!origin || !destination) continue;
      const amount = eventEUR(-event.importe_unidades, origin.moneda, row.clp_por_eur);
      if (amount === null) return null;
      if (people.includes(origin.titular) && destination.titular === "compartido") planned[origin.titular] += amount;
      else if (origin.titular === "compartido" && people.includes(destination.titular)) planned[destination.titular] -= amount;
      else if (people.includes(origin.titular) && people.includes(destination.titular) && origin.titular !== destination.titular) {
        direct[origin.titular] += amount;
        direct[destination.titular] -= amount;
      }
    }
    if (![...Object.values(planned), ...Object.values(direct)].every(Number.isSafeInteger)) return null;
    const jointNeed = target.el + target.ella;
    if (!Number.isSafeInteger(jointNeed)) return null;
    return {tipo: jointNeed === 0 ? "directa" : "conjunta", objetivo_centimos_eur: target,
      planificado_centimos_eur: planned, directo_planificado_centimos_eur: direct,
      necesidad_conjunta_centimos_eur: jointNeed};
  }

  function contributionCard(ctx, row, operation) {
    const proposal = equivalentContributions(ctx.state.caso, row, operation);
    if (!proposal || (!row.pagos.length && !ctx.state.caso.cuentas.some((account) => account.titular === "compartido"))) return "";
    const e = ctx.escapeHtml, target = proposal.objetivo_centimos_eur;
    const heading = '<div class="card-heading"><h3>Aportes equivalentes del mes</h3></div>';
    const note = '<p class="operation-note">Propuesta según reparto; las transferencias guardadas no se cambian.</p>';
    if (proposal.tipo === "directa") {
      const net = target.el, planned = proposal.directo_planificado_centimos_eur.el;
      const route = (amount) => e(amount > 0 ? `${ctx.personName("el")} → ${ctx.personName("ella")}` : `${ctx.personName("ella")} → ${ctx.personName("el")}`);
      return `${heading}<div class="operation-summary"><span>${net === 0 ? "Sin transferencia equivalente" : route(net)}</span>${net === 0 ? "" : `<strong>${ctx.eur(Math.abs(net))}</strong>`}<small>Planificado este mes: ${planned === 0 ? ctx.eur(0) : `${route(planned)} · ${ctx.eur(Math.abs(planned))}`}</small></div>${note}`;
    }
    return `${heading}<div class="table-wrap"><table><thead><tr><th>Persona</th><th>Propuesto</th><th>Planificado (+/−)</th></tr></thead><tbody>${["el", "ella"].map((person) => `<tr><th scope="row">${e(ctx.personName(person))}</th><td>${target[person] < 0 ? "Recibir" : "Aportar"} ${ctx.eur(Math.abs(target[person]))}</td><td>${ctx.eur(proposal.planificado_centimos_eur[person])}</td></tr>`).join("")}</tbody></table></div>${note}`;
  }

  function settlement(ctx, row, operation) {
    const e = ctx.escapeHtml;
    if (!row) return '<p class="operation-empty">Sin cálculo</p>';
    const pending = operation?.compensacion_pendiente_centimos_eur || Object.fromEntries(["el", "ella"].map((person) => [person, ctx.state.result.meses.filter((item) => item.mes <= row.mes).reduce((total, item) => total + item.compensacion_neta_centimos_eur[person], 0)]));
    const net = pending.el;
    const transfer = net > 0 ? `${ctx.personName("ella")} → ${ctx.personName("el")}` : `${ctx.personName("el")} → ${ctx.personName("ella")}`;
    const cards = ["el", "ella"].map((person) => {
      const cost = row.pagos_personales_centimos_eur[person] + row.asignacion_comunes_centimos_eur[person];
      const paid = (operation?.pagos_atribuidos_centimos_eur || row.pagos_externos_centimos_eur)[person];
      return `<div class="operation-summary"><span>${e(ctx.personName(person))}</span><strong>${ctx.eur(perspective === "reparto" ? cost : paid)}</strong><small>${perspective === "reparto" ? "Costo asumido" : "Pagos atribuidos"}</small><span class="muted">${perspective === "reparto" ? "Pagado" : "Asume"}: ${ctx.eur(perspective === "reparto" ? paid : cost)}</span></div>`;
    }).join("");
    return `<div class="operation-perspective segmented" role="group" aria-label="Perspectiva del acuerdo"><button data-op-perspective="reparto" type="button" aria-pressed="${perspective === "reparto"}">Por reparto</button><button data-op-perspective="pagos" type="button" aria-pressed="${perspective === "pagos"}">Por pagos</button></div><div class="settlement-grid">${cards}</div><div class="operation-summary"><span>${net === 0 ? "Sin ajuste pendiente" : e(transfer)}</span>${net === 0 ? "" : `<strong>${ctx.eur(Math.abs(net))}</strong>`}<small>Pendiente acumulado hasta ${e(monthName(row.mes))}</small></div><p class="operation-note">Un pago cubierto por una persona reduce lo que debe aportar en los demás. El ajuste neto descuenta los pagos de ambos y las transferencias planificadas. Los pagos desde cuentas comunes se atribuyen según su porcentaje.</p>${contributionCard(ctx, row, operation)}`;
  }

  function balances(ctx, operation) {
    const e = ctx.escapeHtml, accounts = ctx.state.caso.cuentas;
    if (!accounts.length) return '<p class="operation-empty">Sin cuentas</p>';
    const rows = operation?.cuentas || [];
    return `<div class="table-wrap"><table><thead><tr><th>Cuenta</th><th>Inicio</th><th>Ingresos</th><th>Pagos</th><th>Transferencias (+/−)</th><th>Cierre</th><th>Mínimo</th></tr></thead><tbody>${accounts.map((account) => {
      const row = rows.find((item) => item.cuenta_id === account.id);
      if (!row) return `<tr><th>${e(account.nombre)}</th><td colspan="6">Pendiente de cálculo</td></tr>`;
      const netTransfers = row.transferencias_entrada_unidades - row.transferencias_salida_unidades;
      return `<tr><th scope="row">${e(account.nombre)} <span class="operation-tag">${e(account.moneda)}</span></th><td>${money(row.saldo_inicial_unidades, account.moneda, ctx)}</td><td>${money(row.entradas_unidades, account.moneda, ctx)}</td><td>${money(row.salidas_unidades, account.moneda, ctx)}</td><td>${money(netTransfers, account.moneda, ctx)}</td><td class="${row.saldo_final_unidades < 0 ? "negative" : ""}">${money(row.saldo_final_unidades, account.moneda, ctx)}</td><td class="${row.saldo_minimo_unidades < 0 ? "negative" : ""}">${money(row.saldo_minimo_unidades, account.moneda, ctx)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function events(ctx, operation) {
    const e = ctx.escapeHtml, rows = operation?.eventos || [], accounts = ctx.state.caso.cuentas;
    if (!rows.length) return '<p class="operation-empty">Sin movimientos en cuentas este mes</p>';
    return `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Cuenta</th><th>Entrada / salida</th><th>Saldo</th></tr></thead><tbody>${rows.map((event) => {
      const account = accounts.find((item) => item.id === event.cuenta_id);
      return `<tr><td>${e(dateName(event.fecha))}</td><th scope="row">${e(event.concepto)}</th><td>${e(account?.nombre || event.cuenta_id)}</td><td>${event.importe_unidades > 0 ? "+" : ""}${money(event.importe_unidades, account?.moneda || "EUR", ctx)}</td><td class="${event.saldo_despues_unidades < 0 ? "negative" : ""}">${money(event.saldo_despues_unidades, account?.moneda || "EUR", ctx)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function render(ctx) {
    context = ctx;
    const element = host();
    if (!element || !ctx.state.caso) return;
    normalize(ctx.state.caso);
    const state = ctx.state, e = ctx.escapeHtml;
    if (planIdentity !== state.caso) { undo = null; planIdentity = state.caso; }
    const focus = document.activeElement;
    const key = element.contains(focus) ? focus.dataset?.opKey : null;
    const selection = key && [focus.selectionStart, focus.selectionEnd];
    const opened = new Set([...element.querySelectorAll("details[open][data-op-detail]")].map((details) => details.dataset.opDetail));
    const rows = state.result?.meses || [];
    const selected = state.selected || state.caso.inicio;
    const row = rows.find((item) => item.mes === selected);
    const operation = state.result?.operativa?.meses.find((item) => item.mes === selected);
    const accounts = Array.isArray(state.caso.cuentas) ? state.caso.cuentas : [];
    const transfers = Array.isArray(state.caso.transferencias) ? state.caso.transferencias : [];
    const deficits = operation?.cuentas.filter((item) => item.saldo_minimo_unidades < 0) || [];
    const missing = operation?.sin_cuenta || [];
    element.innerHTML = `<div class="operations-layout"><div class="operations-toolbar"><h2>Operativa</h2><label class="month-select-label"><span>Mes</span><select class="select-control" data-op-month aria-label="Mes de operativa">${rows.map((item) => `<option value="${item.mes}" ${item.mes === selected ? "selected" : ""}>${e(monthName(item.mes))}</option>`).join("")}</select></label></div><form class="operations-grid" id="operation-form"><div class="operations-stack"><section class="card operation-card"><div class="card-heading"><h2>Cuentas</h2><button class="button ghost small" type="button" data-op-add-account>+ Cuenta</button></div><div class="account-grid">${accounts.map((account, index) => accountForm(account, index, ctx)).join("") || '<p class="operation-empty">Sin cuentas</p>'}</div><p class="operation-note">Los saldos de las cuentas se suman al dinero sin cuenta de cada persona.</p></section><section class="card operation-card"><div class="card-heading"><h2>Transferencias</h2><button class="button ghost small" type="button" data-op-add-transfer ${accounts.length < 2 ? "disabled" : ""}>+ Transferencia</button></div>${input(ctx, "plan", 0, "comision_cambio_eur", "Comisión por cambio", state.caso.comision_cambio_eur, {type: "number", min: 0, step: "0.01", suffix: "€", wide: true})}<p class="operation-note">Solo al transferir entre monedas; se carga en origen.</p><p class="operation-note">Planificadas; no se ejecutan automáticamente.</p><div class="transfer-list">${transfers.map((transfer, index) => transferForm(transfer, index, ctx)).join("") || '<p class="operation-empty">Sin transferencias</p>'}</div></section>${undo ? '<button class="button ghost" type="button" data-op-undo>Deshacer eliminación</button>' : ""}</div><div class="operations-stack"><section class="card operation-card"><div class="card-heading"><h2>Caja por cuenta</h2></div>${balances(ctx, operation)}${deficits.length ? `<p class="warning-note">Falta saldo durante el mes: ${deficits.map((item) => e(accounts.find((account) => account.id === item.cuenta_id)?.nombre || item.cuenta_id) + (item.primer_deficit ? ` (${e(dateName(item.primer_deficit))})` : "")).join(", ")}</p>` : ""}<p class="operation-note">Si coinciden fechas, se consideran los pagos antes de los ingresos.</p></section><section class="card operation-card"><div class="card-heading"><h2>Reparto y pagos</h2></div>${settlement(ctx, row, operation)}</section><section class="card operation-card"><div class="card-heading"><h2>Asignación de cuentas</h2>${missing.length ? `<span class="badge">${missing.length} sin cuenta este mes</span>` : ""}</div>${assignments(ctx)}</section><section class="card operation-card"><div class="card-heading"><h2>Movimientos del mes</h2></div>${events(ctx, operation)}</section></div></form></div>`;
    element.querySelectorAll("details[data-op-detail]").forEach((details) => { details.open = opened.has(details.dataset.opDetail); });
    if (key) {
      const next = element.querySelector(`[data-op-key="${key}"]`);
      if (next) {
        next.focus({preventScroll: true});
        if (selection && selection[0] !== null && typeof next.setSelectionRange === "function") {
          try { next.setSelectionRange(...selection); } catch { /* Number and date inputs have no text selection. */ }
        }
      }
    }
  }

  function changed(structural = false) {
    context.changed({rerender: structural});
    if (structural) render(context);
  }

  function inputChanged(event) {
    const input = event.target.closest("[data-op-field]");
    if (!input || !context) return;
    const kind = input.dataset.opKind, index = Number(input.dataset.opIndex), property = input.dataset.opField;
    const caso = context.state.caso;
    const collection = kind === "account" ? caso.cuentas : kind === "transfer" ? caso.transferencias : caso.movimientos;
    const item = kind === "plan" ? caso : collection[index];
    if (!item) return;
    item[property] = property === "intervalo_meses" ? Number(input.value) : input.value;
    let structural = input.tagName === "SELECT";
    if (kind === "account" && ["titular", "moneda"].includes(property)) {
      for (const movement of caso.movimientos) {
        if (movement.cuenta_id !== item.id) continue;
        const person = movement.tipo === "ingreso" ? movement.persona : movement.pagador;
        if (movement.moneda !== item.moneda || (item.titular !== "compartido" && person !== item.titular)) movement.cuenta_id = "";
      }
    }
    if (kind === "transfer" && property === "origen" && item.origen === item.destino) item.destino = caso.cuentas.find((account) => account.id !== item.origen)?.id || "";
    if (kind === "movement" && item.cuenta_id) {
      const account = caso.cuentas.find((candidate) => candidate.id === item.cuenta_id);
      if (account) {
        item.moneda = account.moneda;
        if (account.titular !== "compartido") {
          if (item.tipo === "ingreso") item.persona = item.pagador = account.titular;
          else item.pagador = account.titular;
        }
      }
      structural = true;
    }
    changed(structural);
  }

  function click(event) {
    if (!context) return;
    const target = event.target;
    const caso = context.state.caso;
    if (target.closest("[data-op-perspective]")) {
      perspective = target.closest("[data-op-perspective]").dataset.opPerspective;
      render(context);
      return;
    }
    if (target.closest("[data-op-add-account]")) {
      const account = {id: uuid("cuenta_"), nombre: "Nueva cuenta", titular: "el", moneda: "EUR", saldo_inicial: "0.00", porcentaje_el: "50"};
      caso.cuentas.push(account);
      changed(true);
      host().querySelector(`[data-op-detail="account-${account.id}"]`).open = true;
      host().querySelector(`[data-op-key="account-${caso.cuentas.length - 1}-nombre"]`)?.focus();
      return;
    }
    if (target.closest("[data-op-add-transfer]") && caso.cuentas.length >= 2) {
      const transfer = {id: uuid("transferencia_"), concepto: "Transferencia", origen: caso.cuentas[0].id, destino: caso.cuentas[1].id, importe: "0.00", fecha: (context.state.selected || caso.inicio) + "-01", modalidad: "unico", intervalo_meses: 1, hasta: ""};
      caso.transferencias.push(transfer);
      changed(true);
      host().querySelector(`[data-op-detail="transfer-${transfer.id}"]`).open = true;
      return;
    }
    const accountButton = target.closest("[data-op-delete-account]");
    const transferButton = target.closest("[data-op-delete-transfer]");
    if (accountButton) {
      const index = Number(accountButton.dataset.opDeleteAccount), account = caso.cuentas[index];
      undo = {kind: "account", index, account, transfers: caso.transferencias.map((transfer, i) => ({transfer, index: i})).filter(({transfer}) => transfer.origen === account.id || transfer.destino === account.id), movements: caso.movimientos.filter((movement) => movement.cuenta_id === account.id).map((movement) => movement.id)};
      caso.cuentas.splice(index, 1);
      caso.transferencias = caso.transferencias.filter((transfer) => transfer.origen !== account.id && transfer.destino !== account.id);
      caso.movimientos.forEach((movement) => { if (movement.cuenta_id === account.id) movement.cuenta_id = ""; });
      changed(true);
    } else if (transferButton) {
      const index = Number(transferButton.dataset.opDeleteTransfer);
      undo = {kind: "transfer", index, transfer: caso.transferencias[index]};
      caso.transferencias.splice(index, 1);
      changed(true);
    } else if (target.closest("[data-op-undo]") && undo) {
      if (undo.kind === "account") {
        caso.cuentas.splice(undo.index, 0, undo.account);
        for (const entry of undo.transfers) caso.transferencias.splice(entry.index, 0, entry.transfer);
        for (const movement of caso.movimientos) if (undo.movements.includes(movement.id) && !movement.cuenta_id) movement.cuenta_id = undo.account.id;
      } else caso.transferencias.splice(undo.index, 0, undo.transfer);
      undo = null;
      changed(true);
    }
  }

  function bind(ctx) {
    context = ctx;
    const element = host();
    if (!element || bound.has(element)) return;
    bound.add(element);
    element.addEventListener("submit", (event) => event.preventDefault());
    element.addEventListener("click", click);
    element.addEventListener("input", (event) => { if (event.target.tagName !== "SELECT") inputChanged(event); });
    element.addEventListener("change", (event) => {
      if (event.target.matches("[data-op-month]")) { context.selectMonth(event.target.value); return; }
      if (event.target.tagName === "SELECT") inputChanged(event);
    });
  }

  window.FinanzasOperativa = {normalize, render, bind, equivalentContributions, checkValidity: () => host()?.querySelector("form")?.checkValidity() ?? true};
})();
