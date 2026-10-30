#!/usr/bin/env bash
# Builds dist/Hop.app. Usage: ./build.sh [--install] at the repo root
#   --install  copy to /Applications and (re)launch it
# Env: BUNDLE_ID (default instilled.hop).
# Signing: $CODESIGN_IDENTITY, else the first "Apple Development" identity, else ad-hoc.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE_ID=${BUNDLE_ID:-instilled.hop}
APP=dist/Hop.app

swift build -c release --product Hop
swift build -c release --product hop-cli
BIN=$(swift build -c release --show-bin-path)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources"
cp Resources/Info.plist "$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$APP/Contents/Info.plist"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp "$BIN/Hop" "$APP/Contents/MacOS/Hop"
cp "$BIN/hop-cli" "$APP/Contents/Helpers/hop"

IDENTITY=${CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)}
if [[ -z "$IDENTITY" ]]; then
  IDENTITY=-
  echo "warning: no signing identity found, signing ad-hoc." >&2
  echo "         The Accessibility grant will NOT survive rebuilds (see README)." >&2
fi
codesign --force --timestamp=none --sign "$IDENTITY" --identifier "$BUNDLE_ID.cli" "$APP/Contents/Helpers/hop"
codesign --force --timestamp=none --sign "$IDENTITY" --identifier "$BUNDLE_ID" "$APP"
codesign --verify --strict "$APP"
echo "Signed with: $IDENTITY"
codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => /Designated requirement: /p'

if [[ "${1:-}" == "--install" ]]; then
  pkill -x Hop 2>/dev/null && sleep 0.5 || true
  rm -rf /Applications/Hop.app
  ditto "$APP" /Applications/Hop.app
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Hop.app
  open /Applications/Hop.app
  # Hop.app itself may not be allowed to read Chrome's Local State; record the profiles from here.
  /Applications/Hop.app/Contents/Helpers/hop --sync-profiles
  echo "Installed /Applications/Hop.app"
else
  echo "Built $APP"
fi
