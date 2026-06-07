// pyodide-boot.js — generic Pyodide Web Worker runtime.
// Called by datasette-loader.js via startPyodideWorker(config).
// You do not need to edit this file.

function startPyodideWorker(config) {
  let bridgePort = null;
  let handleRequest = null;

  const initPromise = (async () => {
    // 1. Boot Pyodide (Python/WASM runtime)
    importScripts(config.pyodideUrl + "pyodide.js");
    self.postMessage({ type: "status", message: "loading-pyodide" });
    const pyodide = await loadPyodide({ indexURL: config.pyodideUrl });

    // 2. Load built-in Pyodide packages (already compiled, no wheel needed)
    self.postMessage({ type: "status", message: config.installingMessage || "installing" });
    await pyodide.loadPackage("micropip");
    if (config.builtinPackages?.length) {
      await pyodide.loadPackage(config.builtinPackages);
    }

    // 3. Install vendored wheels via micropip (deps=False — deps loaded above)
    const manifest = await (await fetch(new URL(config.wheelManifest, self.location.href))).json();
    const vendorBase = new URL(config.wheelManifest, self.location.href).href.replace(/[^/]+$/, "");
    pyodide.globals.set("_wheel_urls", pyodide.toPy(manifest.wheels.map(n => vendorBase + n)));
    await pyodide.runPythonAsync(`
import micropip
await micropip.install(_wheel_urls, deps=False)
`);

    // 4. Run Python source files and inline source blocks
    self.postMessage({ type: "status", message: "starting-app" });
    for (const url of (config.pythonFiles || [])) {
      await pyodide.runPythonAsync(await (await fetch(url)).text());
    }
    for (const src of (config.pythonSources || [])) {
      await pyodide.runPythonAsync(src);
    }

    // 5. Inject JS-side config into Python globals, then call setup
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
      const body = new TextEncoder().encode("Error: " + (err?.message ?? err));
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
