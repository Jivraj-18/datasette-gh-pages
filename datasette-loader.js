// datasette-loader.js — runs inside a browser Web Worker (background thread).
// Boots Datasette in Python/WASM and handles every HTTP request the service
// worker intercepts from the page's iframe.
//
// THIS IS THE ONLY FILE YOU NEED TO EDIT to change:
//   - which Datasette plugins to use
//   - the AI model or system prompt

importScripts("pyodide-boot.js");

// ── ASGI bridge — translates browser fetch calls into Python ASGI ─────────────
const ASGI_BRIDGE_PY = String.raw`
import asyncio

class ASGIBridge:
    def __init__(self, app, root_path=""):
        self.app = app
        self.root_path = root_path

    async def startup(self):
        loop = asyncio.get_event_loop()
        self._recv_queue = asyncio.Queue()
        self._startup_complete = loop.create_future()
        self._shutdown_complete = loop.create_future()
        scope = {"type": "lifespan", "asgi": {"version": "3.0", "spec_version": "2.0"}}
        await self._recv_queue.put({"type": "lifespan.startup"})

        async def receive():
            return await self._recv_queue.get()

        async def send(message):
            t = message["type"]
            if t == "lifespan.startup.complete":
                if not self._startup_complete.done():
                    self._startup_complete.set_result(True)
            elif t == "lifespan.startup.failed":
                if not self._startup_complete.done():
                    self._startup_complete.set_exception(
                        RuntimeError(message.get("message", "lifespan startup failed")))
            elif t == "lifespan.shutdown.complete":
                if not self._shutdown_complete.done():
                    self._shutdown_complete.set_result(True)

        async def run():
            try:
                await self.app(scope, receive, send)
            except Exception as exc:
                if not self._startup_complete.done():
                    self._startup_complete.set_exception(exc)
                if not self._shutdown_complete.done():
                    self._shutdown_complete.set_exception(exc)

        asyncio.ensure_future(run())
        await self._startup_complete

    async def handle(self, method, path, query_string, headers, body=b"",
                     scheme="http", host="localhost", port=80):
        if isinstance(query_string, str): query_string = query_string.encode("latin-1")
        if isinstance(body, str): body = body.encode("utf-8")
        if body is None: body = b""

        raw_headers = []
        have_host = False
        for name, value in headers:
            name_bytes = name.lower().encode("latin-1")
            if name_bytes == b"host": have_host = True
            raw_headers.append((name_bytes, value.encode("latin-1")))
        if not have_host:
            h = host if int(port) in (80, 443) else f"{host}:{port}"
            raw_headers.append((b"host", h.encode("latin-1")))

        scope = {
            "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1", "method": method.upper(),
            "scheme": scheme, "path": path, "raw_path": path.encode("utf-8"),
            "query_string": query_string, "root_path": self.root_path,
            "headers": raw_headers, "server": (host, int(port)), "client": ("127.0.0.1", 0),
        }

        msgs = [{"type": "http.request", "body": body, "more_body": False}]
        async def receive():
            return msgs.pop(0) if msgs else {"type": "http.disconnect"}

        resp = {"status": 500, "headers": [], "body": bytearray()}
        async def send(message):
            if message["type"] == "http.response.start":
                resp["status"] = message["status"]
                resp["headers"] = [[k.decode("latin-1"), v.decode("latin-1")]
                                   for k, v in message.get("headers", [])]
            elif message["type"] == "http.response.body":
                resp["body"].extend(message.get("body", b"") or b"")

        await self.app(scope, receive, send)
        return {"status": resp["status"], "headers": resp["headers"], "body": bytes(resp["body"])}
`;

// ── Python: start Datasette from a remote .db URL ─────────────────────────────
const DATASETTE_PY = String.raw`
import os
from datasette.app import Datasette
from js import fetch as jsfetch

async def start_datasette(db_url, aipipe_token, base_url="/"):
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
        settings={"base_url": _base_url, "num_sql_threads": 0},
        default_deny=False,
        metadata={
            "plugins": {
                "datasette-llm": {"default_model": "gpt-4o-mini"},
                # Uncomment to guide the AI agent:
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

async def setup(db_url, aipipe_token, base_url="/"):
    global bridge
    app = await start_datasette(db_url, aipipe_token, base_url)
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

  // Pre-vetted pure-Python wheels, compatible with Pyodide
  wheelManifestUrl: "https://tds-scores.pages.dev/vendor/datasette.json",

  pythonSources: [ASGI_BRIDGE_PY, DATASETTE_PY, GLUE_PY],
  get pyGlobals() { return { _db_url: _cfg.dbUrl, _token: _cfg.token, _base_url: _cfg.baseUrl }; },
  setupExpr: "await setup(_db_url, _token, _base_url)",
});
