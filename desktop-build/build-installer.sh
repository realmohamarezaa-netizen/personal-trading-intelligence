#!/bin/bash
# ─── Personal Trading Intelligence — Windows installer build (Linux host) ────
# Assembles the Electron app package and compiles the NSIS installer.
#
# Prerequisites (already verified by the sandbox):
#   - bun, node, sharp (in project node_modules)
#   - makensis extracted at /home/z/nsis-root  (dpkg -x nsis_*.deb)
#   - /home/z/electron-win32-x64.zip           (electron-v33.x win32-x64)
#   - python-embed.zip                         (Python 3.12 embeddable win64)
#   - /home/z/py-wheels/*.whl                  (MetaTrader5 + requests for win)
#
# Usage: NEXT_DIST_DIR=.next-desktop bash desktop-build/build-installer.sh <version>
# Prereq: run `NEXT_DIST_DIR=.next-desktop bun run build` first (output: "standalone"
# mode is expected — .next-desktop/standalone plus .next/static and public/ are
# assembled below). Using a separate dist dir keeps the dev server's .next intact.

set -euo pipefail
exec 2>&1

VERSION="${1:-1.2.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEXT_DIST="$ROOT/${NEXT_DIST_DIR:-.next}"
STAGE=/home/z/pti-stage
ELECTRON_ZIP=/home/z/electron-win32-x64.zip
PY_EMBED_ZIP="$ROOT/python-embed.zip"
WHEELS=/home/z/py-wheels
MAKENSIS=/home/z/nsis-root/usr/bin/makensis
export NSISDIR=/home/z/nsis-root/usr/share/nsis

echo "=== [1/8] Clean stage ==="
rm -rf "$STAGE"
mkdir -p "$STAGE/app/resources/app"

echo "=== [2/8] Next.js standalone -> app/resources/app/server ==="
cp -r "$NEXT_DIST/standalone/." "$STAGE/app/resources/app/server/"

# standalone output does NOT include static assets — copy them manually
echo "=== [2b/8] Static assets (.next/static, public/) ==="
mkdir -p "$STAGE/app/resources/app/server/.next"
cp -r "$NEXT_DIST/static" "$STAGE/app/resources/app/server/.next/static"
cp -r "$ROOT/public" "$STAGE/app/resources/app/server/public"
# keep the installer lean: never nest the setup exe / big archives inside itself
rm -f "$STAGE/app/resources/app/server/public"/PTI-Setup-*.exe \
      "$STAGE/app/resources/app/server/public"/*.zip

echo "=== [3/8] Electron shell ==="
cd "$STAGE"
unzip -q "$ELECTRON_ZIP" -d "$STAGE/app"
mv "$STAGE/app/electron.exe" "$STAGE/app/TradingIntelligence.exe"

echo "=== [4/8] App payload (main.js, package.json, db, connector) ==="
APP="$STAGE/app/resources/app"
cp "$ROOT/desktop-build/main.js" "$APP/main.js"
cp "$ROOT/desktop-build/app-package.json" "$APP/package.json"
python3 - "$VERSION" <<'EOF'
import json, sys
p = 'app/resources/app/package.json'
d = json.load(open(p))
d['version'] = sys.argv[1]
json.dump(d, open(p, 'w'), indent=2)
EOF
mkdir -p "$APP/db" "$APP/connector"
cp "$ROOT/db/custom.db" "$APP/db/custom.db"
cp "$ROOT/mt5-connector/sync.py" "$ROOT/mt5-connector/sync_service.py" "$APP/connector/"

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
sed -i "s/!define APPVER  \".*\"/!define APPVER  \"$VERSION\"/" installer.nsi 2>/dev/null || true
cp "$ROOT/desktop-build/installer.nsi" "$STAGE/installer.nsi"
sed -i "s/!define APPVER  \".*\"/!define APPVER  \"$VERSION\"/" "$STAGE/installer.nsi"

echo "=== [8/8] Compile installer ==="
"$MAKENSIS" "$STAGE/installer.nsi" | tail -5
mkdir -p "$ROOT/public"
mv "$STAGE/PTI-Setup-$VERSION.exe" "$ROOT/public/PTI-Setup-$VERSION.exe"
ls -lh "$ROOT/public/PTI-Setup-$VERSION.exe"
echo "DONE: public/PTI-Setup-$VERSION.exe"
