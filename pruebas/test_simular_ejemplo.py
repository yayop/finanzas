"""Comprobaciones aritméticas de la maqueta, con datos siempre ficticios."""

import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from scripts.simular_ejemplo import (
    CASO_PREDETERMINADO,
    cargar_caso,
    cuotas_clp,
    main,
    simular,
)


class SimulacionFicticiaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = cargar_caso()

    def setUp(self):
        self.caso = copy.deepcopy(self.base)

    def escenario(self, identificador):
        return copy.deepcopy(next(e for e in self.caso["escenarios"] if e["id"] == identificador))

    def test_flujos_de_meses_representativos_calculados_independientemente(self):
        esperados = {
            "A": [(165000, 64000), (55000, 56000), (55000, 46000), (145000, 76000)],
            "B": [(162000, 67000), (48000, 63000), (43000, 58000), (133000, 88000)],
            "C": [(157021, 71979), (67500, 43500), (67500, 33500), (140000, 81000)],
            "D": [(151364, 77636), (61818, 49182), (61818, 39182), (134286, 86714)],
            "E": [(114500, 114500), (55500, 55500), (50500, 50500), (110500, 110500)],
            "F": [(99500, 129500), (40500, 70500), (35500, 65500), (95500, 125500)],
        }
        for identificador, cifras in esperados.items():
            resultado = simular(self.caso, identificador)
            for indice, esperado in zip((0, 2, 4, 5), cifras):
                with self.subTest(escenario=identificador, mes=resultado["meses"][indice]["mes"]):
                    flujo = resultado["meses"][indice]["flujo_libre_centimos_eur"]
                    self.assertEqual((flujo["el"], flujo["ella"]), esperado)

    def test_saldos_finales_y_totales_del_hogar(self):
        esperados = {"A": (1810000, 846000), "B": (1658000, 998000),
                     "C": (1796542, 859458), "D": (1728184, 927816),
                     "E": (1428000, 1228000), "F": (1248000, 1408000),
                     "G": (1810000, 718000), "H": (2140000, 846000)}
        for identificador, esperado in esperados.items():
            with self.subTest(escenario=identificador):
                resultado = simular(self.caso, identificador)
                totales = resultado["totales"]
                self.assertEqual(tuple(totales["saldo_final_centimos_eur"][p] for p in ("el", "ella")), esperado)
                self.assertEqual(totales["hogar"]["saldo_final_centimos_eur"], sum(esperado))
        hogar = simular(self.caso, "A")["totales"]["hogar"]
        self.assertEqual(hogar["ingresos_reales_centimos_eur"], 5170000)
        self.assertEqual(hogar["pagos_externos_centimos_eur"], 2914000)
        self.assertEqual(hogar["flujo_libre_centimos_eur"], 2256000)
        self.assertEqual(hogar["saldo_final_centimos_eur"], 2656000)

    def test_reglas_y_compensaciones_conservan_dinero_y_no_duplican_pagos(self):
        for escenario in self.caso["escenarios"]:
            resultado = simular(self.caso, escenario)
            for fila in resultado["meses"]:
                with self.subTest(escenario=escenario["id"], mes=fila["mes"]):
                    self.assertEqual(sum(fila["compensacion_neta_centimos_eur"].values()), 0)
                    self.assertEqual(sum(fila["asignacion_comunes_centimos_eur"].values()), fila["gastos_comunes_centimos_eur"])
                    self.assertEqual(sum(p["importe_centimos_eur"] for p in fila["pagos"]), fila["hogar"]["pagos_externos_centimos_eur"])
                    self.assertEqual(sum(fila["pagos_personales_centimos_eur"].values()) + fila["gastos_comunes_centimos_eur"], fila["hogar"]["pagos_externos_centimos_eur"])
                    self.assertEqual(fila["hogar"]["flujo_libre_centimos_eur"], fila["hogar"]["ingresos_reales_centimos_eur"] - fila["hogar"]["pagos_externos_centimos_eur"])
                    for persona in ("el", "ella"):
                        self.assertEqual(fila["flujo_libre_centimos_eur"][persona], fila["ingresos_reales_centimos_eur"][persona] - fila["pagos_personales_centimos_eur"][persona] - fila["asignacion_comunes_centimos_eur"][persona])
        a, b = (simular(self.caso, e)["meses"][0] for e in ("A", "B"))
        self.assertEqual(a["pagos_externos_centimos_eur"], b["pagos_externos_centimos_eur"])
        self.assertEqual(a["pagos_personales_centimos_eur"]["ella"] - b["pagos_personales_centimos_eur"]["ella"], 6000)
        self.assertEqual(b["gastos_comunes_centimos_eur"] - a["gastos_comunes_centimos_eur"], 6000)

    def test_cuotas_no_divisibles_ajustan_la_ultima_sin_perder_pesos(self):
        self.assertEqual(cuotas_clp(100, 3), [33, 33, 34])
        self.assertEqual(sum(cuotas_clp(1000001, 12)), 1000001)
        factura = copy.deepcopy(self.caso["facturas"][0])
        factura.update(importe_clp=100, cuotas=3)
        self.caso["facturas"] = [factura]
        resultado = simular(self.caso, "A")
        self.assertEqual([f["universidad_clp"] for f in resultado["meses"][:3]], [33, 33, 34])
        self.assertEqual(resultado["totales"]["universidad_clp"], 100)

    def test_extra_se_recibe_aunque_se_excluya_de_la_base(self):
        c, d = (simular(self.caso, e) for e in ("C", "D"))
        for fila_c, fila_d in zip(c["meses"], d["meses"]):
            self.assertEqual(fila_c["ingresos_reales_centimos_eur"], fila_d["ingresos_reales_centimos_eur"])
            self.assertEqual(fila_c["ingresos_considerados_centimos_eur"]["ella"] - fila_d["ingresos_considerados_centimos_eur"]["ella"], 30000)
            self.assertEqual(fila_c["pagos_externos_centimos_eur"], fila_d["pagos_externos_centimos_eur"])
            self.assertEqual(fila_c["hogar"], fila_d["hogar"])
        a_sin_extra = self.escenario("A")
        a_sin_extra["incluir_extra"] = False
        sin_extra = simular(self.caso, a_sin_extra)
        self.assertEqual(sin_extra["totales"]["saldo_final_centimos_eur"], simular(self.caso, "A")["totales"]["saldo_final_centimos_eur"])

    def test_igualar_flujo_y_proteger_300_euros_tienen_resultados_distintos(self):
        e, f = (simular(self.caso, identificador) for identificador in ("E", "F"))
        for fila_e, fila_f in zip(e["meses"], f["meses"]):
            self.assertEqual(fila_e["flujo_libre_centimos_eur"]["el"], fila_e["flujo_libre_centimos_eur"]["ella"])
            self.assertEqual(fila_f["flujo_libre_centimos_eur"]["ella"] - fila_f["flujo_libre_centimos_eur"]["el"], 30000)
        self.assertNotEqual(e["totales"]["saldo_final_centimos_eur"]["el"], e["totales"]["saldo_final_centimos_eur"]["ella"])

    def test_saldo_se_arrastra_y_flujo_negativo_no_es_igual_a_falta_de_liquidez(self):
        self.caso["personas"]["el"]["saldo_inicial_eur"] = "1000.00"
        for ingreso in self.caso["ingresos"]:
            if ingreso["persona"] == "el":
                ingreso["importe_eur"] = "0.00"
        resultado = simular(self.caso, "A")
        noviembre, diciembre = resultado["meses"][:2]
        self.assertEqual(noviembre["flujo_libre_centimos_eur"]["el"], -95000)
        self.assertEqual(noviembre["saldo_final_centimos_eur"]["el"], 5000)
        self.assertFalse(noviembre["necesita_financiacion"]["el"])
        self.assertEqual(diciembre["saldo_final_centimos_eur"]["el"], -90000)
        self.assertTrue(diciembre["necesita_financiacion"]["el"])
        for anterior, siguiente in zip(resultado["meses"], resultado["meses"][1:]):
            self.assertEqual(anterior["saldo_final_centimos_eur"], siguiente["saldo_inicial_centimos_eur"])
        self.assertEqual(resultado["totales"]["ingresos_reales_centimos_eur"]["el"], 0)

    def test_ayuda_incluye_marzo_y_termina_en_abril(self):
        resultado = simular(self.caso, "A")
        self.assertEqual([f["ayuda_clp"] for f in resultado["meses"]], [300000] * 5 + [0] * 7)
        self.assertEqual(resultado["totales"]["ayuda_clp"], 1500000)

    def test_deuda_no_reinicia_cuotas_ni_inventa_capital(self):
        resultado = simular(self.caso, "A")
        self.assertEqual(resultado["totales"]["deuda_fija_clp"], 12 * 200000)
        deuda = resultado["compromisos_fuera_horizonte"]["deuda_fija"]
        self.assertEqual(deuda["cuotas_pendientes"], 46 - 6 - 12)
        self.assertEqual(deuda["suma_cuotas_pendientes_clp"], 5600000)
        self.assertIsNone(deuda["capital_pendiente"])

    def test_cambiar_a_seis_cuotas_adelanta_pagos_y_reduce_compromisos_futuros(self):
        a, g = (simular(self.caso, identificador) for identificador in ("A", "G"))
        self.assertEqual(a["totales"]["universidad_clp"], 3040000)
        self.assertEqual(a["compromisos_fuera_horizonte"]["universidad"]["pendiente_clp"], 1280000)
        self.assertEqual(g["totales"]["universidad_clp"], 4320000)
        self.assertEqual(g["compromisos_fuera_horizonte"]["universidad"]["pendiente_clp"], 0)
        for resultado in (a, g):
            self.assertEqual(resultado["totales"]["universidad_clp"] + resultado["compromisos_fuera_horizonte"]["universidad"]["pendiente_clp"], 4320000)

    def test_factura_y_deuda_que_comienzan_despues_del_horizonte(self):
        factura = self.caso["facturas"][0]
        factura["primera_cuota"] = "2027-11"
        self.caso["facturas"] = [factura]
        self.caso["deuda_fija"]["proxima_cuota"] = "2027-11"
        resultado = simular(self.caso, "A")
        self.assertEqual(resultado["totales"]["universidad_clp"], 0)
        self.assertEqual(resultado["totales"]["deuda_fija_clp"], 0)
        futuros = resultado["compromisos_fuera_horizonte"]
        self.assertEqual(futuros["universidad"]["pendiente_clp"], 720000)
        self.assertEqual(futuros["deuda_fija"]["cuotas_pendientes"], 40)

    def test_igualdad_permite_aporte_negativo_y_transferencia_adicional(self):
        for ingreso in self.caso["ingresos"]:
            ingreso["importe_eur"] = "3000.00" if ingreso["id"] == "doctorado" else "0.00"
        fila = simular(self.caso, "E")["meses"][0]
        self.assertEqual(fila["asignacion_comunes_centimos_eur"]["el"], -49500)
        self.assertEqual(fila["compensacion_neta_centimos_eur"]["el"], 199500)
        self.assertEqual(fila["flujo_libre_centimos_eur"], {"el": 29500, "ella": 29500})
        self.assertEqual(fila["hogar"]["pagos_externos_centimos_eur"], 241000)
        self.assertEqual(fila["hogar"]["ingresos_reales_centimos_eur"], 300000)

    def test_conversion_prevista_compra_clp_para_el_pagador_y_usa_su_mes(self):
        self.caso["clp_por_eur"] = {fila["mes"]: "1000" for fila in simular(self.caso, "A")["meses"]}
        self.caso["clp_por_eur"]["2026-12"] = "2000"
        noviembre, diciembre = simular(self.caso, "A")["meses"][:2]
        self.assertEqual(noviembre["clp_comprados"], {"el": 0, "ella": 560000})
        self.assertEqual(diciembre["clp_comprados"], noviembre["clp_comprados"])
        self.assertEqual(noviembre["coste_compra_clp_centimos_eur"]["ella"], 56000)
        self.assertEqual(diciembre["coste_compra_clp_centimos_eur"]["ella"], 28000)
        self.assertEqual(noviembre["ingresos_reales_centimos_eur"], diciembre["ingresos_reales_centimos_eur"])
        self.caso["clp_por_eur"]["2026-11"] = "3"
        primer_pago_clp = next(p for p in simular(self.caso, "A")["meses"][0]["pagos"] if p["moneda_original"] == "CLP")
        self.assertEqual(primer_pago_clp["importe_centimos_eur"], 6666667)

    def test_redondeo_de_reparto_asigna_resto_y_conserva_centimo(self):
        self.caso["gastos"][0]["importe_eur"] = "1500.01"
        fila = simular(self.caso, "A")["meses"][0]
        self.assertEqual(fila["asignacion_comunes_centimos_eur"], {"el": 75001, "ella": 75000})
        igualdad = simular(self.caso, "E")["meses"][0]
        self.assertEqual(abs(igualdad["flujo_libre_centimos_eur"]["el"] - igualdad["flujo_libre_centimos_eur"]["ella"]), 1)

    def test_base_cero_falla_solo_en_proporcional_y_una_base_individual_cero_es_valida(self):
        for ingreso in self.caso["ingresos"]:
            ingreso["importe_eur"] = "0.00"
        for regla in ("A", "E"):
            simular(self.caso, regla)
        with self.assertRaisesRegex(ValueError, "base total.*positiva"):
            simular(self.caso, "C")
        self.caso["ingresos"][3]["importe_eur"] = "1800.00"
        fila = simular(self.caso, "C")["meses"][0]
        self.assertEqual(fila["asignacion_comunes_centimos_eur"], {"el": 0, "ella": 150000})

    def test_entradas_invalidas_tienen_error_explicito(self):
        for tipo_cambio in ("0", "-1", "NaN", True, [], 1000.5):
            with self.subTest(tipo_cambio=tipo_cambio):
                caso = copy.deepcopy(self.caso)
                caso["clp_por_eur"] = tipo_cambio
                with self.assertRaisesRegex(ValueError, "clp_por_eur"):
                    simular(caso, "A")
        for cantidad in (0, 13, 2.5, True, "6"):
            with self.subTest(cuotas=cantidad):
                escenario = self.escenario("G")
                escenario["cuotas_universidad"] = cantidad
                with self.assertRaisesRegex(ValueError, "cuotas_universidad"):
                    simular(self.caso, escenario)
        for ficticio in (False, "true", 1, None):
            self.caso["es_ficticio"] = ficticio
            with self.assertRaisesRegex(ValueError, "es_ficticio"):
                simular(self.caso, "A")
        self.caso["es_ficticio"] = True
        self.caso["facturas"][0]["importe_clp"] = 720000.0
        with self.assertRaisesRegex(ValueError, "importe_clp"):
            simular(self.caso, "A")

    def test_el_ejemplo_no_se_muta_y_su_salida_es_json(self):
        copia = copy.deepcopy(self.caso)
        resultado = simular(self.caso, "G")
        self.assertEqual(self.caso, copia)
        self.assertEqual(json.loads(json.dumps(resultado, ensure_ascii=False)), resultado)
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "caso.json"
            ruta.write_text(json.dumps(self.caso), encoding="utf-8")
            self.assertEqual(cargar_caso(ruta), self.caso)

    def test_cli_json_y_markdown_salen_por_stdout(self):
        salida = io.StringIO()
        with redirect_stdout(salida):
            self.assertEqual(main(["--caso", str(CASO_PREDETERMINADO), "--json"]), 0)
        datos = json.loads(salida.getvalue())
        self.assertEqual([r["escenario"]["id"] for r in datos["resultados"]], list("ABCDEFGH"))
        salida = io.StringIO()
        with redirect_stdout(salida):
            main([])
        documento = salida.getvalue()
        self.assertIn("datos ficticios", documento)
        self.assertIn("2026-11", documento)
        self.assertIn("2027-10", documento)
        self.assertIn("antes de ahorro", documento)
        self.assertIn("no capital pendiente", documento)


if __name__ == "__main__":
    unittest.main()
