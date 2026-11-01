#!/usr/bin/env bash
# Builds the Chrome Web Store upload: dist/hop-sidebar-<version>.zip. Same files as the extension folder, minus the
# Vivaldi CSS mod (not part of the extension) and the manifest's "key" (it pins the ID for Load unpacked; the store
# assigns its own and rejects uploads that carry one).
set -euo pipefail
cd "$(dirname "$0")/../.."
EXT=code/hop-chromium-extension
VERSION=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$EXT/manifest.json")
OUT="$PWD/dist/hop-sidebar-$VERSION.zip"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

rsync -a --exclude vivaldi/ --exclude .DS_Store "$EXT/" "$STAGE/"
python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest.pop("key", None)
json.dump(manifest, open(path, "w"), indent=2, ensure_ascii=False)
PY
mkdir -p dist
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" .)
echo "$OUT"
