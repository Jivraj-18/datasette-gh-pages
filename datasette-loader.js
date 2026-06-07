// datasette-loader.js — runs inside a browser Web Worker (background thread).
// Boots Datasette in Python/WASM and handles every HTTP request the service
// worker intercepts from the page's iframe.
//
// THIS IS THE ONLY FILE YOU NEED TO EDIT to change:
//   - which Datasette plugins to use
//   - the AI model or system prompt

importScripts("pyodide-boot.js");

// ── Python: start Datasette from a remote .db URL ─────────────────────────────
const DATASETTE_PY = String.raw`
import os
from datasette.app import Datasette
from js import fetch as jsfetch

async def start_datasette(db_url, aipipe_token):
    os.environ["OPENAI_API_KEY"] = aipipe_token
    os.environ["OPENAI_BASE_URL"] = "https://aipipe.org/openai/v1"

    # Pyodide compat: httpx streaming returns memoryview chunks; coerce to bytes.
    import openai._streaming as _s
    _orig = _s.SSEDecoder.aiter_bytes
    async def _patched(self, it):
        async def coerce(it):
            async for c in it:
                yield bytes(c) if isinstance(c, memoryview) else c
        async for sse in _orig(self, coerce(it)):
            yield sse
    _s.SSEDecoder.aiter_bytes = _patched

    # Download the SQLite file into Pyodide's in-memory filesystem
    resp = await jsfetch(db_url)
    data = (await resp.arrayBuffer()).to_py().tobytes()
    with open("/tmp/data.db", "wb") as f:
        f.write(data)
    print(f"[datasette] loaded {len(data):,} bytes from {db_url}")

    ds = Datasette(
        files=["/tmp/data.db"],
        settings={"base_url": "/", "num_sql_threads": 0},
        default_deny=False,
        metadata={
            "plugins": {
                "datasette-llm": {"default_model": "gpt-4o-mini"},
                # Uncomment to add a system prompt for the AI agent:
                # "datasette-agent": {"system_prompt_prefix": "You are an expert on this dataset..."},
            }
        },
    )
    ds.root_enabled = True

    # Single-user browser session — skip all permission checks
    from datasette.permissions import _skip_permission_checks
    raw = ds.app()
    async def app(scope, receive, send):
        t = _skip_permission_checks.set(True)
        try:    await raw(scope, receive, send)
        finally: _skip_permission_checks.reset(t)
    return app
`;

// ── Python: connects Datasette to the ASGI bridge ─────────────────────────────
const GLUE_PY = String.raw`
import json
from js import Object
from pyodide.ffi import to_js

bridge = None

async def setup(db_url, aipipe_token):
    global bridge
    app = await start_datasette(db_url, aipipe_token)
    bridge = ASGIBridge(app, root_path="")
    await bridge.startup()

async def handle_request(method, path, query, headers_json, body_buf, scheme, host, port):
    headers = json.loads(headers_json)
    body = b"" if body_buf is None else body_buf.to_py().tobytes()
    resp = await bridge.handle(method, path, query, headers, body,
                               scheme=scheme, host=host, port=int(port))
    return to_js({"status": resp["status"], "headers": resp["headers"], "body": resp["body"]},
                 dict_converter=Object.fromEntries)
`;

// ── Receive config from index.html ─────────────────────────────────────────────
let _cfg = { dbUrl: "", token: "" };
self.addEventListener("message", (e) => {
  if (e.data?.type === "app-config") _cfg = e.data;
});

// ── Boot ───────────────────────────────────────────────────────────────────────
startPyodideWorker({
  installingMessage: "installing-datasette",

  // Pyodide-bundled packages — loaded natively, no wheel download needed
  loadPackages: [
    "pluggy", "pyyaml", "sqlite3", "markupsafe", "pydantic", "pydantic_core",
    "packaging", "click", "jinja2", "httpx", "anyio", "sniffio", "certifi",
    "openai", "cryptography", "python-dateutil",
  ],

  // Pre-vetted pure-Python wheels compatible with Pyodide.
  // Hosted alongside the live TDS scores deployment.
  wheelManifestUrl: "https://tds-scores.pages.dev/vendor/datasette.json",

  // asgi-bridge.py is fetched and run before the inline Python above
  pythonFiles: [new URL("asgi-bridge.py", self.location.href).href],
  pythonSources: [DATASETTE_PY, GLUE_PY],
  get pyGlobals() { return { _db_url: _cfg.dbUrl, _token: _cfg.token }; },
  setupExpr: "await setup(_db_url, _token)",
});
