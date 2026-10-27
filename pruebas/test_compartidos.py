"""Gastos conjuntos y distribución fija independiente del pagador."""

import copy
import unittest

from scripts.modelo import simular_plan
from scripts.migracion import migrar_plan
from scripts.simular_ejemplo import cargar_caso


def gasto(**changes):
    item = {"id": "gasto", "concepto": "Comida", "tipo": "gasto",
            "persona": "compartido", "pagador": "el", "importe": "100",
            "moneda": "EUR", "fecha": "2026-01-15", "modalidad": "unico"}
    item.update(changes)
    return item


def caso(*items, **changes):
    value = {"version": 2, "es_ficticio": True, "inicio": "2026-01", "fin": "2026-01",
             "clp_por_eur": "1000", "personas": {
                 "el": {"nombre": "Yayo", "saldo_inicial_eur": "0"},
                 "ella": {"nombre": "Fer", "saldo_inicial_eur": "0"}},
             "movimientos": list(items)}
    value.update(changes)
    return value


def escenario(**changes):
    value = {"id": "caso", "nombre": "Caso", "regla": "mitades", "incluir_extra": True}
    value.update(changes)
    return value


def mes(value, **changes):
    return simular_plan(value, escenario(**changes))["meses"][0]


class CompartidosTests(unittest.TestCase):
    def test_porcentaje_fijo_asigna_coste_y_compensa_pago_sin_titular_exclusivo(self):
        value = caso(gasto(reparto="fijo", porcentaje_el="25"))
        original = copy.deepcopy(value)
        result = mes(value)
        self.assertEqual(result["pagos_personales_centimos_eur"], {"el": 2500, "ella": 7500})
        self.assertEqual(result["pagos_externos_centimos_eur"], {"el": 10000, "ella": 0})
        self.assertEqual(result["gastos_comunes_centimos_eur"], 0)
        self.assertEqual(result["compensacion_neta_centimos_eur"], {"el": 7500, "ella": -7500})
        self.assertEqual(result["flujo_libre_centimos_eur"], {"el": -2500, "ella": -7500})
        payment = result["pagos"][0]
        self.assertEqual(payment["persona"], "compartido")
        self.assertEqual(payment["reparto"], "fijo")
        self.assertEqual(payment["importe_asignado_centimos_eur"], {"el": 2500, "ella": 7500})
        self.assertEqual(payment["importe_personal_centimos_eur"], 10000)
        self.assertEqual(payment["importe_comun_centimos_eur"], 0)
        self.assertEqual(value, original)

    def test_regla_general_comparte_todo_y_no_crea_coste_personal(self):
        # La parte antigua no se aplica a un registro que ya es conjunto.
        result = mes(caso(gasto(porcentaje_compartido="0")))
        self.assertEqual(result["gastos_comunes_centimos_eur"], 10000)
        self.assertEqual(result["pagos_personales_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(result["asignacion_comunes_centimos_eur"], {"el": 5000, "ella": 5000})
        self.assertEqual(result["compensacion_neta_centimos_eur"], {"el": 5000, "ella": -5000})
        self.assertEqual(result["pagos"][0]["porcentaje_compartido"], "100")
        self.assertEqual(result["pagos"][0]["importe_asignado_centimos_eur"], {"el": 0, "ella": 0})

    def test_regla_proporcional_utiliza_ingresos_del_hogar(self):
        records = [gasto(),
                   gasto(id="ingreso1", tipo="ingreso", persona="el", importe="3000"),
                   gasto(id="ingreso2", tipo="ingreso", persona="ella", importe="1000")]
        result = mes(caso(*records), regla="proporcional")
        self.assertEqual(result["asignacion_comunes_centimos_eur"], {"el": 7500, "ella": 2500})
        self.assertEqual(result["flujo_libre_centimos_eur"], {"el": 292500, "ella": 97500})

    def test_resto_de_redondeo_se_asigna_a_la_segunda_persona(self):
        result = mes(caso(gasto(importe="100.01", reparto="fijo", porcentaje_el="33.3")))
        self.assertEqual(result["pagos"][0]["importe_asignado_centimos_eur"], {"el": 3330, "ella": 6671})
        self.assertEqual(sum(result["pagos_personales_centimos_eur"].values()), 10001)
        tiny = mes(caso(gasto(importe="0.01", reparto="fijo", porcentaje_el="50")))
        self.assertEqual(tiny["pagos"][0]["importe_asignado_centimos_eur"], {"el": 1, "ella": 0})

    def test_se_convierte_clp_una_vez_antes_de_asignar_el_coste(self):
        result = mes(caso(gasto(moneda="CLP", importe="100001", reparto="fijo", porcentaje_el="33.333")))
        payment = result["pagos"][0]
        self.assertEqual(payment["importe_original"], 100001)
        self.assertEqual(payment["importe_centimos_eur"], 10000)
        self.assertEqual(payment["importe_asignado_centimos_eur"], {"el": 3333, "ella": 6667})
        self.assertEqual(result["clp_comprados"], {"el": 100001, "ella": 0})

    def test_pagador_puede_ser_cualquiera_y_no_cambia_el_coste(self):
        first = mes(caso(gasto(reparto="fijo", porcentaje_el="25")))
        second = mes(caso(gasto(pagador="ella", reparto="fijo", porcentaje_el="25")))
        self.assertEqual(first["pagos_personales_centimos_eur"], second["pagos_personales_centimos_eur"])
        self.assertEqual(first["flujo_libre_centimos_eur"], second["flujo_libre_centimos_eur"])
        self.assertEqual(second["compensacion_neta_centimos_eur"], {"el": -2500, "ella": 2500})
        missing = gasto()
        missing.pop("pagador")
        self.assertEqual(mes(caso(missing))["pagos"][0]["pagador"], "el")

    def test_los_extremos_cero_y_cien_son_validos(self):
        for percentage, allocation in (("0", {"el": 0, "ella": 10000}),
                                       ("100", {"el": 10000, "ella": 0})):
            with self.subTest(percentage=percentage):
                result = mes(caso(gasto(reparto="fijo", porcentaje_el=percentage)))
                self.assertEqual(result["pagos_personales_centimos_eur"], allocation)

    def test_compartidos_rechazan_ingresos_y_parametros_invalidos(self):
        with self.assertRaisesRegex(ValueError, "ingresos deben pertenecer"):
            mes(caso(gasto(tipo="ingreso")))
        with self.assertRaisesRegex(ValueError, "pagador"):
            mes(caso(gasto(pagador="compartido")))
        with self.assertRaisesRegex(ValueError, "reparto"):
            mes(caso(gasto(reparto="otro")))
        for value in (None, "-1", "100.001", "NaN", True):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "porcentaje_el"):
                mes(caso(gasto(reparto="fijo", porcentaje_el=value)))

    def test_cuotas_conjuntas_mantienen_calendario_y_compromisos(self):
        result = simular_plan(caso(gasto(tipo="deuda", modalidad="cuotas", importe="1200", cuotas=12,
                                     reparto="fijo", porcentaje_el="40")), escenario())
        self.assertEqual(result["meses"][0]["pagos"][0]["importe_asignado_centimos_eur"], {"el": 4000, "ella": 6000})
        future = result["compromisos_fuera_horizonte"]["movimientos"][0]
        self.assertEqual(future["pagos_pendientes"], 11)
        self.assertEqual(future["importe_pendiente"], "1100.00")

    def test_las_reglas_globales_conservan_dinero_incluida_igualdad(self):
        records = [gasto(reparto="fijo", porcentaje_el="25"), gasto(id="comun", importe="40"),
                   gasto(id="ingreso1", tipo="ingreso", persona="el", importe="3000"),
                   gasto(id="ingreso2", tipo="ingreso", persona="ella", importe="1000")]
        original = caso(*records)
        for rule in ("mitades", "proporcional", "proporcional_disponible", "manual", "igualar"):
            with self.subTest(rule=rule):
                result = mes(original, regla=rule, porcentaje_el="33.33")
                self.assertEqual(sum(result["compensacion_neta_centimos_eur"].values()), 0)
                self.assertEqual(result["hogar"]["flujo_libre_centimos_eur"], 386000)
                payment = next(p for p in result["pagos"] if p["id"] == "gasto")
                self.assertEqual(payment["importe_asignado_centimos_eur"], {"el": 2500, "ella": 7500})
                self.assertEqual(sum(result["pagos_personales_centimos_eur"].values()) + result["gastos_comunes_centimos_eur"], 14000)
                if rule == "igualar":
                    self.assertEqual(result["flujo_libre_centimos_eur"], {"el": 193000, "ella": 193000})

    def test_los_planes_anteriores_conservan_el_resultado(self):
        old = cargar_caso()
        plan = migrar_plan({"caso": old, "escenario": old["escenarios"][0]})
        result = simular_plan(plan["caso"], plan["escenario"])
        self.assertEqual(result["meses"][0]["flujo_libre_centimos_eur"], {"el": 165000, "ella": 64000})
        self.assertEqual(result["totales"]["saldo_final_centimos_eur"], {"el": 1810000, "ella": 846000})
        personal = gasto(persona="ella", porcentaje_compartido="25", reparto="fijo", porcentaje_el="999")
        self.assertEqual(mes(caso(personal))["pagos_personales_centimos_eur"], {"el": 0, "ella": 7500})


if __name__ == "__main__":
    unittest.main()
