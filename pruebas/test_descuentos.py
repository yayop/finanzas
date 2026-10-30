"""La selección de gastos previos cambia el reparto, no duplica pagos."""

import copy
import unittest
from fractions import Fraction

from scripts.migracion import migrar_plan
from scripts.modelo import simular_plan, validar_plan
from pruebas.test_equivalencia import acuerdo, caso, ingresos, movimiento, tasa


def plan_base(**cambios):
    return caso(*ingresos(), movimiento("compromiso", importe="1000", **cambios),
                movimiento("comun", persona="compartido", importe="1500"))


class DescuentosTests(unittest.TestCase):
    def test_elegir_descuento_reduce_solo_la_base_y_no_duplica_el_gasto(self):
        value = plan_base(descontar_antes_reparto=False)
        original = copy.deepcopy(value)
        sin = simular_plan(value, acuerdo())["meses"][0]
        self.assertEqual(value, original)
        self.assertEqual(sin["gastos_descontados_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(sin["gastos_no_descontados_centimos_eur"], {"el": 0, "ella": 100000})
        self.assertEqual(sin["reparto_equivalente"]["base_reparto_centimos_eur"], {"el": 200000, "ella": 200000})
        self.assertEqual(sin["asignacion_comunes_centimos_eur"], {"el": 75000, "ella": 75000})
        self.assertEqual(sin["flujo_libre_centimos_eur"], {"el": 125000, "ella": 25000})
        value["movimientos"][2]["descontar_antes_reparto"] = True
        con = simular_plan(value, acuerdo())["meses"][0]
        self.assertEqual(con["gastos_descontados_centimos_eur"], {"el": 0, "ella": 100000})
        self.assertEqual(con["reparto_equivalente"]["base_reparto_centimos_eur"], {"el": 200000, "ella": 100000})
        self.assertEqual(con["asignacion_comunes_centimos_eur"], {"el": 100000, "ella": 50000})
        self.assertEqual(con["flujo_libre_centimos_eur"], {"el": 100000, "ella": 50000})
        for key in ("ingresos_reales_centimos_eur", "pagos_personales_centimos_eur", "pagos_externos_centimos_eur", "hogar"):
            self.assertEqual(con[key], sin[key], key)
        for row in (sin, con):
            self.assertEqual(row["reparto_equivalente"]["excedentes_equivalentes_centimos_eur"], row["flujo_libre_centimos_eur"])
            self.assertEqual(row["reparto_equivalente"]["diferencia_centimos_eur"], {"el": 0, "ella": 0})
            self.assertEqual(sum(row["reparto_equivalente"]["costos_originales_centimos_eur"].values()), 250000)
        self.assertEqual(tasa(con["reparto_equivalente"], "alpha_prima", "el"), Fraction(2, 5))

    def test_un_gasto_no_seleccionado_sigue_reduciendo_el_excedente_sin_reducir_base(self):
        value = plan_base(descontar_antes_reparto=True)
        value["movimientos"].append(movimiento("personal_excluido", importe="300", descontar_antes_reparto=False))
        row = simular_plan(value, acuerdo())["meses"][0]
        self.assertEqual(row["pagos_personales_centimos_eur"], {"el": 0, "ella": 130000})
        self.assertEqual(row["gastos_descontados_centimos_eur"], {"el": 0, "ella": 100000})
        self.assertEqual(row["reparto_equivalente"]["base_reparto_centimos_eur"], {"el": 200000, "ella": 100000})
        self.assertEqual(row["flujo_libre_centimos_eur"], {"el": 100000, "ella": 20000})

    def test_compartido_fijo_y_personal_parcial_descuentan_solo_la_asignacion_previa(self):
        fixed = movimiento("fijo", persona="compartido", reparto="fijo", porcentaje_el="25", importe="400", descontar_antes_reparto=True)
        partial = movimiento("parcial", porcentaje_compartido="50", importe="200", descontar_antes_reparto=True)
        common = movimiento("comun", persona="compartido", importe="800", descontar_antes_reparto=True)
        value = caso(*ingresos(), fixed, partial, common)
        row = simular_plan(value, acuerdo())["meses"][0]
        self.assertEqual(row["gastos_descontados_centimos_eur"], {"el": 10000, "ella": 40000})
        self.assertEqual(row["gastos_comunes_centimos_eur"], 90000)
        by_id = {m["id"]: m for m in row["pagos"]}
        self.assertEqual(by_id["fijo"]["importe_descontado_centimos_eur"], {"el": 10000, "ella": 30000})
        self.assertEqual(by_id["parcial"]["importe_descontado_centimos_eur"], {"el": 0, "ella": 10000})
        self.assertEqual(by_id["comun"]["importe_descontado_centimos_eur"], {"el": 0, "ella": 0})

    def test_alias_deuda_y_gasto_en_cuotas_generan_mismos_pagos_y_futuros(self):
        gasto = caso(movimiento("cuotas", modalidad="cuotas", cuotas=3, cuotas_pagadas=1,
                               importe="100.01", importe_tipo="total", descontar_antes_reparto=False))
        deuda = copy.deepcopy(gasto)
        deuda["movimientos"][0]["tipo"] = "deuda"
        a, b = simular_plan(gasto, acuerdo()), simular_plan(deuda, acuerdo())
        self.assertEqual(a, b)
        pago = a["meses"][0]["pagos"][0]
        self.assertEqual((pago["tipo"], pago["importe_original"], pago["descontar_antes_reparto"]), ("gasto", 3333, False))
        futuro = a["compromisos_fuera_horizonte"]["movimientos"][0]
        self.assertEqual((futuro["tipo"], futuro["importe_pendiente"]), ("gasto", "33.35"))

    def test_ausencia_del_campo_conserva_calculo_anterior_y_migracion_lo_explica(self):
        legacy = {"version": 2, "caso": plan_base(), "escenario": acuerdo()}
        original = copy.deepcopy(legacy)
        migrated = migrar_plan(legacy)
        self.assertEqual(legacy, original)
        self.assertTrue(all(m["descontar_antes_reparto"] for m in migrated["caso"]["movimientos"] if m["tipo"] == "gasto"))
        self.assertTrue(all("descontar_antes_reparto" not in m for m in migrated["caso"]["movimientos"] if m["tipo"] == "ingreso"))
        self.assertEqual(simular_plan(legacy["caso"], legacy["escenario"]), simular_plan(migrated["caso"], migrated["escenario"]))
        self.assertEqual(migrar_plan(migrated), migrated)

    def test_solo_la_regla_tras_compromisos_cambia_al_marcar_descuentos(self):
        for rule in ("mitades", "manual", "proporcional", "igualar"):
            with self.subTest(rule=rule):
                value = plan_base(descontar_antes_reparto=False)
                before = simular_plan(value, acuerdo(rule, porcentaje_el="25"))
                value["movimientos"][2]["descontar_antes_reparto"] = True
                after = simular_plan(value, acuerdo(rule, porcentaje_el="25"))
                for a, b in zip(before["meses"], after["meses"]):
                    self.assertEqual(a["flujo_libre_centimos_eur"], b["flujo_libre_centimos_eur"])
                    self.assertEqual(a["asignacion_comunes_centimos_eur"], b["asignacion_comunes_centimos_eur"])

    def test_los_descuentos_siguen_el_calendario_de_cuotas_y_recurrencias(self):
        value = caso(*ingresos(modalidad="recurrente"),
                     movimiento("cuotas", modalidad="cuotas", importe_tipo="cuota", cuotas=2, importe="100", descontar_antes_reparto=True),
                     movimiento("recurrente", modalidad="recurrente", intervalo_meses=2, importe="200", descontar_antes_reparto=True),
                     fin="2026-03")
        result = simular_plan(value, acuerdo())
        self.assertEqual([r["gastos_descontados_centimos_eur"]["ella"] for r in result["meses"]], [30000, 10000, 20000])
        self.assertEqual(result["totales"]["gastos_descontados_centimos_eur"], {"el": 0, "ella": 60000})
        self.assertEqual(result["totales"]["gastos_no_descontados_centimos_eur"], {"el": 0, "ella": 0})

    def test_comision_cambio_se_descuenta_una_vez_aunque_gasto_no_se_seleccione(self):
        value = plan_base(descontar_antes_reparto=False)
        value.update(cuentas=[{"id": "eur", "nombre": "EUR", "titular": "ella", "moneda": "EUR", "saldo_inicial": "1000"},
                              {"id": "clp", "nombre": "CLP", "titular": "ella", "moneda": "CLP", "saldo_inicial": "0"}],
                     transferencias=[{"id": "cambio", "concepto": "Cambio", "origen": "eur", "destino": "clp", "importe": "100", "fecha": "2026-01-02", "modalidad": "unico"}],
                     comision_cambio_eur="5")
        row = simular_plan(value, acuerdo())["meses"][0]
        self.assertEqual(row["gastos_descontados_centimos_eur"], {"el": 0, "ella": 500})
        self.assertEqual(row["gastos_no_descontados_centimos_eur"], {"el": 0, "ella": 100000})
        self.assertEqual(row["hogar"]["pagos_externos_centimos_eur"], 250500)
        fees = [p for p in row["pagos"] if p.get("es_comision_cambio")]
        self.assertEqual(len(fees), 1)
        self.assertEqual(fees[0]["importe_descontado_centimos_eur"], {"el": 0, "ella": 500})

    def test_booleano_estricto_incluso_si_se_envia_con_un_ingreso(self):
        for tipo in ("gasto", "deuda", "ingreso"):
            for invalid in ("true", "false", 1, 0, None):
                with self.subTest(tipo=tipo, invalid=invalid), self.assertRaisesRegex(ValueError, "debe ser booleano"):
                    validar_plan(caso(movimiento("registro", tipo=tipo, descontar_antes_reparto=invalid)), acuerdo())
        value = caso(movimiento("ingreso", tipo="ingreso", importe="100", descontar_antes_reparto=True))
        self.assertEqual(simular_plan(value, acuerdo())["meses"][0]["gastos_descontados_centimos_eur"], {"el": 0, "ella": 0})


if __name__ == "__main__":
    unittest.main()
