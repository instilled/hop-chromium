import { openBookmark, pinnedFolder, rebind, unbind } from "./bookmark-tabs.js";

// The toolbar button (and its shortcut) opens the side panel instead of a popup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// MARK: Sidebar open state
// Windows with the sidebar open. Kept in memory because sidePanel.open() must run synchronously inside the
// shortcut's user gesture, and mirrored to session storage because the service worker gets restarted.

const openPanels = new Set();
const panelsLoaded = chrome.storage.session.get("openPanels")
  .then(({ openPanels: saved }) => saved?.forEach((id) => openPanels.add(id)));

function setPanelOpen(windowId, open) {
  if (open === openPanels.has(windowId)) return;
  open ? openPanels.add(windowId) : openPanels.delete(windowId);
  chrome.storage.session.set({ openPanels: [...openPanels] });
  schedule(windowId); // tabs hide only while the sidebar shows them
}

chrome.sidePanel.onOpened?.addListener(({ windowId }) => setPanelOpen(windowId, true));
chrome.sidePanel.onClosed?.addListener(({ windowId }) => setPanelOpen(windowId, false));
chrome.windows.onRemoved.addListener((windowId) => setPanelOpen(windowId, false));

function toggleSidebar(windowId) {
  const open = !openPanels.has(windowId);
  (open ? chrome.sidePanel.open({ windowId }) : chrome.sidePanel.close({ windowId })).catch(console.warn);
  setPanelOpen(windowId, open);
}

// MARK: Hide inactive tabs
// Chrome has no API to hide a tab, so every tab except the active one goes into one collapsed group.
// Only while the setting is on and the sidebar is open in that window; closing the sidebar brings the tabs back.
// The group is recognised by its title; tab group ids don't survive a browser restart.

const HIDDEN_TITLE = "Hop";
const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

const hideEnabled = async () => (await chrome.storage.local.get("hideInactive")).hideInactive === true;
const hiddenGroup = async (windowId) => (await chrome.tabGroups.query({ windowId, title: HIDDEN_TITLE }))[0];

// Chrome refuses tab edits while the user drags a tab; try again shortly.
async function retrying(fn, tries = 8) {
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (--tries <= 0 || !/cannot be edited|dragging/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

async function hideInactive(windowId) {
  if ((await chrome.windows.get(windowId)).type !== "normal") return;
  const tabs = await chrome.tabs.query({ windowId });
  const inactive = tabs.filter((t) => !t.active && !t.pinned && t.groupId === NONE).map((t) => t.id);
  let group = await hiddenGroup(windowId);

  if (inactive.length) {
    const groupId = await retrying(() => chrome.tabs.group(group ? { groupId: group.id, tabIds: inactive } : { createProperties: { windowId }, tabIds: inactive }));
    if (!group) await chrome.tabGroups.update(groupId, { title: HIDDEN_TITLE, color: "grey" });
  }
  const active = tabs.find((t) => t.active);
  if (group && active?.groupId === group.id) await retrying(() => chrome.tabs.ungroup(active.id));

  group = await hiddenGroup(windowId);
  if (!group) return;
  // Keep the group first, right after Chrome's pinned tabs.
  const pinned = tabs.filter((t) => t.pinned).length;
  const [first] = await chrome.tabs.query({ windowId, groupId: group.id });
  if (first && first.index !== pinned) await retrying(() => chrome.tabGroups.move(group.id, { index: pinned }));
  if (!group.collapsed) await retrying(() => chrome.tabGroups.update(group.id, { collapsed: true }));
}

async function showAll(windowId) {
  const group = await hiddenGroup(windowId);
  if (!group) return;
  const tabs = await chrome.tabs.query({ windowId, groupId: group.id });
  if (tabs.length) await retrying(() => chrome.tabs.ungroup(tabs.map((t) => t.id)));
}

// One update at a time per window, coalescing bursts of events.
const timers = new Map();
const queues = new Map();
function schedule(windowId) {
  if (windowId === undefined || windowId === chrome.windows.WINDOW_ID_NONE) return;
  clearTimeout(timers.get(windowId));
  timers.set(windowId, setTimeout(() => {
    const run = async () => {
      await panelsLoaded;
      return (await hideEnabled()) && openPanels.has(windowId) ? hideInactive(windowId) : showAll(windowId);
    };
    const next = (queues.get(windowId) ?? Promise.resolve()).then(run).catch((e) => console.warn("hide inactive:", e.message));
    queues.set(windowId, next);
  }, 60));
}

async function scheduleAll() {
  for (const w of await chrome.windows.getAll({ windowTypes: ["normal"] })) schedule(w.id);
}

chrome.tabs.onActivated.addListener(({ windowId }) => schedule(windowId));
chrome.tabs.onCreated.addListener((tab) => schedule(tab.windowId));
chrome.tabs.onAttached.addListener((_, { newWindowId }) => schedule(newWindowId));
chrome.storage.onChanged.addListener((changes, area) => area === "local" && "hideInactive" in changes && scheduleAll());
chrome.runtime.onStartup.addListener(scheduleAll);
chrome.runtime.onInstalled.addListener(scheduleAll);

// MARK: Bookmark tabs

chrome.tabs.onRemoved.addListener(unbind);
chrome.tabs.onReplaced.addListener((added, removed) => rebind(removed, added));

// ⌘1…⌘6 select the bookmarks in the "Pinned" folder.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-sidebar") return tab && toggleSidebar(tab.windowId);
  const n = Number(/^pinned-(\d)$/.exec(command)?.[1]);
  if (!n) return;
  const bookmark = (await pinnedFolder())?.children?.filter((c) => c.url)[n - 1];
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined);
  if (bookmark && win) await openBookmark(bookmark, win.id);
});
