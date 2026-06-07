// Pyodide Web Worker — runs Datasette + datasette-agent entirely in the browser.
// Receives {type:"app-config", dbUrl, token} before the "init" message.

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";

importScripts("bridge-python.js");

// ── Python: boot Datasette from a remote .db URL ──────────────────────────
const APP_PY = String.raw`
import os
from datasette.app import Datasette
from js import fetch as jsfetch

async def build_app(db_url, aipipe_token):
    # Configure the OpenAI-compatible LLM proxy
    os.environ["OPENAI_API_KEY"] = aipipe_token
    os.environ["OPENAI_BASE_URL"] = "https://aipipe.org/openai/v1"

    # Pyodide returns memoryview chunks from httpx streaming; coerce to bytes.
    import openai._streaming as _s
    _orig = _s.SSEDecoder.aiter_bytes
    async def _patched(self, it):
        async def _coerce(it):
            async for c in it:
                yield bytes(c) if isinstance(c, memoryview) else c
        async for sse in _orig(self, _coerce(it)):
            yield sse
    _s.SSEDecoder.aiter_bytes = _patched

    # Download the SQLite file into Pyodide's in-memory filesystem
    resp = await jsfetch(db_url)
    data = (await resp.arrayBuffer()).to_py().tobytes()
    with open("/tmp/data.db", "wb") as f:
        f.write(data)
    print(f"[app] loaded {len(data):,} byte db from {db_url}")

    ds = Datasette(
        files=["/tmp/data.db"],
        settings={"base_url": "/", "num_sql_threads": 0},
        default_deny=False,
        metadata={"plugins": {"datasette-llm": {"default_model": "gpt-4o-mini"}}},
    )
    ds.root_enabled = True

    # Wrap app to skip permission checks — single-user browser session
    from datasette.permissions import _skip_permission_checks
    raw = ds.app()
    async def app(scope, receive, send):
        t = _skip_permission_checks.set(True)
        try:    await raw(scope, receive, send)
        finally: _skip_permission_checks.reset(t)
    return app
`;

// ── Python: bridge glue ────────────────────────────────────────────────────
const GLUE_PY = String.raw`
import json
from js import Object
from pyodide.ffi import to_js

bridge = None

async def setup(db_url, aipipe_token):
    global bridge
    app = await build_app(db_url, aipipe_token)
    bridge = ASGIBridge(app, root_path="")
    await bridge.startup()
    print("[setup] ready")

async def handle_request(method, path, query, headers_json, body_buf, scheme, host, port):
    headers = json.loads(headers_json)
    body = b"" if body_buf is None else body_buf.to_py().tobytes()
    resp = await bridge.handle(method, path, query, headers, body,
                               scheme=scheme, host=host, port=int(port))
    return to_js({"status": resp["status"], "headers": resp["headers"], "body": resp["body"]},
                 dict_converter=Object.fromEntries)
`;

importScripts("worker-runtime.js");

// Capture config sent before "init" (addEventListener stacks; onmessage would be overwritten)
let _cfg = { dbUrl: "", token: "" };
self.addEventListener("message", (e) => {
  if (e.data?.type === "app-config") _cfg = e.data;
});

startAsgiWorker({
  pyodideUrl: PYODIDE_URL,
  installManifest: "datasette.json",
  installingMessage: "installing-datasette",
  loadPackages: [
    "pluggy", "pyyaml", "sqlite3", "markupsafe", "pydantic", "pydantic_core",
    "packaging", "click", "jinja2", "httpx", "anyio", "sniffio", "certifi",
    "openai", "cryptography", "python-dateutil",
  ],
  pythonSources: [ASGI_BRIDGE_PY, APP_PY, GLUE_PY],
  get pyGlobals() { return { _db_url: _cfg.dbUrl, _token: _cfg.token }; },
  setupExpr: "await setup(_db_url, _token)",
});
