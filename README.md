# Datasette Agent on GitHub Pages

Run [Datasette](https://datasette.io) + an AI agent **entirely in the browser** — no server, no setup, free hosting on GitHub Pages.

Point it at any public SQLite database and chat with it using natural language. Everything runs locally in the user's browser via [Pyodide](https://pyodide.org) (Python compiled to WebAssembly). Python packages are installed from PyPI at runtime — nothing to pre-build or commit.

**Live demo:** `https://jivraj-18.github.io/datasette-gh-pages/`

---

## How it works

```
index.html  (you open this in a browser)
   │
   ├── registers service-worker.js
   │     └── intercepts all /-/* requests from the Datasette iframe
   │
   ├── starts datasette-loader.js in a background thread
   │     ├── loads Python/WASM runtime (Pyodide) from CDN
   │     ├── installs datasette + datasette-agent from PyPI
   │     ├── downloads your .db file
   │     └── runs Datasette inside Python
   │
   └── loads /-/agent in an iframe
         └── every fetch → service worker → Python → response
```

First load: ~30–60s (downloads ~20MB of Python packages). Cached after that.

---

## Files

| File | Role | Edit? |
|---|---|---|
| `index.html` | Login form + browser bootstrap | Only to change the default DB URL |
| `service-worker.js` | Intercepts Datasette requests, routes to Python | No |
| `datasette-loader.js` | Starts Datasette in Python/WASM | **Yes — your app config lives here** |
| `pyodide-boot.js` | Generic Pyodide loader (not specific to Datasette) | No |
| `asgi-bridge.py` | Translates browser fetches into Python ASGI calls | No |

**You only edit `datasette-loader.js`** to change the database, model, plugins, or system prompt.

---

## Deploy

### 1. Fork or clone

```bash
git clone https://github.com/Jivraj-18/datasette-gh-pages
```

No setup, no build step. The repo is ready to deploy as-is.

### 2. Enable GitHub Pages

In your repo: **Settings → Pages → Source → Deploy from branch → `main` / `(root)`**

Your site is live at `https://<you>.github.io/datasette-gh-pages/` in ~1 minute.

---

## Usage

Open the site and enter:

- **SQLite database URL** — any publicly accessible `.db` file (default: `https://datasette.io/content.db`)
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

In `datasette-loader.js`, find `"default_model"` and change it:
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

In `datasette-loader.js`, add the package name to `pypiPackages`:
```js
pypiPackages: [
  "datasette",
  "datasette-agent",
  "datasette-llm",
  "llm",
  "your-plugin-name",   // ← add here
],
```

---

## Credits

- Architecture by [Simon Willison — pyodide-asgi-browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser)
- [Datasette](https://datasette.io) · [datasette-agent](https://github.com/datasette/datasette-agent) · [Pyodide](https://pyodide.org) · [aipipe.org](https://aipipe.org)
