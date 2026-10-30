"""Convierte planes de la primera interfaz al catálogo de movimientos.

La conversión es en memoria y conserva los importes y calendarios del plan
recibido. Nunca recurre al ejemplo si el contenido del usuario es inválido.
"""

import calendar
import copy
from collections import Counter

try:
    from .simular_ejemplo import _elegir_escenario, _validar
except ImportError:
    from simular_ejemplo import _elegir_escenario, _validar


_CONCEPTOS = {
    "sueldo_inicial": "Tu sueldo inicial",
    "chomage": "Tu chômage",
    "nuevo_sueldo": "Tu siguiente sueldo",
    "doctorado": "Ingreso del doctorado",
    "extra": "Ingreso extra",
    "hogar": "Gastos del hogar",
    "propios_el": "Tus gastos personales",
    "propios_ella": "Sus gastos personales",
    "deuda_46_cuotas": "Deuda en cuotas",
    "hermana": "Ayuda a la hermana",
}

_CAMPOS_ANTIGUOS = {
    "importe_eur", "importe_clp", "desde", "hasta", "cuota_clp",
    "cuotas_totales", "cuotas_pagadas", "proxima_cuota", "primera_cuota",
}


def _ultimo_dia(mes):
    ano, numero = map(int, mes.split("-"))
    return "{}-{:02d}".format(mes, calendar.monthrange(ano, numero)[1])


def _concepto(registro, defecto=None):
    for campo in ("concepto", "nombre"):
        if isinstance(registro.get(campo), str) and registro[campo].strip():
            return registro[campo]
    return defecto or _CONCEPTOS.get(registro["id"], registro["id"].replace("_", " ").capitalize())


def _migrar_legacy(caso, escenario):
    _validar(caso, solo_ficticio=False)
    escenario = _elegir_escenario(caso, escenario)
    grupos = [
        ("ingreso", caso["ingresos"]),
        ("gasto", caso["gastos"]),
        ("deuda", [caso["deuda_fija"]]),
        ("ayuda", [caso["ayuda"]]),
        ("factura", caso["facturas"]),
    ]
    repeticiones = Counter(registro["id"] for _, registros in grupos for registro in registros)
    usados = set()
    movimientos = []

    def base(registro, grupo, tipo, persona, defecto=None):
        identificador = registro["id"]
        if repeticiones[identificador] > 1:
            identificador = grupo + "_" + identificador
        candidato = identificador
        consecutivo = 2
        while candidato in usados:
            candidato = identificador + "_" + str(consecutivo)
            consecutivo += 1
        usados.add(candidato)
        # Conservar también notas y metadatos libres que ya tuviera el usuario.
        movimiento = {k: copy.deepcopy(v) for k, v in registro.items() if k not in _CAMPOS_ANTIGUOS}
        movimiento.update({
            "id": candidato,
            "concepto": _concepto(registro, defecto),
            "tipo": tipo,
            "persona": persona,
            "pagador": registro.get("pagador", persona),
            "modalidad": "recurrente",
            "intervalo_meses": 1,
            "hasta": "",
            "cuotas": 1,
            "cuotas_pagadas": 0,
            "importe_tipo": "total",
            "extra": False,
            "porcentaje_compartido": "0",
        })
        return movimiento

    for ingreso in caso["ingresos"]:
        movimiento = base(ingreso, "ingreso", "ingreso", ingreso["persona"])
        importe = ingreso["importe_eur"]
        if ingreso["id"] == "chomage" and "sustituir_chomage_por_eur" in escenario:
            importe = escenario["sustituir_chomage_por_eur"]
        movimiento.update(importe=str(importe), moneda="EUR", fecha=ingreso["desde"] + "-01",
                          hasta=_ultimo_dia(ingreso["hasta"]), extra=ingreso["extra"])
        movimientos.append(movimiento)

    for gasto in caso["gastos"]:
        movimiento = base(gasto, "gasto", "gasto", gasto["pagador"])
        movimiento.update(importe=str(gasto["importe_eur"]), moneda="EUR", fecha=gasto["desde"] + "-01",
                          hasta=_ultimo_dia(gasto["hasta"]),
                          porcentaje_compartido="100" if gasto["tipo"] == "comun" else "0")
        if gasto["tipo"] == "comun":
            movimiento.update(persona="compartido", reparto="regla")
        movimientos.append(movimiento)

    deuda = caso["deuda_fija"]
    movimiento = base(deuda, "deuda", "deuda", deuda["persona"], "Deuda en cuotas")
    movimiento.update(importe=str(deuda["cuota_clp"]), moneda="CLP", modalidad="cuotas",
                      importe_tipo="cuota", fecha=deuda["proxima_cuota"] + "-01",
                      cuotas=deuda["cuotas_totales"], cuotas_pagadas=deuda["cuotas_pagadas"],
                      porcentaje_compartido=str(deuda.get("porcentaje_compartido", "0")),
                      origen_tipo="deuda_fija")
    movimientos.append(movimiento)

    ayuda = caso["ayuda"]
    movimiento = base(ayuda, "ayuda", "gasto", ayuda["persona"], "Ayuda a la hermana")
    movimiento.update(importe=str(ayuda["importe_clp"]), moneda="CLP", fecha=ayuda["desde"] + "-01",
                      hasta=_ultimo_dia(ayuda["hasta"]),
                      porcentaje_compartido=str(ayuda.get("porcentaje_compartido", "0")), origen_tipo="ayuda")
    movimientos.append(movimiento)

    for posicion, factura in enumerate(caso["facturas"], start=1):
        movimiento = base(factura, "factura", "deuda", factura["persona"], "Factura universitaria " + str(posicion))
        porcentaje = factura.get("porcentaje_compartido", "100" if escenario["universidad_compartida"] else "0")
        movimiento.update(importe=str(factura["importe_clp"]), moneda="CLP", modalidad="cuotas",
                          importe_tipo="total", fecha=factura["primera_cuota"] + "-01",
                          cuotas=escenario.get("cuotas_universidad", factura["cuotas"]),
                          porcentaje_compartido=str(porcentaje), origen_tipo="universidad")
        movimientos.append(movimiento)

    caso = {k: copy.deepcopy(v) for k, v in caso.items()
            if k not in ("ingresos", "gastos", "deuda_fija", "ayuda", "facturas", "escenarios")}
    caso.update(version=2, movimientos=movimientos)
    for campo in ("universidad_compartida", "cuotas_universidad", "sustituir_chomage_por_eur"):
        escenario.pop(campo, None)
    escenario.setdefault("porcentaje_el", "50")
    return caso, escenario


def migrar_plan(plan):
    """Devuelve una copia v2 de un plan antiguo o ya basado en movimientos.

    Los ajustes de los escenarios antiguos se aplican a sus movimientos una sola
    vez. Una referencia opcional se convierte por separado, con sus propios datos.
    La validación detallada de los movimientos v2 corresponde al simulador.
    """
    if not isinstance(plan, dict) or not isinstance(plan.get("caso"), dict) or "escenario" not in plan:
        raise ValueError("Se requieren caso y escenario en el plan")
    version = plan.get("version", 1)
    if type(version) is not int or version not in (1, 2):
        raise ValueError("Versión de plan no compatible")
    resultado = copy.deepcopy(plan)
    caso = resultado["caso"]
    if "version" in caso and (type(caso["version"]) is not int or caso["version"] not in (1, 2)):
        raise ValueError("Versión de caso no compatible")
    if "movimientos" in caso:
        if not isinstance(caso["movimientos"], list):
            raise ValueError("movimientos debe ser una lista")
        if not isinstance(resultado["escenario"], dict):
            raise ValueError("escenario debe ser un objeto en un plan de movimientos")
        caso["version"] = 2
    else:
        if caso.get("version") == 2 or version == 2:
            raise ValueError("Un plan de versión 2 requiere movimientos")
        resultado["caso"], resultado["escenario"] = _migrar_legacy(caso, resultado["escenario"])
    for movimiento in resultado["caso"]["movimientos"]:
        if not isinstance(movimiento, dict):
            # La validación detallada sigue correspondiendo al modelo.
            continue
        if movimiento.get("tipo") == "deuda":
            movimiento["tipo"] = "gasto"
        if movimiento.get("tipo") == "gasto":
            # Los planes guardados ya descontaban todos sus gastos asignados.
            # Hacer explícito ese acuerdo evita cambiar sus resultados al abrir.
            movimiento.setdefault("descontar_antes_reparto", True)
    resultado["version"] = 2
    if resultado.get("reference") is not None:
        resultado["reference"] = migrar_plan(resultado["reference"])
    return resultado
