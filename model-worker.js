/* Same Python engine as the local server, running in the user's browser. */
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const FILES = [
  ["python/modelo.py", "/finanzas/scripts/modelo.py"],
  ["python/migracion.py", "/finanzas/scripts/migracion.py"],
  ["python/simular_ejemplo.py", "/finanzas/scripts/simular_ejemplo.py"],
  ["ejemplos/caso_ficticio.json", "/finanzas/ejemplos/caso_ficticio.json"]
];
let runtimePromise;
let requests = Promise.resolve();

const PYTHON_API = `
import copy
import json
import sys
sys.path.insert(0, "/finanzas")
from scripts.modelo import simular_plan, validar_plan
from scripts.migracion import migrar_plan
from scripts.simular_ejemplo import cargar_caso, simular

def _finanzas_api(route, method, body):
    try:
        if route == "/api/inicial" and method == "GET":
            caso = cargar_caso()
            result = migrar_plan({"caso": caso, "escenario": copy.deepcopy(caso["escenarios"][0])})
        elif route in ("/api/simular", "/api/migrar") and method == "POST":
            if not 0 < len(body.encode("utf-8")) <= 1024 * 1024:
                raise ValueError("El JSON debe ocupar entre 1 byte y 1 MB")
            data = json.loads(body)
            if not isinstance(data, dict) or "caso" not in data or "escenario" not in data:
                raise ValueError("Se requieren caso y escenario en el JSON")
            if route == "/api/migrar":
                result = migrar_plan(data)
                current, depth = result, 0
                while current is not None:
                    if depth > 10:
                        raise ValueError("El plan admite hasta 10 referencias anidadas")
                    validar_plan(current["caso"], current["escenario"])
                    current = current.get("reference")
                    depth += 1
            elif isinstance(data["caso"], dict) and "movimientos" in data["caso"]:
                result = simular_plan(data["caso"], data["escenario"])
            else:
                result = simular(data["caso"], data["escenario"], solo_ficticio=False)
        else:
            return json.dumps({"status": 404, "body": {"error": "Ruta no encontrada."}}, ensure_ascii=False)
        return json.dumps({"status": 200, "body": result}, ensure_ascii=False)
    except (ValueError, UnicodeError, KeyError, TypeError, OverflowError, RecursionError) as error:
        return json.dumps({"status": 400, "body": {"error": str(error) or "Entrada inválida"}}, ensure_ascii=False)
`;

async function createRuntime() {
  const [{loadPyodide}, sources] = await Promise.all([
    import(PYODIDE_URL + "pyodide.mjs"),
    Promise.all(FILES.map(async ([asset, filename]) => {
      const response = await fetch(new URL(asset, self.location.href));
      if (!response.ok) throw new Error("No se pudo cargar " + asset);
      return [filename, await response.text()];
    }))
  ]);
  const python = await loadPyodide({indexURL: PYODIDE_URL, stdout: () => {}, stderr: () => {}});
  python.FS.mkdirTree("/finanzas/scripts");
  python.FS.mkdirTree("/finanzas/ejemplos");
  python.FS.writeFile("/finanzas/scripts/__init__.py", "");
  for (const [filename, source] of sources) python.FS.writeFile(filename, source);
  python.runPython(PYTHON_API);
  return python.globals.get("_finanzas_api");
}

function runtime() {
  if (!runtimePromise) runtimePromise = createRuntime().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

self.addEventListener("message", ({data}) => {
  requests = requests.then(async () => {
    try {
      const api = await runtime();
      const result = JSON.parse(api(data.route, data.method, data.body));
      self.postMessage({id: data.id, status: result.status, body: JSON.stringify(result.body)});
    } catch {
      self.postMessage({id: data.id, status: 503, body: JSON.stringify({error: "No se pudo cargar el motor de cálculo. Revisa la conexión y vuelve a intentarlo."})});
    }
  });
});
