#!/usr/bin/env python3
"""Prepara en dist/ la versión estática para GitHub Pages, sin datos privados."""

import shutil
import hashlib
import json
from pathlib import Path


RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "dist"
WEB = ("index.html", "styles.css", "app.js", "operativa.js", "equivalencia.js", "progresividad.js", "historial.js", "browser-model.js", "model-worker.js", "service-worker.js")
MODULOS = ("modelo.py", "operativa.py", "migracion.py", "simular_ejemplo.py")


def preparar():
    # Lista explícita: nunca copiar datos/, resultados/, outputs/ ni el servidor.
    for nombre in WEB:
        if not (RAIZ / "web" / nombre).is_file():
            raise FileNotFoundError("Falta web/" + nombre)
    if DESTINO.exists():
        shutil.rmtree(DESTINO)
    (DESTINO / "python").mkdir(parents=True)
    (DESTINO / "ejemplos").mkdir()
    for nombre in WEB:
        shutil.copyfile(RAIZ / "web" / nombre, DESTINO / nombre)
    for nombre in MODULOS:
        shutil.copyfile(RAIZ / "scripts" / nombre, DESTINO / "python" / nombre)
    shutil.copyfile(RAIZ / "ejemplos" / "caso_ficticio.json", DESTINO / "ejemplos" / "caso_ficticio.json")
    pagina = DESTINO / "index.html"
    contenido = pagina.read_text(encoding="utf-8")
    script_app = '<script src="app.js" defer></script>'
    if contenido.count(script_app) != 1:
        raise ValueError("No se encontró la carga de app.js para añadir el motor del navegador")
    contenido = contenido.replace(script_app, '<script src="browser-model.js" defer></script>\n    ' + script_app)
    huella = hashlib.sha256()
    for archivo in sorted(DESTINO.rglob("*")):
        if archivo.is_file():
            huella.update(str(archivo.relative_to(DESTINO)).encode("utf-8"))
            huella.update(archivo.read_bytes())
    version = huella.hexdigest()[:12]
    for recurso in ("styles.css", "operativa.js", "equivalencia.js", "progresividad.js", "historial.js", "browser-model.js", "app.js"):
        contenido = contenido.replace('"' + recurso + '"', '"' + recurso + '?v=' + version + '"')
    pagina.write_text(contenido, encoding="utf-8")
    worker = DESTINO / "service-worker.js"
    recursos = ["./", "index.html"] + [nombre + "?v=" + version for nombre in WEB if nombre not in ("index.html", "service-worker.js")]
    recursos += ["python/" + nombre + "?v=" + version for nombre in MODULOS]
    recursos += ["ejemplos/caso_ficticio.json?v=" + version]
    worker.write_text(worker.read_text(encoding="utf-8").replace("__FINANZAS_VERSION__", version).replace("__FINANZAS_ASSETS__", json.dumps(recursos)), encoding="utf-8")
    (DESTINO / ".nojekyll").touch()
    print("Versión estática preparada en " + str(DESTINO))


if __name__ == "__main__":
    preparar()
