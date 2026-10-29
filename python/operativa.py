"""Caja por cuenta, transferencias planificadas y liquidez por fecha.

EUR se expresa en céntimos y CLP en pesos. Los saldos de las cuentas se
mantienen en su moneda; las compensaciones del acuerdo no se ejecutan aquí.
"""

from fractions import Fraction

try:
    from . import modelo as m
except ImportError:
    import modelo as m


def _eur(unidades, moneda, cambio):
    return unidades if moneda == "EUR" else m._redondear(Fraction(unidades * 100) / Fraction(cambio))


def _partes(importe, cuenta):
    if cuenta["titular"] != "compartido":
        return {p: importe if p == cuenta["titular"] else 0 for p in m.PERSONAS}
    primero = m._redondear(Fraction(importe) * Fraction(cuenta["_porcentaje_el"]) / 100)
    return {"el": primero, "ella": importe - primero}


def _sumar(destino, partes):
    for persona in m.PERSONAS:
        destino[persona] += partes[persona]


def preparar_operativa(caso, movimientos):
    comision_eur = m._importe(caso.get("comision_cambio_eur", "0"), "EUR", "comision_cambio_eur")
    cuentas_input = caso.get("cuentas", [])
    if not isinstance(cuentas_input, list) or len(cuentas_input) > 100:
        raise ValueError("cuentas debe ser una lista de hasta 100 cuentas")
    cuentas, por_id = [], {}
    for registro in cuentas_input:
        if not isinstance(registro, dict):
            raise ValueError("Cada cuenta debe ser un objeto")
        cuenta = dict(registro)
        identificador = m._texto(cuenta.get("id"), "id de cuenta", 120)
        if identificador in por_id:
            raise ValueError("Hay id de cuenta duplicado: " + identificador)
        m._texto(cuenta.get("nombre"), "nombre de cuenta", 100)
        if cuenta.get("titular") not in (*m.PERSONAS, "compartido"):
            raise ValueError("titular de cuenta debe ser el, ella o compartido")
        if cuenta.get("moneda") not in ("EUR", "CLP"):
            raise ValueError("moneda de cuenta debe ser EUR o CLP")
        cuenta["_saldo"] = m._importe(cuenta.get("saldo_inicial", "0"), cuenta["moneda"], "saldo_inicial de " + identificador, negativo=True)
        cuenta["_porcentaje_el"] = m._porcentaje(cuenta.get("porcentaje_el", "50"), "porcentaje_el de cuenta " + identificador) if cuenta["titular"] == "compartido" else 100 if cuenta["titular"] == "el" else 0
        por_id[identificador] = cuenta
        cuentas.append(cuenta)
    for movimiento in movimientos:
        identificador = movimiento.get("cuenta_id", "")
        if not isinstance(identificador, str) or len(identificador) > 120:
            raise ValueError("cuenta_id debe ser texto de hasta 120 caracteres")
        if not identificador:
            continue
        if identificador not in por_id:
            raise ValueError("La cuenta del movimiento no existe: " + identificador)
        cuenta = por_id[identificador]
        if cuenta["moneda"] != movimiento["moneda"]:
            raise ValueError("La moneda del movimiento debe coincidir con la cuenta: " + movimiento["id"])
        persona = movimiento["persona"] if movimiento["tipo"] == "ingreso" else movimiento["pagador"]
        if cuenta["titular"] != "compartido" and cuenta["titular"] != persona:
            raise ValueError("El titular de la cuenta debe coincidir con quien recibe o paga: " + movimiento["id"])
    transferencias_input = caso.get("transferencias", [])
    if not isinstance(transferencias_input, list) or len(transferencias_input) > 1000:
        raise ValueError("transferencias debe ser una lista de hasta 1000 registros")
    transferencias, usados = [], set()
    for registro in transferencias_input:
        if not isinstance(registro, dict):
            raise ValueError("Cada transferencia debe ser un objeto")
        transferencia = dict(registro)
        identificador = m._texto(transferencia.get("id"), "id de transferencia", 120)
        if identificador in usados:
            raise ValueError("Hay id de transferencia duplicado: " + identificador)
        usados.add(identificador)
        m._texto(transferencia.get("concepto"), "concepto de transferencia")
        origen, destino = transferencia.get("origen"), transferencia.get("destino")
        if not isinstance(origen, str) or not isinstance(destino, str) or origen not in por_id or destino not in por_id:
            raise ValueError("Las cuentas de origen y destino de la transferencia deben existir")
        if origen == destino:
            raise ValueError("La transferencia requiere dos cuentas distintas")
        transferencia["_importe"] = m._importe(transferencia.get("importe"), por_id[origen]["moneda"], "importe de transferencia " + identificador)
        transferencia["_fecha"] = m._fecha(transferencia.get("fecha"), "fecha de transferencia " + identificador)
        if transferencia.get("modalidad", "unico") not in ("unico", "recurrente"):
            raise ValueError("modalidad de transferencia debe ser unico o recurrente")
        transferencia["modalidad"] = transferencia.get("modalidad", "unico")
        transferencia["intervalo_meses"] = m._entero(transferencia.get("intervalo_meses", 1), "intervalo_meses de transferencia", 1, 12)
        transferencia["_cantidad"] = 1 if transferencia["modalidad"] == "unico" else None
        hasta = transferencia.get("hasta", "")
        if hasta and transferencia["modalidad"] == "recurrente":
            ultima = m._fecha(hasta, "hasta de transferencia " + identificador)
            if ultima < transferencia["_fecha"]:
                raise ValueError("hasta de transferencia debe ser posterior o igual a fecha")
            cantidad = (m._indice(ultima) - m._indice(transferencia["_fecha"])) // transferencia["intervalo_meses"] + 1
            if m._ciclo(transferencia, cantidad - 1) > ultima:
                cantidad -= 1
            transferencia["_cantidad"] = cantidad
        elif hasta not in ("", None) and not isinstance(hasta, str):
            raise ValueError("hasta de transferencia debe ser una fecha o texto vacío")
        transferencias.append(transferencia)
    comisiones = []
    identificadores = {movimiento["id"] for movimiento in movimientos}
    for transferencia in transferencias:
        cuenta_origen = por_id[transferencia["origen"]]
        if not comision_eur or not transferencia["_importe"] or cuenta_origen["moneda"] == por_id[transferencia["destino"]]["moneda"]:
            continue
        identificador = "comision_cambio_" + transferencia["id"]
        while identificador in identificadores:
            identificador += "_"
        identificadores.add(identificador)
        conjunta = cuenta_origen["titular"] == "compartido"
        comision = {"id": identificador, "concepto": "Comisión de cambio", "tipo": "gasto",
            "persona": cuenta_origen["titular"], "pagador": "el" if conjunta else cuenta_origen["titular"],
            "cuenta_id": cuenta_origen["id"], "moneda": "EUR", "_importe": comision_eur,
            "modalidad": transferencia["modalidad"], "intervalo_meses": transferencia["intervalo_meses"],
            "_fecha": transferencia["_fecha"], "_cantidad": transferencia["_cantidad"],
            "_porcentaje": m.Decimal(100) if conjunta else m.Decimal(0),
            "grupo": "Comisiones", "etiquetas": ["Cambio de divisa"], "origen_tipo": "comision_cambio",
            "transferencia_id": transferencia["id"], "_comision_cambio": True}
        if conjunta:
            comision.update(_reparto="fijo", _porcentaje_el=cuenta_origen["_porcentaje_el"])
        comisiones.append(comision)
    return {"activa": bool(cuentas or transferencias), "cuentas": cuentas, "por_id": por_id,
            "transferencias": transferencias, "comisiones": comisiones, "comision_cambio_centimos_eur": comision_eur}


def saldos_iniciales_cuentas(caso, preparado):
    total = m._cero()
    cambio = m._fx(caso, caso["inicio"])
    for cuenta in preparado["cuentas"]:
        _sumar(total, _partes(_eur(cuenta["_saldo"], cuenta["moneda"], cambio), cuenta))
    return total


def simular_operativa(caso, preparado, calendario):
    cuentas, por_id = preparado["cuentas"], preparado["por_id"]
    saldos = {cuenta["id"]: cuenta["_saldo"] for cuenta in cuentas}
    caja_libre = {p: m._importe(caso["personas"][p]["saldo_inicial_eur"], "EUR", "saldo sin cuenta", negativo=True) for p in m.PERSONAS}
    transferencias = {mes: [] for mes in calendario}
    inicio, fin = m._mes(caso["inicio"], "inicio"), m._mes(caso["fin"], "fin")
    for transferencia in preparado["transferencias"]:
        intervalo, ancla = transferencia["intervalo_meses"], m._indice(transferencia["_fecha"])
        primero = max(0, (m._indice(inicio) - ancla + intervalo - 1) // intervalo)
        ultimo = (m._indice(fin) - ancla) // intervalo
        if transferencia["_cantidad"] is not None:
            ultimo = min(ultimo, transferencia["_cantidad"] - 1)
        for posicion in range(primero, ultimo + 1):
            fecha = m._ciclo(transferencia, posicion)
            transferencias[fecha.strftime("%Y-%m")].append((transferencia, fecha))
    meses, cambio_anterior = [], m._fx(caso, caso["inicio"])
    for mes, sucesos in calendario.items():
        cambio = m._fx(caso, mes)
        revalorizacion, redondeo, neto_transferencias = m._cero(), m._cero(), m._cero()
        pagos_atribuidos = m._cero()
        filas, eventos, sin_cuenta = {}, [], []
        for cuenta in cuentas:
            identificador, moneda = cuenta["id"], cuenta["moneda"]
            diferencia = _eur(saldos[identificador], moneda, cambio) - _eur(saldos[identificador], moneda, cambio_anterior)
            _sumar(revalorizacion, _partes(diferencia, cuenta))
            filas[identificador] = {"cuenta_id": identificador, "saldo_inicial_unidades": saldos[identificador],
                "entradas_unidades": 0, "salidas_unidades": 0, "transferencias_entrada_unidades": 0, "transferencias_salida_unidades": 0,
                "saldo_minimo_unidades": saldos[identificador], "primer_deficit": mes + "-01" if saldos[identificador] < 0 else None}
        for movimiento, fecha, importe in sucesos:
            equivalente = _eur(importe, movimiento["moneda"], cambio)
            ingreso = movimiento["tipo"] == "ingreso"
            registro = {"id": movimiento["id"], "fecha": fecha.isoformat(), "concepto": movimiento["concepto"], "tipo": movimiento["tipo"],
                "persona": movimiento["persona"], "pagador": movimiento["pagador"], "moneda_original": movimiento["moneda"],
                "importe_original": importe, "importe_centimos_eur": equivalente}
            cuenta_id = movimiento.get("cuenta_id", "")
            if movimiento.get("transferencia_id"):
                registro["transferencia_id"] = movimiento["transferencia_id"]
            if not ingreso:
                if cuenta_id:
                    _sumar(pagos_atribuidos, _partes(equivalente, por_id[cuenta_id]))
                else:
                    pagos_atribuidos[movimiento["pagador"]] += equivalente
            if not cuenta_id:
                sin_cuenta.append(registro)
                caja_libre[movimiento["persona"] if ingreso else movimiento["pagador"]] += equivalente if ingreso else -equivalente
                continue
            unidades_cuenta = importe
            if movimiento.get("_comision_cambio") and por_id[cuenta_id]["moneda"] == "CLP":
                unidades_cuenta = m._redondear(Fraction(importe) * Fraction(cambio) / 100)
            registro.update(cuenta_id=cuenta_id, importe_unidades=unidades_cuenta if ingreso else -unidades_cuenta,
                            _equivalente=equivalente if ingreso else -equivalente)
            eventos.append(registro)
        for transferencia, fecha in transferencias[mes]:
            origen, destino = transferencia["origen"], transferencia["destino"]
            importe = transferencia["_importe"]
            moneda_origen, moneda_destino = por_id[origen]["moneda"], por_id[destino]["moneda"]
            equivalente = _eur(importe, moneda_origen, cambio)
            convertido = importe if moneda_origen == moneda_destino else m._redondear(Fraction(importe) * Fraction(cambio) / 100) if moneda_origen == "EUR" else equivalente
            _sumar(neto_transferencias, _partes(-equivalente, por_id[origen]))
            _sumar(neto_transferencias, _partes(equivalente, por_id[destino]))
            for identificador, contra, delta, nominal in ((origen, destino, -importe, -equivalente), (destino, origen, convertido, equivalente)):
                eventos.append({"id": transferencia["id"], "fecha": fecha.isoformat(), "concepto": transferencia["concepto"], "tipo": "transferencia",
                    "cuenta_id": identificador, "contracuenta_id": contra, "importe_unidades": delta, "_equivalente": nominal})
        # Con fechas sin hora, procesar salidas primero evita prometer liquidez
        # basada en un ingreso que podría llegar más tarde ese mismo día.
        eventos.sort(key=lambda evento: (evento["fecha"], 0 if evento["importe_unidades"] < 0 else 1, evento["id"], evento["cuenta_id"]))
        for evento in eventos:
            identificador, delta = evento["cuenta_id"], evento["importe_unidades"]
            cuenta, fila = por_id[identificador], filas[identificador]
            antes = _eur(saldos[identificador], cuenta["moneda"], cambio)
            saldos[identificador] += delta
            despues = _eur(saldos[identificador], cuenta["moneda"], cambio)
            _sumar(redondeo, _partes(despues - antes - evento.pop("_equivalente"), cuenta))
            campo = ("transferencias_entrada_unidades" if delta >= 0 else "transferencias_salida_unidades") if evento["tipo"] == "transferencia" else "entradas_unidades" if delta >= 0 else "salidas_unidades"
            fila[campo] += abs(delta)
            fila["saldo_minimo_unidades"] = min(fila["saldo_minimo_unidades"], saldos[identificador])
            if saldos[identificador] < 0 and fila["primer_deficit"] is None:
                fila["primer_deficit"] = evento["fecha"]
            evento["saldo_despues_unidades"] = saldos[identificador]
            evento["moneda"] = cuenta["moneda"]
        for identificador, fila in filas.items():
            fila["saldo_final_unidades"] = saldos[identificador]
            fila["necesita_financiacion"] = fila["saldo_minimo_unidades"] < 0
        total_cuentas = sum(_eur(saldos[cuenta["id"]], cuenta["moneda"], cambio) for cuenta in cuentas)
        posicion_real = dict(caja_libre)
        for cuenta in cuentas:
            _sumar(posicion_real, _partes(_eur(saldos[cuenta["id"]], cuenta["moneda"], cambio), cuenta))
        meses.append({"mes": mes, "cuentas": list(filas.values()), "eventos": eventos,
            "sin_cuenta": sorted(sin_cuenta, key=lambda evento: (evento["fecha"], evento["id"])),
            "saldo_sin_cuenta_centimos_eur": dict(caja_libre), "total_cuentas_centimos_eur": total_cuentas,
            "posicion_real_centimos_eur": posicion_real,
            "saldo_total_centimos_eur": total_cuentas + sum(caja_libre.values()),
            "revalorizacion_centimos_eur": revalorizacion, "redondeo_conversion_centimos_eur": redondeo,
            "pagos_atribuidos_centimos_eur": pagos_atribuidos,
            "transferencias_entre_personas_centimos_eur": neto_transferencias})
        cambio_anterior = cambio
    return {"cuentas": [{"id": cuenta["id"], "nombre": cuenta["nombre"], "titular": cuenta["titular"], "moneda": cuenta["moneda"],
                "porcentaje_el": str(cuenta["_porcentaje_el"]), "saldo_inicial_unidades": cuenta["_saldo"]} for cuenta in cuentas],
        "criterio_mismo_dia": "Salidas antes de entradas cuando comparten fecha; saldo mínimo conservador, sin horas de cobro o pago.",
        "meses": meses}


def incorporar_compensaciones(operativa, meses):
    for caja, mes in zip(operativa["meses"], meses):
        caja["compensacion_mes_centimos_eur"] = dict(mes["compensacion_neta_centimos_eur"])
        # Comparar posiciones evita cobrar otra vez un gasto ya financiado en
        # una cuenta conjunta. Las transferencias planificadas y las diferencias
        # pendientes de meses anteriores ya están incluidas en la caja real.
        caja["compensacion_pendiente_centimos_eur"] = {
            persona: mes["saldo_final_centimos_eur"][persona] - caja["posicion_real_centimos_eur"][persona]
            for persona in m.PERSONAS}
