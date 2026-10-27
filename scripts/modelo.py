"""Simulación de movimientos libres, con calendarios e importes exactos.

Los importes EUR se convierten a céntimos y los CLP a pesos enteros. El
calendario conserva el día original al cambiar de mes (31/01, 28/02, 31/03).
Una fecha de cuotas indica siempre el próximo pago pendiente.
"""

import calendar
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from fractions import Fraction


PERSONAS = ("el", "ella")
REGLAS = ("mitades", "proporcional", "proporcional_disponible", "manual", "igualar")
MAX_MOVIMIENTOS = 1000
MAX_ENTERO_SEGURO = 9007199254740991


def _texto(valor, campo, maximo=200):
    if not isinstance(valor, str) or not valor.strip() or len(valor) > maximo:
        raise ValueError("{} debe ser texto no vacío de hasta {} caracteres".format(campo, maximo))
    return valor


def _decimal(valor, campo):
    if isinstance(valor, bool) or not isinstance(valor, (str, int, Decimal)):
        raise ValueError("{} debe ser un decimal en texto o un entero".format(campo))
    if len(str(valor)) > 80:
        raise ValueError("{} es demasiado largo".format(campo))
    try:
        numero = Decimal(valor)
    except InvalidOperation:
        raise ValueError("{} no es un decimal válido".format(campo)) from None
    if not numero.is_finite():
        raise ValueError("{} debe ser finito".format(campo))
    if abs(numero.as_tuple().exponent) > 12:
        raise ValueError("{} admite hasta 12 posiciones decimales".format(campo))
    return numero


def _importe(valor, moneda, campo, negativo=False):
    numero = _decimal(valor, campo)
    if abs(numero) > 10 ** 12 or (numero < 0 and not negativo):
        raise ValueError("{} debe estar {}hasta 1 billón".format(campo, "entre 0 y " if not negativo else "entre −1 billón y "))
    unidades = Fraction(numero) * (100 if moneda == "EUR" else 1)
    if unidades.denominator != 1:
        raise ValueError("{} admite como máximo {} decimales {}".format(campo, 2 if moneda == "EUR" else 0, moneda))
    return unidades.numerator


def _entero(valor, campo, minimo, maximo):
    if type(valor) is not int or not minimo <= valor <= maximo:
        raise ValueError("{} debe ser un entero entre {} y {}".format(campo, minimo, maximo))
    return valor


def _booleano(valor, campo):
    if type(valor) is not bool:
        raise ValueError(campo + " debe ser booleano")
    return valor


def _porcentaje(valor, campo):
    numero = _decimal(valor, campo)
    if not 0 <= numero <= 100:
        raise ValueError(campo + " debe estar entre 0 y 100")
    return numero


def _persona(valor, campo):
    if valor not in PERSONAS:
        raise ValueError(campo + " debe ser el o ella")
    return valor


def _fecha(valor, campo):
    if not isinstance(valor, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
        raise ValueError(campo + " debe tener formato YYYY-MM-DD")
    try:
        resultado = date.fromisoformat(valor)
    except ValueError:
        raise ValueError(campo + " no es una fecha válida") from None
    if not 1900 <= resultado.year <= 2200:
        raise ValueError(campo + " debe estar entre los años 1900 y 2200")
    return resultado


def _mes(valor, campo):
    if not isinstance(valor, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", valor):
        raise ValueError(campo + " debe tener formato YYYY-MM")
    return _fecha(valor + "-01", campo)


def _indice(fecha):
    return fecha.year * 12 + fecha.month - 1


def _mes_texto(indice):
    ano, mes = divmod(indice, 12)
    return "{:04d}-{:02d}".format(ano, mes + 1)


def _ciclo(movimiento, posicion):
    ancla = movimiento["_fecha"]
    ano, mes = divmod(_indice(ancla) + posicion * movimiento["intervalo_meses"], 12)
    return date(ano, mes + 1, min(ancla.day, calendar.monthrange(ano, mes + 1)[1]))


def _redondear(fraccion):
    signo = -1 if fraccion < 0 else 1
    fraccion = abs(fraccion)
    return signo * ((2 * fraccion.numerator + fraccion.denominator) // (2 * fraccion.denominator))


def _fx(caso, mes):
    valor = caso["clp_por_eur"]
    if isinstance(valor, dict):
        if mes not in valor:
            raise ValueError("Falta clp_por_eur para " + mes)
        valor = valor[mes]
    numero = _decimal(valor, "clp_por_eur de " + mes)
    if not 0 < numero <= 10 ** 9:
        raise ValueError("clp_por_eur debe ser positivo y como máximo 1000000000 en " + mes)
    return numero


def _operativa_modulo():
    try:
        from . import operativa
    except ImportError:
        import operativa
    return operativa


def _preparar(caso, escenario):
    if not isinstance(caso, dict):
        raise ValueError("caso debe ser un objeto")
    for campo in ("es_ficticio", "inicio", "fin", "clp_por_eur", "personas", "movimientos"):
        if campo not in caso:
            raise ValueError("Falta el campo " + campo)
    if type(caso.get("version", 2)) is not int or caso.get("version", 2) != 2:
        raise ValueError("La versión del caso debe ser 2")
    _booleano(caso["es_ficticio"], "es_ficticio")
    inicio, fin = _mes(caso["inicio"], "inicio"), _mes(caso["fin"], "fin")
    if not 1 <= _indice(fin) - _indice(inicio) + 1 <= 60:
        raise ValueError("El horizonte debe ser de 1 a 60 meses")
    if not isinstance(caso["personas"], dict) or set(caso["personas"]) != set(PERSONAS):
        raise ValueError("personas debe contener exactamente el y ella")
    for persona in PERSONAS:
        datos = caso["personas"][persona]
        if not isinstance(datos, dict):
            raise ValueError("Los datos de " + persona + " deben ser un objeto")
        _texto(datos.get("nombre"), "nombre de " + persona, 100)
        _importe(datos.get("saldo_inicial_eur"), "EUR", "saldo_inicial_eur de " + persona, negativo=True)
    tipos = caso["clp_por_eur"]
    if isinstance(tipos, dict):
        if len(tipos) > 1000:
            raise ValueError("clp_por_eur admite hasta 1000 meses")
        for mes in tipos:
            _mes(mes, "mes de clp_por_eur")
            _fx(caso, mes)
    for indice in range(_indice(inicio), _indice(fin) + 1):
        _fx(caso, _mes_texto(indice))
    if not isinstance(caso["movimientos"], list) or len(caso["movimientos"]) > MAX_MOVIMIENTOS:
        raise ValueError("movimientos debe ser una lista de hasta {} registros".format(MAX_MOVIMIENTOS))
    movimientos, identificadores = [], set()
    for registro in caso["movimientos"]:
        if not isinstance(registro, dict):
            raise ValueError("Cada movimiento debe ser un objeto")
        movimiento = dict(registro)
        identificador = _texto(movimiento.get("id"), "id de movimiento", 120)
        if identificador in identificadores:
            raise ValueError("Hay id de movimiento duplicados: " + identificador)
        identificadores.add(identificador)
        _texto(movimiento.get("concepto"), "concepto de " + identificador)
        grupo = movimiento.get("grupo", "")
        if not isinstance(grupo, str) or len(grupo) > 80:
            raise ValueError("grupo debe ser texto de hasta 80 caracteres")
        movimiento["grupo"] = grupo.strip()
        etiquetas = movimiento.get("etiquetas", [])
        if not isinstance(etiquetas, list) or len(etiquetas) > 10:
            raise ValueError("etiquetas debe ser una lista de hasta 10 textos")
        movimiento["etiquetas"] = [_texto(etiqueta, "etiqueta", 80).strip() for etiqueta in etiquetas]
        if movimiento.get("tipo") not in ("ingreso", "gasto", "deuda"):
            raise ValueError("tipo de {} debe ser ingreso, gasto o deuda".format(identificador))
        conjunta = movimiento.get("persona") == "compartido"
        if conjunta:
            if movimiento["tipo"] == "ingreso":
                raise ValueError("Los ingresos deben pertenecer a una persona: " + identificador)
            movimiento["_reparto"] = movimiento.get("reparto", "regla")
            if movimiento["_reparto"] not in ("regla", "fijo"):
                raise ValueError("reparto de {} debe ser regla o fijo".format(identificador))
            if movimiento["_reparto"] == "fijo":
                movimiento["_porcentaje_el"] = _porcentaje(movimiento.get("porcentaje_el"), "porcentaje_el de " + identificador)
        else:
            movimiento["persona"] = _persona(movimiento.get("persona"), "persona de " + identificador)
        pagador_predeterminado = "el" if conjunta else movimiento["persona"]
        movimiento["pagador"] = _persona(movimiento.get("pagador", pagador_predeterminado), "pagador de " + identificador)
        if movimiento.get("moneda") not in ("EUR", "CLP"):
            raise ValueError("moneda de {} debe ser EUR o CLP".format(identificador))
        movimiento["_importe"] = _importe(movimiento.get("importe"), movimiento["moneda"], "importe de " + identificador)
        movimiento["_fecha"] = _fecha(movimiento.get("fecha"), "fecha de " + identificador)
        if movimiento.get("modalidad") not in ("unico", "recurrente", "cuotas"):
            raise ValueError("modalidad de {} debe ser unico, recurrente o cuotas".format(identificador))
        modalidad = movimiento["modalidad"]
        if movimiento["tipo"] == "ingreso" and modalidad == "cuotas":
            raise ValueError("Los ingresos no pueden pagarse en cuotas: " + identificador)
        movimiento["intervalo_meses"] = _entero(movimiento.get("intervalo_meses", 1), "intervalo_meses de " + identificador, 1, 12) if modalidad != "unico" else 1
        movimiento["extra"] = _booleano(movimiento.get("extra", False), "extra de " + identificador)
        movimiento["_porcentaje"] = Decimal(100) if conjunta else _porcentaje(movimiento.get("porcentaje_compartido", "0"), "porcentaje_compartido de " + identificador)
        if modalidad == "cuotas":
            cantidad = _entero(movimiento.get("cuotas", 1), "cuotas de " + identificador, 1, 600)
            pagadas = _entero(movimiento.get("cuotas_pagadas", 0), "cuotas_pagadas de " + identificador, 0, cantidad)
            movimiento["cuotas"], movimiento["cuotas_pagadas"] = cantidad, pagadas
            if movimiento.get("importe_tipo", "total") not in ("total", "cuota"):
                raise ValueError("importe_tipo de {} debe ser total o cuota".format(identificador))
            movimiento["importe_tipo"] = movimiento.get("importe_tipo", "total")
            movimiento["_cantidad"] = cantidad - pagadas
        elif modalidad == "unico":
            movimiento["_cantidad"] = 1
        else:
            hasta = movimiento.get("hasta", "")
            if hasta:
                ultima = _fecha(hasta, "hasta de " + identificador)
                if ultima < movimiento["_fecha"]:
                    raise ValueError("hasta debe ser posterior o igual a fecha en " + identificador)
                cantidad = (_indice(ultima) - _indice(movimiento["_fecha"])) // movimiento["intervalo_meses"] + 1
                if _ciclo(movimiento, cantidad - 1) > ultima:
                    cantidad -= 1
                movimiento["_cantidad"] = cantidad
            elif hasta not in ("", None):
                raise ValueError("hasta debe ser una fecha o texto vacío en " + identificador)
            else:
                movimiento["_cantidad"] = None
        movimientos.append(movimiento)
    if not isinstance(escenario, dict):
        raise ValueError("escenario debe ser un objeto")
    escenario = dict(escenario)
    _texto(escenario.get("id"), "id de escenario", 120)
    _texto(escenario.get("nombre"), "nombre de escenario")
    if escenario.get("regla") not in REGLAS:
        raise ValueError("regla debe ser " + ", ".join(REGLAS))
    _booleano(escenario.get("incluir_extra"), "incluir_extra")
    if escenario["regla"] == "manual":
        _porcentaje(escenario.get("porcentaje_el"), "porcentaje_el")
    _operativa_modulo().preparar_operativa(caso, movimientos)
    return movimientos, escenario


def validar_plan(caso, escenario):
    """Valida el contrato de entrada sin mutar los datos recibidos."""
    _preparar(caso, escenario)


def _importe_ciclo(movimiento, posicion):
    importe = movimiento["_importe"]
    if movimiento["modalidad"] != "cuotas" or movimiento["importe_tipo"] == "cuota":
        return importe
    base, resto = divmod(importe, movimiento["cuotas"])
    indice_original = movimiento["cuotas_pagadas"] + posicion
    return base + (resto if indice_original == movimiento["cuotas"] - 1 else 0)


def _importe_restante(movimiento, posicion, cantidad):
    if movimiento["modalidad"] != "cuotas" or movimiento["importe_tipo"] == "cuota":
        return movimiento["_importe"] * cantidad
    base, resto = divmod(movimiento["_importe"], movimiento["cuotas"])
    ultima = movimiento["cuotas"] - movimiento["cuotas_pagadas"] - 1
    return base * cantidad + (resto if posicion <= ultima < posicion + cantidad else 0)


def _formatear(importe, moneda):
    return "{}.{:02d}".format(importe // 100, importe % 100) if moneda == "EUR" else str(importe)


def _calendario(caso, movimientos):
    inicio = _mes(caso["inicio"], "inicio")
    fin = _mes(caso["fin"], "fin")
    calendario = {_mes_texto(indice): [] for indice in range(_indice(inicio), _indice(fin) + 1)}
    futuros, por_moneda, sin_fin = [], {}, 0
    for movimiento in movimientos:
        cantidad, intervalo = movimiento["_cantidad"], movimiento["intervalo_meses"]
        ancla = _indice(movimiento["_fecha"])
        primero = max(0, (_indice(inicio) - ancla + intervalo - 1) // intervalo)
        ultimo = (_indice(fin) - ancla) // intervalo
        if cantidad is not None:
            ultimo = min(ultimo, cantidad - 1)
        for posicion in range(primero, ultimo + 1):
            fecha = _ciclo(movimiento, posicion)
            calendario[fecha.strftime("%Y-%m")].append((movimiento, fecha, _importe_ciclo(movimiento, posicion)))
        if movimiento["tipo"] == "ingreso":
            continue
        siguiente = max(0, (_indice(fin) - ancla) // intervalo + 1)
        if cantidad is not None and siguiente >= cantidad:
            continue
        pendiente = cantidad - siguiente if cantidad is not None else None
        suma = _importe_restante(movimiento, siguiente, pendiente) if pendiente is not None else None
        if suma is not None:
            moneda = movimiento["moneda"]
            por_moneda[moneda] = por_moneda.get(moneda, 0) + suma
        else:
            sin_fin += 1
        futuros.append({"id": movimiento["id"], "concepto": movimiento["concepto"], "tipo": movimiento["tipo"],
                        "moneda": movimiento["moneda"], "modalidad": movimiento["modalidad"],
                        "pagos_pendientes": pendiente,
                        "importe_pendiente": _formatear(suma, movimiento["moneda"]) if suma is not None else None,
                        "proximo_pago": _ciclo(movimiento, siguiente).isoformat()})
    compromisos = {"por_moneda": {m: _formatear(v, m) for m, v in por_moneda.items()},
                   "movimientos": futuros, "recurrentes_sin_fin": sin_fin}
    return calendario, compromisos


def _cero():
    return {p: 0 for p in PERSONAS}


def _asignacion(escenario, mes, comunes, considerados, personales):
    regla = escenario["regla"]
    if regla == "mitades":
        aporte = Fraction(comunes, 2)
    elif regla == "manual":
        aporte = Fraction(comunes) * Fraction(_porcentaje(escenario["porcentaje_el"], "porcentaje_el")) / 100
    elif regla in ("proporcional", "proporcional_disponible"):
        base = {p: considerados[p] - (personales[p] if regla == "proporcional_disponible" else 0) for p in PERSONAS}
        # Sin costes comunes no hace falta dividir; los ingresos pueden comenzar
        # después del primer mes del horizonte.
        if comunes == 0:
            aporte = Fraction(0)
        elif any(v < 0 for v in base.values()) or sum(base.values()) <= 0:
            raise ValueError("{}: {} requiere disponibilidades no negativas y una base total positiva".format(mes, regla))
        else:
            aporte = Fraction(comunes * base["el"], sum(base.values()))
    else:
        aporte = Fraction(comunes + considerados["el"] - personales["el"] - considerados["ella"] + personales["ella"], 2)
    el = _redondear(aporte)
    return {"el": el, "ella": comunes - el}


def _comprobar_enteros(valor):
    if isinstance(valor, dict):
        for contenido in valor.values():
            _comprobar_enteros(contenido)
    elif isinstance(valor, list):
        for contenido in valor:
            _comprobar_enteros(contenido)
    elif type(valor) is int and abs(valor) > MAX_ENTERO_SEGURO:
        raise ValueError("Los importes del plan exceden el límite de precisión de la interfaz")


def simular_plan(caso, escenario):
    """Proyecta el plan sin modificarlo; pagos excluye los ingresos recibidos."""
    movimientos, escenario = _preparar(caso, escenario)
    calendario, compromisos = _calendario(caso, movimientos)
    op_modulo = _operativa_modulo()
    preparado = op_modulo.preparar_operativa(caso, movimientos)
    operativa = op_modulo.simular_operativa(caso, preparado, calendario) if preparado["activa"] else None
    saldos = {p: _importe(caso["personas"][p]["saldo_inicial_eur"], "EUR", "saldo inicial", negativo=True) for p in PERSONAS}
    iniciales_cuentas = op_modulo.saldos_iniciales_cuentas(caso, preparado)
    for persona in PERSONAS:
        saldos[persona] += iniciales_cuentas[persona]
    iniciales, meses = dict(saldos), []
    for indice_mes, (mes, sucesos) in enumerate(calendario.items()):
        tipo_cambio = _fx(caso, mes)
        reales, considerados = _cero(), _cero()
        externos, personales = _cero(), _cero()
        compras, costes_compras = _cero(), _cero()
        pagos, ingresos, comunes = [], [], 0
        cuotas_eur, cuotas_clp = 0, 0
        for movimiento, fecha, importe in sorted(sucesos, key=lambda item: (item[1], item[0]["id"])):
            equivalente = importe if movimiento["moneda"] == "EUR" else _redondear(Fraction(importe * 100) / Fraction(tipo_cambio))
            porcentaje = movimiento["_porcentaje"] if movimiento["tipo"] != "ingreso" else Decimal(0)
            reparto_fijo = movimiento.get("_reparto") == "fijo"
            compartido = 0 if reparto_fijo else _redondear(Fraction(equivalente) * Fraction(porcentaje) / 100)
            registro = {"id": movimiento["id"], "concepto": movimiento["concepto"], "tipo": movimiento["tipo"],
                        "fecha": fecha.isoformat(), "modalidad": movimiento["modalidad"],
                        "persona": movimiento["persona"], "pagador": movimiento["pagador"],
                        "importe_original": importe, "moneda_original": movimiento["moneda"],
                        "importe_centimos_eur": equivalente, "comun": porcentaje > 0,
                        "porcentaje_compartido": str(porcentaje),
                        "importe_comun_centimos_eur": compartido,
                        "importe_personal_centimos_eur": equivalente - compartido}
            if movimiento.get("grupo"):
                registro["grupo"] = movimiento["grupo"]
            if movimiento.get("etiquetas"):
                registro["etiquetas"] = list(movimiento["etiquetas"])
            if movimiento.get("cuenta_id"):
                registro["cuenta_id"] = movimiento["cuenta_id"]
            persona, pagador = movimiento["persona"], movimiento["pagador"]
            if movimiento["tipo"] == "ingreso":
                registro["extra"] = movimiento["extra"]
                ingresos.append(registro)
                reales[persona] += equivalente
                if escenario["incluir_extra"] or not movimiento["extra"]:
                    considerados[persona] += equivalente
                continue
            if "origen_tipo" in movimiento:
                registro["origen_tipo"] = movimiento["origen_tipo"]
            asignado = _cero()
            if persona == "compartido":
                registro["reparto"] = movimiento["_reparto"]
                if reparto_fijo:
                    asignado["el"] = _redondear(Fraction(equivalente) * Fraction(movimiento["_porcentaje_el"]) / 100)
                    asignado["ella"] = equivalente - asignado["el"]
                    registro["porcentaje_el"] = str(movimiento["_porcentaje_el"])
            else:
                asignado[persona] = equivalente - compartido
            registro["importe_asignado_centimos_eur"] = asignado
            pagos.append(registro)
            externos[pagador] += equivalente
            for titular in PERSONAS:
                personales[titular] += asignado[titular]
            comunes += compartido
            if movimiento["moneda"] == "CLP":
                compras[pagador] += importe
                costes_compras[pagador] += equivalente
            if movimiento["modalidad"] == "cuotas":
                cuotas_eur += equivalente
                if movimiento["moneda"] == "CLP":
                    cuotas_clp += importe
        asignacion = _asignacion(escenario, mes, comunes, considerados, personales)
        compensacion = {p: externos[p] - personales[p] - asignacion[p] for p in PERSONAS}
        flujo = {p: reales[p] - externos[p] + compensacion[p] for p in PERSONAS}
        anteriores = dict(saldos)
        caja = operativa["meses"][indice_mes] if operativa else None
        ajuste = {p: caja["revalorizacion_centimos_eur"][p] + caja["redondeo_conversion_centimos_eur"][p] if caja else 0 for p in PERSONAS}
        saldos = {p: saldos[p] + flujo[p] + ajuste[p] for p in PERSONAS}
        fila = {"mes": mes, "clp_por_eur": str(tipo_cambio), "ingresos_reales_centimos_eur": reales,
                "ingresos_considerados_centimos_eur": considerados, "pagos_personales_centimos_eur": personales,
                "gastos_comunes_centimos_eur": comunes, "asignacion_comunes_centimos_eur": asignacion,
                "pagos_externos_centimos_eur": externos, "compensacion_neta_centimos_eur": compensacion,
                "flujo_libre_centimos_eur": flujo, "saldo_inicial_centimos_eur": anteriores,
                "saldo_final_centimos_eur": dict(saldos), "clp_comprados": compras,
                "coste_compra_clp_centimos_eur": costes_compras,
                "necesita_financiacion": {p: saldos[p] < 0 for p in PERSONAS}, "pagos": pagos, "ingresos": ingresos,
                "cuotas_centimos_eur": cuotas_eur, "cuotas_clp": cuotas_clp}
        if operativa:
            fila["ajuste_cuentas_centimos_eur"] = ajuste
        for tipo in ("universidad", "ayuda", "deuda_fija"):
            seleccion = [p for p in pagos if p.get("origen_tipo") == tipo]
            fila[tipo + "_clp"] = sum(p["importe_original"] for p in seleccion if p["moneda_original"] == "CLP")
            fila[tipo + "_centimos_eur"] = sum(p["importe_centimos_eur"] for p in seleccion)
        fila["hogar"] = {campo: sum(fila[campo].values()) for campo in (
            "ingresos_reales_centimos_eur", "pagos_externos_centimos_eur", "flujo_libre_centimos_eur", "saldo_final_centimos_eur")}
        meses.append(fila)
    totales = {}
    for campo in ("ingresos_reales_centimos_eur", "ingresos_considerados_centimos_eur", "pagos_personales_centimos_eur",
                  "asignacion_comunes_centimos_eur", "pagos_externos_centimos_eur", "compensacion_neta_centimos_eur",
                  "flujo_libre_centimos_eur", "clp_comprados", "coste_compra_clp_centimos_eur"):
        totales[campo] = {p: sum(fila[campo][p] for fila in meses) for p in PERSONAS}
    for campo in ("cuotas_clp", "cuotas_centimos_eur", "universidad_clp", "ayuda_clp", "deuda_fija_clp", "gastos_comunes_centimos_eur"):
        totales[campo] = sum(fila[campo] for fila in meses)
    totales["saldo_inicial_centimos_eur"], totales["saldo_final_centimos_eur"] = iniciales, dict(saldos)
    if operativa:
        totales["ajuste_cuentas_centimos_eur"] = {p: sum(fila["ajuste_cuentas_centimos_eur"][p] for fila in meses) for p in PERSONAS}
    totales["hogar"] = {campo: sum(totales[campo].values()) for campo in (
        "ingresos_reales_centimos_eur", "pagos_externos_centimos_eur", "flujo_libre_centimos_eur", "saldo_inicial_centimos_eur", "saldo_final_centimos_eur")}
    resultado = {"version": 2, "es_ficticio": caso["es_ficticio"], "escenario": escenario,
                 "unidad_eur": "centimos_enteros", "inicio": caso["inicio"], "fin": caso["fin"],
                 "conversion": "Equivalencia de cada ingreso y pago CLP en EUR al tipo de su mes, sin comisiones. Compensaciones EUR; no se modelan cuentas CLP separadas.",
                 "meses": meses, "totales": totales, "compromisos_fuera_horizonte": compromisos}
    if operativa:
        op_modulo.incorporar_compensaciones(operativa, meses)
        resultado["operativa"] = operativa
        resultado["conversion"] = "Cuentas en moneda original, valoradas al cambio de cada mes; revalorización y redondeos separados del flujo. Transferencias sin comisiones, compensaciones del acuerdo pendientes hasta planificarlas."
    _comprobar_enteros(resultado)
    return resultado
