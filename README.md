# datasette-pyodide-gh-pages

Run [Datasette](https://datasette.io) + an AI agent **entirely in the browser** — no server, no Docker, free hosting on GitHub Pages.

Uses [Pyodide](https://pyodide.org) (Python → WebAssembly) and a service worker to intercept HTTP requests. Point it at any public `.db` file and chat with it using [datasette-agent](https://github.com/datasette/datasette-agent) via [aipipe.org](https://aipipe.org).

---

## File structure

```
index.html          ← Login form. Starts the worker, registers the SW, brokers messages.
sw.js               ← Service worker. Routes /-/* requests to Pyodide; static files pass through.
worker.js           ← YOUR APP. Edit this to change Datasette config, plugins, system prompt.
pyodide-runtime.js  ← Generic Pyodide loader. Loads packages, runs Python. Don't edit.
bridge.py           ← ASGI ↔ fetch translation layer. Don't edit.
vendor.py           ← Downloads Pyodide runtime + wheels into vendor/. Run once via setup.sh.
setup.sh            ← One-shot setup: runs vendor.py + downloads plugin wheels.
vendor/             ← Downloaded wheels + Pyodide runtime. Committed to repo. Gitignored by default.
```

**You only ever edit `worker.js`** — that's where Datasette is configured, plugins are listed, and the AI system prompt lives.

---

## How it works

```
Browser tab (index.html)
  │
  ├── registers sw.js as service worker
  ├── starts worker.js as a Web Worker (Pyodide boots here)
  └── loads /-/agent in an iframe
        │
        └── every fetch (/-/*) is intercepted by sw.js
              │
              └── sw.js → index.html → worker.js → Datasette (Python/WASM) → response
```

First load downloads ~20 MB (Pyodide + wheels). Cached after that.

---

## Deploy to GitHub Pages

### Prerequisites

```bash
# Install uv (fast Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Step 1 — Clone

```bash
git clone https://github.com/<you>/datasette-pyodide-gh-pages
cd datasette-pyodide-gh-pages
```

### Step 2 — Download wheels into vendor/

```bash
bash setup.sh
```

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

### Point to a different database

Change the default URL in `index.html`:
```html
<input id="db-url" type="url" value="https://your-host.com/your-data.db">
```

### Change the LLM model

In `worker.js`, find `"default_model": "gpt-4o-mini"` and change to any model on aipipe.org:
`gpt-4o`, `gemini-2.0-flash`, `claude-3-5-haiku`, etc.

### Add a custom system prompt

In `worker.js`, add a `system_prompt_prefix` to the Datasette metadata:
```python
metadata={"plugins": {
    "datasette-llm": {"default_model": "gpt-4o-mini"},
    "datasette-agent": {"system_prompt_prefix": "You are an expert on this dataset..."},
}}
```

### Bundle your own datasette plugin

```bash
uv build                                 # builds dist/your_plugin-*.whl
cp dist/your_plugin-*.whl vendor/

# Re-index
uv run python3 -c "
import json, pathlib
wheels = sorted(f.name for f in pathlib.Path('vendor').glob('*.whl'))
pathlib.Path('vendor/datasette.json').write_text(json.dumps({'wheels': wheels}, indent=2))
"
git add vendor/ && git commit -m "add plugin" && git push
```

---

## Credits

- Architecture: [Simon Willison — pyodide-asgi-browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser)
- [Datasette](https://datasette.io) · [datasette-agent](https://github.com/datasette/datasette-agent) · [Pyodide](https://pyodide.org) · [aipipe.org](https://aipipe.org)
