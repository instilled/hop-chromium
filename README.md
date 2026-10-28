# Hop

Arc-style keyboard control on top of plain Google Chrome. Hop between profiles like Arc Spaces, open links in
throwaway mini windows like Little Arc, and promote a mini window to a real tab, all without forking Chromium.

Hop is a tiny macOS menu bar app (no Dock icon) written in Swift.

## Why

Arc got a lot right: Spaces you switch with one shortcut, links from other apps opening in a small Little Arc window
instead of cluttering your tabs, and one keystroke to keep that page if it turns out to matter. Arc is now in
maintenance mode. Chrome has caught up on the UI (vertical tabs, profiles, tab groups) but not on that keyboard flow.

Hop adds just that flow and nothing else. It doesn't touch Chrome's code, sync or tabs. It only raises,
opens and closes Chrome windows through the macOS Accessibility API.

## What it does

| Shortcut | Active | Does |
|---|---|---|
| ⌥⌘← / ⌥⌘→ | only while Chrome is frontmost | Previous / next Chrome profile ("Space"): raise its window, or open one |
| ⌥⇧P | anywhere | Promote the front mini window: open its page as a normal tab in the same profile, close the mini window |

**Mini windows** are Chrome `--app` windows with no tabs or toolbar. They open in the **current profile**, the one
whose Chrome window you used last:

- from the command line: `hop example.com`, `hop ./index.html`, `hop swift actors` (Google search);
- for every link on your Mac, if you make Hop your default browser (Little Arc style). Links clicked inside
  Chrome stay in Chrome.

The menu bar menu lists your profiles (checkmark = current; click to switch). It also has *Launch at Login*,
*Set as Default Browser…*, *Reload Config*, *Open Config* and *Quit*.

Permissions: **Accessibility only.** Hotkeys use Carbon `RegisterEventHotKey`, which needs no Input Monitoring, and
no AppleScript/Automation access is used.

## Requirements

- macOS 14 or later, Google Chrome
- Xcode 16 or later (Swift 5.10+ toolchain) to build

## Install

```sh
git clone https://github.com/<you>/hop-chrome && cd hop-chrome
scripts/build.sh --install   # builds dist/Hop.app, copies it to /Applications, launches it
```

Plain `scripts/build.sh` only builds `dist/Hop.app`.

On first launch Hop asks for Accessibility access. Click **Continue** and turn on Hop in
System Settings → Privacy & Security → Accessibility. No restart needed: the *Grant Accessibility…* menu item
disappears within a few seconds.

Then, optionally:

- **Command line:** `ln -s /Applications/Hop.app/Contents/Helpers/hop /usr/local/bin/hop`
  (or any directory on your `PATH`).
- **Default browser:** menu → *Set as Default Browser…*, then confirm the system dialog. To undo, pick another browser in
  System Settings → Desktop & Dock → Default web browser.
- **Launch at login:** menu toggle (uses `SMAppService`; install to /Applications first).

### Signing and the Accessibility grant

macOS ties the Accessibility grant to the app's code-signing *designated requirement*. `build.sh` signs with
`$CODESIGN_IDENTITY` if set, otherwise with the first **Apple Development** certificate in your keychain. The
requirement is then "bundle id + that certificate", which stays the same across rebuilds, so the grant survives.

Without a certificate it falls back to **ad-hoc** signing. An ad-hoc requirement is the binary's hash, so
**every rebuild invalidates the grant**: the toggle in System Settings still looks on but does nothing. To fix it,
remove Hop from the list (or run `tccutil reset Accessibility com.instilled.hop`) and grant it again.
A free Apple Development certificate (Xcode → Settings → Accounts → add an Apple ID → Manage Certificates) avoids this.

To use your own bundle identifier, set `BUNDLE_ID=com.example.hop scripts/build.sh`.

## Set up Chrome to feel like Arc

Hop covers the keyboard side. These Chrome settings cover the rest:

1. **Tabs on the left.** Chrome 146+ has built-in vertical tabs: right-click the tab strip → *Show Tabs Vertically*,
   or *View → Show Tabs Vertically*, or Settings → Appearance → Tab position → Vertical. Collapse the strip to icons
   for an Arc-like slim sidebar.
2. **One profile per Space.** Create a Chrome profile for each Arc Space (e.g. Work, Personal): profile menu →
   *Add*. Give each its own color (Customize Chrome → *Change theme*) so you can tell them apart at a glance, as
   Arc's Space colors did. ⌥⌘←/→ then walks through them.
3. **Pinned tabs and folders.** Right-click a tab → *Pin* for Arc's pinned tabs. Use tab groups (right-click →
   *Add tab to new group*) as Arc folders; collapse them to keep the sidebar tidy.
4. **Little Arc.** Make Hop the default browser (see above). Links from Slack, Mail and so on open in a mini
   window in your current profile; ⌥⇧P keeps the page as a tab.
5. **Clean chrome.** Hide the bookmarks bar (⌘⇧B). Use ⌘L as Arc's command bar, and ⌘⇧A (tab search) to jump to
   any open tab.
6. **Tab decay.** Arc archived idle tabs. The closest Chrome setting is Settings → Performance → *Memory Saver*,
   which unloads inactive tabs; Chrome doesn't close them for you.

## Config

`~/.config/hop/config.json`, created on first run. Edit it, then choose *Reload Config*.

```json
{
  "miniProfile": "Default",
  "promoteHotkey": "opt+shift+p",
  "previousProfileHotkey": "cmd+opt+left",
  "nextProfileHotkey": "cmd+opt+right",
  "profileOrder": ["Default", "Personal"],
  "profiles": {
    "Personal": { "hotkey": "ctrl+2" },
    "Default": { "titleLabel": "Alex (Work)" }
  }
}
```

| Key | Meaning |
|---|---|
| `previousProfileHotkey`, `nextProfileHotkey` | Profile cycling, active only while Chrome is frontmost. `null` disables. |
| `promoteHotkey` | Global. Missing or `null` means the default. |
| `profileOrder` | Optional cycle order. Defaults to every profile, `Default` first. |
| `profiles.<p>.hotkey` | Optional direct jump to a profile, active only while Chrome is frontmost. Pressing it again cycles that profile's windows. |
| `profiles.<p>.titleLabel` | Optional override of the window-title suffix used to recognise the profile (see below). |
| `miniProfile` | Fallback profile for mini windows when the current one can't be determined. |

Profiles are referenced by directory (`Default`, `Profile 5`) or display name (`Personal`). They're discovered from
`~/Library/Application Support/Google/Chrome/Local State`. Hotkeys are written as modifiers `cmd`, `opt`/`alt`,
`ctrl`, `shift` plus one character or one of `space return tab esc delete left right up down f1`…`f12`. Characters
follow your current keyboard layout.

## How it works

- **Profile of a window** comes from its title. Chrome titles normal windows `<page> - Google Chrome - <label>` and
  app windows `<page> - <label>`. `<label>` is `Given (Profile)` when signed in with a custom profile name (e.g.
  `Alex (Work)`), `Given` when signed in with Chrome's default name, and the profile name when signed out.
- **Current profile** = the profile of Chrome's frontmost *normal* window, readable even when Chrome isn't active.
  Without Accessibility it falls back to `profile.last_used` from Local State, which Chrome writes lazily.
- **Launching** uses `open -na "Google Chrome" --args --profile-directory=<dir> [--app=<url> | <url>]`.
- **Promote** reads the page URL through Accessibility. Chrome's `AXWebArea` exposes `AXURL` once
  `AXManualAccessibility` is set on the app. AppleScript can read app windows too, but it needs the Automation
  permission and reports `mode: "normal"` for both window types, so it can't tell them apart.
- **CLI → app:** `hop` resolves its argument (URL, file relative to the current directory, or search) and hands
  it over as `hop://open?url=…`.

## Known limitations

- **Title matching:**
  - Two profiles with the same label (same first name and profile name) can't be told apart.
  - A mini window whose page title ends in ` - Google Chrome` is taken for a normal window.
  - Changing your Google first name changes the label. Pin it with `titleLabel`.
  - With only one profile, Chrome omits the label. Hop handles that case.
  - Only Chrome stable (`com.google.Chrome`) is supported. Beta, Canary and Chromium use a different bundle id and
    title marker.
- **Other Spaces / full screen:** Accessibility only lists windows on the current macOS Space. If a profile's only
  window is on another Space or in full screen, switching opens a new window instead of jumping there.
- **⌥⌘←/→ shadows Chrome's previous/next-tab shortcut.** Use ⌃⇧Tab / ⌃Tab or ⌘⇧[ / ⌘⇧], or rebind in the config.
- **Repeated presses:** a second press within 3 s of Hop opening a window for a profile is ignored, to avoid
  duplicate windows.
- **Promote** acts on Chrome's focused window only. On a normal window it beeps and shows "Not a mini window" in the
  menu. It turns Chrome's accessibility tree on for up to 2 s.
- A hotkey another app already owns can't be registered; the menu lists it under *Config Problems*.

## Development

```sh
swift test                    # unit tests: parsing, title matching, URL resolution
swift scripts/make-icon.swift # regenerate Resources/AppIcon.icns
log stream --predicate 'subsystem == "com.instilled.hop"' --level debug
```

Non-goals: tab management, sync, an updater, a settings UI, changes to Chromium.

## License

[MIT](LICENSE)
