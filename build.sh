#!/usr/bin/env bash
# Builds the optional macOS app (code/hop-macos/dist/Hop.app). The extension needs no build; see install.sh.
# Usage: ./build.sh [--install]   --install also copies it to /Applications and (re)launches it.
exec "$(dirname "$0")/code/hop-macos/scripts/build.sh" "$@"
