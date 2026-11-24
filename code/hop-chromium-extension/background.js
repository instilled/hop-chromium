import { adoptRestoredTabs, openBookmark, pinnedFolder, rebind, saveBoundUrls, unbind } from "./bookmark-tabs.js";
import { noteStartup, onTabCreated, onTabUpdated } from "./duplicates.js";
import { collector } from "./diagnostics.js";

const diag = collector("background", async () => ({ allTabs: (await chrome.tabs.query({})).length }));

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

// First install: the setup guide (open the sidebar, pin sites, import from Arc, shortcuts, calendar).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") openWelcome().catch(console.warn);
});

// A service worker has no "current window", so tabs.create() without a window fails when none is open
// (e.g. the extension loads at browser launch); open the page in a new window then.
async function openWelcome() {
  const url = chrome.runtime.getURL("welcome.html");
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined);
  if (win) await chrome.tabs.create({ url, windowId: win.id });
  else await chrome.windows.create({ url });
}

// MARK: Bookmark tabs

chrome.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => diag.timed("tabs.onRemoved", async () => {
  await unbind(tabId);
  // Keep the saved addresses when windows close (e.g. quitting), so the tabs can be re-bound on restart.
  if (!isWindowClosing) await saveBoundUrls();
}));
chrome.tabs.onReplaced.addListener((added, removed) => rebind(removed, added));
chrome.tabs.onUpdated.addListener((tabId, { url }) => diag.timed("tabs.onUpdated:bound", async () => {
  if (url && (await chrome.storage.session.get(`bound:${tabId}`))[`bound:${tabId}`]) {
    diag.count("saveBoundUrls");
    await saveBoundUrls();
  }
}));

// MARK: Duplicate tabs from other apps

// Duplicate checks include a 300 ms wait, so their timings are wall-clock, not work.
chrome.tabs.onCreated.addListener((tab) => diag.timed("duplicates:created", () => onTabCreated(tab)).catch(console.warn));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  diag.count("tabs.onUpdated");
  const checking = onTabUpdated(tabId, change, tab);
  if (checking) diag.timed("duplicates:updated", () => checking).catch(console.warn);
});

// Restored tabs appear over the first seconds after a restart; re-bind them as they come.
chrome.runtime.onStartup.addListener(() => {
  noteStartup();
  diag.count("startup");
  for (const delay of [500, 3000, 10000]) {
    setTimeout(() => diag.timed("adoptRestoredTabs", adoptRestoredTabs).catch(console.warn), delay);
  }
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
