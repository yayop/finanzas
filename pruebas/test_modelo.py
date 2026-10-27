"""Calendarios genéricos, reparto independiente del pagador y contrato HTTP."""

import copy
import http.client
import json
import threading
import unittest

from scripts.modelo import simular_plan, validar_plan
from scripts.servidor import crear_servidor
from scripts.simular_ejemplo import cargar_caso, simular


def caso_base(**cambios):
    caso = {"version": 2, "es_ficticio": True, "inicio": "2026-01", "fin": "2026-06",
            "clp_por_eur": "1000", "personas": {
                "el": {"nombre": "Él", "saldo_inicial_eur": "0"},
                "ella": {"nombre": "Ella", "saldo_inicial_eur": "0"}}, "movimientos": []}
    caso.update(cambios)
    return caso


def movimiento(**cambios):
    registro = {"id": "pago", "concepto": "Concepto libre", "tipo": "gasto", "persona": "ella",
                "pagador": "ella", "importe": "100", "moneda": "EUR", "fecha": "2026-01-31",
                "modalidad": "recurrente", "intervalo_meses": 1, "hasta": "", "extra": False,
                "porcentaje_compartido": "0"}
    registro.update(cambios)
    return registro


def escenario(**cambios):
    valor = {"id": "plan", "nombre": "Mi acuerdo", "regla": "mitades", "incluir_extra": True}
    valor.update(cambios)
    return valor


class CalendariosTests(unittest.TestCase):
    def pagos(self, caso):
        return [p for mes in simular_plan(caso, escenario())["meses"] for p in mes["pagos"]]

    def test_recurrente_cada_dos_meses_hasta_inclusive(self):
        caso = caso_base(movimientos=[movimiento(intervalo_meses=2, hasta="2026-05-31")])
        self.assertEqual([p["fecha"] for p in self.pagos(caso)], ["2026-01-31", "2026-03-31", "2026-05-31"])
        caso["movimientos"][0]["hasta"] = "2026-05-30"
        self.assertEqual([p["fecha"] for p in self.pagos(caso)], ["2026-01-31", "2026-03-31"])

    def test_ultimo_dia_de_mes_mantiene_el_dia_ancla(self):
        caso = caso_base(fin="2026-03", movimientos=[movimiento()])
        self.assertEqual([p["fecha"] for p in self.pagos(caso)], ["2026-01-31", "2026-02-28", "2026-03-31"])
        caso.update(inicio="2028-01", fin="2028-03")
        caso["movimientos"][0]["fecha"] = "2028-01-31"
        self.assertEqual([p["fecha"] for p in self.pagos(caso)], ["2028-01-31", "2028-02-29", "2028-03-31"])

    def test_unico_se_cobra_una_vez_y_conserva_concepto_y_fecha(self):
        caso = caso_base(movimientos=[movimiento(modalidad="unico", fecha="2026-03-14", concepto="Veterinario")])
        pagos = self.pagos(caso)
        self.assertEqual([(p["fecha"], p["concepto"], p["importe_original"]) for p in pagos], [("2026-03-14", "Veterinario", 10000)])
        self.assertEqual(simular_plan(caso, escenario())["compromisos_fuera_horizonte"]["movimientos"], [])

    def test_fecha_de_cuotas_es_proxima_cuota_y_no_suma_las_ya_pagadas(self):
        caso = caso_base(fin="2026-12", movimientos=[movimiento(tipo="deuda", modalidad="cuotas", moneda="CLP", importe="200000",
                    cuotas=46, cuotas_pagadas=6, importe_tipo="cuota")])
        resultado = simular_plan(caso, escenario())
        self.assertEqual(len(self.pagos(caso)), 12)
        self.assertEqual(self.pagos(caso)[0]["fecha"], "2026-01-31")
        futuro = resultado["compromisos_fuera_horizonte"]["movimientos"][0]
        self.assertEqual((futuro["pagos_pendientes"], futuro["importe_pendiente"], futuro["proximo_pago"]), (28, "5600000", "2027-01-31"))

    def test_importe_total_cuotas_parcialmente_pagadas_conserva_resto_original(self):
        caso = caso_base(inicio="2026-03", fin="2026-03", movimientos=[movimiento(tipo="deuda", modalidad="cuotas", importe="100.01",
                    fecha="2026-03-15", cuotas=3, cuotas_pagadas=1, importe_tipo="total", intervalo_meses=2)])
        resultado = simular_plan(caso, escenario())
        self.assertEqual(resultado["meses"][0]["pagos"][0]["importe_original"], 3333)
        futuro = resultado["compromisos_fuera_horizonte"]["movimientos"][0]
        self.assertEqual((futuro["pagos_pendientes"], futuro["importe_pendiente"], futuro["proximo_pago"]), (1, "33.35", "2026-05-15"))
        caso["fin"] = "2026-06"
        self.assertEqual([p["importe_original"] for p in self.pagos(caso)], [3333, 3335])

    def test_cuotas_clp_distribuyen_solo_pesos_enteros(self):
        caso = caso_base(movimientos=[movimiento(tipo="deuda", modalidad="cuotas", moneda="CLP", importe="100", cuotas=3, importe_tipo="total")])
        self.assertEqual([p["importe_original"] for p in self.pagos(caso)], [33, 33, 34])
        self.assertEqual(sum(m["cuotas_clp"] for m in simular_plan(caso, escenario())["meses"]), 100)

    def test_deuda_completamente_pagada_no_genera_movimientos(self):
        caso = caso_base(movimientos=[movimiento(tipo="deuda", modalidad="cuotas", importe="100", cuotas=3, cuotas_pagadas=3)])
        resultado = simular_plan(caso, escenario())
        self.assertEqual(self.pagos(caso), [])
        self.assertEqual(resultado["compromisos_fuera_horizonte"]["movimientos"], [])

    def test_calendario_iniciado_antes_del_horizonte_no_reinicia_la_recurrencia(self):
        caso = caso_base(inicio="2026-04", movimientos=[movimiento(intervalo_meses=2)])
        self.assertEqual([p["fecha"] for p in self.pagos(caso)], ["2026-05-31"])

    def test_compromisos_finitos_por_moneda_sin_convertir_con_fx_futuro(self):
        caso = caso_base(fin="2026-03", clp_por_eur={"2026-01": "1000", "2026-02": "1100", "2026-03": "1200"}, movimientos=[
            movimiento(intervalo_meses=2, hasta="2026-09-30", moneda="CLP", importe="15000"),
            movimiento(id="unico", modalidad="unico", fecha="2027-01-05", importe="25.19"),
            movimiento(id="ingreso", tipo="ingreso", modalidad="unico", fecha="2027-01-01", importe="9000")])
        futuro = simular_plan(caso, escenario())["compromisos_fuera_horizonte"]
        self.assertEqual(futuro["por_moneda"], {"CLP": "45000", "EUR": "25.19"})
        self.assertEqual(futuro["movimientos"][0]["pagos_pendientes"], 3)
        self.assertEqual(futuro["movimientos"][0]["proximo_pago"], "2026-05-31")
        self.assertEqual(len(futuro["movimientos"]), 2)

    def test_recurrente_sin_fin_no_inventa_cero_ni_numero_de_pagos(self):
        caso = caso_base(fin="2026-02", movimientos=[movimiento(), movimiento(id="deuda", tipo="deuda", modalidad="cuotas", importe="90", cuotas=3)])
        futuro = simular_plan(caso, escenario())["compromisos_fuera_horizonte"]
        self.assertEqual(futuro["recurrentes_sin_fin"], 1)
        self.assertEqual(futuro["por_moneda"], {"EUR": "30.00"})
        indefinido = futuro["movimientos"][0]
        self.assertIsNone(indefinido["pagos_pendientes"])
        self.assertIsNone(indefinido["importe_pendiente"])
        self.assertEqual(indefinido["proximo_pago"], "2026-03-31")
        caso["movimientos"] = caso["movimientos"][:1]
        self.assertEqual(simular_plan(caso, escenario())["compromisos_fuera_horizonte"]["por_moneda"], {})


class ImportesYRepartoTests(unittest.TestCase):
    def test_convertir_clp_una_vez_antes_de_repartir_con_redondeo_exacto(self):
        caso = caso_base(fin="2026-01", movimientos=[movimiento(moneda="CLP", importe="15", porcentaje_compartido="50")])
        pago = simular_plan(caso, escenario())["meses"][0]["pagos"][0]
        self.assertEqual((pago["importe_centimos_eur"], pago["importe_comun_centimos_eur"], pago["importe_personal_centimos_eur"]), (2, 1, 1))
        caso["movimientos"][0].update(moneda="EUR", importe="1.01", porcentaje_compartido="12.5")
        pago = simular_plan(caso, escenario())["meses"][0]["pagos"][0]
        self.assertEqual((pago["importe_comun_centimos_eur"], pago["importe_personal_centimos_eur"]), (13, 88))

    def test_ingresos_clp_y_gastos_eur_conservan_moneda_original(self):
        caso = caso_base(fin="2026-01", movimientos=[
            movimiento(id="sueldo", tipo="ingreso", persona="el", moneda="CLP", importe="250000"),
            movimiento(id="arriendo", importe="100", porcentaje_compartido="100")])
        mes = simular_plan(caso, escenario())["meses"][0]
        self.assertEqual(mes["ingresos_reales_centimos_eur"], {"el": 25000, "ella": 0})
        self.assertEqual(mes["ingresos"][0]["importe_original"], 250000)
        self.assertEqual(mes["ingresos"][0]["moneda_original"], "CLP")
        self.assertEqual([p["id"] for p in mes["pagos"]], ["arriendo"])
        self.assertEqual(mes["hogar"]["flujo_libre_centimos_eur"], 15000)

    def test_titular_personal_y_pagador_son_independientes(self):
        caso = caso_base(fin="2026-01", movimientos=[movimiento(persona="ella", pagador="el", importe="100")])
        mes = simular_plan(caso, escenario())["meses"][0]
        self.assertEqual(mes["pagos_externos_centimos_eur"], {"el": 10000, "ella": 0})
        self.assertEqual(mes["pagos_personales_centimos_eur"], {"el": 0, "ella": 10000})
        self.assertEqual(mes["compensacion_neta_centimos_eur"], {"el": 10000, "ella": -10000})
        self.assertEqual(mes["flujo_libre_centimos_eur"], {"el": 0, "ella": -10000})
        caso["movimientos"][0]["porcentaje_compartido"] = "25"
        mes = simular_plan(caso, escenario())["meses"][0]
        self.assertEqual(mes["compensacion_neta_centimos_eur"], {"el": 8750, "ella": -8750})

    def test_excluir_extra_cambia_el_reparto_pero_no_el_ingreso_real(self):
        caso = caso_base(fin="2026-01", movimientos=[
            movimiento(id="el", tipo="ingreso", persona="el", importe="1000"),
            movimiento(id="ella", tipo="ingreso", importe="500"),
            movimiento(id="extra", tipo="ingreso", importe="200", extra=True),
            movimiento(id="comun", importe="100", porcentaje_compartido="100")])
        incluido = simular_plan(caso, escenario(regla="igualar"))["meses"][0]
        excluido = simular_plan(caso, escenario(regla="igualar", incluir_extra=False))["meses"][0]
        self.assertEqual(incluido["flujo_libre_centimos_eur"], {"el": 80000, "ella": 80000})
        self.assertEqual(excluido["flujo_libre_centimos_eur"], {"el": 70000, "ella": 90000})
        self.assertEqual(incluido["ingresos_reales_centimos_eur"], excluido["ingresos_reales_centimos_eur"])

    def test_las_cinco_reglas_conservan_caja_y_no_mutan_el_plan(self):
        caso = caso_base(movimientos=[
            movimiento(id="el", tipo="ingreso", persona="el", importe="1200"),
            movimiento(id="ella", tipo="ingreso", importe="900"),
            movimiento(id="extra", tipo="ingreso", importe="100", extra=True),
            movimiento(id="comun", importe="301.01", porcentaje_compartido="100"),
            movimiento(id="deuda", tipo="deuda", persona="ella", pagador="el", moneda="CLP", importe="123456", porcentaje_compartido="12.5")])
        original = copy.deepcopy(caso)
        referencia_hogar = None
        for regla in ("mitades", "proporcional", "proporcional_disponible", "manual", "igualar"):
            with self.subTest(regla=regla):
                resultado = simular_plan(caso, escenario(regla=regla, porcentaje_el="33.333", incluir_extra=False))
                hogar = resultado["totales"]["hogar"]
                if referencia_hogar is None:
                    referencia_hogar = hogar
                self.assertEqual(hogar, referencia_hogar)
                for mes in resultado["meses"]:
                    self.assertEqual(sum(mes["compensacion_neta_centimos_eur"].values()), 0)
                    self.assertEqual(mes["hogar"]["pagos_externos_centimos_eur"], mes["gastos_comunes_centimos_eur"] + sum(mes["pagos_personales_centimos_eur"].values()))
                    self.assertEqual(mes["hogar"]["flujo_libre_centimos_eur"], mes["hogar"]["ingresos_reales_centimos_eur"] - mes["hogar"]["pagos_externos_centimos_eur"])
                    for pago in mes["pagos"]:
                        self.assertEqual(pago["importe_centimos_eur"], pago["importe_comun_centimos_eur"] + pago["importe_personal_centimos_eur"])
                    for persona in ("el", "ella"):
                        self.assertEqual(mes["saldo_final_centimos_eur"][persona], mes["saldo_inicial_centimos_eur"][persona] + mes["flujo_libre_centimos_eur"][persona])
        self.assertEqual(caso, original)

    def test_proporcional_sin_base_y_con_costes_comunes_exige_corregir_plan(self):
        caso = caso_base(fin="2026-01", movimientos=[movimiento(porcentaje_compartido="100")])
        with self.assertRaisesRegex(ValueError, "base total positiva"):
            simular_plan(caso, escenario(regla="proporcional"))
        caso["movimientos"] = []
        self.assertEqual(simular_plan(caso, escenario(regla="proporcional"))["totales"]["hogar"]["flujo_libre_centimos_eur"], 0)


class ValidacionTests(unittest.TestCase):
    def test_valida_precision_calendarios_limites_y_tipos(self):
        cambios_invalidos = (
            {"tipo": "ingreso", "modalidad": "cuotas"}, {"importe": "1.001"}, {"importe": "1.5", "moneda": "CLP"},
            {"importe": 12.5}, {"importe": "NaN"}, {"importe": "1e-999999"}, {"importe": "-1"},
            {"porcentaje_compartido": "100.01"}, {"porcentaje_compartido": True}, {"fecha": "2026-02-30"},
            {"fecha": "2201-01-01"}, {"fecha": "2026-1-01"}, {"intervalo_meses": 0}, {"intervalo_meses": 13},
            {"hasta": "2025-01-01"}, {"modalidad": "cuotas", "cuotas": 601},
            {"modalidad": "cuotas", "cuotas": 3, "cuotas_pagadas": 4}, {"persona": "ambos"}, {"extra": "sí"},
        )
        for cambios in cambios_invalidos:
            with self.subTest(cambios=cambios), self.assertRaises(ValueError):
                validar_plan(caso_base(movimientos=[movimiento(**cambios)]), escenario())

    def test_horizonte_de_uno_a_sesenta_meses_y_tipo_cambio_por_mes(self):
        self.assertEqual(len(simular_plan(caso_base(fin="2026-01"), escenario())["meses"]), 1)
        self.assertEqual(len(simular_plan(caso_base(fin="2030-12"), escenario())["meses"]), 60)
        for caso in (caso_base(fin="2031-01"), caso_base(fin="2025-12"), caso_base(clp_por_eur="0"),
                     caso_base(clp_por_eur={"2026-01": "1000"}), caso_base(version=2.0)):
            with self.subTest(caso=caso), self.assertRaises(ValueError):
                validar_plan(caso, escenario())

    def test_ids_duplicados_y_exceso_de_movimientos_se_rechazan(self):
        for registros in ([movimiento(), movimiento()], [movimiento(id=str(i)) for i in range(1001)]):
            with self.assertRaises(ValueError):
                validar_plan(caso_base(movimientos=registros), escenario())


class ApiMovimientosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servidor = crear_servidor(0)
        cls.hilo = threading.Thread(target=cls.servidor.serve_forever, daemon=True)
        cls.hilo.start()

    @classmethod
    def tearDownClass(cls):
        cls.servidor.shutdown()
        cls.servidor.server_close()
        cls.hilo.join(timeout=2)

    def solicitar(self, metodo, ruta, datos=None):
        conexion = http.client.HTTPConnection("127.0.0.1", self.servidor.server_port, timeout=5)
        try:
            cuerpo = json.dumps(datos).encode("utf-8") if datos is not None else None
            conexion.request(metodo, ruta, cuerpo, {"Content-Type": "application/json"})
            respuesta = conexion.getresponse()
            return respuesta.status, json.loads(respuesta.read())
        finally:
            conexion.close()

    def test_inicial_generico_se_puede_simular_y_no_persiste(self):
        estado, inicial = self.solicitar("GET", "/api/inicial")
        self.assertEqual((estado, inicial["version"]), (200, 2))
        self.assertIn("movimientos", inicial["caso"])
        inicial["caso"]["personas"]["el"]["saldo_inicial_eur"] = "125.47"
        inicial["caso"]["es_ficticio"] = False
        estado, resultado = self.solicitar("POST", "/api/simular", inicial)
        self.assertEqual(estado, 200)
        self.assertFalse(resultado["es_ficticio"])
        self.assertEqual(resultado["totales"]["saldo_inicial_centimos_eur"]["el"], 12547)
        _, siguiente = self.solicitar("GET", "/api/inicial")
        self.assertEqual(siguiente["caso"]["personas"]["el"]["saldo_inicial_eur"], "3000.00")

    def test_post_legacy_mantiene_contrato_y_migracion_conserva_resultado(self):
        caso = cargar_caso()
        plan = {"caso": caso, "escenario": caso["escenarios"][0]}
        estado, resultado = self.solicitar("POST", "/api/simular", plan)
        self.assertEqual((estado, resultado), (200, simular(caso)))
        estado, convertido = self.solicitar("POST", "/api/migrar", plan)
        self.assertEqual((estado, convertido["version"]), (200, 2))
        estado, nuevo = self.solicitar("POST", "/api/simular", convertido)
        self.assertEqual((estado, nuevo["totales"]["hogar"]), (200, resultado["totales"]["hogar"]))

    def test_migracion_valida_movimientos_y_referencia_sin_sustituir_datos(self):
        plan = {"version": 2, "caso": caso_base(movimientos=[movimiento(concepto="Gasto propio")]), "escenario": escenario()}
        estado, convertido = self.solicitar("POST", "/api/migrar", plan)
        self.assertEqual((estado, convertido), (200, plan))
        plan["caso"]["movimientos"][0]["importe"] = "1.001"
        for ruta in ("/api/migrar", "/api/simular"):
            estado, error = self.solicitar("POST", ruta, plan)
            self.assertEqual(estado, 400)
            self.assertIn("decimales EUR", error["error"])
        plan["caso"]["movimientos"][0]["importe"] = "1"
        plan["reference"] = {"caso": caso_base(movimientos=[movimiento(persona="ambos")]), "escenario": escenario()}
        estado, error = self.solicitar("POST", "/api/migrar", plan)
        self.assertEqual(estado, 400)
        self.assertIn("persona", error["error"])


if __name__ == "__main__":
    unittest.main()
