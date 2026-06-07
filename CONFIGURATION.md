# Configuration Reference

Everything you can tune is in `datasette-loader.js`. This document explains each option, what it does, and when you'd change it.

---

## LLM model

```python
"datasette-llm": {"default_model": "gpt-4o-mini"}
```

Controls which AI model answers questions. Passed to [aipipe.org](https://aipipe.org) which proxies to the actual provider.

| Model | Speed | Quality | Cost (aipipe credits) |
|---|---|---|---|
| `gpt-4o-mini` | Fast | Good | Low — default |
| `gpt-4o` | Medium | Better tool use | Higher |
| `gemini-2.0-flash` | Very fast | Good | Low |
| `claude-3-5-haiku` | Fast | Good | Low |

**When to change:** If the agent gives vague answers or doesn't use SQL automatically, try `gpt-4o` — it follows tool-use instructions more reliably.

---

## System prompt prefix

```python
# Currently commented out in datasette-loader.js:
"datasette-agent": {
    "system_prompt_prefix": "You are an expert on this dataset..."
}
```

Text prepended to every conversation. Use it to tell the agent what the data is about, what columns mean, or how to behave.

**Example for a sales database:**
```python
"datasette-agent": {
    "system_prompt_prefix": (
        "This database contains sales records. "
        "The 'orders' table has columns: id, customer_email, product, amount_usd, date. "
        "Always filter by the current year unless the user specifies otherwise."
    )
}
```

**When to use:** Whenever the agent gives confused answers about what the data means, or asks clarifying questions it shouldn't need to ask.

---

## `num_sql_threads`

```python
settings={"num_sql_threads": 0}
```

Number of threads Datasette uses to run SQL queries.

**Must stay at `0`** in this deployment. Pyodide runs Python in a single-threaded WebAssembly environment — creating threads raises an error. Setting it to `0` makes Datasette run SQL synchronously in the same thread, which works correctly in Pyodide.

Do not change this.

---

## `default_deny`

```python
ds = Datasette(..., default_deny=False)
```

When `True`, Datasette requires authentication for every page. When `False`, all pages are public by default.

**Must stay `False`** here. We're already skipping permission checks entirely via `_skip_permission_checks` (see below), so this setting has no practical effect — but setting it to `True` would conflict with that mechanism and could cause unexpected 403 errors.

---

## `_skip_permission_checks`

```python
from datasette.permissions import _skip_permission_checks
async def app(scope, receive, send):
    t = _skip_permission_checks.set(True)
    try:    await raw(scope, receive, send)
    finally: _skip_permission_checks.reset(t)
```

This bypasses all of Datasette's permission checks for every request. It's safe here because:
- There is no real server — everything runs locally in the user's own browser
- The user already authenticated by providing their own API token on the login screen
- Nobody else can access this Datasette instance

**Do not remove this** — without it, Datasette returns 403 Forbidden on most routes because there is no logged-in actor.

---

## `ds.root_enabled = True`

Enables the Datasette root user token mechanism. Required for `datasette-agent` to function — the agent plugin checks for root access internally.

Do not remove this.

---

## `wheelManifestUrl`

```js
wheelManifestUrl: "https://tds-scores.pages.dev/vendor/datasette.json"
```

URL of a JSON file listing the Python wheels to install via micropip. Currently points to the TDS scores deployment which has a pre-vetted set of wheels known to work with Pyodide.

**Why not PyPI directly?** micropip can only install pure-Python wheels. Datasette's dependencies include compiled packages (pydantic-core, cryptography, etc.) that must come from the Pyodide distribution, not PyPI. The manifest lists wheels that have already been filtered for Pyodide compatibility.

**To host your own wheels** (e.g. to add a private plugin):
1. Run `setup.sh` (requires re-adding it from the CF Pages version) to download wheels locally
2. Add your plugin wheel to `vendor/`
3. Commit `vendor/` and update `wheelManifestUrl` to point to your own GitHub Pages URL:
   ```js
   wheelManifestUrl: "https://<you>.github.io/datasette-gh-pages/vendor/datasette.json"
   ```

---

## `loadPackages`

```js
loadPackages: [
  "pluggy", "pyyaml", "sqlite3", "markupsafe", "pydantic", "pydantic_core",
  "packaging", "click", "jinja2", "httpx", "anyio", "sniffio", "certifi",
  "openai", "cryptography", "python-dateutil",
]
```

Packages loaded from Pyodide's own distribution (fast, compiled for WASM, no PyPI needed). These are the compiled dependencies that micropip cannot install from PyPI.

**Do not remove packages from this list** — Datasette will fail to import if any are missing. You can add packages from the [Pyodide package list](https://pyodide.org/en/stable/usage/packages-in-pyodide.html) if a plugin you add needs them.

---

## Database URL

```html
<!-- in index.html -->
<input id="db-url" type="url" value="https://datasette.io/content.db">
```

The default SQLite database loaded on startup. Users can override this in the form.

**Requirements for the database URL:**
- Must be a direct URL to a `.db` file (not an HTML page)
- Must have CORS headers (`Access-Control-Allow-Origin: *`) — GitHub Pages, S3, and most CDNs include these
- Must be publicly accessible (no auth required to download)

**To use a database from a Datasette instance**, append `/database-name.db`:
```
https://global-power-plants.datasettes.com/global-power-plants.db
```

---

## Summary: what you will actually change

| Setting | File | Change when... |
|---|---|---|
| AI model | `datasette-loader.js` | Agent gives poor answers |
| System prompt | `datasette-loader.js` | Agent doesn't understand the data |
| Default database URL | `index.html` | Deploying for a specific dataset |
| `wheelManifestUrl` | `datasette-loader.js` | Adding a private plugin |
| Everything else | — | Don't touch |
