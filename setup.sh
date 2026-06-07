#!/usr/bin/env bash
# setup.sh — Populate vendor/ before deploying to GitHub Pages.
#
# What this does:
#   1. Downloads the Pyodide runtime (Python/WASM) into vendor/
#   2. Downloads datasette + llm plugin wheels into vendor/
#   3. Writes vendor/datasette.json — the manifest worker.js reads at startup
#
# Run once before your first push, and again whenever you update packages.
# Requires: uv (https://docs.astral.sh/uv/getting-started/installation/)

set -euo pipefail
cd "$(dirname "$0")"

echo "── Step 1: Pyodide runtime + core datasette wheels ──"
uv run vendor.py

echo "── Step 2: llm + datasette plugin wheels ──"
uv pip download --only-binary :all: --no-deps --pre --dest vendor/ \
  "llm>=0.32a1" \
  datasette-llm \
  datasette-secrets \
  condense_json \
  python-ulid \
  sqlite-migrate \
  puremagic

echo "── Step 3: Write vendor/datasette.json manifest ──"
uv run python3 - <<'EOF'
import json, pathlib
wheels = sorted(f.name for f in pathlib.Path("vendor").glob("*.whl"))
pathlib.Path("vendor/datasette.json").write_text(json.dumps({"wheels": wheels}, indent=2))
print(f"  {len(wheels)} wheels indexed in vendor/datasette.json")
EOF

echo ""
echo "✓ vendor/ is ready. Now commit and push:"
echo "  git add vendor/ && git commit -m 'add vendor wheels' && git push"
