# Chrome Web Store listing

What to fill in on the [developer dashboard](https://chrome.google.com/webstore/devconsole). Upload
`dist/hop-sidebar-<version>.zip` from `docs/store/package.sh`; images come from `docs/store/make.sh`.

## Store listing

**Name:** Hop Sidebar (from the manifest)

**Summary** (from the manifest): Arc-style sidebar: pinned tiles with Gmail, Calendar and Chat previews, bookmarks as
pinned tabs, and this window's tabs.

**Description:**

> An Arc-style sidebar for Vivaldi and Chrome, in the browser's side panel.
>
> • Pinned tiles: bookmarks in a folder named "Pinned" show as a grid of icons at the top. ⌘1–⌘6 (Ctrl+1–6) open them.
> • Previews: hover the Gmail tile for your newest unread emails, the Google Calendar tile for today's and tomorrow's
>   meetings, or the Google Chat tile for recent conversations.
> • Bookmarks that act like pinned tabs: each bookmark keeps its own tab, so clicking it brings you back to where you
>   were in it.
> • Edit in place: right-click to rename or add folders, drag to rearrange, drop a tab or link to bookmark it.
> • The window's tabs below, with tab groups, and Arc's "Clear" to close the loose ones.
> • No duplicate tabs: when a link from another app opens a page that's already open, switch to it, keep both, or
>   always switch.
> • Unread counts on bookmarks from tab titles (Gmail, WhatsApp, Slack, Outlook and more).
> • Coming from Arc? Import your favorites and each space's pinned tabs from Arc's sidebar file in one step.
>
> In Vivaldi, Hop Sidebar becomes a panel, and an optional UI mod (saved from the setup page) hides the panel bar and
> slims the panel to 220 px, for a single sidebar like Arc's.
>
> Nothing leaves your browser: no servers, no analytics. Open source (MIT): github.com/instilled/hop-chromium

**Category:** Workflow & Planning (or Tools)

**Language:** English

**Graphics:**
- Store icon: `code/hop-chromium-extension/icons/icon128.png`
- Screenshots (1280×800): `docs/store/1-sidebar.png` … `5-duplicates.png`
- Small promo tile (440×280): `docs/store/promo-small.png`

**Homepage:** https://github.com/instilled/hop-chromium
**Support:** https://github.com/instilled/hop-chromium/issues

## Privacy practices

**Single purpose:** An Arc-style sidebar that shows the user's pinned bookmarks, bookmarks and open tabs, with
previews of Gmail, Google Calendar and Google Chat on hover.

**Permission justifications:**

| Permission | Why |
|---|---|
| `sidePanel` | The sidebar is a side panel page. |
| `tabs` | Lists the window's tabs with titles and icons, switches, opens and closes them, and finds the tab that belongs to a bookmark. |
| `tabGroups` | Shows tab groups in the tab list. |
| `bookmarks` | Shows the bookmarks and pinned tiles, and renames, creates, moves and deletes them when the user asks. |
| `favicon` | Shows site icons for bookmarks that have no open tab. |
| `storage` | Keeps settings, the calendar address, and which tab belongs to which bookmark. |
| `scripting` | Reads the conversation list from the user's open Google Chat tab for the Chat preview, and opens a conversation there when clicked. |
| Host `mail.google.com` | Fetches Gmail's unread feed for the Gmail preview. Also where Chat runs inside Gmail. |
| Host `calendar.google.com` | Fetches the calendar's secret iCal address for the Calendar preview. |
| Host `chat.google.com` | Reads the open Chat tab for the Chat preview. |
| Optional `downloads` | Only requested when the user clicks *Save the mod* on the setup page in Vivaldi: saves the optional Vivaldi UI mod (a CSS file in the package) into its own folder in Downloads. |
| Optional host `https://*/*` | Only requested, for that one site, if the user enters a calendar address that isn't on Google. |

**Remote code:** No. All code is in the package.

**Data usage:** Tick "Personal communications" (email and chat previews) and "Website content". Certify: not sold, not
used for unrelated purposes, not used for creditworthiness. All of it is processed only in the browser.

**Privacy policy URL:** https://github.com/instilled/hop-chromium/blob/main/docs/privacy.md

## After approval

Add the store link to the README's Install section (Vivaldi and Chrome can install from it; the CSS mod still comes
from `install.sh`).
