// pyodide-boot.js — Pyodide Web Worker runtime. Do not edit.
// Called by datasette-loader.js via startPyodideWorker(config).

function startPyodideWorker(config) {
  let bridgePort = null;
  let handleRequest = null;

  const initPromise = (async () => {
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.js");
    self.postMessage({ type: "status", message: "loading-pyodide" });
    const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/" });

    self.postMessage({ type: "status", message: config.installingMessage || "installing" });
    await pyodide.loadPackage("micropip");

    if (config.loadPackages?.length) {
      await pyodide.loadPackage(config.loadPackages);
    }

    // Fetch wheel manifest and install all wheels from the given base URL
    const manifest = await (await fetch(config.wheelManifestUrl)).json();
    const base = config.wheelManifestUrl.replace(/[^/]+$/, "");
    pyodide.globals.set("_wheel_urls", pyodide.toPy(manifest.wheels.map(n => base + n)));
    await pyodide.runPythonAsync(`
import micropip
await micropip.install(_wheel_urls, deps=False)
`);

    self.postMessage({ type: "status", message: "starting-app" });

    // Fetch and run any .py files, then run inline Python source strings
    for (const url of (config.pythonFiles || [])) {
      await pyodide.runPythonAsync(await (await fetch(url)).text());
    }
    for (const src of (config.pythonSources || [])) {
      await pyodide.runPythonAsync(src);
    }

    // Inject JS-side values into Python globals, then call setup
    for (const [key, val] of Object.entries(config.pyGlobals || {})) {
      pyodide.globals.set(key, val);
    }
    await pyodide.runPythonAsync(config.setupExpr);
    handleRequest = pyodide.globals.get("handle_request");
    self.postMessage({ type: "ready" });
  })().catch(err => {
    self.postMessage({ type: "error", message: String(err?.message ?? err) });
    throw err;
  });

  async function onBridgeMessage(event) {
    const msg = event.data;
    if (!msg || msg.type !== "request") return;
    try {
      await initPromise;
      const url = new URL(msg.url);
      const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
      const result = await handleRequest(
        msg.method, url.pathname, url.search.replace(/^\?/, ""),
        JSON.stringify(msg.headers || []),
        msg.body ? new Uint8Array(msg.body) : new Uint8Array(),
        url.protocol.replace(":", ""), url.hostname, port,
      );
      const body = result.body ? result.body.slice() : new Uint8Array();
      bridgePort.postMessage(
        { type: "response", id: msg.id, status: result.status, headers: result.headers, body: body.buffer },
        [body.buffer],
      );
    } catch (err) {
      const body = new TextEncoder().encode("ASGI bridge error: " + (err?.message ?? err));
      bridgePort.postMessage(
        { type: "response", id: msg.id, status: 500, headers: [["content-type", "text/plain"]], body: body.buffer },
        [body.buffer],
      );
    }
  }

  self.onmessage = (event) => {
    if (event.data?.type === "init") {
      bridgePort = event.data.port;
      bridgePort.onmessage = onBridgeMessage;
    }
  };
}
