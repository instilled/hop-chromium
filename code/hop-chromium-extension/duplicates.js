// Links from other apps (Slack, Mail, …) open a new tab even when the page is already open. Such a tab has no opener
// and comes up active. Depending on the "duplicates" option it switches to the open tab and closes the new one
// ("switch"), asks in the sidebar first ("ask", the default), or stays ("off").

const STARTUP_GRACE_MS = 15 * 1000; // tabs restored right after the browser starts aren't new
const ASK_MS = 60 * 1000; // the sidebar's question goes away after this
export const ASK = "duplicateAsk"; // session storage: { tabId, existingId, windowId, title, at }

const waiting = new Set(); // new tabs that have no address yet

/** The address without a trailing "/" or empty "#", for http(s) pages only. */
function key(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.href.replace(/#$/, "").replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export async function duplicatesMode() {
  return (await chrome.storage.sync.get("duplicates")).duplicates ?? "ask";
}

export function noteStartup() {
  return chrome.storage.session.set({ startedAt: Date.now() });
}

export async function onTabCreated(tab) {
  if (tab.openerTabId !== undefined || !tab.active) return;
  const { startedAt } = await chrome.storage.session.get("startedAt");
  if (startedAt && Date.now() - startedAt < STARTUP_GRACE_MS) return;
  const url = tab.pendingUrl || tab.url;
  if (key(url)) return check(tab, url);
  waiting.add(tab.id);
  setTimeout(() => waiting.delete(tab.id), 3000);
}

export function onTabUpdated(tabId, { url }, tab) {
  if (!url || !waiting.delete(tabId)) return;
  return check(tab, url);
}

async function check(tab, url) {
  const wanted = key(url);
  if (!wanted) return;
  // The sidebar binds the tabs it opens for bookmarks right after creating them; those aren't duplicates.
  await new Promise((resolve) => setTimeout(resolve, 300));
  if ((await chrome.storage.session.get(`bound:${tab.id}`))[`bound:${tab.id}`]) return;
  const mode = await duplicatesMode();
  if (mode === "off") return;
  const same = (await chrome.tabs.query({})).filter((t) => t.id !== tab.id && key(t.pendingUrl || t.url) === wanted);
  if (!same.length) return;
  // Prefer a bookmark's tab, then one in the same window.
  const stored = await chrome.storage.session.get(same.map((t) => `bound:${t.id}`));
  const rank = (t) => (stored[`bound:${t.id}`] ? 0 : 2) + (t.windowId === tab.windowId ? 0 : 1);
  const existing = same.sort((a, b) => rank(a) - rank(b))[0];
  if (mode === "switch") return switchTo(existing.id, tab.id);
  await chrome.storage.session.set({
    [ASK]: { tabId: tab.id, existingId: existing.id, windowId: tab.windowId, title: existing.title || url, at: Date.now() },
  });
}

/** Go to the open tab and close the new one. */
export async function switchTo(existingId, newTabId) {
  await chrome.storage.session.remove(ASK);
  const existing = await chrome.tabs.update(existingId, { active: true }).catch(() => undefined);
  if (!existing) return;
  await chrome.windows.update(existing.windowId, { focused: true });
  await chrome.tabs.remove(newTabId).catch(() => {});
}

/** The pending question for `windowId`, if it still applies. */
export async function pendingAsk(windowId) {
  const { [ASK]: ask } = await chrome.storage.session.get(ASK);
  if (!ask || ask.windowId !== windowId) return undefined;
  const alive = await Promise.all([ask.tabId, ask.existingId].map((id) => chrome.tabs.get(id).catch(() => undefined)));
  if (Date.now() - ask.at > ASK_MS || alive.some((t) => !t)) {
    await chrome.storage.session.remove(ASK);
    return undefined;
  }
  return ask;
}
