/* Two presentations of the same monthly allocation. Rates never recalculate money. */
(() => {
  "use strict";

  const people = ["el", "ella"];
  const bound = new WeakSet();
  const percent = new Intl.NumberFormat("es-CL", {style: "percent", maximumFractionDigits: 6});
  let context = null;
  let perspective = "compromisos";
  const host = () => document.querySelector("#equivalence-content");

  function rate(value) {
    if (!value || !/^-?\d+$/.test(value.numerador) || !/^\d+$/.test(value.denominador)) return "—";
    const numerator = BigInt(value.numerador), denominator = BigInt(value.denominador);
    if (!denominator) return "—";
    // The quotient is used only for display. Monetary values come directly from Python.
    return percent.format(Number(numerator) / Number(denominator));
  }

  function sameRates(a, b) {
    if (!a || !b) return a === b;
    return people.every((person) => {
      if (!a[person] || !b[person]) return a[person] === b[person];
      return BigInt(a[person].numerador) * BigInt(b[person].denominador)
        === BigInt(b[person].numerador) * BigInt(a[person].denominador);
    });
  }

  function table(ctx, row, value) {
    const e = ctx.escapeHtml;
    const excluded = people.some((person) => row.ingresos_reales_centimos_eur[person] !== row.ingresos_considerados_centimos_eur[person]);
    const line = (label, values, formatter = (amount) => ctx.eur(amount, 2), className = "") => `<tr${className ? ` class="${className}"` : ""}><th scope="row">${label}</th>${people.map((person) => `<td${values?.[person] < 0 ? ' class="negative"' : ""}>${values?.[person] === undefined || values?.[person] === null ? "—" : e(formatter(values[person]))}</td>`).join("")}</tr>`;
    const rates = (label, values) => line(label, values, rate);
    const lines = [
      line("Ingreso real · I", row.ingresos_reales_centimos_eur),
      excluded ? line("Ingreso considerado para el reparto", row.ingresos_considerados_centimos_eur) : "",
      line("Gastos previos · G", value.gastos_previos_centimos_eur),
      line("Base de reparto", value.base_reparto_centimos_eur),
      rates("α · gastos comunes", value.alpha),
      !sameRates(value.alpha, value.alpha_efectiva_comunes) && value.alpha_efectiva_comunes ? rates("α efectiva tras redondear los céntimos", value.alpha_efectiva_comunes) : "",
      rates("α′ · todos los gastos", value.alpha_prima),
      line("Aporte a gastos comunes", row.asignacion_comunes_centimos_eur),
      line("Costo por compromisos", value.costos_originales_centimos_eur),
      line("Costo con tasa única", value.costos_equivalentes_centimos_eur),
      line("Excedente por compromisos · E", value.excedentes_originales_centimos_eur, undefined, "eq-match"),
      line("Excedente con tasa única · E′", value.excedentes_equivalentes_centimos_eur, undefined, "eq-match"),
      line("Diferencia · E′ − E", value.diferencia_centimos_eur)
    ];
    return `<div class="table-wrap"><table class="eq-table"><caption>Comparación mensual · EUR</caption><thead><tr><th scope="col">Concepto</th>${people.map((person) => `<th scope="col">${e(ctx.personName(person))}</th>`).join("")}</tr></thead><tbody>${lines.join("")}</tbody></table></div>`;
  }

  function summary(ctx, value) {
    const e = ctx.escapeHtml, single = perspective === "unica";
    const rates = single ? value.alpha_prima : value.alpha;
    const costs = single ? value.costos_equivalentes_centimos_eur : value.costos_originales_centimos_eur;
    const surplus = single ? value.excedentes_equivalentes_centimos_eur : value.excedentes_originales_centimos_eur;
    const amount = (values, person) => values ? e(ctx.eur(values[person], 2)) : "—";
    return `<div class="eq-summary">${people.map((person) => `<section class="eq-rate-card" data-eq-person="${person}"><h3 class="eq-person">${e(ctx.personName(person))}</h3><strong class="eq-rate">${e(rate(rates?.[person]))}</strong><p class="eq-note">${single ? "α′ de todos los gastos" : "α de los gastos comunes"}</p><dl><div><dt>Costo asumido</dt><dd${costs?.[person] < 0 ? ' class="negative"' : ""}>${amount(costs, person)}</dd></div><div><dt>Excedente</dt><dd${surplus?.[person] < 0 ? ' class="negative"' : ""}>${amount(surplus, person)}</dd></div></dl></section>`).join("")}</div>`;
  }

  function notes(ctx, row, value) {
    const e = ctx.escapeHtml;
    const excluded = people.some((person) => row.ingresos_reales_centimos_eur[person] !== row.ingresos_considerados_centimos_eur[person]);
    const rounded = value.alpha_efectiva_comunes && !sameRates(value.alpha, value.alpha_efectiva_comunes);
    const equivalent = value.diferencia_centimos_eur && people.every((person) => value.diferencia_centimos_eur[person] === 0);
    const fixed = row.pagos?.some((payment) => payment.reparto === "fijo");
    let status = "";
    if (value.estado === "sin_gastos") status = '<p class="eq-status">Sin gastos: α′ no está definida. El excedente es el ingreso.</p>';
    if (value.estado === "no_representable_sin_gastos") status = '<p class="eq-status">Sin gastos: Igualar margen redistribuye ingresos. Una tasa sobre un gasto total de cero no puede representar esa compensación.</p>';
    return `${status}${equivalent ? '<p class="eq-match">E′ = E para cada persona · diferencia 0,00 €</p>' : ""}${value.tasas_fuera_de_rango ? '<p class="eq-status">Hay tasas fuera de 0–100 %. Un costo negativo representa recibir dinero.</p>' : ""}<p class="eq-note">Gastos comunes G<sub>c</sub>: ${e(ctx.eur(value.gastos_comunes_centimos_eur, 2))} · Total G<sub>c</sub> + G<sub>1</sub> + G<sub>2</sub>: ${e(ctx.eur(value.total_gastos_centimos_eur, 2))}</p>${value.gastos_comunes_centimos_eur === 0 && fixed ? '<p class="eq-note">Los repartos fijos entran en G; usa Regla general en los gastos comunes.</p>' : ""}${excluded ? '<p class="eq-note">Los ingresos excluidos del reparto siguen incluidos en el excedente.</p>' : ""}${rounded ? '<p class="eq-note">α′ usa el aporte común ya redondeado al céntimo.</p>' : ""}`;
  }

  function render(ctx) {
    context = ctx;
    const element = host();
    if (!element || !ctx.state.caso) return;
    const {state, escapeHtml: e} = ctx;
    const focus = document.activeElement;
    const focusKey = focus && element.contains(focus) ? focus.dataset?.eqKey : null;
    const rows = state.result?.meses || [];
    const selected = state.selected || state.caso.inicio;
    const row = rows.find((item) => item.mes === selected);
    const value = row?.reparto_equivalente;
    const months = rows.length ? rows : [{mes: selected}].filter((item) => item.mes);
    element.innerHTML = `<div class="eq-toolbar"><h2>Equivalencia</h2><label class="month-select-label"><span>Mes</span><select class="select-control" data-eq-month data-eq-key="month" aria-label="Mes de equivalencia">${months.map((item) => `<option value="${e(item.mes)}" ${item.mes === selected ? "selected" : ""}>${e(ctx.monthLabel(item.mes))}</option>`).join("")}</select></label><label class="month-select-label"><span>Regla base</span><select class="select-control" data-eq-rule data-eq-key="rule" aria-label="Regla base de equivalencia">${Object.entries(ctx.RULES).map(([rule, label]) => `<option value="${e(rule)}" ${rule === state.escenario.regla ? "selected" : ""}>${e(label)}</option>`).join("")}</select></label></div>${value ? `<div class="eq-segmented segmented" role="group" aria-label="Presentación del reparto"><button type="button" data-eq-perspective="compromisos" data-eq-key="compromisos" aria-pressed="${perspective === "compromisos"}">Por compromisos</button><button type="button" data-eq-perspective="unica" data-eq-key="unica" aria-pressed="${perspective === "unica"}">Tasa única</button></div>${summary(ctx, value)}${notes(ctx, row, value)}<section class="card"><p class="eq-formula" aria-label="Alfa prima de cada persona es su gasto previo más su aporte a los gastos comunes, dividido por el gasto total.">α′<sub>k</sub> = (G<sub>k</sub> + α<sub>k</sub> G<sub>c</sub>) / (G<sub>c</sub> + G<sub>1</sub> + G<sub>2</sub>)</p>${table(ctx, row, value)}<p class="eq-note">Tasas redondeadas para mostrar. Los costos y excedentes conservan los céntimos del cálculo. Excedente mensual antes de ahorro y ajustes de cambio.</p></section>` : '<p class="eq-empty">Pendiente de cálculo</p>'}`;
    if (focusKey) element.querySelector(`[data-eq-key="${focusKey}"]`)?.focus({preventScroll: true});
  }

  function bind(ctx) {
    context = ctx;
    const element = host();
    if (!element || bound.has(element)) return;
    bound.add(element);
    element.addEventListener("change", (event) => {
      if (!context) return;
      const month = event.target.closest("[data-eq-month]");
      if (month) { context.selectMonth(month.value); return; }
      const rule = event.target.closest("[data-eq-rule]");
      if (!rule || !Object.hasOwn(context.RULES, rule.value) || context.state.escenario.regla === rule.value) return;
      context.state.escenario.regla = rule.value;
      context.changed({rerender: true});
    });
    element.addEventListener("click", (event) => {
      const button = event.target.closest("[data-eq-perspective]");
      if (!context || !button || !["compromisos", "unica"].includes(button.dataset.eqPerspective)) return;
      perspective = button.dataset.eqPerspective;
      render(context);
    });
  }

  window.FinanzasEquivalencia = {render, bind};
})();
