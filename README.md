# Datasette Agent on GitHub Pages

Run [Datasette](https://datasette.io) + an AI agent **entirely in the browser** — no server required. Hosted free on GitHub Pages.

Point it at any public SQLite database and chat with it using natural language. Everything runs locally in the user's browser via [Pyodide](https://pyodide.org) (Python compiled to WebAssembly).

**Live demo:** `https://<you>.github.io/datasette-gh-pages/`

---

## How it works

The browser runs Python (via Pyodide/WASM) in a background thread. A service worker intercepts all Datasette HTTP requests and routes them to that Python thread instead of a real server.

```
index.html  (you open this)
   │
   ├── registers service-worker.js
   │     └── intercepts all /-/* requests from the iframe
   │
   ├── starts datasette-loader.js in a background thread
   │     ├── boots Python via Pyodide
   │     ├── downloads your .db file
   │     └── runs Datasette + datasette-agent inside Python
   │
   └── loads /-/agent in an iframe
         └── every fetch → service worker → Python → response
```

---

## Files

| File | Role | Edit? |
|---|---|---|
| `index.html` | Login form + browser bootstrap | Only to change defaults |
| `service-worker.js` | Intercepts Datasette requests, routes to Python | No |
| `datasette-loader.js` | Starts Datasette in Python/WASM | **Yes — your app config lives here** |
| `pyodide-boot.js` | Generic Pyodide loader (not specific to Datasette) | No |
| `asgi-bridge.py` | Translates browser fetches into Python ASGI calls | No |
| `download-wheels.py` | Downloads Pyodide runtime + wheels into `vendor/` | No |
| `setup.sh` | One-shot setup script | No |
| `vendor/` | Downloaded wheels + Pyodide runtime (commit this) | No |

**You only edit `datasette-loader.js`** to change the database, model, plugins, or system prompt.

---

## Deploy

### 1. Prerequisites

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # install uv
```

### 2. Clone and download wheels

```bash
git clone https://github.com/Jivraj-18/datasette-gh-pages
cd datasette-gh-pages
bash setup.sh
```

This downloads the Pyodide runtime and all Python wheels into `vendor/` (~20 MB).

### 3. Commit and push

```bash
git add vendor/
git commit -m "add vendor wheels"
git push
```

### 4. Enable GitHub Pages

In your repo: **Settings → Pages → Source → Deploy from branch → `main` / `(root)`**

Your site goes live at `https://<you>.github.io/datasette-gh-pages/` in ~1 minute.

---

## Usage

Open the site and enter:

- **SQLite database URL** — any publicly accessible `.db` file
- **Aipipe token** — free LLM proxy token from [aipipe.org/login](https://aipipe.org/login) (Google sign-in)

The AI agent opens at `/-/agent`. Ask questions about the data in plain English.

---

## Customise

### Change the default database

In `index.html`, update the `value` of the database URL input:
```html
<input id="db-url" type="url" value="https://your-host.com/your-data.db">
```

### Change the AI model

In `datasette-loader.js`, find `"default_model"` and change it to any model available on aipipe.org:
```python
"datasette-llm": {"default_model": "gpt-4o"}   # or gemini-2.0-flash, claude-3-5-haiku, …
```

### Add a system prompt

In `datasette-loader.js`, add to the metadata:
```python
"datasette-agent": {
    "system_prompt_prefix": "You are an expert analyst. Always show your SQL queries."
}
```

### Add a Datasette plugin

```bash
# Build your plugin wheel
cd your-plugin && uv build

# Copy to vendor/
cp dist/your_plugin-*.whl ../datasette-gh-pages/vendor/

# Re-index
cd ../datasette-gh-pages
uv run python3 -c "
import json, pathlib
wheels = sorted(f.name for f in pathlib.Path('vendor').glob('*.whl'))
pathlib.Path('vendor/datasette.json').write_text(json.dumps({'wheels': wheels}, indent=2))
"
git add vendor/ && git commit -m "add plugin" && git push
```

---

## Credits

- Architecture by [Simon Willison — pyodide-asgi-browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser)
- [Datasette](https://datasette.io) · [datasette-agent](https://github.com/datasette/datasette-agent) · [Pyodide](https://pyodide.org) · [aipipe.org](https://aipipe.org)
