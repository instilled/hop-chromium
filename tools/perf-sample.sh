#!/bin/sh
# Records the browser's processes (memory, CPU time) once a minute, to see what grows over days.
#
#   tools/perf-sample.sh start [App]   sample every minute via a LaunchAgent (survives logout and restarts)
#   tools/perf-sample.sh stop          stop sampling (the log stays)
#   tools/perf-sample.sh status        is it running, and how big is the log
#   tools/perf-sample.sh sample [App]  take one sample (what the LaunchAgent runs)
#
# App defaults to Vivaldi. Output: ~/Library/Logs/hop-perf/processes.csv with one row per process per minute:
# time, pid, type (browser, renderer, renderer-extension, gpu-process, utility, …), rss_kb, cpu_seconds (cumulative).

set -eu

LABEL=dev.hop.perf-sample
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OUT="${HOP_PERF_DIR:-$HOME/Library/Logs/hop-perf}"
CSV="$OUT/processes.csv"
APP="${2:-Vivaldi}"

sample() {
  mkdir -p "$OUT"
  [ -s "$CSV" ] || echo "time,pid,type,rss_kb,cpu_seconds" > "$CSV"
  now=$(date +%Y-%m-%dT%H:%M:%S)
  ps -axo pid=,rss=,time=,command= | grep -F "/$APP.app/" | grep -v -e grep -e perf-sample | awk -v t="$now" '
    {
      type = "browser"
      for (i = 5; i <= NF; i++) {
        if ($i ~ /^--type=/) type = substr($i, 8)
        if ($i == "--extension-process") ext = 1
      }
      if (ext) type = type "-extension"
      ext = 0
      # time is [days-][hh:]mm:ss.cc
      days = 0; clock = $3
      if (index(clock, "-")) { days = substr(clock, 1, index(clock, "-") - 1); clock = substr(clock, index(clock, "-") + 1) }
      n = split(clock, p, ":"); secs = 0
      for (j = 1; j <= n; j++) secs = secs * 60 + p[j]
      secs += days * 86400
      printf "%s,%s,%s,%s,%.1f\n", t, $1, type, $2, secs
    }' >> "$CSV"
}

case "${1:-}" in
  sample) sample ;;
  start)
    script=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
    mkdir -p "$OUT" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$script</string><string>sample</string><string>$APP</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$OUT/sampler-errors.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Sampling $APP every minute into $CSV" ;;
  stop)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Stopped. The log stays in $CSV" ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "running"; else echo "not running"; fi
    [ -f "$CSV" ] && echo "$(wc -l < "$CSV" | tr -d ' ') rows, last: $(tail -1 "$CSV")" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
