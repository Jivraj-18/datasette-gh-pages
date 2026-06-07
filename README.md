# Datasette Agent on GitHub Pages

Run [Datasette](https://datasette.io) + AI agent **entirely in the browser** — no server, free hosting.

Point it at any public SQLite `.db` file and chat with the data in plain English. Powered by [Pyodide](https://pyodide.org) (Python/WASM) + [aipipe.org](https://aipipe.org).

**Live demo:** `https://jivraj-18.github.io/datasette-gh-pages/`

---

## Deploy

1. Fork this repo
2. **Settings → Pages → Deploy from branch → `main` / `(root)`**
3. Done — live at `https://<you>.github.io/datasette-gh-pages/`

No build step. No setup script.

---

## Usage

Open the site, enter:
- **SQLite URL** — any public `.db` file (default: `https://datasette.io/content.db`)
- **Aipipe token** — free at [aipipe.org/login](https://aipipe.org/login) (Google sign-in)

First load: ~30–60s (downloads ~20MB of Python packages, cached after that).

---

## Files

| File | Purpose | Edit? |
|---|---|---|
| `datasette-loader.js` | Boots Datasette + configures plugins/model | **Yes — only file you touch** |
| `index.html` | Login form, default DB URL | Only for default DB URL |
| `service-worker.js` | Routes iframe fetches to Pyodide | No |
| `pyodide-boot.js` | Generic Pyodide loader | No |

---

## Configuration (`datasette-loader.js`)

### AI model
```python
"datasette-llm": {"default_model": "gpt-4o-mini"}
```
Options on aipipe.org: `gpt-4o` (better tool use), `gemini-2.0-flash` (faster), `claude-3-5-haiku`.  
Switch to `gpt-4o` if the agent answers from general knowledge instead of querying the DB.

### System prompt
```python
"datasette-agent": {
    "system_prompt_prefix": "This DB contains sales data. Column 'amt' is in USD."
}
```
Tell the agent what the data means. Reduces hallucination. Use when the agent asks questions it should already know.

### Default database URL
In `index.html`:
```html
<input id="db-url" type="url" value="https://your-host.com/data.db">
```
Must be a direct `.db` URL with CORS enabled (`Access-Control-Allow-Origin: *`). GitHub Pages, S3, and most CDNs work.

### `num_sql_threads: 0`
**Do not change.** Pyodide is single-threaded (WebAssembly). Setting this to anything other than `0` will crash the worker.

### `default_deny=False` + `_skip_permission_checks`
**Do not change.** This is a single-user browser app — the user is implicitly trusted after entering their token. Removing these causes 403 errors on all Datasette routes.

### `wheelManifestUrl`
```js
wheelManifestUrl: "https://tds-scores.pages.dev/vendor/datasette.json"
```
Points to a pre-vetted list of pure-Python wheels compatible with Pyodide. micropip cannot install compiled wheels from PyPI — this manifest contains the already-filtered set. Change only if you need to add a private plugin (host your own `vendor/` folder and point here).

---

## How it works

```
Browser
├── service-worker.js   intercepts /-/* fetches, strips subpath prefix
├── datasette-loader.js Python/WASM worker: boots Datasette, handles ASGI
└── index.html          shell: brokers messages between SW ↔ worker
```

```
User asks question
→ iframe fetch (/-/agent/stream)
→ service-worker intercepts → forwards to index.html
→ index.html → datasette-loader.js (Pyodide/Python)
→ Datasette → datasette-agent → sql_query tool
→ aipipe.org → LLM → SSE stream back to iframe
```

---

## Credits

Architecture by [Simon Willison — pyodide-asgi-browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser) · [Datasette](https://datasette.io) · [datasette-agent](https://github.com/datasette/datasette-agent) · [Pyodide](https://pyodide.org)
