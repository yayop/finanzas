/* Static-site transport: finance inputs are sent only to a local Web Worker. */
(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const workerURL = new URL("model-worker.js", document.currentScript.src);
  workerURL.search = new URL(document.currentScript.src).search;
  const pending = new Map();
  let worker = null;
  let sequence = 0;
  const offlineReady = prepareOffline();

  async function prepareOffline() {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const serviceWorker = navigator.serviceWorker;
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        serviceWorker.removeEventListener("controllerchange", finish);
        resolve();
      };
      const timeout = setTimeout(finish, 4000);
      Promise.resolve().then(() => serviceWorker.register(new URL("service-worker.js", workerURL), {scope: "./"}))
        .then(() => serviceWorker.ready)
        .then(() => {
          if (finished) return;
          if (serviceWorker.controller) { finish(); return; }
          serviceWorker.addEventListener("controllerchange", finish, {once: true});
          if (serviceWorker.controller) finish();
        })
        .catch(finish);
    });
  }

  function abortError() {
    return new DOMException("Cálculo cancelado", "AbortError");
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(workerURL, {type: "module", name: "finanzas"});
    worker.addEventListener("message", ({data}) => {
      const request = pending.get(data.id);
      if (!request) return;
      request.finish();
      request.resolve(new Response(data.body, {
        status: data.status,
        headers: {"Content-Type": "application/json; charset=utf-8"}
      }));
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      worker?.terminate();
      worker = null;
      for (const request of [...pending.values()]) {
        request.finish();
        request.reject(new Error("No se pudo iniciar el cálculo. Revisa la conexión y vuelve a intentarlo."));
      }
    });
    return worker;
  }

  window.finanzasApi = (url, options = {}) => {
    const path = new URL(url, document.baseURI).pathname;
    const apiStart = path.lastIndexOf("/api/");
    if (apiStart < 0) return nativeFetch(url, options);
    const route = path.slice(apiStart);
    if (options.signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const id = ++sequence;
      let timeout;
      const onAbort = () => { finish(); reject(abortError()); };
      const finish = () => {
        pending.delete(id);
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      };
      pending.set(id, {resolve, reject, finish});
      options.signal?.addEventListener("abort", onAbort, {once: true});
      timeout = setTimeout(() => {
        finish();
        reject(new Error("El motor está tardando demasiado. Revisa la conexión y vuelve a intentarlo."));
      }, 90000);
      const dispatch = () => {
        if (!pending.has(id)) return;
        try {
          getWorker().postMessage({id, route, method: options.method || "GET", body: options.body || ""});
        } catch (error) { finish(); reject(error); }
      };
      if (typeof navigator === "undefined" || !navigator.serviceWorker) dispatch();
      else offlineReady.then(dispatch);
    });
  };
})();
