import { adoptRestoredTabs, openBookmark, pinnedFolder, rebind, saveBoundUrls, unbind } from "./bookmark-tabs.js";
import { noteStartup, onTabCreated, onTabUpdated } from "./duplicates.js";

// The toolbar button (and its shortcut) opens the side panel instead of a popup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// MARK: Sidebar open state
// Windows with the sidebar open. Kept in memory because sidePanel.open() must run synchronously inside the
// shortcut's user gesture, and mirrored to session storage because the service worker gets restarted.

const openPanels = new Set();
chrome.storage.session.get("openPanels")
  .then(({ openPanels: saved }) => saved?.forEach((id) => openPanels.add(id)));

function setPanelOpen(windowId, open) {
  if (open === openPanels.has(windowId)) return;
  open ? openPanels.add(windowId) : openPanels.delete(windowId);
  chrome.storage.session.set({ openPanels: [...openPanels] });
}

chrome.sidePanel.onOpened?.addListener(({ windowId }) => setPanelOpen(windowId, true));
chrome.sidePanel.onClosed?.addListener(({ windowId }) => setPanelOpen(windowId, false));
chrome.windows.onRemoved.addListener((windowId) => setPanelOpen(windowId, false));

function toggleSidebar(windowId) {
  const open = !openPanels.has(windowId);
  (open ? chrome.sidePanel.open({ windowId }) : chrome.sidePanel.close({ windowId })).catch(console.warn);
  setPanelOpen(windowId, open);
}

// MARK: Cleanup
// Earlier versions hid inactive tabs in a collapsed group titled "Hop"; release any such group once.

async function ungroupLeftovers() {
  await chrome.storage.local.remove("hideInactive");
  for (const group of await chrome.tabGroups.query({ title: "Hop" })) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length) await chrome.tabs.ungroup(tabs.map((t) => t.id)).catch(console.warn);
  }
}
chrome.runtime.onInstalled.addListener(ungroupLeftovers);

// MARK: Bookmark tabs

chrome.tabs.onRemoved.addListener(async (tabId, { isWindowClosing }) => {
  await unbind(tabId);
  // Keep the saved addresses when windows close (e.g. quitting), so the tabs can be re-bound on restart.
  if (!isWindowClosing) await saveBoundUrls();
});
chrome.tabs.onReplaced.addListener((added, removed) => rebind(removed, added));
chrome.tabs.onUpdated.addListener(async (tabId, { url }) => {
  if (url && (await chrome.storage.session.get(`bound:${tabId}`))[`bound:${tabId}`]) await saveBoundUrls();
});

// MARK: Duplicate tabs from other apps

chrome.tabs.onCreated.addListener((tab) => onTabCreated(tab).catch(console.warn));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => onTabUpdated(tabId, change, tab)?.catch(console.warn));

// Restored tabs appear over the first seconds after a restart; re-bind them as they come.
chrome.runtime.onStartup.addListener(() => {
  noteStartup();
  for (const delay of [500, 3000, 10000]) setTimeout(() => adoptRestoredTabs().catch(console.warn), delay);
});
chrome.runtime.onInstalled.addListener(() => adoptRestoredTabs().catch(console.warn));

// ⌘1…⌘6 select the bookmarks in the "Pinned" folder.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-sidebar") return tab && toggleSidebar(tab.windowId);
  const n = Number(/^pinned-(\d)$/.exec(command)?.[1]);
  if (!n) return;
  const bookmark = (await pinnedFolder())?.children?.filter((c) => c.url)[n - 1];
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined);
  if (bookmark && win) await openBookmark(bookmark, win.id);
});
