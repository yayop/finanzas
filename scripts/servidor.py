#!/usr/bin/env python3
"""Interfaz local sin dependencias ni almacenamiento de datos recibidos."""

import argparse
import copy
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .simular_ejemplo import cargar_caso, simular
    from .modelo import simular_plan, validar_plan
    from .migracion import migrar_plan
except ImportError:
    from simular_ejemplo import cargar_caso, simular
    from modelo import simular_plan, validar_plan
    from migracion import migrar_plan


WEB = Path(__file__).resolve().parents[1] / "web"
ARCHIVOS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/operativa.js": ("operativa.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
MAX_CUERPO = 1024 * 1024


class Manejador(BaseHTTPRequestHandler):
    def _responder(self, codigo, contenido, tipo="application/json; charset=utf-8"):
        if not isinstance(contenido, bytes):
            contenido = json.dumps(contenido, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(contenido)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(contenido)

    def _local(self):
        try:
            host = urlsplit("http://" + self.headers.get("Host", ""))
            if host.hostname not in ("127.0.0.1", "localhost") or host.port != self.server.server_port:
                raise ValueError()
            origen = self.headers.get("Origin")
            if origen:
                partes = urlsplit(origen)
                if partes.scheme != "http" or partes.hostname not in ("127.0.0.1", "localhost") or partes.port != self.server.server_port:
                    raise ValueError()
        except ValueError:
            self._responder(403, {"error": "Este servidor solo admite acceso desde la interfaz local."})
            return False
        return True

    def do_GET(self):
        if not self._local():
            return
        ruta = urlsplit(self.path).path
        if ruta == "/api/inicial":
            caso = cargar_caso()
            self._responder(200, migrar_plan({"caso": caso, "escenario": copy.deepcopy(caso["escenarios"][0])}))
        elif ruta in ARCHIVOS:
            nombre, tipo = ARCHIVOS[ruta]
            archivo = WEB / nombre
            if archivo.is_file():
                self._responder(200, archivo.read_bytes(), tipo)
            else:
                self._responder(404, {"error": "Archivo de interfaz no encontrado."})
        else:
            self._responder(404, {"error": "Ruta no encontrada."})

    def do_POST(self):
        if not self._local():
            return
        ruta = urlsplit(self.path).path
        if ruta not in ("/api/simular", "/api/migrar"):
            self._responder(404, {"error": "Ruta no encontrada."})
            return
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Se requiere Content-Type: application/json")
            longitud = int(self.headers.get("Content-Length", "0"))
            if not 0 < longitud <= MAX_CUERPO:
                raise ValueError("El JSON debe ocupar entre 1 byte y 1 MB")
            datos = json.loads(self.rfile.read(longitud).decode("utf-8"))
            if not isinstance(datos, dict) or "caso" not in datos or "escenario" not in datos:
                raise ValueError("Se requieren caso y escenario en el JSON")
            if ruta == "/api/migrar":
                resultado = migrar_plan(datos)
                actual, profundidad = resultado, 0
                while actual is not None:
                    if profundidad > 10:
                        raise ValueError("El plan admite hasta 10 referencias anidadas")
                    validar_plan(actual["caso"], actual["escenario"])
                    actual = actual.get("reference")
                    profundidad += 1
            elif isinstance(datos["caso"], dict) and "movimientos" in datos["caso"]:
                resultado = simular_plan(datos["caso"], datos["escenario"])
            else:
                resultado = simular(datos["caso"], datos["escenario"], solo_ficticio=False)
        except (ValueError, UnicodeError, KeyError, TypeError, OverflowError, RecursionError) as error:
            self._responder(400, {"error": str(error) or "Entrada inválida"})
            return
        self._responder(200, resultado)

    def log_message(self, formato, *argumentos):
        # Nunca registrar los datos financieros enviados en el cuerpo JSON.
        return


def crear_servidor(puerto=8765):
    return ThreadingHTTPServer(("127.0.0.1", puerto), Manejador)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Simulador local de finanzas de pareja")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Abrir el simulador en el navegador")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port debe estar entre 1 y 65535")
    with crear_servidor(args.port) as servidor:
        print("Simulador disponible en http://127.0.0.1:{}/".format(servidor.server_port), flush=True)
        print("Pulsa Ctrl+C para detenerlo. Los datos enviados no se guardan en el servidor.", flush=True)
        if args.open:
            apertura = threading.Timer(0.3, webbrowser.open, args=("http://127.0.0.1:{}/".format(servidor.server_port),))
            apertura.daemon = True
            apertura.start()
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
