"""Caja real por cuenta frente al costo acordado, sin duplicar dinero."""

import copy
import unittest

from scripts.modelo import simular_plan, validar_plan


def cuenta(identificador, titular="el", moneda="EUR", saldo="0", **extra):
    return dict(id=identificador, nombre=identificador, titular=titular, moneda=moneda, saldo_inicial=saldo, **extra)


def movimiento(identificador="gasto", **extra):
    item = dict(id=identificador, concepto=identificador, tipo="gasto", persona="compartido", pagador="el",
                importe="100", moneda="EUR", fecha="2026-01-10", modalidad="unico", cuenta_id="yayo")
    item.update(extra)
    return item


def transferencia(**extra):
    item = dict(id="transferencia", concepto="Compensación", origen="fer", destino="yayo", importe="50",
                fecha="2026-01-20", modalidad="unico")
    item.update(extra)
    return item


def caso(**extra):
    item = dict(version=2, es_ficticio=True, inicio="2026-01", fin="2026-01", clp_por_eur="1000",
                personas={"el": {"nombre": "Yayo", "saldo_inicial_eur": "0"},
                          "ella": {"nombre": "Fer", "saldo_inicial_eur": "0"}}, movimientos=[], cuentas=[], transferencias=[])
    item.update(extra)
    return item


ACUERDO = dict(id="acuerdo", nombre="Acuerdo", regla="mitades", incluir_extra=True)


def simular(value):
    return simular_plan(value, ACUERDO)


class OperativaTests(unittest.TestCase):
    def test_cuentas_y_caja_sin_cuenta_se_suman_una_sola_vez(self):
        value = caso(cuentas=[cuenta("yayo", saldo="100"), cuenta("fer", "ella", "CLP", "25000"),
                              cuenta("comun", "compartido", saldo="300", porcentaje_el="25")])
        value["personas"]["el"]["saldo_inicial_eur"] = "10"
        original = copy.deepcopy(value)
        result = simular(value)
        self.assertEqual(result["totales"]["saldo_inicial_centimos_eur"], {"el": 18500, "ella": 25000})
        self.assertEqual(result["totales"]["hogar"]["saldo_final_centimos_eur"], 43500)
        self.assertEqual(result["operativa"]["meses"][0]["saldo_total_centimos_eur"], 43500)
        self.assertEqual(value, original)

    def test_compensacion_no_se_ejecuta_sola_y_transferencia_la_resuelve(self):
        value = caso(cuentas=[cuenta("yayo", saldo="100"), cuenta("fer", "ella", saldo="100")],
                     movimientos=[movimiento()])
        result = simular(value)
        caja = result["operativa"]["meses"][0]
        self.assertEqual([f["saldo_final_unidades"] for f in caja["cuentas"]], [0, 10000])
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 5000, "ella": -5000})
        self.assertEqual(result["meses"][0]["saldo_final_centimos_eur"], {"el": 5000, "ella": 5000})
        value["transferencias"] = [transferencia()]
        result = simular(value)
        caja = result["operativa"]["meses"][0]
        self.assertEqual([f["saldo_final_unidades"] for f in caja["cuentas"]], [5000, 5000])
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(result["meses"][0]["flujo_libre_centimos_eur"], {"el": -5000, "ella": -5000})
        self.assertEqual(caja["cuentas"][0]["entradas_unidades"], 0)
        self.assertEqual(caja["cuentas"][0]["transferencias_entrada_unidades"], 5000)

    def test_pendiente_acumula_meses_y_descuenta_solo_transferencias_entre_titulares(self):
        value = caso(fin="2026-02", cuentas=[cuenta("yayo", saldo="300"), cuenta("fer", "ella", saldo="300"), cuenta("otro")],
                     movimientos=[movimiento(modalidad="recurrente")],
                     transferencias=[transferencia(), transferencia(id="propia", origen="yayo", destino="otro", importe="10")])
        result = simular(value)
        enero, febrero = result["operativa"]["meses"]
        self.assertEqual(enero["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(febrero["compensacion_mes_centimos_eur"], {"el": 5000, "ella": -5000})
        self.assertEqual(febrero["compensacion_pendiente_centimos_eur"], {"el": 5000, "ella": -5000})

    def test_transferencias_con_cuenta_comun_usan_su_proporcion(self):
        value = caso(cuentas=[cuenta("yayo", saldo="100"), cuenta("comun", "compartido", porcentaje_el="25")],
                     transferencias=[transferencia(origen="yayo", destino="comun", importe="100")])
        caja = simular(value)["operativa"]["meses"][0]
        self.assertEqual(caja["transferencias_entre_personas_centimos_eur"], {"el": -7500, "ella": 7500})
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 7500, "ella": -7500})
        self.assertEqual(caja["saldo_total_centimos_eur"], 10000)

    def test_pago_ya_financiado_en_cuenta_conjunta_no_genera_otra_compensacion(self):
        value = caso(cuentas=[cuenta("comun", "compartido", saldo="100")], movimientos=[movimiento(cuenta_id="comun")])
        result = simular(value)
        caja = result["operativa"]["meses"][0]
        self.assertEqual(result["meses"][0]["saldo_final_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(caja["posicion_real_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})

    def test_pagos_de_cuenta_conjunta_se_atribuyen_segun_sus_fondos(self):
        value = caso(cuentas=[cuenta("comun", "compartido", saldo="100")], movimientos=[movimiento(cuenta_id="comun")])
        result = simular(value)
        self.assertEqual(result["operativa"]["meses"][0]["pagos_atribuidos_centimos_eur"], {"el": 5000, "ella": 5000})
        self.assertEqual(result["meses"][0]["pagos_externos_centimos_eur"], {"el": 10000, "ella": 0})
        self.assertEqual(result["operativa"]["meses"][0]["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})

    def test_pagos_personales_y_sin_cuenta_conservan_su_pagador(self):
        value = caso(cuentas=[cuenta("yayo", saldo="100")], movimientos=[movimiento(),
                     movimiento("sin cuenta", cuenta_id="", pagador="ella", importe="25")])
        caja = simular(value)["operativa"]["meses"][0]
        self.assertEqual(caja["pagos_atribuidos_centimos_eur"], {"el": 10000, "ella": 2500})

    def test_sueldo_a_cuenta_conjunta_y_transferencias_se_compensan_por_posicion_real(self):
        value = caso(cuentas=[cuenta("comun", "compartido"), cuenta("yayo")],
                     movimientos=[movimiento("sueldo", tipo="ingreso", persona="el", cuenta_id="comun", importe="100")])
        caja = simular(value)["operativa"]["meses"][0]
        self.assertEqual(caja["posicion_real_centimos_eur"], {"el": 5000, "ella": 5000})
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 5000, "ella": -5000})
        value["transferencias"] = [transferencia(origen="comun", destino="yayo", importe="100")]
        caja = simular(value)["operativa"]["meses"][0]
        self.assertEqual(caja["posicion_real_centimos_eur"], {"el": 10000, "ella": 0})
        self.assertEqual(caja["compensacion_pendiente_centimos_eur"], {"el": 0, "ella": 0})

    def test_cambio_entre_monedas_conserva_caja_y_registra_ambos_lados(self):
        value = caso(cuentas=[cuenta("eur", saldo="100"), cuenta("clp", moneda="CLP")],
                     transferencias=[transferencia(origen="eur", destino="clp", importe="100")])
        result = simular(value)
        caja = result["operativa"]["meses"][0]
        self.assertEqual([f["saldo_final_unidades"] for f in caja["cuentas"]], [0, 100000])
        self.assertEqual([e["importe_unidades"] for e in caja["eventos"]], [-10000, 100000])
        self.assertEqual(caja["saldo_total_centimos_eur"], 10000)
        self.assertEqual(result["totales"]["hogar"]["flujo_libre_centimos_eur"], 0)

    def test_conversion_redondeada_no_crea_dinero_inexistente(self):
        value = caso(clp_por_eur="1", cuentas=[cuenta("eur", saldo="0.01"), cuenta("clp", moneda="CLP")],
                     transferencias=[transferencia(origen="eur", destino="clp", importe="0.01")])
        result = simular(value)
        caja = result["operativa"]["meses"][0]
        self.assertEqual([f["saldo_final_unidades"] for f in caja["cuentas"]], [0, 0])
        self.assertEqual(caja["redondeo_conversion_centimos_eur"], {"el": -1, "ella": 0})
        self.assertEqual(result["meses"][0]["ajuste_cuentas_centimos_eur"], {"el": -1, "ella": 0})
        self.assertEqual(result["totales"]["hogar"]["saldo_final_centimos_eur"], 0)

    def test_revalorizacion_mensual_se_separa_del_ingreso_y_del_flujo(self):
        value = caso(fin="2026-02", clp_por_eur={"2026-01": "1000", "2026-02": "2000"},
                     cuentas=[cuenta("clp", moneda="CLP", saldo="100000")])
        result = simular(value)
        febrero = result["meses"][1]
        self.assertEqual(febrero["ingresos_reales_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(febrero["flujo_libre_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(febrero["ajuste_cuentas_centimos_eur"], {"el": -5000, "ella": 0})
        self.assertEqual(febrero["saldo_final_centimos_eur"], {"el": 5000, "ella": 0})
        self.assertEqual(result["operativa"]["meses"][1]["cuentas"][0]["saldo_final_unidades"], 100000)

    def test_detecta_falta_de_saldo_antes_del_cobro_aunque_cierre_positivo(self):
        value = caso(cuentas=[cuenta("yayo")], movimientos=[movimiento(importe="10"),
                     movimiento("sueldo", tipo="ingreso", persona="el", importe="100", fecha="2026-01-20")])
        caja = simular(value)["operativa"]["meses"][0]
        fila = caja["cuentas"][0]
        self.assertEqual((fila["saldo_final_unidades"], fila["saldo_minimo_unidades"]), (9000, -1000))
        self.assertEqual(fila["primer_deficit"], "2026-01-10")
        self.assertTrue(fila["necesita_financiacion"])

    def test_misma_fecha_procesa_salidas_antes_de_entradas(self):
        value = caso(cuentas=[cuenta("yayo")], movimientos=[movimiento(),
                     movimiento("sueldo", tipo="ingreso", persona="el", importe="100")])
        caja = simular(value)["operativa"]["meses"][0]
        self.assertEqual([e["tipo"] for e in caja["eventos"]], ["gasto", "ingreso"])
        self.assertEqual(caja["cuentas"][0]["saldo_minimo_unidades"], -10000)
        self.assertEqual(caja["cuentas"][0]["saldo_final_unidades"], 0)

    def test_transferencia_recurrente_respeta_fin_y_dia_original(self):
        value = caso(fin="2026-04", cuentas=[cuenta("yayo", saldo="100"), cuenta("otro")],
                     transferencias=[transferencia(origen="yayo", destino="otro", importe="1", fecha="2026-01-31", modalidad="recurrente", hasta="2026-03-31")])
        cajas = simular(value)["operativa"]["meses"]
        self.assertEqual([[e["fecha"] for e in caja["eventos"] if e["importe_unidades"] < 0] for caja in cajas],
                         [["2026-01-31"], ["2026-02-28"], ["2026-03-31"], []])

    def test_movimientos_sin_cuenta_siguen_visibles_y_conservan_total(self):
        value = caso(cuentas=[cuenta("yayo", saldo="100")], movimientos=[movimiento(cuenta_id="", importe="20")])
        result = simular(value)
        caja = result["operativa"]["meses"][0]
        self.assertEqual(caja["sin_cuenta"][0]["concepto"], "gasto")
        self.assertEqual(caja["saldo_sin_cuenta_centimos_eur"], {"el": -2000, "ella": 0})
        self.assertEqual(caja["cuentas"][0]["saldo_final_unidades"], 10000)
        self.assertEqual(caja["saldo_total_centimos_eur"], result["meses"][0]["hogar"]["saldo_final_centimos_eur"])

    def test_valoracion_y_redondeos_conservan_hogar_en_cada_mes(self):
        value = caso(fin="2026-03", clp_por_eur={"2026-01": "955", "2026-02": "901", "2026-03": "1111"},
                     cuentas=[cuenta("eur", saldo="10.07"), cuenta("clp", "compartido", "CLP", "10001", porcentaje_el="33.333")],
                     movimientos=[movimiento("pago", cuenta_id="clp", moneda="CLP", importe="333", modalidad="recurrente"),
                                  movimiento("sin", cuenta_id="", importe="0.03", modalidad="recurrente")],
                     transferencias=[transferencia(origen="eur", destino="clp", importe="0.01", modalidad="recurrente")])
        result = simular(value)
        for row, caja in zip(result["meses"], result["operativa"]["meses"]):
            self.assertEqual(caja["saldo_total_centimos_eur"], row["hogar"]["saldo_final_centimos_eur"])
            for persona in ("el", "ella"):
                self.assertEqual(row["saldo_final_centimos_eur"][persona], row["saldo_inicial_centimos_eur"][persona] + row["flujo_libre_centimos_eur"][persona] + row["ajuste_cuentas_centimos_eur"][persona])

    def test_planes_anteriores_sin_cuentas_no_cambian_su_contrato(self):
        value = caso(movimientos=[movimiento(cuenta_id="")])
        value.pop("cuentas")
        value.pop("transferencias")
        result = simular(value)
        self.assertNotIn("operativa", result)
        self.assertNotIn("ajuste_cuentas_centimos_eur", result["meses"][0])

    def test_grupos_y_etiquetas_se_propagan_solo_si_tienen_contenido(self):
        value = caso(movimientos=[movimiento(cuenta_id="", grupo=" Hogar ", etiquetas=[" Casa ", "Fijo"]),
                                  movimiento("sueldo", tipo="ingreso", persona="el", cuenta_id="", grupo="", etiquetas=[])])
        row = simular(value)["meses"][0]
        self.assertEqual(row["pagos"][0]["grupo"], "Hogar")
        self.assertEqual(row["pagos"][0]["etiquetas"], ["Casa", "Fijo"])
        self.assertNotIn("grupo", row["ingresos"][0])
        self.assertNotIn("etiquetas", row["ingresos"][0])


class ValidacionOperativaTests(unittest.TestCase):
    def test_rechaza_moneda_titular_y_referencias_incompatibles(self):
        for changes in ({"cuenta_id": "desconocida"}, {"cuenta_id": []}, {"moneda": "CLP", "importe": "100"}, {"pagador": "ella"},
                        {"tipo": "ingreso", "persona": "ella"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validar_plan(caso(cuentas=[cuenta("yayo")], movimientos=[movimiento(**changes)]), ACUERDO)

    def test_rechaza_cuentas_y_transferencias_invalidas(self):
        invalidos = [
            {"cuentas": None}, {"cuentas": [cuenta("x"), cuenta("x")]},
            {"cuentas": [cuenta("x", titular="nadie")]}, {"cuentas": [cuenta("x", moneda="USD")]},
            {"cuentas": [cuenta("x", moneda="CLP", saldo="1.01")]},
            {"transferencias": [transferencia(origen="fer", destino="fer")]},
            {"transferencias": [transferencia(destino="inexistente")]},
            {"transferencias": [transferencia(importe="-1")]},
            {"transferencias": [transferencia(importe=1.1)]},
            {"transferencias": [transferencia(fecha="2026-02-30")]},
            {"transferencias": [transferencia(intervalo_meses=0)]},
            {"transferencias": [transferencia(modalidad="cuotas")]},
            {"transferencias": [transferencia(modalidad="recurrente", hasta="2025-12-01")]},
            {"transferencias": [transferencia(), transferencia()]},
        ]
        for changes in invalidos:
            value = caso(cuentas=[cuenta("yayo"), cuenta("fer", "ella")])
            value.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validar_plan(value, ACUERDO)

    def test_rechaza_metadatos_fuera_de_limite(self):
        for changes in ({"grupo": None}, {"grupo": "x" * 81}, {"etiquetas": "texto"}, {"etiquetas": ["x"] * 11}, {"etiquetas": [""]}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validar_plan(caso(movimientos=[movimiento(cuenta_id="", **changes)]), ACUERDO)


if __name__ == "__main__":
    unittest.main()
