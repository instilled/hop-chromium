#!/usr/bin/env bash
# Build, copy to /Applications, relaunch, and record Chrome profiles. Same as: scripts/build.sh --install
exec "$(dirname "$0")/build.sh" --install
