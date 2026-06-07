#!/usr/bin/env python3
"""
vendor.py — Download Pyodide runtime + datasette wheels into ./vendor/

PURPOSE: GitHub Pages is a static host. The browser's Pyodide worker needs
~20 MB of files (Python runtime + datasette wheels). This script pre-downloads
them so they're served from your own Pages URL instead of external CDNs.

This is OPTIONAL if your users always have internet access — the worker can
load Pyodide directly from cdn.jsdelivr.net. But vendoring makes the app:
  - Work offline after first visit
  - Load faster (same origin, no CORS)
  - Stable (immune to CDN version changes)

Run once before deploying:
  uv run vendor.py
"""

import json
import urllib.request
from pathlib import Path

PYODIDE_VERSION = "0.29.4"
CDN = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full/"
VENDOR = Path(__file__).resolve().parent / "vendor"

# Pyodide runtime files the browser needs to boot Python/WASM
RUNTIME_FILES = [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
]

# Pyodide-bundled packages (already compiled into Pyodide, just need their .whl)
BUNDLED_PACKAGES = [
    "micropip", "packaging", "pluggy", "pyyaml", "sqlite3",
    "markupsafe", "pydantic", "pydantic_core", "click",
    "jinja2", "httpx", "anyio", "sniffio", "certifi",
    "openai", "cryptography", "python-dateutil",
]


def fetch(url: str, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  skip  {dest.name}")
        return
    print(f"  fetch {dest.name}")
    with urllib.request.urlopen(url, timeout=120) as r:
        dest.write_bytes(r.read())


def bundled_wheels(lock: dict, packages: list[str]) -> list[str]:
    """Resolve package names to their .whl filenames using the Pyodide lock."""
    pk = lock["packages"]
    seen: set[str] = set()

    def visit(name: str):
        key = name.lower().replace("_", "-")
        if key in seen or key not in pk:
            return
        seen.add(key)
        for dep in pk[key].get("depends", []):
            visit(dep)

    for p in packages:
        visit(p)
    return sorted(pk[n]["file_name"] for n in seen)


def main():
    VENDOR.mkdir(exist_ok=True)

    print("Downloading Pyodide runtime…")
    for name in RUNTIME_FILES:
        fetch(CDN + name, VENDOR / name)

    print("Resolving bundled package wheels…")
    lock = json.loads((VENDOR / "pyodide-lock.json").read_text())
    for wheel in bundled_wheels(lock, BUNDLED_PACKAGES):
        fetch(CDN + wheel, VENDOR / wheel)

    print(f"Done. vendor/ has {len(list(VENDOR.iterdir()))} files.")


if __name__ == "__main__":
    main()
