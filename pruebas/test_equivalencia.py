"""La tasa única conserva el costo y el excedente mensual de cada persona."""

import copy
import json
import unittest
from fractions import Fraction

from scripts.modelo import PERSONAS, simular_plan


def movimiento(identificador, **cambios):
    registro = {"id": identificador, "concepto": identificador, "tipo": "gasto",
                "persona": "ella", "pagador": "ella", "importe": "100", "moneda": "EUR",
                "fecha": "2026-01-01", "modalidad": "unico"}
    registro.update(cambios)
    return registro


def caso(*movimientos, **cambios):
    valor = {"version": 2, "es_ficticio": True, "inicio": "2026-01", "fin": "2026-01",
             "clp_por_eur": "1000", "personas": {
                 "el": {"nombre": "Persona A", "saldo_inicial_eur": "0"},
                 "ella": {"nombre": "Persona B", "saldo_inicial_eur": "0"}},
             "movimientos": list(movimientos)}
    valor.update(cambios)
    return valor


def acuerdo(regla="proporcional_disponible", **cambios):
    valor = {"id": "prueba", "nombre": "Prueba", "regla": regla, "incluir_extra": True}
    valor.update(cambios)
    return valor


def tasa(reparto, campo, persona):
    valor = reparto[campo][persona]
    return Fraction(int(valor["numerador"]), int(valor["denominador"]))


def ingresos(a="2000", b="2000", **cambios):
    return [movimiento("ingreso_a", tipo="ingreso", persona="el", importe=a, **cambios),
            movimiento("ingreso_b", tipo="ingreso", persona="ella", importe=b, **cambios)]


class EquivalenciaTests(unittest.TestCase):
    def assert_equivalente(self, mes):
        reparto = mes["reparto_equivalente"]
        self.assertEqual(reparto["excedentes_originales_centimos_eur"], mes["flujo_libre_centimos_eur"])
        self.assertEqual(reparto["excedentes_equivalentes_centimos_eur"], mes["flujo_libre_centimos_eur"])
        self.assertEqual(reparto["costos_equivalentes_centimos_eur"], reparto["costos_originales_centimos_eur"])
        self.assertEqual(reparto["diferencia_centimos_eur"], {p: 0 for p in PERSONAS})
        self.assertEqual(sum(reparto["costos_originales_centimos_eur"].values()), reparto["total_gastos_centimos_eur"])
        if reparto["estado"] == "calculado":
            self.assertEqual(sum(tasa(reparto, "alpha_prima", p) for p in PERSONAS), 1)
            for persona in PERSONAS:
                self.assertEqual(tasa(reparto, "alpha_prima", persona) * reparto["total_gastos_centimos_eur"],
                                 reparto["costos_originales_centimos_eur"][persona])
        return reparto

    def test_proporcional_neto_se_convierte_a_una_tasa_sobre_todo_el_gasto(self):
        value = caso(*ingresos(), movimiento("previo", importe="1000"),
                     movimiento("comun", persona="compartido", importe="1500"))
        original = copy.deepcopy(value)
        mes = simular_plan(value, acuerdo())["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertEqual(reparto["base_reparto_centimos_eur"], {"el": 200000, "ella": 100000})
        self.assertEqual([tasa(reparto, "alpha", p) for p in PERSONAS], [Fraction(2, 3), Fraction(1, 3)])
        self.assertEqual([tasa(reparto, "alpha_prima", p) for p in PERSONAS], [Fraction(2, 5), Fraction(3, 5)])
        self.assertEqual(reparto["excedentes_originales_centimos_eur"], {"el": 100000, "ella": 50000})
        self.assertEqual(value, original)
        self.assertEqual(json.loads(json.dumps(mes))["reparto_equivalente"], reparto)

    def test_las_cinco_reglas_conservan_los_centimos_y_el_total(self):
        value = caso(*ingresos("2200", "1700"), movimiento("previo", importe="600.01"),
                     movimiento("fijo", persona="compartido", reparto="fijo", porcentaje_el="23.456", importe="321.09"),
                     movimiento("comun", persona="compartido", importe="1200.03"))
        for regla in ("mitades", "manual", "proporcional", "proporcional_disponible", "igualar"):
            with self.subTest(regla=regla):
                mes = simular_plan(value, acuerdo(regla, porcentaje_el="37.123"))["meses"][0]
                reparto = self.assert_equivalente(mes)
                self.assertEqual(reparto["gastos_previos_centimos_eur"], mes["pagos_personales_centimos_eur"])
                self.assertEqual(reparto["gastos_comunes_centimos_eur"], mes["gastos_comunes_centimos_eur"])
                self.assertEqual(reparto["total_gastos_centimos_eur"], mes["hogar"]["pagos_externos_centimos_eur"])

    def test_tasa_teorica_y_tasa_efectiva_distinguen_el_redondeo_a_centimos(self):
        mes = simular_plan(caso(movimiento("comun", persona="compartido", importe="1.01")), acuerdo("mitades"))["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertEqual(tasa(reparto, "alpha", "el"), Fraction(1, 2))
        self.assertEqual(tasa(reparto, "alpha_efectiva_comunes", "el"), Fraction(51, 101))
        self.assertEqual(tasa(reparto, "alpha_prima", "el"), Fraction(51, 101))
        self.assertEqual(reparto["costos_equivalentes_centimos_eur"], {"el": 51, "ella": 50})

    def test_clp_se_convierte_y_redondea_antes_de_obtener_la_tasa(self):
        mes = simular_plan(caso(*ingresos(), movimiento("previo", moneda="CLP", importe="300001"),
                               movimiento("comun", persona="compartido", moneda="CLP", importe="940001"),
                               clp_por_eur="1057.3141"), acuerdo())["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertEqual(reparto["total_gastos_centimos_eur"], sum(p["importe_centimos_eur"] for p in mes["pagos"]))
        self.assertTrue(all(type(v) is int for v in reparto["costos_equivalentes_centimos_eur"].values()))

    def test_extra_excluido_del_reparto_sigue_incluido_en_el_excedente(self):
        value = caso(*ingresos(), movimiento("extra", tipo="ingreso", importe="244", extra=True),
                     movimiento("previo", importe="300"), movimiento("comun", persona="compartido", importe="940"))
        mes = simular_plan(value, acuerdo(incluir_extra=False))["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertEqual(reparto["base_reparto_centimos_eur"], {"el": 200000, "ella": 170000})
        self.assertEqual(reparto["excedentes_originales_centimos_eur"]["ella"],
                         224400 - reparto["costos_originales_centimos_eur"]["ella"])

    def test_cada_mes_tiene_su_tasa_con_su_calendario(self):
        value = caso(*ingresos(modalidad="recurrente"),
                     movimiento("previo", importe="1000", modalidad="recurrente", hasta="2026-02-01"),
                     movimiento("comun", persona="compartido", importe="1500", modalidad="recurrente"), fin="2026-03")
        meses = simular_plan(value, acuerdo())["meses"]
        repartos = [self.assert_equivalente(mes) for mes in meses]
        self.assertEqual([tasa(r, "alpha_prima", "el") for r in repartos],
                         [Fraction(2, 5), Fraction(2, 5), Fraction(1, 2)])

    def test_sin_gastos_la_tasa_no_es_necesaria_y_el_excedente_es_el_ingreso(self):
        for regla in ("mitades", "manual", "proporcional", "proporcional_disponible"):
            with self.subTest(regla=regla):
                mes = simular_plan(caso(*ingresos()), acuerdo(regla, porcentaje_el="30"))["meses"][0]
                reparto = self.assert_equivalente(mes)
                self.assertEqual(reparto["estado"], "sin_gastos")
                self.assertIsNone(reparto["alpha_prima"])
                self.assertIsNone(reparto["alpha_efectiva_comunes"])
                self.assertEqual(reparto["excedentes_equivalentes_centimos_eur"], {"el": 200000, "ella": 200000})

    def test_cero_gastos_no_representa_la_transferencia_de_igualar_rentas(self):
        mes = simular_plan(caso(*ingresos("3000", "1000")), acuerdo("igualar"))["meses"][0]
        reparto = mes["reparto_equivalente"]
        self.assertEqual(reparto["estado"], "no_representable_sin_gastos")
        self.assertEqual(reparto["costos_originales_centimos_eur"], {"el": 100000, "ella": -100000})
        self.assertEqual(reparto["excedentes_originales_centimos_eur"], {"el": 200000, "ella": 200000})
        for campo in ("alpha", "alpha_prima", "alpha_efectiva_comunes", "costos_equivalentes_centimos_eur",
                      "excedentes_equivalentes_centimos_eur", "diferencia_centimos_eur"):
            self.assertIsNone(reparto[campo])

    def test_sin_base_ni_gasto_comun_la_asignacion_previa_tiene_tasa_equivalente(self):
        mes = simular_plan(caso(movimiento("previo", importe="100")), acuerdo())["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertEqual(reparto["estado"], "calculado")
        self.assertIsNone(reparto["alpha"])
        self.assertEqual([tasa(reparto, "alpha_prima", p) for p in PERSONAS], [0, 1])

    def test_deficit_familiar_conserva_excedentes_negativos(self):
        mes = simular_plan(caso(*ingresos("100", "100"), movimiento("comun", persona="compartido", importe="300")),
                           acuerdo())["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertEqual(reparto["excedentes_equivalentes_centimos_eur"], {"el": -5000, "ella": -5000})

    def test_igualar_puede_necesitar_tasas_fuera_del_intervalo_cero_uno(self):
        mes = simular_plan(caso(*ingresos("3000", "1000"), movimiento("comun", persona="compartido", importe="100")),
                           acuerdo("igualar"))["meses"][0]
        reparto = self.assert_equivalente(mes)
        self.assertTrue(reparto["tasas_fuera_de_rango"])
        self.assertEqual([tasa(reparto, "alpha_prima", p) for p in PERSONAS], [Fraction(21, 2), Fraction(-19, 2)])

    def test_comisiones_de_conversion_se_incluyen_una_vez_y_no_son_una_transferencia(self):
        cuentas = [{"id": "eur", "nombre": "EUR", "titular": "ella", "moneda": "EUR", "saldo_inicial": "1000"},
                   {"id": "clp", "nombre": "CLP", "titular": "ella", "moneda": "CLP", "saldo_inicial": "0"}]
        transferencia = {"id": "cambio", "concepto": "Cambio", "origen": "eur", "destino": "clp",
                         "importe": "300", "fecha": "2026-01-02", "modalidad": "unico"}
        value = caso(*ingresos(), movimiento("comun", persona="compartido", importe="940"),
                     cuentas=cuentas, transferencias=[transferencia])
        for comision in ("0", "5"):
            with self.subTest(comision=comision):
                value["comision_cambio_eur"] = comision
                mes = simular_plan(value, acuerdo())["meses"][0]
                reparto = self.assert_equivalente(mes)
                self.assertEqual(reparto["total_gastos_centimos_eur"], 94000 + int(comision) * 100)
                self.assertEqual(reparto["gastos_previos_centimos_eur"], {"el": 0, "ella": int(comision) * 100})

    def test_revalorizacion_y_ahorro_previo_no_forman_parte_del_excedente(self):
        value = caso(fin="2026-02", clp_por_eur={"2026-01": "1000", "2026-02": "2000"},
                     cuentas=[{"id": "clp", "nombre": "CLP", "titular": "el", "moneda": "CLP", "saldo_inicial": "100000"}])
        value["personas"]["ella"]["saldo_inicial_eur"] = "50"
        resultado = simular_plan(value, acuerdo())
        for mes in resultado["meses"]:
            reparto = self.assert_equivalente(mes)
            self.assertEqual(reparto["excedentes_originales_centimos_eur"], {"el": 0, "ella": 0})
        self.assertEqual(resultado["meses"][1]["ajuste_cuentas_centimos_eur"], {"el": -5000, "ella": 0})


if __name__ == "__main__":
    unittest.main()
