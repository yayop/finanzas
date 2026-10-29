"""Comisión fija EUR por una conversión real entre cuentas."""

import copy
import unittest

from scripts.modelo import simular_plan, validar_plan


ACUERDO = {"id": "prueba", "nombre": "50/50", "regla": "mitades", "incluir_extra": True}


def cuenta(identificador, moneda, saldo="0", titular="el", **extra):
    return dict(id=identificador, nombre=identificador, moneda=moneda, saldo_inicial=saldo,
                titular=titular, **extra)


def plan(**extra):
    value = dict(version=2, es_ficticio=True, inicio="2026-01", fin="2026-01", clp_por_eur="1000",
                 comision_cambio_eur="5", personas={
                     "el": {"nombre": "A", "saldo_inicial_eur": "0"},
                     "ella": {"nombre": "B", "saldo_inicial_eur": "0"}},
                 cuentas=[cuenta("eur", "EUR", "110"), cuenta("clp", "CLP")], movimientos=[],
                 transferencias=[dict(id="cambio", concepto="Cambio", origen="eur", destino="clp",
                                      importe="100", fecha="2026-01-10", modalidad="unico")])
    value.update(extra)
    return value


def calcular(value):
    return simular_plan(value, ACUERDO)


class ComisionCambioTests(unittest.TestCase):
    def assert_conserva_caja(self, result):
        for row, caja in zip(result["meses"], result["operativa"]["meses"]):
            self.assertEqual(row["hogar"]["saldo_final_centimos_eur"], caja["saldo_total_centimos_eur"])
            self.assertEqual(sum(caja["compensacion_pendiente_centimos_eur"].values()), 0)

    def test_eur_a_clp_cobra_una_vez_sin_tratar_principal_como_gasto(self):
        value = plan()
        original = copy.deepcopy(value)
        result = calcular(value)
        row, caja = result["meses"][0], result["operativa"]["meses"][0]
        self.assertEqual([item["saldo_final_unidades"] for item in caja["cuentas"]], [500, 100000])
        self.assertEqual(row["pagos_externos_centimos_eur"], {"el": 500, "ella": 0})
        self.assertEqual(row["hogar"]["flujo_libre_centimos_eur"], -500)
        self.assertEqual(row["hogar"]["saldo_final_centimos_eur"], 10500)
        self.assertEqual(len(row["pagos"]), 1)
        fee = row["pagos"][0]
        self.assertTrue(fee["es_comision_cambio"])
        self.assertEqual((fee["concepto"], fee["grupo"], fee["transferencia_id"]),
                         ("Comisión de cambio", "Comisiones", "cambio"))
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(value, original)
        self.assert_conserva_caja(result)

    def test_clp_a_eur_carga_equivalente_en_la_cuenta_clp_de_origen(self):
        value = plan(cuentas=[cuenta("clp", "CLP", "110000", "ella"), cuenta("eur", "EUR", titular="ella")])
        value["transferencias"][0].update(origen="clp", destino="eur", importe="100000")
        result = calcular(value)
        row, caja = result["meses"][0], result["operativa"]["meses"][0]
        self.assertEqual([item["saldo_final_unidades"] for item in caja["cuentas"]], [5000, 10000])
        fee_event = next(event for event in caja["eventos"] if event["tipo"] == "gasto")
        self.assertEqual((fee_event["cuenta_id"], fee_event["importe_unidades"], fee_event["moneda"]),
                         ("clp", -5000, "CLP"))
        self.assertEqual(row["pagos"][0]["importe_centimos_eur"], 500)
        self.assertEqual(row["pagos_personales_centimos_eur"], {"el": 0, "ella": 500})
        self.assertEqual(caja["cuentas"][0]["salidas_unidades"], 5000)
        self.assertEqual(caja["cuentas"][0]["transferencias_salida_unidades"], 100000)
        self.assert_conserva_caja(result)

    def test_no_cobra_transferencia_en_misma_moneda_ni_importe_cero(self):
        same = plan(cuentas=[cuenta("eur", "EUR", "110"), cuenta("otra", "EUR")])
        same["transferencias"][0]["destino"] = "otra"
        zero = plan()
        zero["transferencias"][0]["importe"] = "0"
        for value in (same, zero):
            with self.subTest(value=value):
                result = calcular(value)
                self.assertEqual(result["meses"][0]["pagos"], [])
                self.assertEqual(result["totales"]["hogar"]["flujo_libre_centimos_eur"], 0)
                self.assert_conserva_caja(result)

    def test_pagar_con_clp_que_ya_existen_no_es_otra_conversion(self):
        value = plan(transferencias=[], cuentas=[cuenta("clp", "CLP", "100000")], movimientos=[
            dict(id="pago", concepto="Pago", tipo="gasto", persona="el", pagador="el", cuenta_id="clp",
                 importe="20000", moneda="CLP", fecha="2026-01-10", modalidad="unico")])
        result = calcular(value)
        self.assertEqual([p["id"] for p in result["meses"][0]["pagos"]], ["pago"])
        self.assertEqual(result["totales"]["hogar"]["flujo_libre_centimos_eur"], -2000)
        self.assert_conserva_caja(result)

    def test_recurrencia_respeta_dia_original_fin_y_compromisos_futuros(self):
        value = plan(fin="2026-02")
        value["transferencias"][0].update(importe="10", fecha="2026-01-31", modalidad="recurrente", hasta="2026-03-31")
        result = calcular(value)
        self.assertEqual([[p["fecha"] for p in row["pagos"]] for row in result["meses"]],
                         [["2026-01-31"], ["2026-02-28"]])
        self.assertEqual(result["totales"]["hogar"]["flujo_libre_centimos_eur"], -1000)
        future = result["compromisos_fuera_horizonte"]
        self.assertEqual(future["por_moneda"], {"EUR": "5.00"})
        self.assertEqual((future["movimientos"][0]["pagos_pendientes"], future["movimientos"][0]["proximo_pago"]),
                         (1, "2026-03-31"))
        self.assert_conserva_caja(result)

    def test_clp_usa_cambio_de_cada_mes_y_conserva_comision_eur(self):
        value = plan(fin="2026-02", clp_por_eur={"2026-01": "1000", "2026-02": "2000"},
                     cuentas=[cuenta("clp", "CLP", "100000"), cuenta("eur", "EUR")])
        value["transferencias"][0].update(origen="clp", destino="eur", importe="10000", modalidad="recurrente")
        result = calcular(value)
        fees = [next(event for event in caja["eventos"] if event["tipo"] == "gasto")
                for caja in result["operativa"]["meses"]]
        self.assertEqual([event["importe_unidades"] for event in fees], [-5000, -10000])
        self.assertEqual([row["pagos"][0]["importe_centimos_eur"] for row in result["meses"]], [500, 500])
        self.assert_conserva_caja(result)

    def test_comision_conjunta_sigue_su_porcentaje_sin_otra_compensacion(self):
        value = plan(cuentas=[cuenta("eur", "EUR", "110", "compartido", porcentaje_el="25"),
                              cuenta("clp", "CLP", titular="compartido", porcentaje_el="25")])
        result = calcular(value)
        row, caja = result["meses"][0], result["operativa"]["meses"][0]
        self.assertEqual(row["pagos_personales_centimos_eur"], {"el": 125, "ella": 375})
        self.assertEqual(caja["pagos_atribuidos_centimos_eur"], {"el": 125, "ella": 375})
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})
        self.assert_conserva_caja(result)

    def test_redondeo_nativo_se_separa_de_comision_eur(self):
        value = plan(comision_cambio_eur="0.01", clp_por_eur="1",
                     cuentas=[cuenta("clp", "CLP", "10"), cuenta("eur", "EUR")])
        value["transferencias"][0].update(origen="clp", destino="eur", importe="1")
        result = calcular(value)
        row, caja = result["meses"][0], result["operativa"]["meses"][0]
        self.assertEqual(row["pagos"][0]["importe_centimos_eur"], 1)
        self.assertEqual(caja["redondeo_conversion_centimos_eur"], {"el": 1, "ella": 0})
        self.assertEqual(row["hogar"]["saldo_final_centimos_eur"], 1000)
        self.assert_conserva_caja(result)

    def test_cero_y_ausencia_conservan_contrato_anterior(self):
        value = plan(comision_cambio_eur="0")
        with_zero = calcular(value)
        del value["comision_cambio_eur"]
        self.assertEqual(calcular(value), with_zero)

    def test_rechaza_comision_negativa_no_finita_o_sin_precision_eur(self):
        for fee in ("-1", "0.001", "NaN", "Infinity", None, True, 5.5):
            with self.subTest(fee=fee), self.assertRaises(ValueError):
                validar_plan(plan(comision_cambio_eur=fee), ACUERDO)


if __name__ == "__main__":
    unittest.main()
