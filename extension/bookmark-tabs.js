// Arc-style bookmark tabs: a bookmark opens one tab that stays bound to it, so clicking the bookmark again
// returns to that tab wherever it has navigated. Bindings live in session storage as `bound:<tabId>` → bookmark id.
// Tab ids don't survive a browser restart, so each bound tab's address is also kept in local storage
// (`boundUrls`: bookmark id → addresses) and restored tabs are re-bound by address.

export const PINNED_FOLDER = "Pinned";

const PREFIX = "bound:";
const URLS = "boundUrls";

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
  await bind(tab.id, bookmark.id);
}

export async function bind(tabId, bookmarkId) {
  await chrome.storage.session.set({ [PREFIX + tabId]: bookmarkId });
  await saveBoundUrls();
}

/** Record the addresses of all bound tabs, for re-binding after a restart. */
export async function saveBoundUrls() {
  const [all, tabs] = await Promise.all([bindings(), chrome.tabs.query({})]);
  const urlOf = new Map(tabs.map((t) => [t.id, t.url || t.pendingUrl]));
  const urls = {};
  for (const { tabId, bookmarkId } of all) {
    const url = urlOf.get(tabId);
    if (url) (urls[bookmarkId] ??= []).push(url);
  }
  await chrome.storage.local.set({ [URLS]: urls });
}

/** After a restart: bind restored tabs to their bookmarks again, by saved address (or the bookmark's own). */
export async function adoptRestoredTabs() {
  const [{ [URLS]: saved = {} }, all, tabs] = await Promise.all([
    chrome.storage.local.get(URLS), bindings(), chrome.tabs.query({ windowType: "normal" }),
  ]);
  const taken = new Set(all.map((b) => b.tabId));
  const boundIn = new Set(all.map((b) => `${b.bookmarkId}@${tabs.find((t) => t.id === b.tabId)?.windowId}`));
  const updates = {};
  for (const [bookmarkId, urls] of Object.entries(saved)) {
    const bookmark = await chrome.bookmarks.get(bookmarkId).then(([b]) => b, () => undefined);
    if (!bookmark?.url) continue;
    const wanted = new Set([...urls, bookmark.url]);
    for (const tab of tabs) {
      const key = `${bookmarkId}@${tab.windowId}`;
      if (taken.has(tab.id) || boundIn.has(key) || !wanted.has(tab.url || tab.pendingUrl)) continue;
      updates[PREFIX + tab.id] = bookmarkId;
      taken.add(tab.id);
      boundIn.add(key);
    }
  }
  if (Object.keys(updates).length) await chrome.storage.session.set(updates);
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
