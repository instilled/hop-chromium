#!/usr/bin/env bash
# Renders the Chrome Web Store screenshots (1280×800) from docs/screenshots with frame.html. Needs Google Chrome.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

shot() { # name screenshot title text [card]
  local url="file://$PWD/frame.html?shot=$2&title=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$3")&text=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$4")&card=${5:-}"
  "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1280,800 --screenshot="$PWD/$1.png" "$url" >/dev/null 2>&1
  echo "$1.png"
}

shot 1-sidebar sidebar "Arc's sidebar, in Vivaldi" \
  "Pinned tiles, bookmark folders and the window's tabs in one slim panel. ⌘1–⌘6 jump to your pinned sites."
shot 2-gmail preview-gmail "Peek at your inbox" \
  "Hover the Gmail tile for the newest unread emails, without switching tabs."
shot 3-calendar preview-calendar "Your day at a glance" \
  "Hover the Calendar tile for today's remaining meetings and tomorrow's."
# The setup page's Arc import card (arc-card.html), rendered first.
"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --force-dark-mode \
  --blink-settings=preferredColorScheme=0 --default-background-color=00000000 --force-device-scale-factor=2 \
  --window-size=640,465 --screenshot="$PWD/arc-card.png" "file://$PWD/arc-card.html" >/dev/null 2>&1
shot 4-arc sidebar "Coming from Arc?" \
  "Bring your favorites and spaces over in one step." arc-card.png
shot 5-duplicates duplicate "No duplicate tabs" \
  "A link from Slack or Mail whose page is already open? Switch to it, keep both, or always switch."

"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=440,280 --screenshot="$PWD/promo-small.png" "file://$PWD/promo.html" >/dev/null 2>&1
echo "promo-small.png"
