#!/usr/bin/env bash
# setup.sh — download vendor wheels and prepare for GitHub Pages deployment.
# Run once before the first push (and again whenever you update packages).
#
# Requires: uv (https://docs.astral.sh/uv/getting-started/installation/)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
VENDOR="$REPO_ROOT/vendor"

echo "→ Creating vendor/ directory"
mkdir -p "$VENDOR"

# ── 1. Pyodide runtime + core datasette wheels ────────────────────────────────
echo "→ Downloading Pyodide + datasette wheels"
cd "$REPO_ROOT"
uv run vendor.py

# ── 2. llm + datasette plugin wheels ─────────────────────────────────────────
echo "→ Downloading llm + datasette-llm wheels"
uv pip download --only-binary :all: --no-deps --pre --dest "$VENDOR" \
  "llm>=0.32a1" \
  datasette-llm \
  datasette-secrets \
  condense_json \
  python-ulid \
  sqlite-migrate \
  puremagic

# ── 3. (Optional) Copy your own plugin wheel ──────────────────────────────────
# If you have a custom datasette plugin, build it and copy the wheel here:
#   uv build
#   cp dist/your_plugin-*.whl "$VENDOR/"

# ── 4. Write the wheel manifest ───────────────────────────────────────────────
echo "→ Writing vendor/datasette.json"
uv run python3 - <<'EOF'
import json, pathlib
vendor = pathlib.Path("vendor")
wheels = sorted(f.name for f in vendor.glob("*.whl"))
(vendor / "datasette.json").write_text(json.dumps({"wheels": wheels}, indent=2))
print(f"   {len(wheels)} wheels indexed")
EOF

echo ""
echo "✓ Done. Commit vendor/ and push:"
echo "  git add vendor/ && git commit -m 'add vendor wheels' && git push"
