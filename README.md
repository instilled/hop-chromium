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
| ⌘O | only while a mini window has focus | Promote it, like Arc's *Open in Arc*: open its page as a normal tab in the same profile, close the mini window |

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
git clone https://github.com/instilled/hop-chromium && cd hop-chromium
scripts/install.sh   # builds dist/Hop.app, copies it to /Applications, launches it
```

Plain `scripts/build.sh` only builds `dist/Hop.app`.

`--install` also runs `hop --sync-profiles`, which records your Chrome profiles in Hop's config. macOS may not let
Hop.app read Chrome's data (`Local State`), but a command run from Terminal usually can. Run
`/Applications/Hop.app/Contents/Helpers/hop --sync-profiles` again after adding or renaming a Chrome profile.

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
   for an Arc-like slim sidebar. Or use the [Hop Sidebar extension](#chrome-extension-hop-sidebar) for a sidebar
   with your bookmarks above the tabs.
2. **One profile per Space.** Create a Chrome profile for each Arc Space (e.g. Work, Personal): profile menu →
   *Add*. Give each its own color (Customize Chrome → *Change theme*) so you can tell them apart at a glance, as
   Arc's Space colors did. ⌥⌘←/→ then walks through them.
3. **Pinned tabs and folders.** Right-click a tab → *Pin* for Arc's pinned tabs. Use tab groups (right-click →
   *Add tab to new group*) as Arc folders; collapse them to keep the sidebar tidy.
4. **Little Arc.** Make Hop the default browser (see above). Links from Slack, Mail and so on open in a mini
   window in your current profile; ⌘O keeps the page as a tab.
5. **Clean chrome.** Hide the bookmarks bar (⌘⇧B). Use ⌘L as Arc's command bar, and ⌘⇧A (tab search) to jump to
   any open tab.
6. **Tab decay.** Arc archived idle tabs. The closest Chrome setting is Settings → Performance → *Memory Saver*,
   which unloads inactive tabs; Chrome doesn't close them for you.

## Config

`~/.config/hop/config.json`, created on first run. Edit it, then choose *Reload Config*.

```json
{
  "browser": "chrome",
  "miniProfile": "Default",
  "promoteHotkey": "cmd+o",
  "previousProfileHotkey": "cmd+opt+left",
  "nextProfileHotkey": "cmd+opt+right",
  "openLinksIn": "mini",
  "profileOrder": ["Default", "Personal"],
  "profiles": {
    "Personal": { "hotkey": "ctrl+2" },
    "Default": { "titleLabel": "Alex (Work)" }
  }
}
```

| Key | Meaning |
|---|---|
| `browser` | `"chrome"` (default) or `"vivaldi"`. Run `hop --sync-profiles` after changing it. In Vivaldi, profile switching is off (its window titles don't name the profile); mini windows and ⌘O work. |
| `previousProfileHotkey`, `nextProfileHotkey` | Profile cycling, active only while Chrome is frontmost. `null` disables. |
| `promoteHotkey` | Active only while Chrome's focused window is a mini window, so ⌘O stays *Open File…* everywhere else. Missing or `null` means the default. |
| `openLinksIn` | `"mini"` (default) opens links from other apps and `hop <url>` in a mini window, `"tab"` as a normal tab. Both use the current profile. Also a menu toggle. |
| `profileOrder` | Optional cycle order. Defaults to every profile, `Default` first. |
| `profiles.<p>.hotkey` | Optional direct jump to a profile, active only while Chrome is frontmost. Pressing it again cycles that profile's windows. |
| `profiles.<p>.titleLabel` | Optional override of the window-title suffix used to recognise the profile (see below). |
| `miniProfile` | Fallback profile for mini windows when the current one can't be determined. |

Profiles are referenced by directory (`Default`, `Profile 5`) or display name (`Personal`). They're discovered from
`~/Library/Application Support/Google/Chrome/Local State`, or, when macOS blocks Hop from reading it, taken from the
`name`/`titleLabel` entries that `hop --sync-profiles` writes. Hotkeys are written as modifiers `cmd`, `opt`/`alt`,
`ctrl`, `shift` plus one character or one of `space return tab esc delete left right up down f1`…`f12`. Characters
follow your current keyboard layout.

## Chrome extension: Hop Sidebar

`extension/` is an optional Chrome extension, separate from the app. It's an Arc-style sidebar in Chrome's side panel:

- **Pinned:** bookmarks in a bookmarks folder named **Pinned** (create it anywhere) show as a grid of icons at the
  top, like Arc's favorites. ⌘1–⌘6 select the first six.
- **Bookmarks** of the bookmarks bar, plus *Other* / *Mobile* as folders (open state is remembered).
- **Bookmarks open like Arc's pinned tabs.** A bookmark (pinned or not) opens one tab that stays bound to it: click
  the bookmark again and you're back in that tab, even after browsing elsewhere in it. Its tab shows on the bookmark,
  not in the tab list; **×** or middle-click on the bookmark closes it. ⌘-click opens a plain background tab instead.
- **Unread badges** on bookmarks whose tab is open, read from the tab title the way Gmail (`Inbox (3)`), WhatsApp
  (`(12) WhatsApp`), Outlook, Slack and others write it. Calendar titles carry no count, so it gets no badge.
- **Edit:** right-click a bookmark, folder or tile to rename it. Drag tiles to reorder them; drag a bookmark onto the
  grid to pin it.
- **Tabs** of the current window, with tab groups. Click to switch; **×** or middle-click closes.
- **Hide inactive** (toggle next to *Tabs*, off by default): Chrome can't hide tabs, so Hop moves every tab except the
  active one into a collapsed group named "Hop". Chrome's tab bar then shows just that small chip and the current tab;
  the sidebar still lists everything. This only happens while the sidebar is open in that window: close it (⌃S)
  and the tabs come back to Chrome's tab bar. Turning the setting off ungroups them too. While on, the list keeps tabs in opening order.

Install it:

1. `chrome://extensions` → turn on *Developer mode* → *Load unpacked* → pick the repo's `extension/` folder.
   Do this in each profile you want it in.
2. Put the side panel on the left: Chrome Settings → Appearance → *Side panel* → *Show on left*.
3. Open it with the toolbar button (pin it via the puzzle icon), or toggle it with ⌃S, like Arc's ⌘S, to keep it
   hidden until you need it. Shortcuts are set at `chrome://extensions/shortcuts`. Chrome allows only four suggested
   shortcuts per extension, so ⌃S and ⌘1–⌘3 come preset; assign ⌘4–⌘6 for the remaining pinned bookmarks yourself.
   Width: drag the panel's inner edge; Chrome won't go below its minimum width.

Limitations: Chrome won't let an extension hide the tab strip itself, or open the side panel in mini (app) windows.
⌘1–⌘6 are meant to take over Chrome's "go to tab N"; if Chrome keeps its own, pick other keys at `chrome://extensions/shortcuts`. The bookmark ↔ tab bindings reset when Chrome restarts. A tab group you name
"Hop" is treated as the hidden group. `javascript:` bookmarklets don't run from the sidebar. After `git pull`, click
the reload icon on the extension's card.

### Vivaldi

Hop Sidebar also runs in Vivaldi (tested with 8.2), where it becomes a Vivaldi panel. That panel can be narrower than
Chrome's 360 px side-panel minimum, and with `vivaldi/hide-panel-bar.css` it replaces Vivaldi's panel bar entirely:

1. `vivaldi://extensions` → *Developer mode* → *Load unpacked* → `extension/`. Vivaldi adds it to the panel bar.
2. `vivaldi://experiments` → enable *Allow for using CSS modifications*, then restart Vivaldi.
3. Settings → Appearance → *Custom UI Modifications* → choose the repo's `vivaldi/` folder, then restart again.
4. Open or close Hop with Quick Commands (⌘E → *Toggle Current Panel*), or bind that command in Settings → Keyboard.
   Keep the panel non-floating (⌘E → *Toggle Floating Panel*), or it closes whenever you click the page.

The CSS hides the panel bar, lets the panel take its place with Vivaldi's usual 6 px gap, and drops the web panel's
title row (for every web panel). Hide Vivaldi's own tab bar as well if the sidebar's tab list is enough.

The Hop app can drive Vivaldi too: set `"browser": "vivaldi"` in the config and run `hop --sync-profiles`. Mini
windows, links (as default browser) and ⌘O promote then go to Vivaldi. Profile switching stays off there, since
Vivaldi doesn't put the profile name in normal window titles; use Vivaldi's Workspaces instead.

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

- **Reading Chrome's profile list:** recent macOS versions block Hop.app from reading Chrome's `Local State` ("you
  don't have permission to view it"). Hop then uses the profiles recorded by `hop --sync-profiles`, which you need to
  re-run after profile changes. Granting Hop Full Disk Access should also lift the block (untested), but isn't needed.

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
- **Promote** acts on Chrome's focused window only. ⌘O is registered only while that is a mini window (Hop watches
  Chrome's window focus via Accessibility); the menu item on a normal window beeps and shows "Not a mini window".
  Promoting turns Chrome's accessibility tree on for up to 2 s.
- A hotkey another app already owns can't be registered; the menu lists it under *Config Problems*.

## Development

```sh
swift test                    # unit tests: parsing, title matching, URL resolution
swift scripts/make-icon.swift # regenerate Resources/AppIcon.icns
log stream --predicate 'subsystem == "com.instilled.hop"' --level debug
```

Non-goals for the app: tab management (that's the extension's job), sync, an updater, a settings UI, changes to Chromium.

## License

[MIT](LICENSE)
