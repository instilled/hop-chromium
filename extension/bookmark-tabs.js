// Arc-style bookmark tabs: a bookmark opens one tab that stays bound to it, so clicking the bookmark again
// returns to that tab wherever it has navigated. Bindings live in session storage as `bound:<tabId>` → bookmark id.

export const PINNED_FOLDER = "Pinned";

const PREFIX = "bound:";

async function bindings() {
  const stored = await chrome.storage.session.get(null);
  return Object.entries(stored).filter(([key]) => key.startsWith(PREFIX))
    .map(([key, bookmarkId]) => ({ tabId: Number(key.slice(PREFIX.length)), bookmarkId }));
}

/** Bookmark id → tab id for the bound tabs in `windowId`. */
export async function boundTabs(windowId) {
  const [all, tabs] = await Promise.all([bindings(), chrome.tabs.query({ windowId })]);
  const inWindow = new Set(tabs.map((t) => t.id));
  return new Map(all.filter((b) => inWindow.has(b.tabId)).map((b) => [b.bookmarkId, b.tabId]));
}

export async function openBookmark(bookmark, windowId) {
  const bound = (await boundTabs(windowId)).get(bookmark.id);
  if (bound !== undefined) return chrome.tabs.update(bound, { active: true });

  // Adopt an unbound tab that is already showing the bookmark, else open one.
  const taken = new Set((await bindings()).map((b) => b.tabId));
  const existing = (await chrome.tabs.query({ windowId })).find((t) => t.url === bookmark.url && !taken.has(t.id));
  const tab = existing
    ? await chrome.tabs.update(existing.id, { active: true })
    : await chrome.tabs.create({ url: bookmark.url, windowId });
  await chrome.storage.session.set({ [PREFIX + tab.id]: bookmark.id });
}

export const unbind = (tabId) => chrome.storage.session.remove(PREFIX + tabId);

export async function rebind(oldTabId, newTabId) {
  const { [PREFIX + oldTabId]: bookmarkId } = await chrome.storage.session.get(PREFIX + oldTabId);
  if (bookmarkId) await chrome.storage.session.set({ [PREFIX + newTabId]: bookmarkId });
  await unbind(oldTabId);
}

/** The "Pinned" bookmarks folder (anywhere in the tree), with its children. */
export async function pinnedFolder() {
  const folder = (await chrome.bookmarks.search({ title: PINNED_FOLDER })).find((n) => !n.url);
  return folder && (await chrome.bookmarks.getSubTree(folder.id))[0];
}
