#!/usr/bin/env bash
# Sets up Hop Sidebar in Vivaldi, for every Vivaldi profile:
#   - turns on CSS modifications (vivaldi://experiments) and points Custom UI Modifications at the Vivaldi UI mod;
#   - sets Hop's saved panel width to the mod's width (Vivaldi saves its own 295 px when the extension is loaded,
#     and the page then lays out wider than the panel), and makes Hop the panel that opens.
# Vivaldi must be quit: it rewrites its settings on exit. Each changed file is backed up next to it (*.hop-backup).
# Profiles without the extension get it on the next run: install it there, quit Vivaldi, run this again.
# Also run it again after moving the repo or changing --hop-panel-width.
#
#   ./install.sh         for the Chrome Web Store version (updates itself)
#   ./install.sh --dev   for the extension in this repo, loaded unpacked (to run your own changes)
set -euo pipefail

MODE=store
case "${1:-}" in
  "") ;;
  --dev) MODE=dev ;;
  *) echo "Usage: ./install.sh [--dev]" >&2; exit 2 ;;
esac

REPO=$(cd "$(dirname "$0")" && pwd)
EXT="$REPO/code/hop-chromium-extension"
MOD="$EXT/vivaldi"
DATA="$HOME/Library/Application Support/Vivaldi"

[[ -f "$DATA/Local State" ]] || { echo "No Vivaldi settings at $DATA. Install and start Vivaldi once first." >&2; exit 1; }
if pgrep -x Vivaldi >/dev/null; then
  echo "Quit Vivaldi first (⌘Q), then run this again." >&2
  exit 1
fi

python3 -I - "$DATA" "$EXT" "$MOD" "$MODE" <<'EOF'
import base64, hashlib, json, re, shutil, sys
data, ext, mod, mode = sys.argv[1:]

def edit(path, change):
    with open(path) as f: prefs = json.load(f)
    shutil.copy2(path, path + ".hop-backup")
    change(prefs)
    with open(path, "w") as f: json.dump(prefs, f, separators=(",", ":"))

# Two IDs: the Chrome Web Store's, and the unpacked one, which follows from the manifest key (the same wherever
# the repo is).
STORE_ID = "hkokhefgbadgimfimolbkhjoeehnfdgn"
key = json.load(open(f"{ext}/manifest.json"))["key"]
dev_id = "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(base64.b64decode(key)).hexdigest()[:32])
panel = f"EXT_PANEL_{STORE_ID if mode == 'store' else dev_id}"
other = f"EXT_PANEL_{dev_id if mode == 'store' else STORE_ID}"
width = int(re.search(r"--hop-panel-width:\s*(\d+)px", open(f"{mod}/hide-panel-bar.css").read()).group(1))

def labs(state):
    on = state.setdefault("browser", {}).setdefault("enabled_labs_experiments", [])
    if "vivaldi-css-mods@1" not in on: on.append("vivaldi-css-mods@1")
    global profiles
    profiles = state.get("profile", {}).get("info_cache", {})

edit(f"{data}/Local State", labs)

missing = []

def profile(prefs):
    v = prefs.setdefault("vivaldi", {})
    v.setdefault("appearance", {})["css_ui_mods_directory"] = mod
    panels = v.setdefault("panels", {})
    elements = panels.get("web", {}).get("elements", [])
    hop = [e for e in elements if e.get("id") == panel]
    for element in hop: element["width"] = width
    panels.setdefault("window_defaults", {}).update(width=width, contentVisible=True, selectedPanel=panel)
    return bool(hop), any(e.get("id") == other for e in elements)

for directory, info in profiles.items():
    name = f"{info.get('name', directory)} ({directory})"
    loaded = []
    edit(f"{data}/{directory}/Preferences", lambda prefs: loaded.append(profile(prefs)))
    found, both = loaded[0]
    print(f"Set up {name}" + ("" if found else ": extension not installed yet"))
    if both: print(f"  {name} also has the {'unpacked' if mode == 'store' else 'store'} version; remove it on vivaldi://extensions")
    if not found: missing.append(name)
with open(sys.argv[1] + "/.hop-missing", "w") as f: f.write("\n".join(missing))
EOF

MISSING=$(cat "$DATA/.hop-missing"); rm -f "$DATA/.hop-missing"
if [[ -z "$MISSING" ]]; then
  open -a Vivaldi
  echo "Done."
  exit 0
fi
WHERE=$(echo "$MISSING" | paste -sd, - | sed 's/,/, /g')
if [[ $MODE == store ]]; then
  open -a Vivaldi "https://chromewebstore.google.com/detail/hop-sidebar/hkokhefgbadgimfimolbkhjoeehnfdgn"
  cat <<EOM

Install the extension in: $WHERE
from the Chrome Web Store page that just opened (Add to Vivaldi; in each profile).
Then quit Vivaldi and run ./install.sh again, which fixes the panel width.
EOM
else
  printf '%s' "$EXT" | pbcopy
  open -a Vivaldi "vivaldi://extensions"
  cat <<EOM

Load the extension in: $WHERE
On vivaldi://extensions turn on Developer mode, click Load unpacked and choose
  $EXT
(the path is on the clipboard: ⌘⇧G in the folder dialog, then ⌘V).
Then quit Vivaldi and run ./install.sh --dev again, which fixes the panel width.
EOM
fi
