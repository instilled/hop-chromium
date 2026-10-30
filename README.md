# Hop Sidebar

An Arc-style sidebar for Vivaldi: pinned tiles with previews, your bookmarks as Arc-style pinned tabs, and the
window's tabs below, in a slim panel that replaces Vivaldi's panel bar. It's a plain browser extension plus a small
Vivaldi UI mod. Nothing to build.

```
install.sh                            sets up Hop Sidebar in Vivaldi (below)
build.sh                              builds the optional macOS app
code/hop-chromium-extension/          the extension (Load unpacked this folder)
code/hop-chromium-extension/vivaldi/  the Vivaldi UI mod (CSS)
code/hop-macos/                       Hop for macOS, an older companion app (see the end)
```

## What it does

- **Pinned:** bookmarks in a bookmarks folder named **Pinned** (create it anywhere) show as a grid of icons at the
  top, like Arc's favorites. ⌘1–⌘6 select the first six.
- **Bookmarks** of the bookmarks bar, plus *Other* / *Mobile* as folders (open state is remembered). Vivaldi's Trash
  is hidden.
- **Bookmarks open like Arc's pinned tabs.** A bookmark (pinned or not) opens one tab that stays bound to it: click
  the bookmark again and you're back in that tab, even after browsing elsewhere in it. Its tab shows on the bookmark,
  not in the tab list; **×** or middle-click on the bookmark closes it. ⌘-click opens a plain background tab instead.
- **Unread badges** on bookmarks whose tab is open, read from the tab title the way Gmail (`Inbox (3)`), WhatsApp
  (`(12) WhatsApp`), Outlook, Slack and others write it.
- **Previews** (like Arc's peeks): hover a pinned Gmail tile for the newest unread emails (from Gmail's unread feed,
  using your existing login), a pinned Google Calendar tile for today's remaining and tomorrow's meetings (from the
  calendar's *secret iCal address*, set in Options), or a pinned Google Chat tile for recent conversations (read from
  the open Chat tab, so that tab has to be open; Chat has no feed). Click an entry to open it in the tile's tab.
  Previews are cached and prefetched, so the card appears instantly and refreshes in the background.
- **Edit:** right-click a bookmark, folder or tile for *Rename · New Folder · Delete* (empty space: *New Folder*).
  Drag bookmarks and folders to rearrange them (onto the middle of a folder to put them inside). Drop a tab from the
  list, or a page or link from anywhere, to bookmark it at that spot; a dropped tab becomes that bookmark's tab.
- **Restarts:** bookmark tabs restored by the browser are matched back to their bookmarks by address.
- **Tabs** of the current window, with tab groups. Click to switch; **×** or middle-click closes.
- **Clear** (at the end of the divider above the tab list), like Arc: closes the window's loose tabs. Bookmark tabs,
  pinned tabs and tabs in tab groups stay; ⌘⇧T brings closed tabs back. **+ New Tab** sits below it.
- **Options** (the extension's *Options*): background colour, any CSS colour or `transparent` (default `#35343E` in
  dark mode), and the calendar's secret iCal address.

## Install

Tested with Vivaldi 8.2 on macOS.

1. Get the code and quit Vivaldi (⌘Q):
   ```sh
   git clone https://github.com/instilled/hop-chromium && cd hop-chromium
   ./install.sh
   ```
   For every Vivaldi profile, `install.sh` turns on CSS modifications, points *Custom UI Modifications* at the UI
   mod, sets the saved panel width to match it and makes Hop the panel that opens. It backs up each settings file it
   changes (`*.hop-backup` next to it), then opens `vivaldi://extensions` with the extension's folder on the
   clipboard. Run it again after moving the repo or changing the panel width.
2. Load the extension, in each profile: `vivaldi://extensions` → turn on *Developer mode* → *Load unpacked* →
   choose `code/hop-chromium-extension` (⌘⇧G, ⌘V pastes the path). Vivaldi can't load an extension from a
   script, so this step stays manual. The manifest pins the extension's ID, so it doesn't change when the folder moves.
3. Open or close Hop with Quick Commands (⌘E → *Toggle Current Panel*), or bind that command in Settings → Keyboard.
   Keep the panel non-floating (⌘E → *Toggle Floating Panel*), or it closes whenever you click the page.
4. Shortcuts: `vivaldi://extensions/shortcuts`. ⌃S (toggle) and ⌘1–⌘3 come preset; assign ⌘4–⌘6 yourself. If
   Vivaldi keeps ⌘1–⌘6 for its own *Switch to Tab N*, clear those in Settings → Keyboard.
5. For the calendar preview, paste the calendar's secret iCal address into the extension's Options (Google Calendar
   → Settings → your calendar → *Secret address in iCal format*).

After `git pull`, click the reload icon on the extension's card.

### The Vivaldi UI mod

Vivaldi's own interface is a web page, and Vivaldi can load extra CSS into it. `code/hop-chromium-extension/vivaldi/hide-panel-bar.css` uses that
to make the Hop panel look like Arc's sidebar:

- hides the panel bar (the strip of panel icons) and lets the open panel take its place, with Vivaldi's usual 6 px gap
  to the window edge;
- fixes the panel at 220 px. Vivaldi won't let a panel be dragged below 260 px, so dragging has no effect while
  this is set;
- drops the web panel's title row (name, back/forward/reload, close), for every web panel;
- removes the panel's border and shadow.

`install.sh` sets this up. By hand, once per profile:

1. **Turn on CSS mods.** Open `vivaldi://experiments`, tick *Allow for using CSS modifications*, and restart Vivaldi.
   This switch applies to all profiles.
2. **Point Vivaldi at the folder.** Settings → Appearance → *Custom UI Modifications* → *Select Folder* → choose the
   `code/hop-chromium-extension/vivaldi` folder (the folder, not the `.css` file). Vivaldi loads every `.css` file in it.
3. **Restart Vivaldi.** The panel bar disappears and the Hop panel sits at the left edge. If it's empty, you have no
   panel open: open Hop with ⌘E → *Toggle Current Panel*.

**Changing the width:** edit `--hop-panel-width` in `hide-panel-bar.css`, quit Vivaldi and run `./install.sh` again.
It copies the width into Vivaldi's saved panel width (`vivaldi.panels.window_defaults.width` in each profile's
`Preferences`); without that, the page renders at the old width until you click into it.

**Undo:** clear the folder in Settings → Appearance → *Custom UI Modifications* and restart. The panel bar comes back
and panels can be dragged to any width again.

CSS mods are unofficial: a Vivaldi update can rename the elements the CSS targets. If the layout breaks after an
update, undo the mod as above until the CSS is fixed.

Hide Vivaldi's own tab bar as well if the sidebar's tab list is enough (Settings → Tabs → *Tab Bar Position*, or
⌘E → *Toggle Tab Bar*).

## Limitations

- `javascript:` bookmarklets don't run from the sidebar.
- The Chat preview needs the Chat tab open (and not asleep).
- Profiles can't share a window. For several "Spaces" in one window, use Vivaldi's Workspaces.

## Hop for macOS (optional)

Secondary and no longer developed: I don't use it anymore, but it still builds and works with Chrome and Vivaldi (in Vivaldi without profile switching).

`code/hop-macos` is Hop, a small menu bar app that the sidebar doesn't need. It's built separately with `./build.sh`;
see [its README](code/hop-macos/README.md). It gives the browser Arc's keyboard flow: ⌥⌘←/→ to switch profiles like
Spaces, links from other apps in a throwaway mini window like Little Arc, and ⌘O to keep that page as a normal tab.

Link launchers such as Choosy, Finicky or Velja also sit between other apps and the browser, but they only decide
*where* a link goes, by rules (this domain → that browser or profile), and hand it off. Hop instead follows what
you're doing: it reads the browser's windows through Accessibility to open links in the profile you used last. It
opens them in a mini (`--app`) window rather than a tab, and moves that window into a real tab on ⌘O. It also switches
between the profiles' windows. It doesn't route by rules and drives one browser (Chrome; in Vivaldi without profile
switching).

## License

[MIT](LICENSE)
