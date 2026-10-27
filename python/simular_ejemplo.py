#!/usr/bin/env python3
"""Motor de simulación mensual y ejemplo reproducible del repositorio.

No calcula prestaciones legales ni administra cuentas reales. Los importes EUR
se guardan como céntimos enteros; los CLP, como pesos enteros. Las compras de CLP
se proyectan explícitamente al tipo de cambio de cada mes, sin comisiones.
"""

import argparse
import json
import re
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from pathlib import Path


PERSONAS = ("el", "ella")
CASO_PREDETERMINADO = Path(__file__).resolve().parents[1] / "ejemplos" / "caso_ficticio.json"


def _mes_indice(mes):
    if not isinstance(mes, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes):
        raise ValueError("Mes inválido: se requiere YYYY-MM, recibido {!r}".format(mes))
    ano, numero = map(int, mes.split("-"))
    if ano < 1:
        raise ValueError("El año debe ser positivo")
    return ano * 12 + numero - 1


def _mes_texto(indice):
    ano, mes = divmod(indice, 12)
    return "{:04d}-{:02d}".format(ano, mes + 1)


def _meses(inicio, fin):
    return [_mes_texto(i) for i in range(_mes_indice(inicio), _mes_indice(fin) + 1)]


def _decimal(valor, campo):
    if isinstance(valor, bool) or not isinstance(valor, (str, int, Decimal)):
        raise ValueError("{} debe ser un número decimal en texto o un entero".format(campo))
    try:
        numero = Decimal(valor)
    except InvalidOperation:
        raise ValueError("{} no es un decimal válido".format(campo)) from None
    if not numero.is_finite():
        raise ValueError("{} debe ser finito".format(campo))
    return numero


def _centimos(valor, campo, permitir_negativo=False):
    numero = _decimal(valor, campo) * 100
    if numero != numero.to_integral_value():
        raise ValueError("{} admite como máximo dos decimales EUR".format(campo))
    if numero < 0 and not permitir_negativo:
        raise ValueError("{} no puede ser negativo".format(campo))
    return int(numero)


def _entero(valor, campo, minimo=0, maximo=None):
    if type(valor) is not int or valor < minimo or (maximo is not None and valor > maximo):
        limite = " y como máximo {}".format(maximo) if maximo is not None else ""
        raise ValueError("{} debe ser entero, como mínimo {}{}".format(campo, minimo, limite))
    return valor


def _redondear(fraccion):
    """Entero más próximo; una mitad exacta se aleja de cero."""
    signo = -1 if fraccion < 0 else 1
    fraccion = abs(fraccion)
    return signo * ((2 * fraccion.numerator + fraccion.denominator) // (2 * fraccion.denominator))


def cuotas_clp(importe, cantidad):
    """Cuotas en pesos enteros; la última absorbe el resto, sin perder pesos."""
    _entero(importe, "importe_clp")
    _entero(cantidad, "cuotas", minimo=1, maximo=12)
    base, resto = divmod(importe, cantidad)
    return [base] * (cantidad - 1) + [base + resto]


def _persona(valor, campo):
    if valor not in PERSONAS:
        raise ValueError("{} debe ser 'el' o 'ella'".format(campo))


def _periodo(elemento, campo):
    if _mes_indice(elemento["desde"]) > _mes_indice(elemento["hasta"]):
        raise ValueError("{}: desde debe ser anterior o igual a hasta".format(campo))


def _vigente(elemento, mes):
    return elemento["desde"] <= mes <= elemento["hasta"]


def _fx(caso, mes):
    valor = caso["clp_por_eur"]
    if isinstance(valor, dict):
        if mes not in valor:
            raise ValueError("Falta clp_por_eur para {}".format(mes))
        valor = valor[mes]
    numero = _decimal(valor, "clp_por_eur de " + mes)
    if numero <= 0:
        raise ValueError("clp_por_eur debe ser estrictamente positivo en " + mes)
    return numero


def _porcentaje(valor, campo="porcentaje_compartido"):
    numero = _decimal(valor, campo)
    if not 0 <= numero <= 100:
        raise ValueError("{} debe estar entre 0 y 100".format(campo))
    return numero


def _validar(caso, solo_ficticio=True):
    if not isinstance(caso, dict):
        raise ValueError("caso debe ser un objeto")
    if type(caso.get("es_ficticio")) is not bool:
        raise ValueError("es_ficticio debe ser booleano")
    if solo_ficticio and caso["es_ficticio"] is not True:
        raise ValueError("Esta maqueta solo acepta un caso con es_ficticio: true")
    requeridos = ("inicio", "fin", "clp_por_eur", "personas", "ingresos", "gastos", "deuda_fija", "ayuda", "facturas", "escenarios")
    for campo in requeridos:
        if campo not in caso:
            raise ValueError("Falta el campo " + campo)
    duracion = _mes_indice(caso["fin"]) - _mes_indice(caso["inicio"]) + 1
    if duracion < 1:
        raise ValueError("inicio debe ser anterior o igual a fin")
    if duracion > 60:
        raise ValueError("El horizonte debe ser de 1 a 60 meses")
    if not isinstance(caso["personas"], dict) or set(caso["personas"]) != set(PERSONAS):
        raise ValueError("personas debe contener exactamente el y ella")
    for persona in PERSONAS:
        datos = caso["personas"][persona]
        if not isinstance(datos, dict) or "saldo_inicial_eur" not in datos:
            raise ValueError("Falta saldo_inicial_eur de " + persona)
        _centimos(datos["saldo_inicial_eur"], "saldo_inicial_eur", permitir_negativo=True)
    for mes in _meses(caso["inicio"], caso["fin"]):
        _fx(caso, mes)
    for campo in ("ingresos", "gastos", "facturas", "escenarios"):
        if not isinstance(caso[campo], list):
            raise ValueError(campo + " debe ser una lista")
        identificadores = []
        for elemento in caso[campo]:
            if not isinstance(elemento, dict) or not isinstance(elemento.get("id"), str) or not elemento["id"]:
                raise ValueError(campo + " requiere objetos con id de texto no vacío")
            identificadores.append(elemento["id"])
        if len(set(identificadores)) != len(identificadores):
            raise ValueError("Hay id duplicados en " + campo)
    try:
        for ingreso in caso["ingresos"]:
            _persona(ingreso["persona"], "persona de ingreso")
            _centimos(ingreso["importe_eur"], "importe_eur de ingreso")
            _periodo(ingreso, "ingreso " + ingreso["id"])
            if type(ingreso["extra"]) is not bool:
                raise ValueError("extra debe ser booleano")
        for gasto in caso["gastos"]:
            _persona(gasto["pagador"], "pagador del gasto")
            _centimos(gasto["importe_eur"], "importe_eur de gasto")
            _periodo(gasto, "gasto " + gasto["id"])
            if gasto["tipo"] not in ("personal", "comun"):
                raise ValueError("tipo de gasto debe ser personal o comun")
        deuda = caso["deuda_fija"]
        if not isinstance(deuda, dict):
            raise ValueError("deuda_fija debe ser un objeto")
        _persona(deuda["persona"], "persona de deuda_fija")
        _entero(deuda["cuota_clp"], "cuota_clp")
        _entero(deuda["cuotas_totales"], "cuotas_totales", minimo=1)
        _entero(deuda["cuotas_pagadas"], "cuotas_pagadas", maximo=deuda["cuotas_totales"])
        _mes_indice(deuda["proxima_cuota"])
        ayuda = caso["ayuda"]
        if not isinstance(ayuda, dict):
            raise ValueError("ayuda debe ser un objeto")
        _persona(ayuda["persona"], "persona de ayuda")
        _entero(ayuda["importe_clp"], "importe_clp de ayuda")
        _periodo(ayuda, "ayuda")
        for factura in caso["facturas"]:
            _persona(factura["persona"], "persona de factura")
            cuotas_clp(factura["importe_clp"], factura["cuotas"])
            _mes_indice(factura["primera_cuota"])
        for nombre, elemento in [("deuda_fija", deuda), ("ayuda", ayuda)] + [("factura", f) for f in caso["facturas"]]:
            if not isinstance(elemento.get("id"), str) or not elemento["id"]:
                raise ValueError(nombre + " requiere un id de texto no vacío")
            if "porcentaje_compartido" in elemento:
                _porcentaje(elemento["porcentaje_compartido"])
    except KeyError as error:
        raise ValueError("Falta el campo {} en un registro".format(error.args[0])) from None


def cargar_caso(ruta=CASO_PREDETERMINADO):
    """Lee y valida el JSON ficticio; no modifica el archivo ni el objeto."""
    with Path(ruta).open(encoding="utf-8") as archivo:
        caso = json.load(archivo)
    _validar(caso)
    return caso


def _elegir_escenario(caso, escenario):
    if isinstance(escenario, str):
        coincidencias = [e for e in caso["escenarios"] if e["id"] == escenario]
        if not coincidencias:
            raise ValueError("Escenario desconocido: " + escenario)
        escenario = coincidencias[0]
    if not isinstance(escenario, dict):
        raise ValueError("escenario debe ser un id o un objeto de escenario")
    for campo in ("id", "nombre", "regla", "incluir_extra", "universidad_compartida"):
        if campo not in escenario:
            raise ValueError("Falta {} en escenario".format(campo))
    if escenario["regla"] not in ("mitades", "proporcional", "proporcional_disponible", "manual", "igualar"):
        raise ValueError("regla debe ser mitades, proporcional, proporcional_disponible, manual o igualar")
    for campo in ("id", "nombre"):
        if not isinstance(escenario[campo], str) or not escenario[campo]:
            raise ValueError(campo + " de escenario debe ser texto no vacío")
    if escenario["regla"] == "manual":
        if "porcentaje_el" not in escenario:
            raise ValueError("La regla manual requiere porcentaje_el")
        _porcentaje(escenario["porcentaje_el"], "porcentaje_el")
    for campo in ("incluir_extra", "universidad_compartida"):
        if type(escenario[campo]) is not bool:
            raise ValueError(campo + " debe ser booleano")
    if "cuotas_universidad" in escenario:
        _entero(escenario["cuotas_universidad"], "cuotas_universidad", minimo=1, maximo=12)
    if "sustituir_chomage_por_eur" in escenario:
        _centimos(escenario["sustituir_chomage_por_eur"], "sustituir_chomage_por_eur")
        if not any(i["id"] == "chomage" for i in caso["ingresos"]):
            raise ValueError("La sustitución de chômage requiere el ingreso con id chomage")
    return dict(escenario)


def _cero():
    return {persona: 0 for persona in PERSONAS}


def _planes_facturas(caso, escenario):
    planes = []
    for factura in caso["facturas"]:
        cantidad = escenario.get("cuotas_universidad", factura["cuotas"])
        inicio = _mes_indice(factura["primera_cuota"])
        pagos = {_mes_texto(inicio + i): valor for i, valor in enumerate(cuotas_clp(factura["importe_clp"], cantidad))}
        planes.append((factura, pagos))
    return planes


def simular(caso, escenario="A", solo_ficticio=True):
    """Devuelve meses, totales y compromisos futuros serializables como JSON.

    Cada pago CLP genera una compra prevista de esa moneda. Se convierte con
    Fraction y se redondea una vez a céntimos EUR. El reparto redondea el aporte
    de él y asigna a ella el resto; las compensaciones conservan el total hogar.
    """
    _validar(caso, solo_ficticio=solo_ficticio)
    escenario = _elegir_escenario(caso, escenario)
    planes = _planes_facturas(caso, escenario)
    saldos = {p: _centimos(caso["personas"][p]["saldo_inicial_eur"], "saldo_inicial_eur", True) for p in PERSONAS}
    saldos_iniciales = dict(saldos)
    meses = []
    deuda = caso["deuda_fija"]
    cuotas_deuda = deuda["cuotas_totales"] - deuda["cuotas_pagadas"]
    primer_mes_deuda = _mes_indice(deuda["proxima_cuota"])
    for mes in _meses(caso["inicio"], caso["fin"]):
        tipo_cambio = _fx(caso, mes)
        reales, considerados = _cero(), _cero()
        for ingreso in caso["ingresos"]:
            if not _vigente(ingreso, mes):
                continue
            importe = ingreso["importe_eur"]
            if ingreso["id"] == "chomage" and "sustituir_chomage_por_eur" in escenario:
                importe = escenario["sustituir_chomage_por_eur"]
            importe = _centimos(importe, "ingreso")
            persona = ingreso["persona"]
            reales[persona] += importe
            if escenario["incluir_extra"] or not ingreso["extra"]:
                considerados[persona] += importe
        pagos = []

        def agregar_pago(identificador, tipo, pagador, importe, moneda, porcentaje=0):
            equivalente = importe if moneda == "EUR" else _redondear(Fraction(importe * 100) / Fraction(tipo_cambio))
            porcentaje = _porcentaje(porcentaje)
            parte_comun = _redondear(Fraction(equivalente) * Fraction(porcentaje) / 100)
            pagos.append({"id": identificador, "tipo": tipo, "pagador": pagador,
                          "importe_original": importe, "moneda_original": moneda,
                          "importe_centimos_eur": equivalente, "comun": porcentaje > 0,
                          "porcentaje_compartido": str(porcentaje),
                          "importe_comun_centimos_eur": parte_comun,
                          "importe_personal_centimos_eur": equivalente - parte_comun})

        for gasto in caso["gastos"]:
            if _vigente(gasto, mes):
                agregar_pago(gasto["id"], "gasto", gasto["pagador"], _centimos(gasto["importe_eur"], "gasto"), "EUR", 100 if gasto["tipo"] == "comun" else 0)
        posicion_deuda = _mes_indice(mes) - primer_mes_deuda
        if 0 <= posicion_deuda < cuotas_deuda:
            agregar_pago(deuda["id"], "deuda_fija", deuda["persona"], deuda["cuota_clp"], "CLP", deuda.get("porcentaje_compartido", 0))
        ayuda = caso["ayuda"]
        if _vigente(ayuda, mes):
            agregar_pago(ayuda["id"], "ayuda", ayuda["persona"], ayuda["importe_clp"], "CLP", ayuda.get("porcentaje_compartido", 0))
        for factura, calendario in planes:
            if mes in calendario:
                porcentaje = factura.get("porcentaje_compartido", 100 if escenario["universidad_compartida"] else 0)
                agregar_pago(factura["id"], "universidad", factura["persona"], calendario[mes], "CLP", porcentaje)
        personales, externos, compras_clp, coste_compras_clp = _cero(), _cero(), _cero(), _cero()
        comunes = 0
        for pago in pagos:
            persona, importe = pago["pagador"], pago["importe_centimos_eur"]
            externos[persona] += importe
            comunes += pago["importe_comun_centimos_eur"]
            personales[persona] += pago["importe_personal_centimos_eur"]
            if pago["moneda_original"] == "CLP":
                compras_clp[persona] += pago["importe_original"]
                coste_compras_clp[persona] += importe
        if escenario["regla"] == "mitades":
            aporte_el = Fraction(comunes, 2)
        elif escenario["regla"] == "manual":
            aporte_el = Fraction(comunes) * Fraction(_porcentaje(escenario["porcentaje_el"], "porcentaje_el")) / 100
        elif escenario["regla"] == "proporcional":
            base = sum(considerados.values())
            if base <= 0:
                raise ValueError("{}: proporcional requiere una base total de ingresos positiva".format(mes))
            aporte_el = Fraction(comunes * considerados["el"], base)
        elif escenario["regla"] == "proporcional_disponible":
            disponibles = {p: considerados[p] - personales[p] for p in PERSONAS}
            if any(valor < 0 for valor in disponibles.values()) or sum(disponibles.values()) <= 0:
                raise ValueError("{}: proporcional_disponible requiere disponibilidades no negativas y una base total positiva; cambia la regla o los ingresos/gastos personales".format(mes))
            aporte_el = Fraction(comunes * disponibles["el"], sum(disponibles.values()))
        else:
            disponibilidad_el = considerados["el"] - personales["el"]
            disponibilidad_ella = considerados["ella"] - personales["ella"]
            aporte_el = Fraction(comunes + disponibilidad_el - disponibilidad_ella, 2)
        aporte_el = _redondear(aporte_el)
        asignacion = {"el": aporte_el, "ella": comunes - aporte_el}
        compensacion = {p: externos[p] - personales[p] - asignacion[p] for p in PERSONAS}
        flujo = {p: reales[p] - externos[p] + compensacion[p] for p in PERSONAS}
        saldo_anterior = dict(saldos)
        saldos = {p: saldos[p] + flujo[p] for p in PERSONAS}
        fila = {"mes": mes, "clp_por_eur": str(tipo_cambio),
                "ingresos_reales_centimos_eur": reales, "ingresos_considerados_centimos_eur": considerados,
                "pagos_personales_centimos_eur": personales, "gastos_comunes_centimos_eur": comunes,
                "asignacion_comunes_centimos_eur": asignacion, "pagos_externos_centimos_eur": externos,
                "compensacion_neta_centimos_eur": compensacion, "flujo_libre_centimos_eur": flujo,
                "saldo_inicial_centimos_eur": saldo_anterior, "saldo_final_centimos_eur": dict(saldos),
                "clp_comprados": compras_clp, "coste_compra_clp_centimos_eur": coste_compras_clp,
                "necesita_financiacion": {p: saldos[p] < 0 for p in PERSONAS}, "pagos": pagos}
        for tipo in ("universidad", "ayuda", "deuda_fija"):
            seleccion = [pago for pago in pagos if pago["tipo"] == tipo]
            fila[tipo + "_clp"] = sum(pago["importe_original"] for pago in seleccion)
            fila[tipo + "_centimos_eur"] = sum(pago["importe_centimos_eur"] for pago in seleccion)
        fila["hogar"] = {campo: sum(fila[campo].values()) for campo in (
            "ingresos_reales_centimos_eur", "pagos_externos_centimos_eur", "flujo_libre_centimos_eur", "saldo_final_centimos_eur")}
        meses.append(fila)
    totales = {}
    for campo in ("ingresos_reales_centimos_eur", "ingresos_considerados_centimos_eur", "pagos_personales_centimos_eur",
                  "asignacion_comunes_centimos_eur", "pagos_externos_centimos_eur", "compensacion_neta_centimos_eur",
                  "flujo_libre_centimos_eur", "clp_comprados", "coste_compra_clp_centimos_eur"):
        totales[campo] = {p: sum(fila[campo][p] for fila in meses) for p in PERSONAS}
    for tipo in ("universidad", "ayuda", "deuda_fija"):
        totales[tipo + "_clp"] = sum(fila[tipo + "_clp"] for fila in meses)
    totales["saldo_inicial_centimos_eur"] = saldos_iniciales
    totales["saldo_final_centimos_eur"] = dict(saldos)
    totales["hogar"] = {campo: sum(totales[campo].values()) for campo in (
        "ingresos_reales_centimos_eur", "pagos_externos_centimos_eur", "flujo_libre_centimos_eur", "saldo_inicial_centimos_eur", "saldo_final_centimos_eur")}
    fin = caso["fin"]
    futuras_universidad = [{"id": factura["id"], "cuotas_pendientes": sum(mes > fin for mes in calendario),
                           "pendiente_clp": sum(importe for mes, importe in calendario.items() if mes > fin)}
                          for factura, calendario in planes]
    pendientes_fijas = max(0, cuotas_deuda - max(0, _mes_indice(fin) - primer_mes_deuda + 1))
    compromisos = {
        "universidad": {"pendiente_clp": sum(f["pendiente_clp"] for f in futuras_universidad),
                        "cuotas_pendientes": sum(f["cuotas_pendientes"] for f in futuras_universidad),
                        "por_factura": futuras_universidad},
        "deuda_fija": {"cuotas_pendientes": pendientes_fijas,
                       "suma_cuotas_pendientes_clp": pendientes_fijas * deuda["cuota_clp"],
                       "capital_pendiente": None,
                       "nota": "Suma nominal de cuotas futuras; no es capital pendiente."},
        "ayuda": {"pagos_pendientes": max(0, _mes_indice(ayuda["hasta"]) - max(_mes_indice(fin), _mes_indice(ayuda["desde"]) - 1))}
    }
    compromisos["ayuda"]["pendiente_clp"] = compromisos["ayuda"]["pagos_pendientes"] * ayuda["importe_clp"]
    return {"es_ficticio": caso["es_ficticio"], "escenario": escenario, "unidad_eur": "centimos_enteros",
            "inicio": caso["inicio"], "fin": fin,
            "conversion": "Saldo inicial CLP cero. Compra prevista de cada pago CLP con EUR al tipo de su mes, sin comisiones. Compensaciones EUR.",
            "meses": meses, "totales": totales, "compromisos_fuera_horizonte": compromisos}


def _eur(centimos):
    signo = "−" if centimos < 0 else ""
    entero, resto = divmod(abs(centimos), 100)
    return "{}{},{}".format(signo, format(entero, ",").replace(",", "."), str(resto).zfill(2))


def _clp(importe):
    return format(importe, ",").replace(",", ".")


def generar_markdown(caso, resultados):
    """Informe explicativo del caso: evidencia para discutir el funcionamiento."""
    lineas = ["# Ejercicio de funcionamiento con datos ficticios", "",
              "**Todos los importes, fechas y tipos de cambio de este ejercicio son ficticios.** No representan las finanzas reales de la pareja, una cotización vigente ni el derecho o importe legal del chômage.", "",
              "Este documento se genera con `python3 scripts/simular_ejemplo.py --markdown`. Presenta el caso de prueba que acompaña al simulador interactivo local, disponible al ejecutar `python3 scripts/servidor.py`.", "",
              "## Supuestos del ejercicio", "",
              "- Período: {} a {}, ambos incluidos; cierre mensual y saldos iniciales anteriores al primer mes.".format(caso["inicio"], caso["fin"]),
              "- Saldo inicial: él {} EUR; ella {} EUR; ambos parten con 0 CLP.".format(*[_eur(_centimos(caso["personas"][p]["saldo_inicial_eur"], "saldo", True)) for p in PERSONAS]),
              "- Cada pago CLP se financia mediante una compra prevista de CLP con EUR al tipo explícito de su mes, sin comisiones. Los registros identifican pagador, moneda original e importe convertido.",
              "- Los importes EUR internos son céntimos enteros; los CLP son pesos enteros. El redondeo mensual asigna el aporte de él al céntimo más próximo y a ella el resto, conservando el total; una mitad exacta se redondea alejándose de cero.",
              "- Las facturas comienzan a pagarse en el mes configurado; aquí los meses de primera cuota están separados por dos meses. No se descuenta también el importe completo de cada factura.",
              "- Cada cuota CLP se convierte y redondea una vez. Por ello la suma de sus equivalentes EUR puede diferir algún céntimo de convertir el agregado CLP una sola vez.", ""]
    tipos = ["{}: {} CLP/EUR".format(m, _fx(caso, m)) for m in _meses(caso["inicio"], caso["fin"])]
    if len(set(str(_fx(caso, m)) for m in _meses(caso["inicio"], caso["fin"]))) == 1:
        lineas.append("Tipo de cambio ficticio constante: **1 EUR = {} CLP**.".format(_fx(caso, caso["inicio"])))
    else:
        lineas.append("Tipos de cambio ficticios por mes: " + "; ".join(tipos) + ".")
    lineas += ["", "| Ingreso | Persona | Neto mensual EUR | Desde | Hasta | Extra |",
               "| --- | --- | ---: | --- | --- | --- |"]
    for ingreso in caso["ingresos"]:
        lineas.append("| {} | {} | {} | {} | {} | {} |".format(ingreso["id"], ingreso["persona"], _eur(_centimos(ingreso["importe_eur"], "ingreso")), ingreso["desde"], ingreso["hasta"], "Sí" if ingreso["extra"] else "No"))
    lineas += ["", "La fuente denominada chômage usa un importe supuesto aportado al ejemplo. El escenario H sustituye esa fuente durante sus mismas fechas; no suma sueldo y prestación.", "",
               "| Gasto EUR | Pagador | Carácter | Mensual EUR | Desde | Hasta |", "| --- | --- | --- | ---: | --- | --- |"]
    for gasto in caso["gastos"]:
        lineas.append("| {} | {} | {} | {} | {} | {} |".format(gasto["id"], gasto["pagador"], gasto["tipo"], _eur(_centimos(gasto["importe_eur"], "gasto")), gasto["desde"], gasto["hasta"]))
    deuda, ayuda = caso["deuda_fija"], caso["ayuda"]
    lineas += ["", "- Deuda fija de {}: {} cuotas totales; {} ya pagadas; {} por pagar desde {}; cuota de {} CLP. No se infiere capital ni interés a partir de las cuotas.".format(deuda["persona"], deuda["cuotas_totales"], deuda["cuotas_pagadas"], deuda["cuotas_totales"] - deuda["cuotas_pagadas"], deuda["proxima_cuota"], _clp(deuda["cuota_clp"])),
               "- Ayuda personal a la hermana: {} paga {} CLP cada mes, de {} a {}, **incluido el último mes**.".format(ayuda["persona"], _clp(ayuda["importe_clp"]), ayuda["desde"], ayuda["hasta"]), "",
               "| Factura | Titular y pagador | Importe CLP | Primera cuota | Cuotas base |", "| --- | --- | ---: | --- | ---: |"]
    for factura in caso["facturas"]:
        lineas.append("| {} | {} | {} | {} | {} |".format(factura["id"], factura["persona"], _clp(factura["importe_clp"]), factura["primera_cuota"], factura["cuotas"]))
    lineas += ["", "## Escenarios comparados", "", "| Id | Acuerdo |", "| --- | --- |"]
    for resultado in resultados:
        escenario = resultado["escenario"]
        lineas.append("| {} | {} |".format(escenario["id"], escenario["nombre"]))
    lineas += ["", "A-F conservan ingresos y pagos externos: cambia quién asume sus costos. En B ella sigue pagando a la universidad y la parte compartida entra una sola vez al reparto. G adelanta pagos universitarios; H cambia los ingresos de enero a marzo.", "",
               "En la regla proporcional se usan los ingresos considerados, sin descontar obligaciones personales. Para igualar disponibilidad considerada se define `D = ingresos considerados − pagos personales` y `aporte de él = (comunes + D de él − D de ella) / 2`. Un aporte negativo es posible y representa apoyo adicional entre ambos.", "",
               "Excluir extras cambia únicamente la base del acuerdo: esos ingresos siempre llegan al saldo. E iguala el flujo libre real; F iguala el margen calculado sin los extras y protege esos ingresos. Esto no iguala los saldos acumulados iniciales.", "",
               "Aunque una deuda conserve su titular y pago personal, descontarla antes de igualar disponibilidades cambia los aportes comunes. Por tanto, esa regla redistribuye indirectamente su efecto económico entre ambos; debe ser un acuerdo consciente.", ""]
    base = next((r for r in resultados if r["escenario"]["id"] == "A"), resultados[0])
    primer_mes = base["meses"][0]
    lineas += ["## Un mes explicado", "",
               "Escenario {}, {}. En los datos él paga los gastos del hogar a terceros; cada uno paga sus conceptos personales. La compensación ajusta quién termina asumiendo el costo del acuerdo. Recibir una compensación no crea un nuevo ingreso para el hogar.".format(base["escenario"]["id"], primer_mes["mes"]), "",
               "| Concepto EUR | Él | Ella |", "| --- | ---: | ---: |"]
    for etiqueta, campo in (("Ingresos recibidos", "ingresos_reales_centimos_eur"),
                            ("Pagado a terceros", "pagos_externos_centimos_eur")):
        lineas.append("| {} | {} | {} |".format(etiqueta, *[_eur(primer_mes[campo][p]) for p in PERSONAS]))
    costos = {p: primer_mes["pagos_personales_centimos_eur"][p] + primer_mes["asignacion_comunes_centimos_eur"][p] for p in PERSONAS}
    lineas.append("| Costo asumido: personal + común asignado | {} | {} |".format(*[_eur(costos[p]) for p in PERSONAS]))
    for etiqueta, campo in (("Compensación neta: recibido menos enviado", "compensacion_neta_centimos_eur"),
                            ("Flujo libre del mes", "flujo_libre_centimos_eur"),
                            ("Saldo inicial", "saldo_inicial_centimos_eur"),
                            ("Saldo final", "saldo_final_centimos_eur")):
        lineas.append("| {} | {} | {} |".format(etiqueta, *[_eur(primer_mes[campo][p]) for p in PERSONAS]))
    lineas += ["", "`Flujo libre = ingresos − pagos a terceros + compensación = ingresos − costo asumido`. Las compensaciones de ambos suman cero.", "",
               "## Comparación de meses representativos", "", "Cada celda muestra **flujo libre de él / flujo libre de ella**, en EUR, antes de reservar ahorro.", ""]
    meses_disponibles = [fila["mes"] for fila in resultados[0]["meses"]]
    representativos = [meses_disponibles[i] for i in (0, 2, 4, 5) if i < len(meses_disponibles)]
    lineas += ["| Escenario | " + " | ".join(representativos) + " |", "| --- | " + " | ".join("---:" for _ in representativos) + " |"]
    for resultado in resultados:
        por_mes = {fila["mes"]: fila for fila in resultado["meses"]}
        celdas = ["{} / {}".format(*[_eur(por_mes[mes]["flujo_libre_centimos_eur"][p]) for p in PERSONAS]) for mes in representativos]
        lineas.append("| {} | {} |".format(resultado["escenario"]["id"], " | ".join(celdas)))
    lineas += ["", "## Recorrido mensual del escenario {}".format(base["escenario"]["id"]), "",
               "Importes en EUR salvo universidad y ayuda, que se muestran en CLP. La compensación de él es **positiva si recibe** dinero; la de ella tiene igual importe y signo contrario. La deuda fija se incluye en los pagos y flujos, aunque no tiene columna propia.", "",
               "| Mes | Ingreso él | Ingreso ella | Univ. CLP | Ayuda CLP | Comp. él | Libre él | Libre ella | Saldo él | Saldo ella |",
               "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for fila in base["meses"]:
        celdas = [fila["mes"], _eur(fila["ingresos_reales_centimos_eur"]["el"]), _eur(fila["ingresos_reales_centimos_eur"]["ella"]),
                  _clp(fila["universidad_clp"]), _clp(fila["ayuda_clp"]), _eur(fila["compensacion_neta_centimos_eur"]["el"]),
                  _eur(fila["flujo_libre_centimos_eur"]["el"]), _eur(fila["flujo_libre_centimos_eur"]["ella"]),
                  _eur(fila["saldo_final_centimos_eur"]["el"]), _eur(fila["saldo_final_centimos_eur"]["ella"])]
        lineas.append("| " + " | ".join(celdas) + " |")
    lineas += ["", "## Cierre y obligaciones posteriores al horizonte", "",
               "| Escenario | Saldo él EUR | Saldo ella EUR | Saldo hogar EUR | Universidad pagada CLP | Universidad futura CLP | Cuotas fijas futuras | Suma nominal fija futura CLP |",
               "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for resultado in resultados:
        totales = resultado["totales"]
        futuros = resultado["compromisos_fuera_horizonte"]
        lineas.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(resultado["escenario"]["id"],
            _eur(totales["saldo_final_centimos_eur"]["el"]), _eur(totales["saldo_final_centimos_eur"]["ella"]),
            _eur(totales["hogar"]["saldo_final_centimos_eur"]), _clp(totales["universidad_clp"]), _clp(futuros["universidad"]["pendiente_clp"]),
            futuros["deuda_fija"]["cuotas_pendientes"], _clp(futuros["deuda_fija"]["suma_cuotas_pendientes_clp"])))
    hogar = base["totales"]["hogar"]
    lineas += ["", "En {}: ingresos del hogar {} EUR; pagos a terceros {} EUR; flujo libre acumulado {} EUR; saldo inicial {} EUR y saldo final {} EUR. Las transferencias entre ustedes se cancelan al sumar el hogar.".format(base["escenario"]["id"], *[_eur(hogar[c]) for c in ("ingresos_reales_centimos_eur", "pagos_externos_centimos_eur", "flujo_libre_centimos_eur", "saldo_inicial_centimos_eur", "saldo_final_centimos_eur")]), "",
               "## Qué permite comprobar y qué queda pendiente", "",
               "- Cambiar el reparto redistribuye el dinero libre individual. No crea recursos para el hogar. Un aporte negativo bajo la regla de igualdad exige una transferencia adicional y podría consumir saldos previos.",
               "- Pagar en menos cuotas cambia el calendario: un cierre menor puede acompañarse de menos obligaciones futuras. La suma de cuotas fijas pendientes es un compromiso nominal, **no capital pendiente**. Los compromisos futuros permanecen en CLP; no se les aplica una cotización futura inventada.",
               "- Los saldos acumulan cada flujo mensual. Un flujo negativo consume saldo previo; un saldo final negativo marca necesidad de financiación, sin agregar crédito automático. La igualdad de flujo puede diferir en un céntimo cuando el total no admite división exacta.",
               "- Este es flujo libre **antes de ahorro**: todavía no se modelan reservas, metas ni aportes posibles de ahorro. El saldo acumulado no es una recomendación de cuánto gastar: quedan compromisos posteriores al horizonte. Un saldo positivo tampoco garantiza liquidez antes de cada vencimiento dentro del mes.",
               "- El saldo en EUR de esta maqueta combina efectivo inicial y compras previstas de CLP. No sustituye la futura contabilidad de cuentas reales por moneda, comisiones ni conversiones efectivamente realizadas; una equivalencia de presentación por sí sola no compra CLP.",
               "- El ejemplo no estima derechos, importes legales ni fechas reales del chômage, intereses o capital de la deuda. Todos los ingresos, las tasas de cambio y las fechas deben reemplazarse por datos confirmados antes de usar el futuro producto para decisiones personales.", ""]
    return "\n".join(lineas)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--caso", type=Path, default=CASO_PREDETERMINADO, help="JSON ficticio; por defecto, el ejemplo del repositorio")
    formato = parser.add_mutually_exclusive_group()
    formato.add_argument("--json", action="store_true", help="Resultados en JSON con céntimos EUR enteros")
    formato.add_argument("--markdown", action="store_true", help="Informe Markdown (predeterminado)")
    args = parser.parse_args(argv)
    try:
        caso = cargar_caso(args.caso)
        resultados = [simular(caso, escenario) for escenario in caso["escenarios"]]
        if not resultados:
            raise ValueError("El caso debe definir al menos un escenario")
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps({"es_ficticio": True, "resultados": resultados}, ensure_ascii=False, indent=2))
    else:
        print(generar_markdown(caso, resultados))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
