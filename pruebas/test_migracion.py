"""Compatibilidad de los planes guardados con el catálogo de movimientos."""

import copy
import unittest

from scripts.migracion import migrar_plan
from scripts.simular_ejemplo import CASO_PREDETERMINADO, cargar_caso, simular


class MigracionTests(unittest.TestCase):
    def setUp(self):
        self.caso = cargar_caso()
        self.plan = {"version": 1, "caso": self.caso, "escenario": copy.deepcopy(self.caso["escenarios"][0])}

    def movimiento(self, plan, identificador):
        return next(m for m in plan["caso"]["movimientos"] if m["id"] == identificador)

    def test_migra_todos_los_conceptos_sin_mutar_ni_escribir_el_ejemplo(self):
        original = copy.deepcopy(self.plan)
        archivo_original = CASO_PREDETERMINADO.read_bytes()
        nuevo = migrar_plan(self.plan)
        self.assertEqual(nuevo["version"], 2)
        self.assertEqual(nuevo["caso"]["version"], 2)
        self.assertEqual(len(nuevo["caso"]["movimientos"]), 14)
        self.assertEqual(self.plan, original)
        self.assertEqual(CASO_PREDETERMINADO.read_bytes(), archivo_original)
        for campo in ("ingresos", "gastos", "facturas", "ayuda", "deuda_fija", "escenarios"):
            self.assertNotIn(campo, nuevo["caso"])
        nuevo["caso"]["personas"]["el"]["nombre"] = "Otro nombre"
        self.assertEqual(self.plan, original)

    def test_mantiene_importes_nombres_y_ediciones_guardadas(self):
        self.plan["caso"]["es_ficticio"] = False
        self.plan["caso"]["personas"]["el"]["saldo_inicial_eur"] = "125.47"
        self.caso["ingresos"][0].update(importe_eur="2890.23", nombre="Contrato actual", notas="Neto confirmado")
        self.caso["gastos"][0].update(importe_eur="1312.97", concepto="Arriendo y servicios")
        self.caso["ayuda"].update(importe_clp=315000, hasta="2027-02")
        self.caso["facturas"][0].update(importe_clp=735017, cuotas=7, primera_cuota="2026-12")
        nuevo = migrar_plan(self.plan)
        self.assertFalse(nuevo["caso"]["es_ficticio"])
        self.assertEqual(nuevo["caso"]["personas"]["el"]["saldo_inicial_eur"], "125.47")
        sueldo = self.movimiento(nuevo, "sueldo_inicial")
        self.assertEqual((sueldo["concepto"], sueldo["importe"], sueldo["notas"]), ("Contrato actual", "2890.23", "Neto confirmado"))
        self.assertEqual(self.movimiento(nuevo, "hogar")["concepto"], "Arriendo y servicios")
        ayuda = self.movimiento(nuevo, "hermana")
        self.assertEqual((ayuda["importe"], ayuda["hasta"]), ("315000", "2027-02-28"))
        factura = self.movimiento(nuevo, "universidad_1")
        self.assertEqual((factura["importe"], factura["cuotas"], factura["fecha"]), ("735017", 7, "2026-12-01"))

    def test_recurrencias_incluyen_el_ultimo_mes_y_febrero_bisiesto(self):
        self.caso["ingresos"][0]["hasta"] = "2028-02"
        nuevo = migrar_plan(self.plan)
        self.assertEqual(self.movimiento(nuevo, "sueldo_inicial")["hasta"], "2028-02-29")
        self.assertEqual(self.movimiento(nuevo, "hermana")["hasta"], "2027-03-31")
        for identificador in ("sueldo_inicial", "hogar", "hermana"):
            movimiento = self.movimiento(nuevo, identificador)
            self.assertEqual(movimiento["modalidad"], "recurrente")
            self.assertEqual(movimiento["intervalo_meses"], 1)

    def test_cuotas_pagadas_no_desplazan_la_proxima_fecha_de_pago(self):
        nuevo = migrar_plan(self.plan)
        deuda = self.movimiento(nuevo, "deuda_46_cuotas")
        self.assertEqual((deuda["cuotas"], deuda["cuotas_pagadas"]), (46, 6))
        self.assertEqual((deuda["fecha"], deuda["importe"], deuda["importe_tipo"]), ("2026-11-01", "200000", "cuota"))
        factura = self.movimiento(nuevo, "universidad_1")
        self.assertEqual((factura["cuotas_pagadas"], factura["importe_tipo"]), (0, "total"))

    def test_materializa_overrides_sin_perder_repartos_parciales(self):
        self.plan["escenario"].update(universidad_compartida=True, cuotas_universidad=6, sustituir_chomage_por_eur="2675.43")
        self.caso["deuda_fija"]["porcentaje_compartido"] = "12.5"
        self.caso["ayuda"]["porcentaje_compartido"] = "33.333"
        self.caso["facturas"][0]["porcentaje_compartido"] = "0"
        self.caso["facturas"][1]["porcentaje_compartido"] = "27.25"
        nuevo = migrar_plan(self.plan)
        self.assertEqual(self.movimiento(nuevo, "chomage")["importe"], "2675.43")
        self.assertEqual(self.movimiento(nuevo, "deuda_46_cuotas")["porcentaje_compartido"], "12.5")
        self.assertEqual(self.movimiento(nuevo, "hermana")["porcentaje_compartido"], "33.333")
        self.assertEqual([self.movimiento(nuevo, "universidad_" + str(i))["porcentaje_compartido"] for i in range(1, 5)], ["0", "27.25", "100", "100"])
        self.assertTrue(all(self.movimiento(nuevo, "universidad_" + str(i))["cuotas"] == 6 for i in range(1, 5)))
        for campo in ("universidad_compartida", "cuotas_universidad", "sustituir_chomage_por_eur"):
            self.assertNotIn(campo, nuevo["escenario"])
        self.assertEqual(migrar_plan(nuevo), nuevo)

    def test_ids_de_listas_distintas_no_colisionan(self):
        self.caso["ingresos"][0]["id"] = "hogar"
        self.caso["deuda_fija"]["id"] = "hogar"
        self.caso["facturas"][0]["id"] = "gasto_hogar"
        nuevo = migrar_plan(self.plan)
        identificadores = [m["id"] for m in nuevo["caso"]["movimientos"]]
        self.assertEqual(len(identificadores), len(set(identificadores)))
        self.assertIn("ingreso_hogar", identificadores)
        self.assertIn("deuda_hogar", identificadores)

    def test_referencia_se_migra_con_sus_propios_datos_sin_contaminar_plan(self):
        referencia = copy.deepcopy(self.plan)
        referencia["caso"]["ingresos"][0]["importe_eur"] = "3100.00"
        referencia["escenario"] = copy.deepcopy(self.caso["escenarios"][6])
        self.plan["reference"] = referencia
        self.plan["caso"]["ingresos"][0]["importe_eur"] = "1800.00"
        original = copy.deepcopy(self.plan)
        nuevo = migrar_plan(self.plan)
        self.assertEqual(self.movimiento(nuevo, "sueldo_inicial")["importe"], "1800.00")
        self.assertEqual(self.movimiento(nuevo["reference"], "sueldo_inicial")["importe"], "3100.00")
        self.assertEqual(self.movimiento(nuevo, "universidad_1")["cuotas"], 12)
        self.assertEqual(self.movimiento(nuevo["reference"], "universidad_1")["cuotas"], 6)
        self.assertEqual(self.plan, original)
        nuevo["reference"]["caso"]["personas"]["el"]["nombre"] = "Referencia"
        self.assertNotEqual(nuevo["caso"]["personas"]["el"]["nombre"], "Referencia")

    def test_plan_generico_conserva_valores_sin_reintroducir_defaults(self):
        nuevo = migrar_plan(self.plan)
        nuevo["caso"]["movimientos"] = []
        nuevo["escenario"]["porcentaje_el"] = "73.25"
        nuevo["notas"] = {"texto": "Borrador propio"}
        original = copy.deepcopy(nuevo)
        convertido = migrar_plan(nuevo)
        self.assertEqual(convertido, original)
        convertido["notas"]["texto"] = "Editado"
        self.assertEqual(nuevo, original)

    def test_plan_invalido_produce_error_sin_cargar_ejemplo(self):
        for plan in (None, [], {}, {"caso": {}, "escenario": {}},
                     {"version": 3, "caso": self.caso, "escenario": self.plan["escenario"]},
                     {"version": 2, "caso": self.caso, "escenario": self.plan["escenario"]}):
            with self.subTest(plan=plan):
                with self.assertRaises(ValueError):
                    migrar_plan(plan)

    def test_los_ocho_escenarios_conservan_los_resultados_mensuales(self):
        from scripts.modelo import simular_plan

        campos = (
            "mes", "clp_por_eur", "ingresos_reales_centimos_eur", "ingresos_considerados_centimos_eur",
            "pagos_personales_centimos_eur", "gastos_comunes_centimos_eur", "asignacion_comunes_centimos_eur",
            "pagos_externos_centimos_eur", "compensacion_neta_centimos_eur", "flujo_libre_centimos_eur",
            "saldo_inicial_centimos_eur", "saldo_final_centimos_eur", "clp_comprados",
            "coste_compra_clp_centimos_eur", "necesita_financiacion", "hogar",
        )
        for escenario in self.caso["escenarios"]:
            with self.subTest(escenario=escenario["id"]):
                anterior = simular(self.caso, escenario)
                plan = migrar_plan({"caso": self.caso, "escenario": escenario})
                nuevo = simular_plan(plan["caso"], plan["escenario"])
                self.assertEqual(len(nuevo["meses"]), len(anterior["meses"]))
                for mes_anterior, mes_nuevo in zip(anterior["meses"], nuevo["meses"]):
                    self.assertEqual({k: mes_nuevo[k] for k in campos}, {k: mes_anterior[k] for k in campos})
                for campo in campos:
                    if campo in anterior["totales"]:
                        self.assertEqual(nuevo["totales"][campo], anterior["totales"][campo])

    def test_conversion_y_repartos_conservan_redondeos_de_cuotas_no_divisibles(self):
        from scripts.modelo import simular_plan

        self.caso["clp_por_eur"] = "970.31"
        self.caso["deuda_fija"].update(cuota_clp=15, porcentaje_compartido="50")
        self.caso["ayuda"]["porcentaje_compartido"] = "33.333"
        self.caso["facturas"][0].update(importe_clp=720001, cuotas=7, porcentaje_compartido="12.5")
        self.plan["escenario"].update(regla="manual", porcentaje_el="33.333")
        anterior = simular(self.caso, self.plan["escenario"])
        plan = migrar_plan(self.plan)
        nuevo = simular_plan(plan["caso"], plan["escenario"])
        for viejo, actual in zip(anterior["meses"], nuevo["meses"]):
            for campo in ("ingresos_reales_centimos_eur", "pagos_personales_centimos_eur", "gastos_comunes_centimos_eur",
                          "asignacion_comunes_centimos_eur", "flujo_libre_centimos_eur", "saldo_final_centimos_eur", "clp_comprados"):
                self.assertEqual(actual[campo], viejo[campo], (actual["mes"], campo))


if __name__ == "__main__":
    unittest.main()
