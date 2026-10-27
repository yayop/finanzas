"""Reglas interactivas y contrato HTTP con datos de ejemplo."""

import copy
import http.client
import json
import threading
import unittest

from scripts.servidor import crear_servidor
from scripts.migracion import migrar_plan
from scripts.simular_ejemplo import cargar_caso, simular


class ReglasInteractivasTests(unittest.TestCase):
    def setUp(self):
        self.caso = cargar_caso()
        self.escenario = copy.deepcopy(self.caso["escenarios"][0])

    def test_compartir_parcialmente_conserva_importes_y_no_duplica(self):
        self.caso["deuda_fija"]["porcentaje_compartido"] = "25"
        self.caso["ayuda"]["porcentaje_compartido"] = "50"
        self.caso["facturas"][0]["porcentaje_compartido"] = "12.5"
        resultado = simular(self.caso)
        primera = resultado["meses"][0]
        self.assertEqual(primera["gastos_comunes_centimos_eur"], 170750)
        self.assertEqual(primera["pagos_personales_centimos_eur"], {"el": 20000, "ella": 50250})
        for mes in resultado["meses"]:
            self.assertEqual(sum(mes["compensacion_neta_centimos_eur"].values()), 0)
            self.assertEqual(mes["hogar"]["pagos_externos_centimos_eur"], mes["gastos_comunes_centimos_eur"] + sum(mes["pagos_personales_centimos_eur"].values()))
            for pago in mes["pagos"]:
                self.assertEqual(pago["importe_comun_centimos_eur"] + pago["importe_personal_centimos_eur"], pago["importe_centimos_eur"])
        referencia = simular(cargar_caso())
        self.assertEqual(resultado["totales"]["hogar"], referencia["totales"]["hogar"])

    def test_porcentaje_explicito_prevalece_sobre_universidad_legacy(self):
        self.escenario["universidad_compartida"] = True
        self.caso["facturas"][0]["porcentaje_compartido"] = "0"
        primera = simular(self.caso, self.escenario)["meses"][0]
        universidad = next(p for p in primera["pagos"] if p["tipo"] == "universidad")
        self.assertEqual(universidad["importe_comun_centimos_eur"], 0)
        self.assertEqual(universidad["importe_personal_centimos_eur"], 6000)

    def test_compartir_redondea_despues_de_convertir_y_asigna_resto(self):
        self.caso["deuda_fija"].update(cuota_clp=15, porcentaje_compartido="50")
        pago = next(p for p in simular(self.caso)["meses"][0]["pagos"] if p["tipo"] == "deuda_fija")
        self.assertEqual(pago["importe_centimos_eur"], 2)
        self.assertEqual(pago["importe_comun_centimos_eur"], 1)
        self.assertEqual(pago["importe_personal_centimos_eur"], 1)

    def test_manual_aplica_porcentaje_y_conserva_el_hogar(self):
        self.escenario.update(regla="manual", porcentaje_el="30")
        fila = simular(self.caso, self.escenario)["meses"][0]
        self.assertEqual(fila["asignacion_comunes_centimos_eur"], {"el": 45000, "ella": 105000})
        self.assertEqual(fila["flujo_libre_centimos_eur"], {"el": 195000, "ella": 34000})
        for porcentaje, esperado in (("0", 0), ("100", 150000), ("33.333", 50000)):
            self.escenario["porcentaje_el"] = porcentaje
            fila = simular(self.caso, self.escenario)["meses"][0]
            self.assertEqual(fila["asignacion_comunes_centimos_eur"]["el"], esperado)
            self.assertEqual(fila["hogar"]["flujo_libre_centimos_eur"], 229000)

    def test_proporcional_disponible_resta_solo_las_partes_personales(self):
        self.escenario["regla"] = "proporcional_disponible"
        fila = simular(self.caso, self.escenario)["meses"][0]
        # 1500 * (2600 - 200) / ((2600 - 200) + (2100 - 710)).
        self.assertEqual(fila["asignacion_comunes_centimos_eur"], {"el": 94987, "ella": 55013})
        self.caso["deuda_fija"]["porcentaje_compartido"] = "100"
        fila = simular(self.caso, self.escenario)["meses"][0]
        # Deuda común: 1700 * 2400 / (2400 + 1590).
        self.assertEqual(fila["asignacion_comunes_centimos_eur"], {"el": 102256, "ella": 67744})

    def test_proporcional_disponible_permite_una_base_cero_y_rechaza_negativa(self):
        self.caso["fin"] = self.caso["inicio"]
        self.escenario["regla"] = "proporcional_disponible"
        self.caso["ingresos"][0]["importe_eur"] = "200"
        fila = simular(self.caso, self.escenario)["meses"][0]
        self.assertEqual(fila["asignacion_comunes_centimos_eur"], {"el": 0, "ella": 150000})
        self.caso["ingresos"][0]["importe_eur"] = "199.99"
        with self.assertRaisesRegex(ValueError, "disponibilidades no negativas"):
            simular(self.caso, self.escenario)

    def test_es_ficticio_real_solo_si_se_habilita_explicitamente(self):
        self.caso["es_ficticio"] = False
        with self.assertRaisesRegex(ValueError, "es_ficticio"):
            simular(self.caso)
        self.assertFalse(simular(self.caso, solo_ficticio=False)["es_ficticio"])
        self.caso["es_ficticio"] = "false"
        with self.assertRaisesRegex(ValueError, "booleano"):
            simular(self.caso, solo_ficticio=False)

    def test_horizonte_admite_1_a_60_meses(self):
        for fin, cantidad in (("2026-11", 1), ("2031-10", 60)):
            self.caso["fin"] = fin
            self.assertEqual(len(simular(self.caso)["meses"]), cantidad)
        self.caso["fin"] = "2031-11"
        with self.assertRaisesRegex(ValueError, "1 a 60"):
            simular(self.caso)

    def test_porcentajes_invalidos_y_manual_sin_porcentaje_dan_error(self):
        for valor in ("-0.01", "100.01", "NaN", True, 12.5, [], None):
            with self.subTest(valor=valor):
                self.caso["ayuda"]["porcentaje_compartido"] = valor
                with self.assertRaisesRegex(ValueError, "porcentaje_compartido"):
                    simular(self.caso)
        del self.caso["ayuda"]["porcentaje_compartido"]
        self.escenario["regla"] = "manual"
        with self.assertRaisesRegex(ValueError, "porcentaje_el"):
            simular(self.caso, self.escenario)


class ServidorLocalTests(unittest.TestCase):
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

    def solicitud(self, metodo, ruta, datos=None, headers=None):
        conexion = http.client.HTTPConnection("127.0.0.1", self.servidor.server_port, timeout=5)
        cabeceras = {"Content-Type": "application/json"}
        cabeceras.update(headers or {})
        cuerpo = json.dumps(datos).encode("utf-8") if datos is not None else None
        try:
            conexion.request(metodo, ruta, body=cuerpo, headers=cabeceras)
            respuesta = conexion.getresponse()
            return respuesta.status, json.loads(respuesta.read())
        finally:
            conexion.close()

    def test_inicial_simulacion_real_y_sin_persistencia(self):
        estado, inicial = self.solicitud("GET", "/api/inicial")
        self.assertEqual(estado, 200)
        caso = inicial["caso"]
        caso["es_ficticio"] = False
        caso["personas"]["el"]["saldo_inicial_eur"] = "123.45"
        estado, resultado = self.solicitud("POST", "/api/simular", {"caso": caso, "escenario": inicial["escenario"]})
        self.assertEqual(estado, 200)
        self.assertFalse(resultado["es_ficticio"])
        self.assertEqual(resultado["totales"]["saldo_inicial_centimos_eur"]["el"], 12345)
        _, nuevo = self.solicitud("GET", "/api/inicial")
        original = cargar_caso()
        self.assertEqual(nuevo, migrar_plan({"caso": original, "escenario": original["escenarios"][0]}))

    def test_migrar_plan_antiguo_preserva_ediciones_y_referencia(self):
        caso = cargar_caso()
        datos = {"version": 1, "caso": caso, "escenario": caso["escenarios"][0]}
        datos["reference"] = copy.deepcopy(datos)
        caso["ingresos"][0]["importe_eur"] = "1234.56"
        estado, plan = self.solicitud("POST", "/api/migrar", datos)
        self.assertEqual(estado, 200)
        self.assertEqual(plan, migrar_plan(datos))
        estado, resultado = self.solicitud("POST", "/api/simular", plan)
        self.assertEqual(estado, 200)
        self.assertEqual(resultado["meses"][0]["ingresos_reales_centimos_eur"]["el"], 123456)
        referencia = next(m for m in plan["reference"]["caso"]["movimientos"] if m["id"] == "sueldo_inicial")
        self.assertEqual(referencia["importe"], "2600.00")

    def test_migrar_rechaza_un_plan_generico_invalido_sin_sustituirlo(self):
        _, plan = self.solicitud("GET", "/api/inicial")
        plan["caso"]["movimientos"][0]["importe"] = "-1"
        estado, error = self.solicitud("POST", "/api/migrar", plan)
        self.assertEqual(estado, 400)
        self.assertIsInstance(error["error"], str)

    def test_errores_de_usuario_devuelven_400_y_texto(self):
        for datos in ({}, [], {"caso": {}, "escenario": "A"}, {"caso": None, "escenario": "A"}):
            with self.subTest(datos=datos):
                estado, error = self.solicitud("POST", "/api/simular", datos)
                self.assertEqual(estado, 400)
                self.assertIsInstance(error["error"], str)

    def test_no_expone_repositorio_y_rechaza_host_u_origen_externo(self):
        for ruta in ("/README.md", "/ejemplos/caso_ficticio.json", "/../README.md", "/scripts/servidor.py"):
            estado, _ = self.solicitud("GET", ruta)
            self.assertEqual(estado, 404)
        for cabeceras in ({"Host": "sitio.example:8765"}, {"Origin": "https://sitio.example"}, {"Origin": "null"}):
            estado, _ = self.solicitud("GET", "/api/inicial", headers=cabeceras)
            self.assertEqual(estado, 403)


if __name__ == "__main__":
    unittest.main()
