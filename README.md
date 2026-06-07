# datasette-pyodide-gh-pages

Run [Datasette](https://datasette.io) + an AI agent **entirely in the browser** — no server, no Docker, free hosting.

Uses [Pyodide](https://pyodide.org) (Python → WebAssembly) and a service worker to intercept HTTP requests. Point it at any public `.db` file and chat with it using [datasette-agent](https://github.com/datasette/datasette-agent) via [aipipe.org](https://aipipe.org).

---

## How it works

```
Browser
├── index.html          ← form: db URL + aipipe token
├── sw.js               ← service worker: intercepts /-/* fetches → Pyodide
└── worker-app.js       ← Pyodide web worker
    ├── downloads the .db file
    ├── boots Datasette (Python/WASM, in-memory)
    └── handles ASGI requests from the service worker
```

Request flow: `iframe fetch → SW → shell → Pyodide worker → Datasette → response`

First load: ~20 MB download (Pyodide + wheels). Cached after that.

---

## Deploy to GitHub Pages

### Prerequisites

Install [uv](https://docs.astral.sh/uv/getting-started/installation/):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Step 1 — Clone

```bash
git clone https://github.com/<you>/datasette-pyodide-gh-pages
cd datasette-pyodide-gh-pages
```

### Step 2 — Download wheels

```bash
bash setup.sh
```

This uses `uv` to download all Python wheels into `vendor/` and writes `vendor/datasette.json`.

### Step 3 — Commit and push

```bash
git add vendor/
git commit -m "add vendor wheels"
git push
```

### Step 4 — Enable GitHub Pages

**Settings → Pages → Source → Deploy from branch → `main` / `(root)`**

Your site: `https://<you>.github.io/datasette-pyodide-gh-pages/`

---

## Usage

Open the URL and enter:

- **SQLite database URL** — any public `.db` file (default: `https://datasette.io/content.db`)
- **Aipipe token** — free token at [aipipe.org/login](https://aipipe.org/login) (Google sign-in)

The AI agent opens at `/-/agent`. Ask anything about the data.

---

## Customise

### Change the LLM model

In `worker-app.js`, find `"default_model": "gpt-4o-mini"` and change it to any model on aipipe.org — e.g. `gpt-4o`, `gemini-2.0-flash`, `claude-3-5-haiku`.

### Bundle your own datasette plugin

```bash
# Build your plugin wheel
uv build

# Copy to vendor/
cp dist/your_plugin-*.whl vendor/

# Re-index
uv run python3 -c "
import json, pathlib
v = pathlib.Path('vendor')
wheels = sorted(f.name for f in v.glob('*.whl'))
(v / 'datasette.json').write_text(json.dumps({'wheels': wheels}, indent=2))
print(len(wheels), 'wheels')
"
```

### Private or per-user data

If your data isn't a public URL, load it differently in `worker-app.js` — for example, fetch a JSON blob and insert rows into an in-memory SQLite table. See the [TDS scores example](https://github.com/Jivraj-18/datasette-agent/tree/main/cloudflare-pages) for a full working pattern.

---

## File reference

| File | Purpose |
|---|---|
| `index.html` | Login form. Registers SW, starts Pyodide worker, brokers messages. |
| `sw.js` | Service worker. Lets static files through; routes `/-/*` to Pyodide. |
| `worker-app.js` | Pyodide worker. Downloads DB, boots Datasette, handles ASGI. |
| `worker-runtime.js` | Generic Pyodide loader + micropip installer (from [simonw/research](https://github.com/simonw/research/tree/main/pyodide-asgi-browser)). |
| `bridge-python.js` | Python ASGI ↔ fetch bridge (embedded as a JS string). |
| `vendor.py` | Downloads Pyodide runtime + datasette core wheels into `vendor/`. |
| `setup.sh` | Runs `vendor.py` + `uv pip download` to populate `vendor/`. Run once. |
| `vendor/` | All Python wheels + Pyodide runtime. Commit this directory. |

---

## Credits

- Architecture: [Simon Willison — pyodide-asgi-browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser)
- [Datasette](https://datasette.io) · [datasette-agent](https://github.com/datasette/datasette-agent) · [Pyodide](https://pyodide.org) · [aipipe.org](https://aipipe.org)
