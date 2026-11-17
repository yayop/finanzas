"""Modelo implícito, presupuesto y ejecución conservan dinero y parámetros."""

import copy
import json
import math
import unittest
from fractions import Fraction

from scripts.modelo import PERSONAS, resolver_progresividad, simular_plan, validar_plan
from pruebas.test_equivalencia import acuerdo, caso, ingresos, movimiento


def fraccion(resultado, persona="el"):
    valor = resultado["alpha_fracciones"][persona]
    return Fraction(int(valor["numerador"]), int(valor["denominador"]))


def plan_referencia(**cambios):
    return caso(*ingresos("2000", "1000", estado="pagado"),
                movimiento("hogar", persona="compartido", importe="1200", descontar_antes_reparto=False),
                **cambios)


class ProgresividadTests(unittest.TestCase):
    def test_referencias_analiticas_gamma_cero_y_uno(self):
        for gamma, alpha, aportes, personal in (
                ("0", Fraction(1, 2), {"el": 60000, "ella": 60000}, {"el": 140000, "ella": 40000}),
                ("1", Fraction(2, 3), {"el": 80000, "ella": 40000}, {"el": 120000, "ella": 60000})):
            with self.subTest(gamma=gamma):
                resultado = resolver_progresividad({"el": 200000, "ella": 100000}, 120000, gamma)
                self.assertEqual(fraccion(resultado), alpha)
                self.assertEqual(resultado["contribucion_centimos_eur"], aportes)
                self.assertEqual(resultado["personal_centimos_eur"], personal)

    def test_gamma_dos_satisface_ecuacion_implicita_y_no_potencias_de_a(self):
        resultado = resolver_progresividad({"el": 200000, "ella": 100000}, 120000, "2")
        alpha = resultado["alpha"]["el"]
        p1, p2 = 200000 - alpha * 120000, 100000 - (1 - alpha) * 120000
        self.assertAlmostEqual(alpha, 0.7320700984037662, places=13)
        self.assertAlmostEqual(alpha / (1 - alpha), (p1 / p2) ** 2, places=11)
        self.assertGreater(abs(alpha - 0.8), 0.05)
        self.assertEqual(resultado["contribucion_centimos_eur"], {"el": 87848, "ella": 32152})
        self.assertEqual(resultado["personal_centimos_eur"], {"el": 112152, "ella": 67848})

    def test_identidades_factibilidad_y_ecuacion_en_distintas_escalas(self):
        for a, b, comunes in ((200000, 100000, 120000), (300, 999, 701),
                              (1, 1000000, 999999), (100000000000000, 30000000000000, 70000000000001)):
            for gamma in ("0.05", "0.7", "1", "2.35", "10"):
                with self.subTest(a=a, b=b, comunes=comunes, gamma=gamma):
                    resultado = resolver_progresividad({"el": a, "ella": b}, comunes, gamma)
                    alpha = fraccion(resultado)
                    self.assertEqual(alpha + fraccion(resultado, "ella"), 1)
                    self.assertTrue(0 <= alpha <= 1)
                    self.assertTrue(all(p >= 0 for p in resultado["personal_centimos_eur"].values()))
                    self.assertEqual(sum(resultado["contribucion_centimos_eur"].values()), comunes)
                    self.assertEqual(sum(resultado["personal_centimos_eur"].values()), a + b - comunes)
                    p1, p2 = a - alpha * comunes, b - (1 - alpha) * comunes
                    residual = math.log(alpha.numerator) - math.log(alpha.denominator - alpha.numerator) - float(gamma) * math.log(float(p1 / p2))
                    self.assertAlmostEqual(residual, 0, places=8)

    def test_gamma_cero_conserva_50_50_y_advierte_deficit_individual(self):
        resultado = resolver_progresividad({"el": 10000, "ella": 200000}, 120000, "0")
        self.assertEqual(resultado["estado"], "deficit_individual")
        self.assertEqual(resultado["alpha"], {"el": 0.5, "ella": 0.5})
        self.assertEqual(resultado["personal_centimos_eur"], {"el": -50000, "ella": 140000})
        self.assertTrue(resultado["advertencia"])

    def test_gamma_positivo_no_inventa_reparto_si_faltan_recursos(self):
        for disponible, comunes in (({"el": 10000, "ella": 20000}, 40000),
                                     ({"el": -1000, "ella": 200000}, 40000)):
            for gamma in ("0.05", "1", "4"):
                with self.subTest(disponible=disponible, gamma=gamma):
                    resultado = resolver_progresividad(disponible, comunes, gamma)
                    self.assertEqual(resultado["estado"], "deficit")
                    self.assertIsNone(resultado["alpha"])
                    self.assertIsNone(resultado["contribucion_centimos_eur"])
                    self.assertIsNone(resultado["personal_centimos_eur"])
                    self.assertEqual(resultado["personal_total_centimos_eur"], sum(disponible.values()) - comunes)

    def test_un_ingreso_disponible_nulo_asigna_cero_a_esa_persona(self):
        for gamma in ("0.05", "1", "4", "100"):
            for persona in PERSONAS:
                disponible = {p: 0 if p == persona else 100000 for p in PERSONAS}
                resultado = resolver_progresividad(disponible, 60000, gamma)
                self.assertEqual(resultado["alpha"][persona], 0)
                self.assertEqual(resultado["personal_centimos_eur"][persona], 0)
                self.assertEqual(resultado["contribucion_centimos_eur"][persona], 0)

    def test_sin_excedente_la_factibilidad_fija_la_tasa_limite(self):
        resultado = resolver_progresividad({"el": 10000, "ella": 30000}, 40000, "2")
        self.assertEqual(resultado["estado"], "agotado")
        self.assertEqual(resultado["alpha"], {"el": 0.25, "ella": 0.75})
        self.assertEqual(resultado["personal_centimos_eur"], {"el": 0, "ella": 0})
        self.assertTrue(resultado["advertencia"])

    def test_sin_comunes_sigue_ecuacion_y_sin_recursos_tasa_indefinida(self):
        resultado = resolver_progresividad({"el": 200000, "ella": 100000}, 0, "2")
        self.assertAlmostEqual(resultado["alpha"]["el"], 0.8)
        self.assertEqual(resultado["personal_centimos_eur"], {"el": 200000, "ella": 100000})
        cero = resolver_progresividad({"el": 0, "ella": 0}, 0, "1")
        self.assertEqual(cero["estado"], "sin_reparto")
        self.assertIsNone(cero["alpha"])
        self.assertEqual(cero["personal_centimos_eur"], {"el": 0, "ella": 0})

    def test_gamma_mayor_a_cuatro_y_extremo_no_desborda(self):
        for gamma in ("10", "1000", "10000000000000000000000000000000000000"):
            resultado = resolver_progresividad({"el": 200000, "ella": 100000}, 120000, gamma)
            self.assertTrue(math.isfinite(resultado["alpha"]["el"]))
            self.assertTrue(all(p >= 0 for p in resultado["personal_centimos_eur"].values()))
            json.dumps(resultado, allow_nan=False)
        no_comunes = resolver_progresividad({"el": 1, "ella": 1000}, 0, "10000000000000000000000000000000000000")
        self.assertEqual(no_comunes["alpha"], {"el": 0, "ella": 1})

    def test_gamma_y_estados_invalidos_se_rechazan(self):
        for valor in ("-0.1", "NaN", "Infinity", True, None, 1.5):
            with self.subTest(valor=valor), self.assertRaises(ValueError):
                validar_plan(plan_referencia(), acuerdo("progresivo", gamma=valor))
        for cambios in ({"estado": "true"}, {"estados_por_mes": {"2026-01": True}},
                        {"estados_por_mes": {"2026-13": "pagado"}}, {"estados_por_mes": []}):
            with self.subTest(cambios=cambios), self.assertRaises(ValueError):
                validar_plan(caso(movimiento("gasto", **cambios)), acuerdo("progresivo"))
        for overrides in ({"2026-13": "1"}, {"2026-01": "-1"}, []):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                validar_plan(plan_referencia(), acuerdo("progresivo", gamma_por_mes=overrides))

    def test_gamma_y_ejecucion_se_resuelven_por_mes_sin_mutar_el_plan(self):
        value = caso(*ingresos("2000", "1000", modalidad="recurrente", estados_por_mes={"2026-01": "pagado"}),
                     movimiento("hogar", persona="compartido", importe="1200", modalidad="recurrente",
                                estados_por_mes={"2026-02": "pagado"}), fin="2026-02")
        rule = acuerdo("progresivo", gamma="1", gamma_por_mes={"2026-01": "0", "2026-02": "2"})
        original = copy.deepcopy((value, rule))
        result = simular_plan(value, rule)
        self.assertEqual((value, rule), original)
        january, february = result["meses"]
        self.assertEqual(january["presupuesto"]["gamma"], "0")
        self.assertEqual(february["presupuesto"]["gamma"], "2")
        self.assertEqual(january["ejecucion"]["ingresos_centimos_eur"], {"el": 200000, "ella": 100000})
        self.assertEqual(january["ejecucion"]["egresos_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(february["ejecucion"]["ingresos_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(february["ejecucion"]["egresos_centimos_eur"], {"el": 87848, "ella": 32152})
        rule["gamma"] = "4"
        rerun = simular_plan(value, rule)
        self.assertEqual([r["presupuesto"] for r in rerun["meses"]], [r["presupuesto"] for r in result["meses"]])

    def test_socializados_definen_g_y_personales_no_reducen_p(self):
        value = plan_referencia()
        value["movimientos"] += [movimiento("socializado", persona="el", pagador="ella", importe="200", descontar_antes_reparto=True),
                                 movimiento("personal", importe="300", descontar_antes_reparto=False)]
        row = simular_plan(value, acuerdo("progresivo"))["meses"][0]
        budget = row["presupuesto"]
        self.assertEqual(budget["gastos_socializados_centimos_eur"], {"el": 20000, "ella": 0})
        self.assertEqual(budget["disponible_centimos_eur"], {"el": 180000, "ella": 100000})
        self.assertEqual(sum(budget["personal_centimos_eur"].values()), 160000)
        self.assertEqual(sum(row["flujo_libre_centimos_eur"].values()), 130000)
        self.assertEqual(row["reparto_equivalente"]["base_reparto_centimos_eur"], budget["disponible_centimos_eur"])
        self.assertEqual(row["reparto_equivalente"]["diferencia_centimos_eur"], {"el": 0, "ella": 0})

    def test_ingreso_extra_se_incluye_en_el_modelo_progresivo(self):
        value = plan_referencia()
        value["movimientos"].append(movimiento("extra", tipo="ingreso", persona="ella", importe="1000", extra=True))
        row = simular_plan(value, acuerdo("progresivo", incluir_extra=False))["meses"][0]
        self.assertEqual(row["presupuesto"]["alpha"], {"el": 0.5, "ella": 0.5})
        self.assertEqual(row["presupuesto"]["ingresos_centimos_eur"], {"el": 200000, "ella": 200000})
        self.assertEqual(row["ingresos_considerados_centimos_eur"], {"el": 200000, "ella": 100000})

    def test_ejecucion_no_da_por_pagadas_obligaciones_previstas(self):
        value = plan_referencia()
        value["movimientos"] += [movimiento("socializado", importe="200", descontar_antes_reparto=True),
                                 movimiento("ocio", importe="100", descontar_antes_reparto=False, estado="pagado")]
        row = simular_plan(value, acuerdo("progresivo"))["meses"][0]
        actual = row["ejecucion"]
        self.assertEqual(actual["egresos_centimos_eur"], {"el": 0, "ella": 10000})
        self.assertEqual(actual["gastos_personales_centimos_eur"], {"el": 0, "ella": 10000})
        self.assertEqual(actual["saldo_centimos_eur"], {"el": 200000, "ella": 90000})
        self.assertEqual(sum(actual["obligaciones_pendientes_centimos_eur"].values()), 140000)
        for persona in PERSONAS:
            self.assertEqual(row["presupuesto"]["personal_centimos_eur"][persona],
                             actual["gastos_personales_centimos_eur"][persona] + actual["saldo_centimos_eur"][persona]
                             + actual["ingresos_pendientes_centimos_eur"][persona] - actual["obligaciones_pendientes_centimos_eur"][persona])

    def test_presupuesto_totalmente_pagado_conserva_p_d_mas_s(self):
        value = plan_referencia()
        value["movimientos"][2]["estado"] = "pagado"
        value["movimientos"].append(movimiento("ocio", importe="125", descontar_antes_reparto=False, estado="pagado"))
        row = simular_plan(value, acuerdo("progresivo", gamma="2"))["meses"][0]
        actual = row["ejecucion"]
        for persona in PERSONAS:
            self.assertEqual(row["presupuesto"]["personal_centimos_eur"][persona],
                             actual["gastos_personales_centimos_eur"][persona] + actual["saldo_centimos_eur"][persona])
            self.assertEqual(actual["ingresos_centimos_eur"][persona], actual["egresos_centimos_eur"][persona] + actual["saldo_centimos_eur"][persona])
        # El pagador físico y la responsabilidad económica se registran aparte.
        self.assertEqual(actual["pagos_fisicos_centimos_eur"], {"el": 0, "ella": 132500})
        self.assertEqual(actual["egresos_centimos_eur"], {"el": 87848, "ella": 44652})

    def test_cada_pago_y_redondeo_cuadra_sin_duplicar_el_total_comun(self):
        value = caso(*ingresos(), *(movimiento("comun" + str(i), persona="compartido", importe="0.01", estado="pagado") for i in range(7)))
        row = simular_plan(value, acuerdo("progresivo"))["meses"][0]
        self.assertEqual(row["asignacion_comunes_centimos_eur"], {"el": 4, "ella": 3})
        for persona in PERSONAS:
            self.assertEqual(sum(pago["costo_asumido_centimos_eur"][persona] for pago in row["pagos"]), row["asignacion_comunes_centimos_eur"][persona])
        self.assertTrue(all(sum(pago["costo_asumido_centimos_eur"].values()) == pago["importe_centimos_eur"] for pago in row["pagos"]))
        self.assertEqual(row["ejecucion"]["egresos_centimos_eur"], {"el": 4, "ella": 3})

    def test_deficit_se_expone_sin_asignacion_y_con_total_hogar_valido(self):
        value = caso(*ingresos("100", "200", modalidad="recurrente"),
                     movimiento("hogar", persona="compartido", importe="400", modalidad="recurrente"), fin="2026-02")
        result = simular_plan(value, acuerdo("progresivo"))
        for row in result["meses"]:
            self.assertEqual(row["presupuesto"]["estado"], "deficit")
            self.assertEqual(row["presupuesto"]["deficit_centimos_eur"], 10000)
            self.assertIsNone(row["asignacion_comunes_centimos_eur"])
            self.assertIsNone(row["flujo_libre_centimos_eur"])
            self.assertIsNone(row["saldo_final_centimos_eur"])
            self.assertEqual(row["hogar"]["flujo_libre_centimos_eur"], -10000)
            self.assertEqual(row["reparto_equivalente"]["estado"], "sin_reparto")
        self.assertEqual(result["totales"]["hogar"]["saldo_final_centimos_eur"], -20000)
        self.assertIsNone(result["totales"]["saldo_final_centimos_eur"])
        json.dumps(result, allow_nan=False)

    def test_deficit_con_cuentas_conserva_caja_sin_inventar_compensaciones(self):
        value = caso(movimiento("hogar", persona="compartido", importe="100"),
                     cuentas=[{"id": "cuenta", "nombre": "Cuenta", "titular": "el", "moneda": "EUR", "saldo_inicial": "200"}])
        result = simular_plan(value, acuerdo("progresivo"))
        caja = result["operativa"]["meses"][0]
        self.assertEqual(caja["saldo_total_centimos_eur"], 10000)
        self.assertIsNone(caja["compensacion_mes_centimos_eur"])
        self.assertIsNone(caja["compensacion_pendiente_centimos_eur"])
        self.assertEqual(result["totales"]["hogar"]["saldo_final_centimos_eur"], 10000)

    def test_una_cuota_pagada_no_marca_las_cuotas_futuras(self):
        value = caso(*ingresos("2000", "1000", modalidad="recurrente"),
                     movimiento("cuotas", modalidad="cuotas", cuotas=2, importe="400", importe_tipo="total",
                                estados_por_mes={"2026-01": "pagado"}, descontar_antes_reparto=False), fin="2026-02")
        rows = simular_plan(value, acuerdo("progresivo"))["meses"]
        self.assertEqual([row["pagos"][0]["estado"] for row in rows], ["pagado", "previsto"])
        self.assertEqual([row["ejecucion"]["egresos_centimos_eur"]["ella"] for row in rows], [20000, 0])
        self.assertEqual([row["pagos_externos_centimos_eur"]["ella"] for row in rows], [20000, 20000])

    def test_caja_real_incluye_saldos_conjuntos_y_solo_transferencias_pagadas(self):
        value = caso(movimiento("ingreso_a", tipo="ingreso", persona="el", importe="1000", cuenta_id="a", estado="pagado"),
                     movimiento("ingreso_b", tipo="ingreso", persona="ella", importe="500", cuenta_id="b"),
                     movimiento("hogar", persona="compartido", pagador="el", importe="600", cuenta_id="c", estado="pagado"),
                     cuentas=[{"id": "a", "nombre": "A", "titular": "el", "moneda": "EUR", "saldo_inicial": "200"},
                              {"id": "b", "nombre": "B", "titular": "ella", "moneda": "EUR", "saldo_inicial": "300"},
                              {"id": "c", "nombre": "Conjunta", "titular": "compartido", "porcentaje_el": "50", "moneda": "EUR", "saldo_inicial": "100"}],
                     transferencias=[{"id": "aporte_a", "concepto": "Aporte A", "origen": "a", "destino": "c", "importe": "500", "fecha": "2026-01-01", "estado": "pagado"},
                                     {"id": "aporte_b", "concepto": "Aporte B", "origen": "b", "destino": "c", "importe": "500", "fecha": "2026-01-01"}])
        original = copy.deepcopy(value)
        result = simular_plan(value, acuerdo("progresivo"))
        self.assertEqual(value, original)
        actual = result["meses"][0]["ejecucion"]
        self.assertEqual(actual["posicion_real_centimos_eur"], {"el": 70000, "ella": 30000})
        self.assertEqual(actual["posicion_reparto_centimos_eur"], {"el": 85000, "ella": 15000})
        self.assertEqual(actual["compensacion_pendiente_centimos_eur"], {"el": 15000, "ella": -15000})
        self.assertEqual(actual["flujo_caja_centimos_eur"], {"el": 45000, "ella": -5000})
        self.assertEqual(actual["pagos_fisicos_centimos_eur"], {"el": 30000, "ella": 30000})
        self.assertEqual(result["operativa_real"]["meses"][0]["saldo_total_centimos_eur"], 100000)
        self.assertEqual(result["operativa"]["meses"][0]["saldo_total_centimos_eur"], 150000)
        real_transfers = [event for event in result["operativa_real"]["meses"][0]["eventos"] if event["tipo"] == "transferencia"]
        self.assertEqual({event["id"] for event in real_transfers}, {"aporte_a"})

    def test_caja_real_cobra_comision_solo_si_cambio_esta_pagado(self):
        value = caso(cuentas=[{"id": "eur", "nombre": "EUR", "titular": "el", "moneda": "EUR", "saldo_inicial": "1000"},
                              {"id": "clp", "nombre": "CLP", "titular": "ella", "moneda": "CLP", "saldo_inicial": "0"}],
                     comision_cambio_eur="5", transferencias=[
                         {"id": "pagado", "concepto": "Pagado", "origen": "eur", "destino": "clp", "importe": "100", "fecha": "2026-01-01", "estados_por_mes": {"2026-01": "pagado"}},
                         {"id": "previsto", "concepto": "Previsto", "origen": "eur", "destino": "clp", "importe": "100", "fecha": "2026-01-01"}])
        result = simular_plan(value, acuerdo("progresivo"))
        actual = result["meses"][0]["ejecucion"]
        self.assertEqual(actual["egresos_centimos_eur"], {"el": 500, "ella": 0})
        self.assertEqual(actual["posicion_real_centimos_eur"], {"el": 89500, "ella": 10000})
        self.assertEqual(actual["compensacion_pendiente_centimos_eur"], {"el": 10000, "ella": -10000})
        fees = [pago for pago in result["meses"][0]["pagos"] if pago.get("es_comision_cambio")]
        self.assertEqual(sorted(pago["estado"] for pago in fees), ["pagado", "previsto"])
        self.assertEqual(result["operativa_real"]["meses"][0]["saldo_total_centimos_eur"], 99500)
        self.assertEqual(result["operativa"]["meses"][0]["saldo_total_centimos_eur"], 99000)

    def test_caja_real_sin_cuentas_conserva_dinero_inicial_y_estado_por_mes(self):
        value = caso(movimiento("ingreso", tipo="ingreso", persona="el", importe="100", estado="pagado", modalidad="recurrente"),
                     movimiento("gasto", persona="el", pagador="el", importe="20", modalidad="recurrente", descontar_antes_reparto=False,
                                estados_por_mes={"2026-02": "pagado"}), fin="2026-02")
        value["personas"]["el"]["saldo_inicial_eur"] = "100"
        rows = simular_plan(value, acuerdo("progresivo"))["meses"]
        self.assertEqual([row["ejecucion"]["posicion_real_centimos_eur"]["el"] for row in rows], [20000, 28000])
        self.assertEqual([row["ejecucion"]["flujo_caja_centimos_eur"]["el"] for row in rows], [10000, 8000])


if __name__ == "__main__":
    unittest.main()
