"use strict";

const $ = (selector) => document.querySelector(selector);
const apiFetch = (...args) => window.finanzasApi ? window.finanzasApi(...args) : fetch(...args);
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const eur = (cents, decimals = null) => {
  const digits = decimals ?? (cents % 100 === 0 ? 0 : 2);
  return new Intl.NumberFormat("es-ES", {style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits}).format(cents / 100);
};
const clp = (pesos) => new Intl.NumberFormat("es-CL", {maximumFractionDigits: 0}).format(pesos) + " CLP";
const monthLabel = (month, short = false) => new Intl.DateTimeFormat("es-CL", {month: short ? "short" : "long", year: "numeric", timeZone: "UTC"}).format(new Date(month + "-01T12:00:00Z"));
const RULES = {mitades: "50/50", proporcional: "Según ingresos", proporcional_disponible: "Tras compromisos", igualar: "Igualar margen", manual: "Porcentaje fijo"};
const TYPES = {ingreso: "Ingreso", gasto: "Gasto", deuda: "Deuda"};
const DEFAULT_NAMES = {el: "Yayo", ella: "Fer"};
const STORAGE_KEY = "finanzas-pareja-plan-v2";
const LEGACY_STORAGE_KEY = "finanzas-pareja-plan-v1";
const state = {caso: null, escenario: null, initial: null, result: null, reference: null, selected: null, metric: "flujo", edited: false, saveEnabled: false, sequence: 0, importSequence: 0, controller: null, timer: null, filter: "todos", search: "", activeMovement: null, undoMovement: null};
const dateLabel = (date) => date && !Number.isNaN(new Date(date + "T12:00:00Z").getTime()) ? new Intl.DateTimeFormat("es-CL", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"}).format(new Date(date + "T12:00:00Z")) : "fecha por definir";
const originalMoney = (amount, currency) => currency === "CLP" ? clp(Number(amount)) : eur(Math.round(Number(amount) * 100));

function personName(person, caso = state.caso) {
  if (person === "compartido") return "Compartido";
  return caso?.personas?.[person]?.nombre?.trim() || DEFAULT_NAMES[person];
}

function peopleOptions(includeShared = false) {
  return [...["el", "ella"].map((person) => [person, personName(person)]), ...(includeShared ? [["compartido", "Compartido"]] : [])];
}

function updateNameLabels() {
  for (const person of ["el", "ella"]) {
    $("#legend-" + person).textContent = personName(person);
    const label = document.querySelector(`label[for="f-caso-personas-${person}-saldo_inicial_eur"]`);
    if (label) label.textContent = "Saldo inicial de " + personName(person);
  }
  const manual = document.querySelector('label[for="f-escenario-porcentaje_el"]');
  if (manual) manual.textContent = "Parte de " + personName("el");
}

function field(path, label, options = {}) {
  const {type = "number", value, suffix = "", min = 0, max, step = "0.01", wide = false, kind = "string", hint = "", disabled = false, required = true, maxLength} = options;
  const id = "f-" + path.replaceAll(".", "-");
  return `<div class="field${wide ? " wide" : ""}"><label for="${id}">${escapeHtml(label)}</label><div class="input-wrap"><input id="${id}" data-path="${path}" data-kind="${kind}" type="${type}" value="${escapeHtml(value)}" ${type === "number" ? `min="${min}" step="${step}" ${max === undefined ? "" : `max="${max}"`}` : ""} ${maxLength ? `maxlength="${maxLength}"` : ""} ${disabled ? "disabled" : required ? "required" : ""}>${suffix ? `<span class="suffix">${escapeHtml(suffix)}</span>` : ""}</div>${hint ? `<small class="hint">${escapeHtml(hint)}</small>` : ""}</div>`;
}

function selectField(path, label, value, options, wide = false) {
  const id = "f-" + path.replaceAll(".", "-");
  return `<div class="field${wide ? " wide" : ""}"><label for="${id}">${escapeHtml(label)}</label><select id="${id}" data-path="${path}">${options.map(([key, text]) => `<option value="${escapeHtml(key)}" ${key === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></div>`;
}

function toggle(path, label, checked, hint = "") {
  return `<label class="toggle-row"><span>${escapeHtml(label)}${hint ? `<small class="hint">${escapeHtml(hint)}</small>` : ""}</span><input class="checkbox" type="checkbox" data-path="${path}" data-kind="boolean" ${checked ? "checked" : ""}></label>`;
}

function sharing(path, value) {
  const id = "f-" + path.replaceAll(".", "-");
  return `<div class="sharing-control"><div class="range-row"><label for="${id}">Parte con regla general</label><output class="range-value" for="${id}">${escapeHtml(value)} %</output></div><input id="${id}" aria-label="Parte compartida" type="range" min="0" max="100" step="any" value="${escapeHtml(value)}" data-path="${path}" data-kind="string"></div>`;
}

function section(id, number, title, meta, body, open = false) {
  return `<details class="control-section" data-section="${id}" ${open ? "open" : ""}><summary class="section-summary"><span>${title}</span><small class="section-meta">${id === "movements" ? state.caso.movimientos.length : ""}</small><span class="section-chevron" aria-hidden="true">⌄</span></summary><div class="section-body">${body}</div></details>`;
}

function normalize(data) {
  const caso = clone(data.caso);
  const escenario = clone(data.escenario);
  if (!Array.isArray(caso.movimientos)) throw new Error("No se pudo leer la lista de movimientos del plan.");
  for (const person of ["el", "ella"]) {
    const name = caso.personas[person].nombre;
    const generic = person === "el" ? ["él", "el", "tú", "tu"] : ["ella"];
    if (!name?.trim() || generic.includes(name.trim().toLocaleLowerCase("es"))) caso.personas[person].nombre = DEFAULT_NAMES[person];
  }
  if (typeof caso.clp_por_eur === "object") {
    const rates = [...new Set(Object.values(caso.clp_por_eur).map(String))];
    if (rates.length !== 1) throw new Error("Este editor utiliza un tipo de cambio constante. Conserva el archivo original con sus tipos mensuales.");
    caso.clp_por_eur = rates[0];
  }
  caso.movimientos.forEach((movement) => {
    movement.pagador ??= movement.persona === "compartido" ? "el" : movement.persona;
    movement.hasta ??= "";
    movement.intervalo_meses ??= 1;
    movement.cuotas ??= 12;
    movement.cuotas_pagadas ??= 0;
    movement.importe_tipo ??= "total";
    movement.extra ??= false;
    movement.porcentaje_compartido ??= "0";
    if (movement.tipo === "gasto" && Number(movement.porcentaje_compartido) === 100 && movement.persona !== "compartido") movement.persona = "compartido";
    if (movement.persona === "compartido") {
      movement.reparto ??= "regla";
      movement.porcentaje_el ??= "50";
      movement.porcentaje_compartido = "100";
    }
  });
  escenario.porcentaje_el ??= "50";
  return {caso, escenario};
}

function emptyPlan() {
  const now = new Date();
  const month = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return {version: 2, caso: {
    version: 2, es_ficticio: false,
    inicio: month(now), fin: month(new Date(now.getFullYear(), now.getMonth() + 11, 1)),
    clp_por_eur: "1000",
    personas: Object.fromEntries(["el", "ella"].map((person) => [person, {nombre: DEFAULT_NAMES[person], saldo_inicial_eur: "0.00"}])),
    movimientos: []
  }, escenario: {id: "nuevo", nombre: "50/50", regla: "mitades", incluir_extra: true, porcentaje_el: "50"}};
}

function savedPlan() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const plan = JSON.parse(localStorage.getItem(key));
      if ([1, 2].includes(plan?.version) && plan.caso && plan.escenario) return plan;
    } catch { /* Probar la copia anterior. */ }
  }
  return null;
}

async function preparePlan(data) {
  if (!data.caso || !data.escenario) throw new Error("Usa un plan exportado desde el simulador.");
  if (Array.isArray(data.caso.movimientos)) return normalize(data);
  const response = await apiFetch("/api/migrar", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)});
  const migrated = await response.json();
  if (!response.ok) throw new Error(migrated.error || "No se pudo convertir el plan anterior.");
  return normalize(migrated);
}

function renderControls(preserve = false) {
  const open = new Set([...document.querySelectorAll("details[open][data-section]")].map((el) => el.dataset.section));
  const c = state.caso, e = state.escenario;
  const people = `<div class="field-grid">${["el", "ella"].map((person, i) => field(`caso.personas.${person}.nombre`, `Nombre ${i + 1}`, {type: "text", value: c.personas[person].nombre, maxLength: 100})).join("")}</div>`;
  const rules = selectField("escenario.regla", "Regla general", e.regla, Object.entries(RULES), true)
    + `<div id="manual-field" ${e.regla === "manual" ? "" : "hidden"}>${field("escenario.porcentaje_el", "Parte de " + personName("el"), {value: e.porcentaje_el, suffix: "%", max: 100, step: "any", disabled: e.regla !== "manual"})}</div>`
    + toggle("escenario.incluir_extra", "Incluir extras en el reparto", e.incluir_extra)
    + `<span id="rule-help" hidden></span>`;
  const period = `<div class="field-grid">${field("caso.inicio", "Desde", {type: "month", value: c.inicio})}${field("caso.fin", "Hasta", {type: "month", value: c.fin})}${field("caso.clp_por_eur", "Cambio", {value: c.clp_por_eur, suffix: "CLP / €", min: 0.01, wide: true})}${field("caso.personas.el.saldo_inicial_eur", "Saldo inicial de " + personName("el"), {value: c.personas.el.saldo_inicial_eur, suffix: "€", min: -100000000})}${field("caso.personas.ella.saldo_inicial_eur", "Saldo inicial de " + personName("ella"), {value: c.personas.ella.saldo_inicial_eur, suffix: "€", min: -100000000})}</div>`;
  const movements = `<div class="movement-toolbar"><div class="movement-add-buttons">${Object.entries(TYPES).map(([key, label]) => `<button type="button" class="button ghost small" data-add-movement="${key}">+ ${label}</button>`).join("")}</div><label class="movement-search"><span class="visually-hidden">Buscar movimiento</span><input type="search" id="movement-search" placeholder="Buscar…" value="${escapeHtml(state.search)}"></label><div class="movement-filters" role="group" aria-label="Filtrar movimientos">${[["todos", "Todos"], ...Object.entries(TYPES).map(([key, label]) => [key, label + "s"])].map(([key, label]) => `<button type="button" class="filter-button" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join("")}</div><div class="undo-row" ${state.undoMovement ? "" : "hidden"}><button type="button" class="button ghost small" id="undo-movement">Deshacer</button></div></div><div id="movement-list"></div>`;
  $("#controls").innerHTML = section("people", "01", "Nombres", "", people)
    + section("rules", "02", "Reparto", "", rules)
    + section("period", "03", "Período y saldos", "", period)
    + section("movements", "04", "Registros", "", movements, true);
  if (preserve) document.querySelectorAll("details[data-section]").forEach((el) => { el.open = open.has(el.dataset.section); });
  renderMovementList();
  updateRuleHelp();
  updateNameLabels();
}

function movementSchedule(movement) {
  if (movement.modalidad === "unico") return "Una vez · " + dateLabel(movement.fecha);
  if (movement.modalidad === "cuotas") return `${Math.max(0, movement.cuotas - movement.cuotas_pagadas)} cuotas`;
  return movement.intervalo_meses === 1 ? "Mensual" : `Cada ${movement.intervalo_meses} meses`;
}

function movementResponsibility(movement) {
  if (movement.persona !== "compartido" || movement.reparto !== "fijo") return personName(movement.persona);
  const percentage = Number(movement.porcentaje_el);
  return `${personName("el")} ${percentage}% / ${personName("ella")} ${Math.round((100 - percentage) * 10000) / 10000}%`;
}

function movementCard(movement, i, open) {
  const path = `caso.movimientos.${i}`;
  const income = movement.tipo === "ingreso", shared = movement.persona === "compartido";
  const installments = movement.modalidad === "cuotas", recurring = movement.modalidad === "recurrente";
  const amountLabel = installments ? movement.importe_tipo === "cuota" ? "Cada cuota" : "Total original" : "Importe";
  const dateTitle = installments ? "Próxima cuota" : recurring ? "Desde" : "Fecha";
  const options = [["unico", "Una vez"], ["recurrente", "Recurrente"], ...(!income ? [["cuotas", "Cuotas"]] : [])];
  const fields = [
    field(`${path}.concepto`, "Concepto", {type: "text", value: movement.concepto, wide: true}),
    selectField(`${path}.tipo`, "Tipo", movement.tipo, Object.entries(TYPES)),
    selectField(`${path}.persona`, income ? "Recibe" : "Responsabilidad", movement.persona, peopleOptions(!income)),
    field(`${path}.importe`, amountLabel, {value: movement.importe, suffix: movement.moneda === "CLP" ? "CLP" : "€", step: movement.moneda === "CLP" ? "1" : "0.01"}),
    selectField(`${path}.moneda`, "Moneda", movement.moneda, [["EUR", "EUR"], ["CLP", "CLP"]]),
    !income ? selectField(`${path}.pagador`, "Pagado por", movement.pagador, peopleOptions(), true) : "",
    selectField(`${path}.modalidad`, "Frecuencia", movement.modalidad, options, true),
    installments ? selectField(`${path}.importe_tipo`, "Importe", movement.importe_tipo, [["total", "Total a dividir"], ["cuota", "Cada cuota"]], true) : "",
    field(`${path}.fecha`, dateTitle, {type: "date", value: movement.fecha, wide: !recurring && !installments}),
    recurring || installments ? field(`${path}.intervalo_meses`, "Cada (meses)", {value: movement.intervalo_meses, step: "1", min: 1, max: 12, kind: "integer"}) : "",
    recurring ? field(`${path}.hasta`, "Fin (opcional)", {type: "date", value: movement.hasta, wide: true, required: false}) : "",
    installments ? field(`${path}.cuotas`, "Cuotas totales", {value: movement.cuotas, min: 1, max: 600, step: "1", kind: "integer"}) + field(`${path}.cuotas_pagadas`, "Pagadas", {value: movement.cuotas_pagadas, min: 0, max: movement.cuotas, step: "1", kind: "integer"}) : ""
  ].join("");
  let split = "";
  if (income) split = toggle(`${path}.extra`, "Ingreso extra", movement.extra);
  else if (shared) {
    split = `<div class="joint-split">${selectField(`${path}.reparto`, "Reparto", movement.reparto || "regla", [["regla", "Regla general"], ["fijo", "Porcentaje fijo"]], true)}`;
    if (movement.reparto === "fijo") {
      const remainder = movement.porcentaje_el !== "" && Number.isFinite(Number(movement.porcentaje_el)) ? Math.round((100 - Number(movement.porcentaje_el)) * 10000) / 10000 : "—";
      split += `${field(`${path}.porcentaje_el`, personName("el"), {value: movement.porcentaje_el ?? "50", suffix: "%", min: 0, max: 100, step: "any"})}<p class="split-result" data-split-result>${escapeHtml(personName("ella"))} ${remainder}%</p>`;
    }
    split += "</div>";
  } else {
    const partial = Number(movement.porcentaje_compartido) > 0;
    split = `<label class="toggle-row"><span>Compartir una parte</span><input class="checkbox" type="checkbox" data-share-toggle="${i}" ${partial ? "checked" : ""}></label>${partial ? sharing(`${path}.porcentaje_compartido`, movement.porcentaje_compartido) : ""}`;
  }
  return `<details class="movement-card" data-movement-id="${escapeHtml(movement.id)}" ${open ? "open" : ""}><summary class="movement-summary"><span class="movement-summary-copy"><strong data-summary-concept>${escapeHtml(movement.concepto || "Sin concepto")}</strong><small data-summary-schedule>${escapeHtml(movementResponsibility(movement))} · ${escapeHtml(movementSchedule(movement))}</small></span><span class="movement-amount" data-summary-amount>${escapeHtml(originalMoney(movement.importe, movement.moneda))}</span><span class="movement-chevron" aria-hidden="true">⌄</span></summary><div class="movement-editor"><div class="movement-actions"><button type="button" class="button ghost small" data-duplicate-movement="${i}">Duplicar</button><button type="button" class="button ghost small" data-remove-movement="${i}">Eliminar</button></div><div class="field-grid">${fields}</div>${split}</div></details>`;
}

function renderMovementList(preserve = false) {
  const open = new Set([...document.querySelectorAll(".movement-card[open]")].map((el) => el.dataset.movementId));
  const filtered = state.caso.movimientos.map((movement, i) => ({movement, i})).filter(({movement}) => (state.filter === "todos" || movement.tipo === state.filter) && movement.concepto.toLocaleLowerCase("es").includes(state.search.toLocaleLowerCase("es")));
  $("#movement-list").innerHTML = filtered.length ? filtered.map(({movement, i}) => movementCard(movement, i, movement.id === state.activeMovement || (preserve && open.has(movement.id)))).join("") : `<div class="movement-list-empty">${state.caso.movimientos.length ? "Sin resultados." : "Sin registros."}</div>`;
  document.querySelectorAll("[data-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter)));
  const meta = document.querySelector('[data-section="movements"] .section-meta');
  if (meta) meta.textContent = state.caso.movimientos.length;
  const undo = document.querySelector(".undo-row");
  if (undo) undo.hidden = !state.undoMovement;
}

function updateRuleHelp() {
  $("#rule-help").textContent = "";
  $("#rule-help").hidden = true;
  const manual = $("#manual-field");
  manual.hidden = state.escenario.regla !== "manual";
  manual.querySelector("input").disabled = manual.hidden;
}

function setPath(path, value) {
  const parts = path.split(".");
  let parent = state;
  for (let i = 0; i < parts.length - 1; i++) parent = parent[parts[i]];
  parent[parts.at(-1)] = value;
}

function markEdited() {
  state.edited = true;
  state.saveEnabled = true;
  state.caso.es_ficticio = false;
  state.escenario.id = "personalizado";
  state.escenario.nombre = RULES[state.escenario.regla];
  $("#data-mode").textContent = "Plan";
}

function persist() {
  if (!state.saveEnabled) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 2, caso: state.caso, escenario: state.escenario, reference: state.reference && {caso: state.reference.caso, escenario: state.reference.escenario}}));
    $("#restore-plan").hidden = false;
  } catch { /* El cálculo sigue disponible aunque no haya almacenamiento local. */ }
}

function showError(message) {
  $("#error").hidden = false;
  $("#error").textContent = message + (state.result ? " Se muestra el último cálculo válido." : "");
  $("#status").textContent = "Revisar";
  document.body.classList.add("has-error");
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3200);
}

async function requestCalculation(caso, escenario, signal) {
  const response = await apiFetch("/api/simular", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({caso, escenario}), signal});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo calcular este escenario.");
  return data;
}

function scheduleCalculation() {
  clearTimeout(state.timer);
  state.sequence++;
  state.controller?.abort();
  $("#status").textContent = "Calculando…";
  document.body.classList.add("calculating");
  state.timer = setTimeout(calculate, 220);
}

async function calculate() {
  const sequence = ++state.sequence;
  state.controller?.abort();
  if (!$("#controls").checkValidity()) {
    document.body.classList.remove("calculating");
    showError("Revisa los campos.");
    return;
  }
  state.controller = new AbortController();
  $("#status").textContent = "Calculando…";
  document.body.classList.add("calculating");
  try {
    const result = await requestCalculation(state.caso, state.escenario, state.controller.signal);
    if (sequence !== state.sequence) return;
    state.result = result;
    if (!result.meses.some((m) => m.mes === state.selected)) state.selected = result.meses[0].mes;
    $("#error").hidden = true;
    document.body.classList.remove("has-error");
    $("#status").textContent = "Listo";
    persist();
    renderResults();
  } catch (error) {
    if (error.name !== "AbortError" && sequence === state.sequence) showError(error.message || "No hay conexión con el simulador local.");
  } finally {
    if (sequence === state.sequence) document.body.classList.remove("calculating");
  }
}

function selectedRow() { return state.result.meses.find((m) => m.mes === state.selected) || state.result.meses[0]; }

function delta(current, previous) {
  if (previous === undefined) return "";
  const difference = current - previous;
  if (difference === 0) return "";
  return `<span class="${difference < 0 ? "negative" : "positive"}">${difference > 0 ? "+" : ""}${eur(difference)}</span>`;
}

function stat(label, amount, style, previous, footer) {
  const difference = delta(amount, previous);
  return `<article class="stat-card ${style}"><div class="stat-top"><span class="stat-dot" aria-hidden="true"></span>${escapeHtml(label)}</div><div class="stat-value ${amount < 0 ? "negative" : ""}">${eur(amount)}</div>${difference ? `<div class="stat-delta" title="Cambio frente a la referencia">${difference}</div>` : ""}${footer ? `<div class="stat-footer">${footer}</div>` : ""}</article>`;
}

function renderResults() {
  updateNameLabels();
  const rows = state.result.meses, row = selectedRow();
  const reference = state.reference?.result.meses.find((m) => m.mes === row.mes);
  $("#period-label").textContent = `${monthLabel(rows[0].mes, true)} — ${monthLabel(rows.at(-1).mes, true)}`;
  const selector = $("#selected-month");
  selector.innerHTML = rows.map((m) => `<option value="${m.mes}" ${m.mes === row.mes ? "selected" : ""}>${monthLabel(m.mes)}</option>`).join("");
  $("#kpis").innerHTML = stat("Margen de " + personName("el"), row.flujo_libre_centimos_eur.el, "theme-a", reference?.flujo_libre_centimos_eur.el, "")
    + stat("Margen de " + personName("ella"), row.flujo_libre_centimos_eur.ella, "theme-b", reference?.flujo_libre_centimos_eur.ella, "")
    + stat("Margen del hogar", row.hogar.flujo_libre_centimos_eur, "theme-total", reference?.hogar.flujo_libre_centimos_eur, `Saldo: ${eur(row.hogar.saldo_final_centimos_eur)}`);
  renderChart();
  renderInsight(row);
  renderComparison();
  renderTable(rows);
  renderDetails(row);
  renderCommitments();
}

function renderInsight(row) {
  const negative = Object.values(row.necesita_financiacion).some(Boolean);
  const spendingSavings = Object.values(row.flujo_libre_centimos_eur).some((n) => n < 0);
  const compensation = row.compensacion_neta_centimos_eur.el;
  const transfer = compensation === 0 ? "" : compensation > 0 ? `${personName("ella")} → ${personName("el")} · ${eur(compensation)}` : `${personName("el")} → ${personName("ella")} · ${eur(-compensation)}`;
  const needsCash = ["el", "ella"].filter((person) => row.necesita_financiacion[person]).map((person) => personName(person));
  $("#insight").className = negative || spendingSavings ? "warning-note" : "info-note";
  $("#insight").textContent = [negative ? `Saldo negativo: ${needsCash.join(" y ")}` : spendingSavings ? "Se usa saldo previo" : "", transfer].filter(Boolean).join(" · ");
  $("#insight").hidden = !$("#insight").textContent;
}

function renderComparison() {
  const current = state.result.totales, reference = state.reference?.result.totales;
  if (!reference) {
    $("#comparison").innerHTML = `<div class="empty-state">Sin referencia</div>`;
    return;
  }
  const samePeriod = state.result.inicio === state.reference.result.inicio && state.result.fin === state.reference.result.fin;
  $("#comparison").innerHTML = `<div class="comparison-header"><h3>Saldo final</h3><span class="chip">${escapeHtml(RULES[state.reference.escenario.regla])}</span></div>${!samePeriod ? `<p class="warning-note">Períodos distintos</p>` : ""}<div class="comparison-grid">${[[personName("el"), "el"], [personName("ella"), "ella"], ["Hogar", "hogar"]].map(([name, key]) => {
    const amount = key === "hogar" ? current.hogar.saldo_final_centimos_eur : current.saldo_final_centimos_eur[key];
    const before = key === "hogar" ? reference.hogar.saldo_final_centimos_eur : reference.saldo_final_centimos_eur[key];
    return `<div class="comparison-item"><span class="muted">${escapeHtml(name)}</span><strong>${eur(amount)}</strong><small>${delta(amount, before)}</small></div>`;
  }).join("")}</div>`;
}

function renderTable(rows) {
  $("#monthly-table").innerHTML = `<thead><tr><th scope="col">Mes</th><th scope="col">Ingreso · ${escapeHtml(personName("el"))}</th><th scope="col">Ingreso · ${escapeHtml(personName("ella"))}</th><th scope="col">Pagos en cuotas</th><th scope="col">Margen · ${escapeHtml(personName("el"))}</th><th scope="col">Margen · ${escapeHtml(personName("ella"))}</th><th scope="col">Saldo hogar</th></tr></thead><tbody>${rows.map((row) => `<tr data-month="${row.mes}" class="${row.mes === state.selected ? "row-selected" : ""}"><th scope="row"><button class="table-row-button" type="button" data-month="${row.mes}" aria-label="Ver reparto de ${monthLabel(row.mes)}" ${row.mes === state.selected ? 'aria-current="true"' : ""}>${monthLabel(row.mes, true)}</button></th><td>${eur(row.ingresos_reales_centimos_eur.el)}</td><td>${eur(row.ingresos_reales_centimos_eur.ella)}</td><td>${eur(row.cuotas_centimos_eur)}</td><td class="${row.flujo_libre_centimos_eur.el < 0 ? "negative" : "theme-a"}">${eur(row.flujo_libre_centimos_eur.el)}</td><td class="${row.flujo_libre_centimos_eur.ella < 0 ? "negative" : "theme-b"}">${eur(row.flujo_libre_centimos_eur.ella)}</td><td class="${row.hogar.saldo_final_centimos_eur < 0 ? "negative" : ""}">${eur(row.hogar.saldo_final_centimos_eur)}</td></tr>`).join("")}</tbody>`;
}

function renderDetails(row) {
  const metrics = [
    ["Ingresos reales", row.ingresos_reales_centimos_eur], ["Ingresos para repartir", row.ingresos_considerados_centimos_eur],
    ["Asignado", row.pagos_personales_centimos_eur], ["Por regla general", row.asignacion_comunes_centimos_eur],
    ["Costo total", {el: row.pagos_personales_centimos_eur.el + row.asignacion_comunes_centimos_eur.el, ella: row.pagos_personales_centimos_eur.ella + row.asignacion_comunes_centimos_eur.ella}],
    ["Pagado a terceros", row.pagos_externos_centimos_eur], ["Compensación (+/−)", row.compensacion_neta_centimos_eur],
    ["Margen del mes", row.flujo_libre_centimos_eur], ["Saldo al cierre", row.saldo_final_centimos_eur]
  ];
  const paymentSplit = (payment) => {
    if (payment.persona === "compartido") {
      if (payment.reparto !== "fijo") return "Regla general";
      return ["el", "ella"].map((person) => `${personName(person)} ${eur(payment.importe_asignado_centimos_eur[person], 2)}`).join(" / ");
    }
    const common = payment.importe_comun_centimos_eur ?? 0;
    return common ? `${personName(payment.persona)} · común ${eur(common, 2)}` : personName(payment.persona);
  };
  $("#month-detail").innerHTML = `<p class="muted">${monthLabel(row.mes)} · ${escapeHtml(RULES[state.escenario.regla])}</p><div class="table-wrap"><table class="detail-table"><thead><tr><th scope="col">Concepto</th><th scope="col">${escapeHtml(personName("el"))}</th><th scope="col">${escapeHtml(personName("ella"))}</th></tr></thead><tbody>${metrics.map(([label, values]) => `<tr><th scope="row">${label}</th><td>${eur(values.el, 2)}</td><td>${eur(values.ella, 2)}</td></tr>`).join("")}</tbody></table></div><details class="payment-detail"><summary>Pagos (${row.pagos.length})</summary><div class="table-wrap"><table><thead><tr><th>Pago</th><th>Pagado por</th><th>EUR</th><th>Reparto</th></tr></thead><tbody>${row.pagos.map((payment) => `<tr><th scope="row">${escapeHtml(payment.concepto || payment.id)}</th><td>${escapeHtml(personName(payment.pagador))}</td><td>${eur(payment.importe_centimos_eur, 2)}</td><td>${escapeHtml(paymentSplit(payment))}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function renderCommitments() {
  const future = state.result.compromisos_fuera_horizonte;
  const finite = Object.entries(future.por_moneda).map(([currency, amount]) => `<div class="detail-card"><span class="muted">Pagos con término · ${currency}</span><strong>${escapeHtml(originalMoney(amount, currency))}</strong></div>`).join("");
  const list = future.movimientos.map((movement) => `<div class="commitment-row"><div><strong>${escapeHtml(movement.concepto)}</strong><small>${movement.pagos_pendientes === null ? "Recurrente" : `${movement.pagos_pendientes} pagos`}${movement.proximo_pago ? ` · ${dateLabel(movement.proximo_pago)}` : ""}</small></div><span>${movement.importe_pendiente === null ? "Sin fin" : escapeHtml(originalMoney(movement.importe_pendiente, movement.moneda))}</span></div>`).join("");
  $("#commitments").innerHTML = `${finite ? `<div class="detail-grid">${finite}</div>` : ""}${list || '<p class="empty-state">Sin pagos futuros</p>'}`;
}

function renderChart() {
  $("#chart-tooltip").hidden = true;
  const rows = state.result.meses;
  const fieldName = state.metric === "saldo" ? "saldo_final_centimos_eur" : "flujo_libre_centimos_eur";
  $("#metric-flujo").setAttribute("aria-pressed", String(state.metric === "flujo"));
  $("#metric-saldo").setAttribute("aria-pressed", String(state.metric === "saldo"));
  const width = Math.max(320, $("#chart").clientWidth || 900), height = 282, left = width < 600 ? 70 : 84, right = 30, top = 22, bottom = 44;
  const values = rows.flatMap((row) => [row[fieldName].el, row[fieldName].ella]);
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  const pad = (max - min || 10000) * .12;
  max += pad;
  if (min < 0) min -= pad;
  const x = (i) => rows.length === 1 ? (left + width - right) / 2 : left + i / (rows.length - 1) * (width - left - right);
  const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
  const line = (person) => rows.map((row, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(row[fieldName][person]).toFixed(2)}`).join(" ");
  const selectedIndex = rows.findIndex((row) => row.mes === state.selected);
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4;
    grid += `<line class="chart-grid" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text class="chart-axis" x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${escapeHtml(eur(value, 0))}</text>`;
  }
  const tickStep = Math.max(1, Math.ceil(rows.length / (width < 600 ? 3 : 6)));
  const labels = rows.map((row, i) => i === 0 || i === rows.length - 1 || (i % tickStep === 0 && rows.length - 1 - i >= Math.max(2, Math.ceil(tickStep / 2))) ? `<text class="chart-axis" x="${x(i)}" y="${height - 14}" text-anchor="middle">${escapeHtml(monthLabel(row.mes, true))}</text>` : "").join("");
  const slot = (width - left - right) / Math.max(1, rows.length - 1);
  const hits = rows.map((row, i) => `<rect class="chart-hit" data-month="${row.mes}" x="${Math.max(left, x(i) - slot / 2)}" y="${top}" width="${rows.length === 1 ? slot : Math.min(width - right, x(i) + slot / 2) - Math.max(left, x(i) - slot / 2)}" height="${height - top - bottom}" fill="transparent" tabindex="0" role="button" aria-label="${escapeHtml(monthLabel(row.mes))}: ${escapeHtml(personName("el"))} ${escapeHtml(eur(row[fieldName].el))}, ${escapeHtml(personName("ella"))} ${escapeHtml(eur(row[fieldName].ella))}"/>`).join("");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-label="${state.metric === "saldo" ? "Saldo acumulado" : "Margen mensual"} de ambos durante el plan" role="img">${grid}<line class="chart-zero" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"/><path class="chart-line-a" d="${line("el")}" fill="none"/><path class="chart-line-b" d="${line("ella")}" fill="none"/><line class="chart-selection" x1="${x(selectedIndex)}" x2="${x(selectedIndex)}" y1="${top}" y2="${height - bottom}"/>${["el", "ella"].map((person) => `<circle class="chart-dot-${person === "el" ? "a" : "b"}" cx="${x(selectedIndex)}" cy="${y(rows[selectedIndex][fieldName][person])}" r="5"/>`).join("")}${labels}${hits}</svg>`;
  $("#chart-caption").textContent = state.metric === "saldo" ? "EUR" : "EUR · antes de ahorro";
}

function selectMonth(month) {
  if (!state.result?.meses.some((row) => row.mes === month)) return;
  state.selected = month;
  $("#chart-tooltip").hidden = true;
  renderResults();
}

function handleControl(event) {
  const shareToggle = event.target.closest("[data-share-toggle]");
  if (shareToggle) {
    state.caso.movimientos[Number(shareToggle.dataset.shareToggle)].porcentaje_compartido = shareToggle.checked ? "50" : "0";
    markEdited();
    renderMovementList(true);
    scheduleCalculation();
    return;
  }
  const input = event.target.closest("[data-path]");
  if (!input) return;
  const value = input.type === "range" ? String(Math.round(Number(input.value) * 10000) / 10000) : input.dataset.kind === "boolean" ? input.checked : input.dataset.kind === "integer" && input.value !== "" ? Number(input.value) : input.value;
  const path = input.dataset.path;
  setPath(input.dataset.path, value);
  if (/^caso\.personas\.(el|ella)\.nombre$/.test(path)) {
    updateNameLabels();
    renderMovementList(true);
  }
  if (input.type === "range") input.closest(".sharing-control").querySelector("output").textContent = value + " %";
  const match = path.match(/^caso\.movimientos\.(\d+)\.(\w+)$/);
  if (match) {
    const i = Number(match[1]), movement = state.caso.movimientos[i];
    if (movement.tipo === "ingreso") {
      if (movement.persona === "compartido") movement.persona = "el";
      movement.pagador = movement.persona;
      movement.porcentaje_compartido = "0";
      movement.reparto = "regla";
      if (movement.modalidad === "cuotas") movement.modalidad = "recurrente";
    } else if (match[2] === "persona") {
      if (movement.persona === "compartido") {
        movement.porcentaje_compartido = "100";
        movement.reparto ??= "regla";
        movement.porcentaje_el ??= "50";
      } else {
        movement.porcentaje_compartido = "0";
        movement.reparto = "regla";
      }
    }
    if (["tipo", "modalidad", "importe_tipo", "moneda", "persona", "reparto"].includes(match[2])) renderMovementList(true);
    else {
      const card = input.closest(".movement-card");
      if (card) {
        card.querySelector("[data-summary-concept]").textContent = movement.concepto || "Sin concepto";
        card.querySelector("[data-summary-schedule]").textContent = `${movementResponsibility(movement)} · ${movementSchedule(movement)}`;
        card.querySelector("[data-summary-amount]").textContent = originalMoney(movement.importe, movement.moneda);
        const paid = card.querySelector(`[data-path="caso.movimientos.${i}.cuotas_pagadas"]`);
        if (paid) paid.max = movement.cuotas;
        const split = card.querySelector("[data-split-result]");
        if (split) split.textContent = `${personName("ella")} ${movement.porcentaje_el !== "" ? Math.round((100 - Number(movement.porcentaje_el)) * 10000) / 10000 : "—"}%`;
      }
    }
  }
  markEdited();
  updateRuleHelp();
  scheduleCalculation();
}

function handleArrayActions(event) {
  const filter = event.target.closest("[data-filter]");
  if (filter) { state.filter = filter.dataset.filter; renderMovementList(true); return; }
  const add = event.target.closest("[data-add-movement]");
  const remove = event.target.closest("[data-remove-movement]");
  const duplicate = event.target.closest("[data-duplicate-movement]");
  const uniqueId = () => "mov_" + crypto.randomUUID();
  let focusIndex = null;
  if (add) {
    const type = add.dataset.addMovement;
    const movement = {id: uniqueId(), concepto: type === "ingreso" ? "Nuevo ingreso" : type === "deuda" ? "Nueva deuda" : "Nuevo gasto", tipo: type, persona: type === "gasto" ? "compartido" : "el", pagador: "el", importe: "0.00", moneda: "EUR", fecha: state.caso.inicio + "-01", modalidad: type === "deuda" ? "cuotas" : "recurrente", intervalo_meses: 1, hasta: "", cuotas: 12, cuotas_pagadas: 0, importe_tipo: "total", extra: false, porcentaje_compartido: type === "gasto" ? "100" : "0", reparto: "regla", porcentaje_el: "50"};
    state.caso.movimientos.push(movement);
    state.activeMovement = movement.id;
    state.filter = type;
    state.search = "";
    $("#movement-search").value = "";
    focusIndex = state.caso.movimientos.length - 1;
  } else if (remove) {
    const i = Number(remove.dataset.removeMovement);
    state.undoMovement = {movement: clone(state.caso.movimientos[i]), index: i};
    state.caso.movimientos.splice(i, 1);
    toast("Eliminado.");
  } else if (duplicate) {
    const movement = clone(state.caso.movimientos[Number(duplicate.dataset.duplicateMovement)]);
    movement.id = uniqueId();
    movement.concepto += " (copia)";
    state.caso.movimientos.push(movement);
    state.activeMovement = movement.id;
    focusIndex = state.caso.movimientos.length - 1;
  } else if (event.target.closest("#undo-movement") && state.undoMovement) {
    state.caso.movimientos.splice(state.undoMovement.index, 0, state.undoMovement.movement);
    state.activeMovement = state.undoMovement.movement.id;
    state.undoMovement = null;
    state.filter = "todos";
    state.search = "";
    $("#movement-search").value = "";
  } else return;
  markEdited();
  renderMovementList(true);
  state.activeMovement = null;
  if (focusIndex !== null) {
    const concept = document.querySelector(`[data-path="caso.movimientos.${focusIndex}.concepto"]`);
    concept?.focus();
    concept?.select();
  }
  scheduleCalculation();
}

async function importPlan(file) {
  if (!file) return;
  const sequence = state.sequence;
  const importSequence = ++state.importSequence;
  try {
    if (file.size > 250000) throw new Error("El archivo es demasiado grande. Usa un plan JSON de menos de 250 KB.");
    const imported = JSON.parse(await file.text());
    if (!imported.caso || !imported.escenario) throw new Error("Usa un archivo exportado desde este simulador.");
    const plan = await preparePlan(imported);
    const result = await requestCalculation(plan.caso, plan.escenario);
    if (importSequence !== state.importSequence) return;
    if (sequence !== state.sequence) {
      toast("Se conservan tus cambios más recientes. Vuelve a importar si quieres reemplazarlos.");
      return;
    }
    state.controller?.abort();
    clearTimeout(state.timer);
    state.sequence++;
    state.caso = plan.caso;
    state.escenario = plan.escenario;
    state.result = result;
    state.reference = null;
    state.edited = !plan.caso.es_ficticio;
    state.saveEnabled = true;
    state.selected = result.meses[0].mes;
    state.filter = "todos";
    state.search = "";
    state.undoMovement = null;
    renderControls();
    $("#data-mode").textContent = state.edited ? "Plan" : "Ejemplo";
    $("#error").hidden = true;
    document.body.classList.remove("has-error", "calculating");
    $("#status").textContent = "Plan importado";
    persist();
    renderResults();
    toast("Importado.");
  } catch (error) { toast(error.message || "No se pudo importar el archivo."); }
  finally { $("#import-file").value = ""; }
}

async function restoreSavedPlan() {
  const saved = savedPlan();
  if (!saved) { toast("Sin plan guardado."); return; }
  const sequence = state.sequence;
  const importSequence = ++state.importSequence;
  try {
    const plan = await preparePlan(saved);
    const result = await requestCalculation(plan.caso, plan.escenario);
    let reference = null;
    if (saved.reference) {
      try {
        const previous = await preparePlan(saved.reference);
        reference = {...previous, result: await requestCalculation(previous.caso, previous.escenario)};
      } catch { /* El plan puede recuperarse aunque su referencia sea inválida. */ }
    }
    if (importSequence !== state.importSequence || sequence !== state.sequence) return;
    state.controller?.abort();
    clearTimeout(state.timer);
    state.sequence++;
    state.caso = plan.caso;
    state.escenario = plan.escenario;
    state.result = result;
    state.reference = reference;
    state.edited = !plan.caso.es_ficticio;
    state.saveEnabled = true;
    state.selected = result.meses[0].mes;
    state.filter = "todos";
    state.search = "";
    state.undoMovement = null;
    renderControls();
    $("#data-mode").textContent = "Plan";
    $("#error").hidden = true;
    document.body.classList.remove("has-error", "calculating");
    $("#status").textContent = "Listo";
    persist();
    renderResults();
  } catch (error) { toast(error.message || "No se pudo recuperar el plan."); }
}

async function resetPlan() {
  state.controller?.abort();
  clearTimeout(state.timer);
  state.sequence++;
  state.importSequence++;
  const plan = emptyPlan();
  state.caso = plan.caso;
  state.escenario = plan.escenario;
  state.result = null;
  state.reference = null;
  state.selected = null;
  state.edited = false;
  state.saveEnabled = false;
  state.filter = "todos";
  state.search = "";
  state.undoMovement = null;
  state.activeMovement = null;
  $("#data-mode").textContent = "Vacío";
  $("#restore-plan").hidden = !savedPlan();
  renderControls();
  await calculate();
}

function bindEvents() {
  $("#controls").addEventListener("submit", (event) => event.preventDefault());
  $("#controls").addEventListener("input", handleControl);
  $("#controls").addEventListener("input", (event) => {
    if (event.target.id !== "movement-search") return;
    state.search = event.target.value;
    renderMovementList(true);
  });
  $("#controls").addEventListener("change", (event) => { if (["month", "date"].includes(event.target.type) || event.target.tagName === "SELECT") handleControl(event); });
  $("#controls").addEventListener("click", handleArrayActions);
  $("#selected-month").addEventListener("change", (event) => selectMonth(event.target.value));
  $("#monthly-table").addEventListener("click", (event) => { const row = event.target.closest("[data-month]"); if (row) selectMonth(row.dataset.month); });
  $("#chart").addEventListener("click", (event) => { const point = event.target.closest("[data-month]"); if (point) selectMonth(point.dataset.month); });
  $("#chart").addEventListener("keydown", (event) => { const point = event.target.closest("[data-month]"); if (point && ["Enter", " "].includes(event.key)) { event.preventDefault(); selectMonth(point.dataset.month); } });
  $("#chart").addEventListener("pointermove", (event) => {
    const point = event.target.closest("[data-month]");
    const tooltip = $("#chart-tooltip");
    if (!point || !state.result) { tooltip.hidden = true; return; }
    const row = state.result.meses.find((r) => r.mes === point.dataset.month);
    const value = state.metric === "saldo" ? row.saldo_final_centimos_eur : row.flujo_libre_centimos_eur;
    tooltip.innerHTML = `<strong>${monthLabel(row.mes)}</strong><span class="theme-a">${escapeHtml(personName("el"))} <b>${eur(value.el, 2)}</b></span><span class="theme-b">${escapeHtml(personName("ella"))} <b>${eur(value.ella, 2)}</b></span>`;
    tooltip.style.position = "fixed";
    tooltip.style.left = Math.max(8, Math.min(window.innerWidth - 245, event.clientX + 14)) + "px";
    tooltip.style.top = Math.max(8, event.clientY - 108) + "px";
    tooltip.hidden = false;
  });
  $("#chart").addEventListener("pointerleave", () => { $("#chart-tooltip").hidden = true; });
  for (const metric of ["flujo", "saldo"]) $("#metric-" + metric).addEventListener("click", () => { state.metric = metric; if (state.result) renderChart(); });
  $("#save-reference").addEventListener("click", () => {
    if (!state.result || !$("#error").hidden || document.body.classList.contains("calculating")) { toast("El cálculo no es válido."); return; }
    state.reference = {caso: clone(state.caso), escenario: clone(state.escenario), result: clone(state.result)};
    persist();
    renderResults();
    toast("Referencia guardada.");
  });
  $("#restore-plan").addEventListener("click", restoreSavedPlan);
  $("#reset").addEventListener("click", resetPlan);
  $("#download").addEventListener("click", () => {
    if (!$("#controls").checkValidity() || !$("#error").hidden || document.body.classList.contains("calculating")) { toast("Revisa los campos antes de exportar."); return; }
    const blob = new Blob([JSON.stringify({version: 2, caso: state.caso, escenario: state.escenario}, null, 2)], {type: "application/json"});
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = "plan-finanzas.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exportado.");
  });
  $("#import-file").addEventListener("change", (event) => importPlan(event.target.files[0]));
  window.addEventListener?.("resize", () => { if (state.result) renderChart(); });
}

async function initialize() {
  try {
    state.initial = emptyPlan();
    bindEvents();
    await resetPlan();
  } catch (error) { showError(error.message || "No se pudo iniciar el simulador local."); }
}

initialize();
