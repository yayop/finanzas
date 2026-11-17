/* Monthly budget views and a numerical preview of the implicit allocation. */
(() => {
  "use strict";

  const people = ["el", "ella"];
  const bound = new WeakSet();
  const percent = new Intl.NumberFormat("es-ES", {style: "percent", maximumFractionDigits: 2});
  const number = new Intl.NumberFormat("es-ES", {maximumFractionDigits: 2});
  const graphs = new WeakMap();
  let context = null;
  let chartMetric = "personal";

  function solve(a1, a2, common, gamma) {
    if (![a1, a2, common, gamma].every(Number.isFinite) || common < 0 || gamma < 0) return {estado: "invalido", alpha: null, contribucion_centimos_eur: null, personal_centimos_eur: null};
    const total = a1 + a2;
    const result = (alpha, estado = "calculado") => {
      if (alpha === null) return {estado, alpha: null, contribucion_centimos_eur: null, personal_centimos_eur: null, personal_total_centimos_eur: total - common};
      const rounded = Math.round(common * alpha);
      const first = gamma > 0 ? Math.max(Math.max(0, common - a2), Math.min(Math.min(common, a1), rounded)) : rounded;
      const contribution = {el: first, ella: common - first};
      return {estado, alpha: {el: alpha, ella: 1 - alpha}, contribucion_centimos_eur: contribution,
        personal_centimos_eur: {el: a1 - contribution.el, ella: a2 - contribution.ella}, personal_total_centimos_eur: total - common};
    };
    if (gamma === 0) {
      const state = total < common ? "deficit" : a1 < common / 2 || a2 < common / 2 ? "deficit_individual" : "calculado";
      return result(0.5, state);
    }
    if (a1 < 0 || a2 < 0 || total < common) return result(null, "deficit");
    if (total === 0) return {estado: "sin_reparto", alpha: null, contribucion_centimos_eur: {el: 0, ella: 0}, personal_centimos_eur: {el: 0, ella: 0}, personal_total_centimos_eur: 0};
    if (common > 0 && total === common) return result(a1 / total, "agotado");
    if (a1 === 0) return result(0);
    if (a2 === 0) return result(1);
    if (gamma === 1) return result(a1 / total);
    if (common === 0) {
      const logOdds = gamma * (Math.log(a1) - Math.log(a2));
      const exponential = Math.exp(-Math.abs(logOdds));
      return result(logOdds >= 0 ? 1 / (1 + exponential) : exponential / (1 + exponential));
    }
    let lower = Math.max(0, 1 - a2 / common);
    let upper = Math.min(1, a1 / common);
    for (let iteration = 0; iteration < 100; iteration++) {
      const alpha = (lower + upper) / 2;
      const p1 = a1 - alpha * common;
      const p2 = a2 - (1 - alpha) * common;
      if (p1 <= 0) { upper = alpha; continue; }
      if (p2 <= 0) { lower = alpha; continue; }
      const residual = Math.log(alpha) - Math.log1p(-alpha) - gamma * (Math.log(p1) - Math.log(p2));
      if (residual > 0) upper = alpha;
      else lower = alpha;
    }
    return result((lower + upper) / 2);
  }

  function selected(ctx) {
    return ctx.state.result?.meses?.find((row) => row.mes === ctx.state.selected) || ctx.state.result?.meses?.[0];
  }

  function gammaValue(ctx, row) {
    const scenario = ctx.state.escenario || {};
    return Number(scenario.gamma_por_mes?.[row?.mes || ctx.state.selected] ?? scenario.gamma ?? row?.presupuesto?.gamma ?? 1);
  }

  function isNumber(value) { return typeof value === "number" && Number.isFinite(value); }
  function amount(ctx, value) { return isNumber(value) ? ctx.escapeHtml(ctx.eur(value, 2)) : "—"; }
  function ratio(value) { return isNumber(value) ? percent.format(value) : "—"; }
  function pairTotal(values) { return values && people.every((person) => isNumber(values[person])) ? values.el + values.ella : null; }

  function stack(ctx, parts, label) {
    const total = parts.reduce((sum, part) => sum + Math.max(0, part.value || 0), 0);
    const valid = parts.every((part) => isNumber(part.value) && part.value >= 0);
    if (!valid) return `<div class="gv-stack gv-stack-unavailable" role="img" aria-label="${ctx.escapeHtml(label)}"></div>`;
    return `<div class="gv-stack${total === 0 ? " gv-stack-empty" : ""}" role="img" aria-label="${ctx.escapeHtml(label)}">${parts.filter((part) => part.value > 0).map((part) => `<span class="${part.className}" style="flex-basis:${part.value / total * 100}%" title="${ctx.escapeHtml(part.label)} · ${amount(ctx, part.value)}"></span>`).join("")}</div>`;
  }

  function legend(ctx, parts) {
    return `<div class="gv-legend">${parts.map((part) => `<span><i class="${part.className}" aria-hidden="true"></i>${ctx.escapeHtml(part.label)} <b${part.value < 0 ? ' class="negative"' : ""}>${amount(ctx, part.value)}</b></span>`).join("")}</div>`;
  }

  function warning(ctx, budget) {
    if (budget.estado === "deficit" && !budget.alpha) {
      const deficit = budget.deficit_centimos_eur || Math.max(0, -budget.personal_total_centimos_eur);
      const message = deficit > 0 ? `Déficit presupuestario · ${amount(ctx, deficit)}.` : "Un gasto socializado supera el ingreso de su responsable.";
      return `<p class="gv-warning warning-note" role="status">${message} No hay un reparto factible.</p>`;
    }
    if (budget.estado === "deficit" || budget.estado === "deficit_individual") return '<p class="gv-warning warning-note" role="status">Este reparto deja dinero personal negativo. Revisa los importes señalados.</p>';
    if (budget.estado === "agotado") return '<p class="gv-warning warning-note">Las obligaciones consumen todos los recursos. El reparto está fijado por la disponibilidad de cada persona.</p>';
    return "";
  }

  function personCards(ctx, budget, row) {
    return `<div class="gv-grid">${people.map((person) => {
      const personal = budget.personal_centimos_eur?.[person];
      const contribution = budget.contribucion_centimos_eur?.[person];
      const parts = [{label: "Socializado", value: budget.gastos_socializados_centimos_eur[person], className: "gv-social"},
        {label: "Común", value: contribution, className: "gv-common"}, {label: "Personal", value: personal, className: "gv-personal"}];
      const label = `${ctx.personName(person)}. ` + parts.map((part) => `${part.label} ${isNumber(part.value) ? ctx.eur(part.value, 2) : "sin determinar"}`).join(". ");
      const cash = row?.ejecucion?.posicion_real_centimos_eur?.[person];
      return `<section class="card gv-person"><div class="gv-person-heading"><h3>${ctx.escapeHtml(ctx.personName(person))}</h3><span>${amount(ctx, budget.ingresos_centimos_eur[person])} de ingreso</span></div><p class="gv-personal-label">Dinero personal presupuestado</p><strong class="gv-personal-value${personal < 0 ? " negative" : ""}">${amount(ctx, personal)}</strong>${stack(ctx, parts, label)}${legend(ctx, parts)}${isNumber(cash) ? `<div class="gv-cash"><span>Saldo efectivo al cierre</span><strong${cash < 0 ? ' class="negative"' : ""}>${amount(ctx, cash)}</strong></div>` : ""}</section>`;
    }).join("")}</div>`;
  }

  function commonSplit(ctx, budget) {
    const parts = people.map((person, index) => ({label: ctx.personName(person), value: budget.contribucion_centimos_eur?.[person], className: index === 0 ? "gv-a" : "gv-b"}));
    const criterion = ctx.state.escenario.regla === "progresivo" ? "γ = " + number.format(Number(budget.gamma)) : (ctx.RULES?.[ctx.state.escenario.regla] || ctx.state.escenario.regla);
    return `<section class="card gv-split"><div class="card-heading"><div><h2>Gastos comunes</h2><p>${ctx.escapeHtml(criterion)}</p></div><strong>${amount(ctx, budget.gastos_comunes_centimos_eur)}</strong></div><div class="gv-split-body">${stack(ctx, parts, parts.map((part) => `${part.label} ${isNumber(part.value) ? ctx.eur(part.value, 2) : "sin determinar"}`).join(". "))}<div class="gv-contributions">${people.map((person, index) => {
      const available = budget.disponible_centimos_eur[person];
      const contribution = budget.contribucion_centimos_eur?.[person];
      const burden = available > 0 && isNumber(contribution) ? contribution / available : null;
      return `<div><span class="${index === 0 ? "gv-text-a" : "gv-text-b"}">${ctx.escapeHtml(ctx.personName(person))}</span><strong${contribution < 0 ? ' class="negative"' : ""}>${amount(ctx, contribution)} <small>${ctx.escapeHtml(ratio(budget.alpha?.[person]))}</small></strong><small>${ctx.escapeHtml(ratio(burden))} de su disponible</small></div>`;
    }).join("")}</div></div></section>`;
  }

  function balance(ctx, row, budget) {
    const execution = row.ejecucion;
    const line = (label, values, className = "") => `<tr${className ? ` class="${className}"` : ""}><th scope="row">${label}</th>${people.map((person) => `<td${values?.[person] < 0 ? ' class="negative"' : ""}>${amount(ctx, values?.[person])}</td>`).join("")}<td${pairTotal(values) < 0 ? ' class="negative"' : ""}>${amount(ctx, pairTotal(values))}</td></tr>`;
    const planned = line("Ingresos", budget.ingresos_centimos_eur) + line("Gastos socializados", budget.gastos_socializados_centimos_eur)
      + line("Aporte a gastos comunes", budget.contribucion_centimos_eur) + line("Dinero personal · P", budget.personal_centimos_eur, "gv-table-total");
    const actual = execution ? line("Ingresos recibidos", execution.ingresos_centimos_eur) + line("Egresos pagados · E", execution.egresos_centimos_eur)
      + line("Gastos personales pagados · D", execution.gastos_personales_centimos_eur)
      + line("Ingresos pendientes", execution.ingresos_pendientes_centimos_eur)
      + line("Obligaciones pendientes", execution.obligaciones_pendientes_centimos_eur)
      + line("Saldo tras reparto · S", execution.saldo_centimos_eur, "gv-table-total")
      + (execution.flujo_caja_centimos_eur ? line("Flujo efectivo de caja", execution.flujo_caja_centimos_eur) : "")
      + (execution.compensacion_pendiente_centimos_eur ? line("Compensación pendiente", execution.compensacion_pendiente_centimos_eur) : "")
      + (execution.posicion_real_centimos_eur ? line("Saldo efectivo al cierre", execution.posicion_real_centimos_eur, "gv-table-total") : "") : '<tr><td colspan="4" class="empty-state">Registra los pagos para ver el balance efectivo.</td></tr>';
    return `<details class="card gv-balance"><summary class="card-summary"><h2>Balance mensual</h2></summary><div class="table-wrap"><table class="gv-budget-table"><caption class="visually-hidden">Presupuesto y pagos de ${ctx.escapeHtml(ctx.monthLabel(row.mes))}</caption><thead><tr><th scope="col">Concepto</th>${people.map((person) => `<th scope="col">${ctx.escapeHtml(ctx.personName(person))}</th>`).join("")}<th scope="col">Total</th></tr></thead><tbody><tr class="gv-table-section"><th colspan="4" scope="colgroup">Presupuesto</th></tr>${planned}<tr class="gv-table-section"><th colspan="4" scope="colgroup">Efectivamente realizado</th></tr>${actual}</tbody></table></div>${execution && people.some((person) => execution.compensacion_pendiente_centimos_eur?.[person]) ? '<p class="gv-balance-note hint">El saldo tras reparto supone saldadas las compensaciones entre ambos.</p>' : ""}</details>`;
  }

  function expenseBreakdown(ctx, row) {
    const expenses = row.pagos || [];
    if (!expenses.length) return "";
    return `<details class="card gv-expenses" open><summary class="card-summary"><h2>Reparto por gasto</h2></summary><div class="gv-list">${expenses.map((payment) => {
      const costs = payment.costo_asumido_centimos_eur;
      const parts = people.map((person, index) => ({label: ctx.personName(person), value: costs?.[person], className: index === 0 ? "gv-a" : "gv-b"}));
      return `<article class="gv-expense"><div class="gv-expense-heading"><strong>${ctx.escapeHtml(payment.concepto)}</strong><span>${amount(ctx, payment.importe_centimos_eur)}</span></div>${stack(ctx, parts, `${payment.concepto}. ` + parts.map((part) => `${part.label} ${isNumber(part.value) ? ctx.eur(part.value, 2) : "sin determinar"}`).join(". "))}${legend(ctx, parts)}</article>`;
    }).join("")}</div></details>`;
  }

  function renderDashboard(ctx, row) {
    const host = document.querySelector("#dashboard-content");
    if (!host) return;
    if (!row?.presupuesto) { host.innerHTML = '<p class="empty-state">Agrega ingresos y gastos en Presupuesto.</p>'; return; }
    const budget = row.presupuesto;
    host.innerHTML = warning(ctx, budget) + personCards(ctx, budget, row) + commonSplit(ctx, budget) + expenseBreakdown(ctx, row) + balance(ctx, row, budget);
  }

  function previewBudget(row, gamma) {
    const budget = row.presupuesto;
    return {...budget, gamma: String(gamma), ...solve(budget.disponible_centimos_eur.el, budget.disponible_centimos_eur.ella, budget.gastos_comunes_centimos_eur, gamma)};
  }

  function simulationResults(ctx, budget) {
    return warning(ctx, budget) + `<div class="gv-simulation-results">${people.map((person, index) => `<section class="gv-preview-person"><h3 class="${index === 0 ? "gv-text-a" : "gv-text-b"}">${ctx.escapeHtml(ctx.personName(person))}</h3><dl><div><dt>Ingreso</dt><dd>${amount(ctx, budget.ingresos_centimos_eur[person])}</dd></div><div><dt>Socializado</dt><dd>${amount(ctx, budget.gastos_socializados_centimos_eur[person])}</dd></div><div><dt>Disponible antes de aportar</dt><dd>${amount(ctx, budget.disponible_centimos_eur[person])}</dd></div><div><dt>α · parte de los comunes</dt><dd>${ctx.escapeHtml(ratio(budget.alpha?.[person]))}</dd></div><div><dt>Aporte</dt><dd>${amount(ctx, budget.contribucion_centimos_eur?.[person])}</dd></div><div class="gv-preview-total"><dt>Dinero personal · P</dt><dd${budget.personal_centimos_eur?.[person] < 0 ? ' class="negative"' : ""}>${amount(ctx, budget.personal_centimos_eur?.[person])}</dd></div></dl></section>`).join("")}</div>`;
  }

  function renderSimulator(ctx, row) {
    const host = document.querySelector("#simulator-content");
    if (!host) return;
    if (!row?.presupuesto) { host.innerHTML = '<p class="empty-state">Agrega ingresos y gastos en Presupuesto.</p>'; return; }
    const gamma = gammaValue(ctx, row);
    const focus = document.activeElement;
    const focusKey = focus && host.contains(focus) ? focus.dataset?.gvKey : null;
    if (focus?.dataset?.gvGamma && host.contains(focus) && host.dataset?.gvMonth === row.mes) {
      paintPreview(ctx, row, gamma, focus);
      return;
    }
    if (host.dataset) host.dataset.gvMonth = row.mes;
    const budget = previewBudget(row, gamma);
    host.innerHTML = `<section class="card gv-gamma-card"><div class="card-heading"><h2>Progresividad</h2><span>γ</span></div><form class="gv-gamma-controls" id="gamma-controls"><label class="gv-gamma-number" for="gamma-number">Gamma<input id="gamma-number" data-gv-gamma="number" data-gv-key="number" type="number" min="0" step="any" value="${ctx.escapeHtml(gamma)}" required></label><div class="gv-gamma-range"><label class="visually-hidden" for="gamma-range">Gamma entre cero y cuatro</label><input id="gamma-range" data-gv-gamma="range" data-gv-key="range" type="range" min="0" max="4" step="0.05" value="${Math.min(4, gamma)}"><div class="gv-range-labels"><span>0 · 50/50</span><span>1 · Proporcional</span><span>4</span></div></div></form><p class="gv-month-note hint">Este valor de γ se guarda en ${ctx.escapeHtml(ctx.monthLabel(row.mes))}.</p>${ctx.state.escenario.regla !== "progresivo" ? '<div class="gv-preview-notice"><span>Activar γ recalcula la proyección del plan.</span><button class="button ghost small" type="button" data-gv-apply>Activar γ en el plan</button></div>' : ""}<p class="gv-formula" aria-label="El cociente de aportes es el cociente de dinero personal elevado a gamma">α₁ / α₂ = (P₁ / P₂)<sup>γ</sup></p></section><div data-gv-results>${simulationResults(ctx, budget)}</div><section class="card gv-chart-card"><div class="card-heading"><h2>Efecto de γ</h2><div class="segmented gv-chart-controls" role="group" aria-label="Variable del gráfico"><button type="button" data-gv-metric="personal" data-gv-key="personal" aria-pressed="${chartMetric === "personal"}">Dinero personal</button><button type="button" data-gv-metric="alpha" data-gv-key="alpha" aria-pressed="${chartMetric === "alpha"}">Aportes %</button></div></div><div class="gv-legend gv-chart-legend">${people.map((person, index) => `<span><i class="${index === 0 ? "gv-a" : "gv-b"}" aria-hidden="true"></i>${ctx.escapeHtml(ctx.personName(person))}</span>`).join("")}</div><canvas class="gv-chart" id="gamma-chart" data-gv-key="chart" tabindex="0" role="img" aria-label="${chartMetric === "personal" ? "Dinero personal de cada persona según gamma" : "Porcentaje de gastos comunes asumido por cada persona según gamma"}. Selecciona un punto o usa las flechas para cambiar gamma." aria-describedby="gamma-chart-selection"></canvas><p class="gv-chart-hint" id="gamma-chart-selection">γ = ${ctx.escapeHtml(number.format(gamma))} · ${people.map((person) => `${ctx.escapeHtml(ctx.personName(person))} ${chartMetric === "personal" ? amount(ctx, budget.personal_centimos_eur?.[person]) : ctx.escapeHtml(ratio(budget.alpha?.[person]))}`).join(" · ")}</p></section>`;
    host.querySelector("#gamma-controls")?.addEventListener("submit", (event) => event.preventDefault());
    const canvas = host.querySelector("#gamma-chart");
    if (canvas) drawChart(ctx, row, gamma, canvas);
    if (focusKey) host.querySelector(`[data-gv-key="${focusKey}"]`)?.focus({preventScroll: true});
  }

  function drawChart(ctx, row, gamma, canvas) {
    if (typeof canvas.getContext !== "function") return;
    const painter = canvas.getContext("2d");
    if (!painter) return;
    const box = canvas.getBoundingClientRect();
    const width = Math.max(280, box.width || canvas.clientWidth || 640);
    const height = 280;
    const scale = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * scale);
    canvas.height = height * scale;
    painter.setTransform(scale, 0, 0, scale, 0, 0);
    painter.clearRect(0, 0, width, height);
    const style = typeof getComputedStyle === "function" ? getComputedStyle(canvas) : null;
    const colors = {a: style?.getPropertyValue("--green").trim() || "#226d54", b: style?.getPropertyValue("--blue").trim() || "#596db7",
      muted: style?.getPropertyValue("--muted").trim() || "#68716c", line: style?.getPropertyValue("--line").trim() || "#dde2de"};
    const maximum = Math.max(4, Math.ceil(gamma));
    const samples = Array.from({length: 161}, (_, index) => {
      const value = index * maximum / 160;
      return {gamma: value, budget: previewBudget(row, value)};
    });
    const values = samples.flatMap((sample) => people.map((person) => chartMetric === "personal" ? sample.budget.personal_centimos_eur?.[person] : sample.budget.alpha?.[person])).filter(isNumber);
    const minimumY = chartMetric === "alpha" ? 0 : Math.min(0, ...values);
    const maximumY = chartMetric === "alpha" ? 1 : Math.max(100, ...values);
    const margin = {left: width < 430 ? 61 : 76, right: 20, top: 20, bottom: 36};
    const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
    const x = (value) => margin.left + value / maximum * plotWidth;
    const y = (value) => margin.top + (maximumY - value) / (maximumY - minimumY || 1) * plotHeight;
    painter.font = '13px "Instrument Sans", system-ui, sans-serif';
    painter.lineWidth = 1;
    for (let tick = 0; tick <= 4; tick++) {
      const value = minimumY + (maximumY - minimumY) * tick / 4;
      painter.beginPath(); painter.moveTo(margin.left, y(value)); painter.lineTo(width - margin.right, y(value)); painter.strokeStyle = colors.line; painter.stroke();
      painter.textAlign = "right"; painter.textBaseline = "middle"; painter.fillStyle = colors.muted;
      painter.fillText(chartMetric === "alpha" ? percent.format(value) : new Intl.NumberFormat("es-ES", {maximumFractionDigits: 0, notation: Math.abs(value) >= 1000000 ? "compact" : "standard"}).format(value / 100) + " €", margin.left - 10, y(value));
    }
    for (let tick = 0; tick <= 4; tick++) {
      const value = maximum * tick / 4;
      painter.textAlign = "center"; painter.textBaseline = "top"; painter.fillStyle = colors.muted;
      painter.fillText(number.format(value), x(value), height - margin.bottom + 12);
    }
    people.forEach((person, index) => {
      painter.beginPath();
      let started = false;
      for (const sample of samples) {
        const value = chartMetric === "personal" ? sample.budget.personal_centimos_eur?.[person] : sample.budget.alpha?.[person];
        if (!isNumber(value)) { started = false; continue; }
        if (started) painter.lineTo(x(sample.gamma), y(value));
        else { painter.moveTo(x(sample.gamma), y(value)); started = true; }
      }
      painter.strokeStyle = index === 0 ? colors.a : colors.b; painter.lineWidth = 2.5; painter.stroke();
    });
    painter.beginPath(); painter.moveTo(x(gamma), margin.top); painter.lineTo(x(gamma), height - margin.bottom); painter.lineWidth = 1; painter.setLineDash([4, 4]); painter.strokeStyle = colors.muted; painter.stroke(); painter.setLineDash([]);
    const current = previewBudget(row, gamma);
    people.forEach((person, index) => {
      const value = chartMetric === "personal" ? current.personal_centimos_eur?.[person] : current.alpha?.[person];
      if (!isNumber(value)) return;
      painter.beginPath(); painter.arc(x(gamma), y(value), 4, 0, Math.PI * 2); painter.fillStyle = index === 0 ? colors.a : colors.b; painter.fill();
    });
    if (!values.length) {
      painter.fillStyle = colors.muted; painter.textAlign = "center"; painter.fillText("Sin reparto factible", margin.left + plotWidth / 2, margin.top + plotHeight / 2);
    }
    graphs.set(canvas, {maximum, margin, plotWidth, width});
  }

  function paintPreview(ctx, row, gamma, active) {
    const host = document.querySelector("#simulator-content");
    if (!host) return;
    const budget = previewBudget(row, gamma);
    const numeric = host.querySelector('[data-gv-gamma="number"]');
    const range = host.querySelector('[data-gv-gamma="range"]');
    if (numeric && numeric !== active) numeric.value = String(gamma);
    if (range && range !== active) range.value = String(Math.min(4, gamma));
    const output = host.querySelector("[data-gv-results]");
    if (output) output.innerHTML = simulationResults(ctx, budget);
    const hint = host.querySelector("#gamma-chart-selection");
    if (hint) hint.textContent = `γ = ${number.format(gamma)} · ` + people.map((person) => `${ctx.personName(person)} ${chartMetric === "personal" && isNumber(budget.personal_centimos_eur?.[person]) ? ctx.eur(budget.personal_centimos_eur[person], 2) : ratio(budget.alpha?.[person])}`).join(" · ");
    const canvas = host.querySelector("#gamma-chart");
    if (canvas) drawChart(ctx, row, gamma, canvas);
  }

  function updatePreview(gamma, active) {
    if (!context || !Number.isFinite(gamma) || gamma < 0) return;
    const row = selected(context);
    if (!row?.presupuesto) return;
    paintPreview(context, row, gamma, active);
    context.setGamma?.(String(gamma));
  }

  function render(ctx) {
    context = ctx;
    const row = selected(ctx);
    renderDashboard(ctx, row);
    renderSimulator(ctx, row);
  }

  function bind(ctx) {
    context = ctx;
    const host = document.querySelector("#simulator-content");
    if (!host || bound.has(host)) return;
    bound.add(host);
    host.addEventListener("input", (event) => {
      const input = event.target.closest("[data-gv-gamma]");
      if (!input || input.value.trim() === "" || input.checkValidity?.() === false) return;
      updatePreview(Number(input.value), input);
    });
    host.addEventListener("click", (event) => {
      if (event.target.closest("[data-gv-apply]")) { updatePreview(gammaValue(context, selected(context)), null); return; }
      const metric = event.target.closest("[data-gv-metric]");
      if (metric && ["personal", "alpha"].includes(metric.dataset.gvMetric)) { chartMetric = metric.dataset.gvMetric; renderSimulator(context, selected(context)); return; }
      const canvas = event.target.closest("#gamma-chart");
      const graph = canvas && graphs.get(canvas);
      if (!graph || !isNumber(event.clientX)) return;
      const left = canvas.getBoundingClientRect().left;
      const gamma = Math.max(0, Math.min(graph.maximum, (event.clientX - left - graph.margin.left) / graph.plotWidth * graph.maximum));
      updatePreview(Math.round(gamma * 20) / 20, null);
    });
    host.addEventListener("keydown", (event) => {
      const canvas = event.target.closest("#gamma-chart");
      if (!canvas || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = gammaValue(context, selected(context));
      const maximum = graphs.get(canvas)?.maximum || 4;
      const value = event.key === "Home" ? 0 : event.key === "End" ? maximum : current + (event.key === "ArrowRight" ? 0.05 : -0.05);
      updatePreview(Math.round(Math.max(0, value) * 20) / 20, null);
    });
    window.addEventListener?.("resize", () => {
      const canvas = document.querySelector("#gamma-chart"), row = selected(context);
      if (canvas && row?.presupuesto) drawChart(context, row, gammaValue(context, row), canvas);
    });
  }

  window.FinanzasProgresividad = {render, bind, solve, checkValidity: () => document.querySelector("#gamma-controls")?.checkValidity() !== false};
})();
