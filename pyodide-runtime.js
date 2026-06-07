// Shared Pyodide ASGI worker runtime
function startAsgiWorker(config) {
  let bridgePort = null;
  let handleRequest = null;

  const initPromise = (async () => {
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.js");
    self.postMessage({ type: "status", message: "loading-pyodide" });
    const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/" });

    self.postMessage({ type: "status", message: config.installingMessage || "installing-packages" });
    await pyodide.loadPackage("micropip");

    if (config.loadPackages && config.loadPackages.length) {
      await pyodide.loadPackage(config.loadPackages);
    }

    // Install our vendored wheels with deps=False (all deps already loaded above)
    const vendorBase = new URL("vendor/", self.location.href).href;
    const install = await (await fetch(vendorBase + config.installManifest)).json();
    pyodide.globals.set("_wheel_urls", pyodide.toPy(install.wheels.map(n => vendorBase + n)));
    await pyodide.runPythonAsync(`
import micropip
await micropip.install(_wheel_urls, deps=False)
`);

    self.postMessage({ type: "status", message: "starting-app" });

    // Fetch and run any .py files by URL (loaded before inline pythonSources)
    for (const url of (config.pythonFiles || [])) {
      const src = await (await fetch(url)).text();
      await pyodide.runPythonAsync(src);
    }

    // Run inline python source blocks
    for (const src of (config.pythonSources || [])) {
      await pyodide.runPythonAsync(src);
    }

    // Inject any JS globals into Python before calling setup
    if (config.pyGlobals) {
      for (const [key, val] of Object.entries(config.pyGlobals)) {
        pyodide.globals.set(key, val);
      }
    }

    await pyodide.runPythonAsync(config.setupExpr);
    handleRequest = pyodide.globals.get("handle_request");
    self.postMessage({ type: "ready" });
  })().catch((err) => {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
    throw err;
  });

  async function onBridgeMessage(event) {
    const msg = event.data;
    if (!msg || msg.type !== "request") return;
    try {
      await initPromise;
      const url = new URL(msg.url);
      const headersJson = JSON.stringify(msg.headers || []);
      const bodyArr = msg.body ? new Uint8Array(msg.body) : new Uint8Array();
      const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);

      const result = await handleRequest(
        msg.method, url.pathname, url.search.replace(/^\?/, ""),
        headersJson, bodyArr, url.protocol.replace(":", ""), url.hostname, port,
      );

      const bodyCopy = result.body ? result.body.slice() : new Uint8Array();
      bridgePort.postMessage(
        { type: "response", id: msg.id, status: result.status, headers: result.headers, body: bodyCopy.buffer },
        [bodyCopy.buffer],
      );
    } catch (err) {
      const payload = new TextEncoder().encode("ASGI bridge error: " + ((err && err.message) || err));
      bridgePort.postMessage(
        { type: "response", id: msg.id, status: 500, headers: [["content-type", "text/plain"]], body: payload.buffer },
        [payload.buffer],
      );
    }
  }

  self.onmessage = (event) => {
    const data = event.data;
    if (data && data.type === "init") {
      bridgePort = data.port;
      bridgePort.onmessage = onBridgeMessage;
    }
  };
}
