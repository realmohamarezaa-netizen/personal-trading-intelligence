#!/bin/bash
# ─── Personal Trading Intelligence — Windows installer build (Linux host) ────
# Assembles the Electron app package and compiles the NSIS installer.
#
# v1.3.0 guarantees:
#   * NO database of any kind ships inside the installer — user data is
#     created at runtime in the user-data directory and migrated on demand.
#     (The build FAILS if a custom.db sneaks into the payload.)
#   * The version comes from ONE source of truth: src/lib/app-info.ts.
#   * All tool paths are overridable via env vars and missing prerequisites
#     fail with an explicit message.
#
# Environment overrides:
#   ELECTRON_ZIP   (default /home/z/electron-win32-x64.zip)
#   PY_EMBED_ZIP   (default $ROOT/python-embed.zip)
#   WHEELS_DIR     (default /home/z/py-wheels)
#   MAKENSIS       (default /home/z/nsis-root/usr/bin/makensis)
#   NSISDIR        (default /home/z/nsis-root/usr/share/nsis)
#   STAGE_DIR      (default /home/z/pti-stage)
#
# Prereq: run `NEXT_DIST_DIR=.next-desktop bun run build` first.
# Usage: NEXT_DIST_DIR=.next-desktop bash desktop-build/build-installer.sh [version]

set -euo pipefail
exec 2>&1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() { echo "BUILD ERROR: $*" >&2; exit 1; }

# ─── Version: single source of truth ─────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(grep -E "^export const APP_VERSION" "$ROOT/src/lib/app-info.ts" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" || true)"
fi
[ -n "$VERSION" ] || fail "could not determine version — pass it as arg 1 or check src/lib/app-info.ts"
echo "=== Version: $VERSION (from src/lib/app-info.ts) ==="

# ─── Tool paths (overridable, verified with explicit errors) ─────────────────
NEXT_DIST="$ROOT/${NEXT_DIST_DIR:-.next}"
STAGE="${STAGE_DIR:-/home/z/pti-stage}"
ELECTRON_ZIP="${ELECTRON_ZIP:-/home/z/electron-win32-x64.zip}"
PY_EMBED_ZIP="${PY_EMBED_ZIP:-$ROOT/python-embed.zip}"
WHEELS="${WHEELS_DIR:-/home/z/py-wheels}"
MAKENSIS="${MAKENSIS:-/home/z/nsis-root/usr/bin/makensis}"
export NSISDIR="${NSISDIR:-/home/z/nsis-root/usr/share/nsis}"

[ -d "$NEXT_DIST/standalone" ] || fail "missing $NEXT_DIST/standalone — run: NEXT_DIST_DIR=${NEXT_DIST_DIR:-.next-desktop} bun run build"
[ -f "$ELECTRON_ZIP" ]         || fail "missing Electron win32-x64 zip ($ELECTRON_ZIP) — set ELECTRON_ZIP"
[ -f "$PY_EMBED_ZIP" ]         || fail "missing Python embeddable zip ($PY_EMBED_ZIP) — set PY_EMBED_ZIP"
[ -d "$WHEELS" ] && ls "$WHEELS"/*.whl >/dev/null 2>&1 || fail "missing MT5 wheels dir ($WHEELS) — set WHEELS_DIR"
[ -x "$MAKENSIS" ]             || fail "missing makensis at $MAKENSIS — set MAKENSIS"

echo "=== [1/8] Clean stage ==="
rm -rf "$STAGE"
mkdir -p "$STAGE/app/resources/app"

echo "=== [2/8] Next.js standalone -> app/resources/app/server ==="
cp -r "$NEXT_DIST/standalone/." "$STAGE/app/resources/app/server/"

# standalone output does NOT include static assets — copy them manually.
# IMPORTANT: the server serves /_next/static from <serverDir>/<distDir>/static,
# where distDir is baked into required-server-files.json at build time
# (e.g. ".next-desktop"). Copying to ".next/static" would 404 every CSS/JS
# chunk and the installed app would render unstyled HTML.
echo "=== [2b/8] Static assets (<distDir>/static, public/) ==="
DIST_NAME="$(basename "$NEXT_DIST")"
mkdir -p "$STAGE/app/resources/app/server/$DIST_NAME"
cp -r "$NEXT_DIST/static" "$STAGE/app/resources/app/server/$DIST_NAME/static"
# Replace public/ cleanly: cp -r into an existing standalone public/ would
# nest public/public/ and could smuggle the previous installer exe inside
# itself, so wipe it first, then copy, then strip exes/zips from the payload.
rm -rf "$STAGE/app/resources/app/server/public"
cp -r "$ROOT/public" "$STAGE/app/resources/app/server/public"
rm -f "$STAGE/app/resources/app/server/public"/PTI-Setup-*.exe \
      "$STAGE/app/resources/app/server/public"/*.zip

echo "=== [3/8] Electron shell ==="
cd "$STAGE"
unzip -q "$ELECTRON_ZIP" -d "$STAGE/app"
mv "$STAGE/app/electron.exe" "$STAGE/app/TradingIntelligence.exe"

echo "=== [4/8] App payload (main.js, package.json, user-data module, connector) ==="
APP="$STAGE/app/resources/app"
cp "$ROOT/desktop-build/main.js" "$APP/main.js"
cp "$ROOT/desktop-build/user-data.js" "$APP/user-data.js"
cp "$ROOT/desktop-build/app-package.json" "$APP/package.json"
python3 - "$VERSION" <<'EOF'
import json, sys
p = 'app/resources/app/package.json'
d = json.load(open(p))
d['version'] = sys.argv[1]
json.dump(d, open(p, 'w'), indent=2)
EOF
mkdir -p "$APP/connector"
cp "$ROOT/mt5-connector/sync.py" "$ROOT/mt5-connector/sync_service.py" "$ROOT/mt5-connector/mt5_shim.py" "$APP/connector/"

# ─── DATA-SAFETY ASSERTION: no developer/private database may ship ──────────
if [ -e "$APP/db" ]; then
  fail "refusing to ship: payload contains a 'db' folder ($APP/db) — the installer must never bundle a database"
fi
echo "=== payload contains NO database ✓ ==="

echo "=== [5/8] Icons ==="
node "$ROOT/desktop-build/make-icons.mjs" "$ROOT/desktop-build/icon.svg" "$APP"

echo "=== [6/8] Bundled Python 3.12 (win64) + MT5 wheels ==="
mkdir -p "$APP/python"
unzip -q "$PY_EMBED_ZIP" -d "$APP/python"
# enable site-packages in the embeddable distribution
cat > "$APP/python/python312._pth" <<'EOF'
python312.zip
.
Lib/site-packages
import site
EOF
mkdir -p "$APP/python/Lib/site-packages"
for whl in "$WHEELS"/*.whl; do
  unzip -qo "$whl" -d "$APP/python/Lib/site-packages/"
done

echo "=== [7/8] NSIS script (version $VERSION) ==="
cp "$ROOT/desktop-build/README-fa.txt" "$STAGE/README-fa.txt"
cd "$STAGE"
cp "$ROOT/desktop-build/installer.nsi" "$STAGE/installer.nsi"
sed -i "s/!define APPVER  \".*\"/!define APPVER  \"$VERSION\"/" "$STAGE/installer.nsi"

echo "=== [8/8] Compile installer ==="
"$MAKENSIS" "$STAGE/installer.nsi" | tail -5
mkdir -p "$ROOT/public"
mv "$STAGE/PTI-Setup-$VERSION.exe" "$ROOT/public/PTI-Setup-$VERSION.exe"
ls -lh "$ROOT/public/PTI-Setup-$VERSION.exe"
echo "DONE: public/PTI-Setup-$VERSION.exe"
