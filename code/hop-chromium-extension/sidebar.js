// Hop Sidebar: pinned bookmarks, bookmarks and this window's tabs. Everything re-renders from Chrome's state on each change.

import { adoptRestoredTabs, bind, boundTabs, openBookmark, PINNED_FOLDER, pinnedFolder } from "./bookmark-tabs.js";
import { CALENDAR_HELP, saveCalendarAddress } from "./calendar-setting.js";
import { pendingAsk, switchTo, ASK } from "./duplicates.js";
import { calendarPreview, chatPreview, gmailPreview, openChatConversation, previewKind } from "./previews.js";

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const PINNED_SHORTCUTS = 6;

let windowId;
let clearable = []; // tabs "Clear" closes, from the last render
let paused = false; // while renaming or dragging; re-rendering would throw away the text field or the drag
let dragged; // the bookmark being dragged
let draggedTab; // a tab from the tab list being dragged
let renameNext; // bookmark id to start renaming after the next render (a new folder)
let lastPinned = []; // pinned bookmarks from the last render, for prefetching previews

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** The browser's cached favicon for a page. */
function cachedFavicon(url) {
  const src = new URL(chrome.runtime.getURL("/_favicon/"));
  src.searchParams.set("pageUrl", url || "about:blank");
  src.searchParams.set("size", "32");
  return src.href;
}

/** A tab's live favicon when this page may load it; chrome:// and the page's own blob: URLs (WhatsApp draws its
 *  unread count into one) aren't loadable here. */
function faviconFor(url, tab) {
  const live = tab?.favIconUrl;
  if (live && !/^(chrome|blob):/.test(live)) return live;
  return cachedFavicon(url);
}

function icon(url, tab) {
  const img = el("img", { className: "icon", src: faviconFor(url, tab), alt: "" });
  // Any other unloadable icon: fall back to the cached one, once.
  img.addEventListener("error", () => {
    const fallback = cachedFavicon(url);
    if (img.src !== fallback) img.src = fallback;
  }, { once: true });
  return img;
}
const isMiddleClick = (event) => event.button === 1;
const activate = (tabId) => chrome.tabs.update(tabId, { active: true });
const close = (tabId) => chrome.tabs.remove(tabId);

/** Unread count from a tab title, as Gmail ("Inbox (3) - …"), Outlook, Slack and others write it. */
function unreadCount(tab) {
  return tab?.title?.match(/\((\d{1,3}(?:,\d{3})*\+?)\)/)?.[1];
}

const badge = (count) => el("span", { className: "badge", textContent: count });

function closeButton(tabId, title) {
  const button = el("button", { className: "close", title, textContent: "×" });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    close(tabId);
  });
  return button;
}

function debounce(fn, ms = 30) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// MARK: Bookmarks

const openFolders = new Set(JSON.parse(localStorage.getItem("openFolders") || "[]"));

/** Click: the bookmark's own tab. ⌘-click: a plain background tab. Middle-click: close its tab. */
function onBookmarkClick(bookmark, tab, event) {
  if (event.metaKey || event.ctrlKey) chrome.tabs.create({ url: bookmark.url, windowId, active: false });
  else if (isMiddleClick(event)) tab && close(tab.id);
  else openBookmark(bookmark, windowId);
}

/** Right-click: rename in place. Return saves (so does clicking away), Escape cancels. */
function startRename(bookmark, target, className = "") {
  paused = true;
  const input = el("input", { className: `rename ${className}`, value: bookmark.title, spellcheck: false });
  target.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (save && title && title !== bookmark.title) await chrome.bookmarks.update(bookmark.id, { title });
    paused = false;
    render();
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault(); // don't toggle a folder's <details>
  });
}

// MARK: Context menu
// Right-click a bookmark, folder or tile: Rename · New Folder · Delete. Right-click empty space: New Folder.

const menu = () => document.getElementById("menu");

function closeMenu() {
  menu().hidden = true;
}

function showMenu(event, entries) {
  event.preventDefault();
  event.stopPropagation();
  const box = menu();
  box.replaceChildren(...entries.map(([label, action, danger]) => {
    const item = el("button", { className: `menu-item${danger ? " danger" : ""}`, textContent: label });
    item.addEventListener("click", () => {
      closeMenu();
      action();
    });
    return item;
  }));
  box.hidden = false;
  const x = Math.min(event.clientX, window.innerWidth - box.offsetWidth - 4);
  const y = Math.min(event.clientY, window.innerHeight - box.offsetHeight - 4);
  box.style.left = `${Math.max(4, x)}px`;
  box.style.top = `${Math.max(4, y) + window.scrollY}px`;
}

/** A folder named "New Folder" right after `sibling` (or at the end of the bookmarks bar), then rename it. */
async function newFolder(sibling) {
  const [root] = await chrome.bookmarks.getTree();
  const place = sibling && sibling.parentId !== "0"
    ? { parentId: sibling.parentId, index: sibling.index + 1 }
    : { parentId: root.children[0].id };
  const folder = await chrome.bookmarks.create({ ...place, title: "New Folder" });
  openFolders.add(folder.id);
  renameNext = folder.id;
  render();
}

async function deleteBookmark(bookmark) {
  if (bookmark.url) return chrome.bookmarks.remove(bookmark.id);
  const [tree] = await chrome.bookmarks.getSubTree(bookmark.id);
  const count = (function countLeaves(n) { return (n.children ?? []).reduce((s, c) => s + (c.url ? 1 : countLeaves(c)), 0); })(tree);
  if (count && !confirm(`Delete "${bookmark.title}" and the ${count} bookmark${count === 1 ? "" : "s"} in it?`)) return;
  await chrome.bookmarks.removeTree(bookmark.id);
}

function onRightClick(node, bookmark, target, className) {
  node.dataset.bookmarkId = bookmark.id;
  node.addEventListener("contextmenu", (event) => {
    const isRoot = bookmark.parentId === "0"; // "Other bookmarks" etc. can't be renamed, moved or deleted
    showMenu(event, [
      ...(isRoot ? [] : [["Rename", () => startRename(bookmark, target(), className)]]),
      ["New Folder", () => newFolder(isRoot ? undefined : bookmark)],
      ...(isRoot ? [] : [["Delete", () => deleteBookmark(bookmark), true]]),
    ]);
  });
}

function wireBookmark(node, bookmark, tab) {
  node.classList.toggle("open", Boolean(tab));
  node.classList.toggle("active", Boolean(tab?.active));
  node.addEventListener("click", (event) => onBookmarkClick(bookmark, tab, event));
  node.addEventListener("auxclick", (event) => isMiddleClick(event) && onBookmarkClick(bookmark, tab, event));
  return node;
}

// MARK: Drag and drop
// Bookmarks, folders and tiles move by dragging. Dropping a tab from the tab list, or a page or link from anywhere,
// adds a bookmark at that spot; a dropped tab becomes the new bookmark's tab, as in Arc.

const URL_TYPES = ["text/uri-list", "text/x-moz-url", "text/plain"];
const accepts = (event) => dragged || draggedTab || URL_TYPES.some((t) => event.dataTransfer.types.includes(t));

/** What was dropped: { bookmark } | { tab } | { url, title } | undefined. */
function dropPayload(event) {
  if (dragged) return { bookmark: dragged };
  if (draggedTab) return { tab: draggedTab };
  const data = event.dataTransfer;
  const url = (data.getData("text/uri-list").split(/\r?\n/).find((l) => l && !l.startsWith("#"))
    || data.getData("text/plain")).trim();
  if (!/^https?:\/\/|^file:\/\//i.test(url)) return undefined;
  const html = data.getData("text/html");
  const title = (html && new DOMParser().parseFromString(html, "text/html").body.textContent.trim()) || new URL(url).hostname;
  return { url, title: title.slice(0, 200) };
}

/** Apply a drop at { parentId, index }. Chrome counts the index before removing a moved bookmark from its spot. */
async function dropAt(payload, place) {
  try {
    if (payload.bookmark) {
      if (payload.bookmark.id !== place.parentId) await chrome.bookmarks.move(payload.bookmark.id, place);
    } else if (payload.tab) {
      const bookmark = await chrome.bookmarks.create({ ...place, title: payload.tab.title || payload.tab.url, url: payload.tab.url });
      await bind(payload.tab.id, bookmark.id);
    } else {
      await chrome.bookmarks.create({ ...place, title: payload.title, url: payload.url });
    }
  } catch (error) {
    console.warn("drop:", error.message); // e.g. a folder dropped into itself
  }
}

const DROP_CLASSES = ["drop", "drop-before", "drop-after", "drop-into"];
const clearDropMarks = () => document.querySelectorAll(DROP_CLASSES.map((c) => `.${c}`).join(",")).forEach((n) => n.classList.remove(...DROP_CLASSES));

/** A bookmark row or folder header as a drop target: before / after it, or into a folder (middle half). */
function listDropTarget(node, bookmark) {
  const where = (event) => {
    const box = node.getBoundingClientRect();
    const y = (event.clientY - box.top) / box.height;
    if (!bookmark.url && y > 0.25 && y < 0.75) return "into";
    return y < 0.5 ? "before" : "after";
  };
  node.addEventListener("dragover", (event) => {
    if (!accepts(event) || bookmark.parentId === "0" && where(event) !== "into") return;
    event.preventDefault();
    event.stopPropagation();
    clearDropMarks();
    node.classList.add(`drop-${where(event)}`);
  });
  node.addEventListener("drop", async (event) => {
    const payload = dropPayload(event);
    const position = where(event);
    event.preventDefault();
    event.stopPropagation();
    clearDropMarks();
    if (!payload) return;
    const place = position === "into" ? { parentId: bookmark.id }
      : { parentId: bookmark.parentId, index: bookmark.index + (position === "after" ? 1 : 0) };
    await dropAt(payload, place);
  });
}

function draggable(node, bookmark) {
  node.draggable = true;
  node.addEventListener("dragstart", (event) => {
    dragged = bookmark;
    paused = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/uri-list", bookmark.url);
  });
  node.addEventListener("dragend", () => {
    dragged = undefined;
    paused = false;
    render();
  });
}

/** Drop on a tile: take its place. Drop on the grid's empty space: go last. */
/** `folder` is undefined until something is pinned; the first drop creates it at the top of the bookmarks bar. */
function pinnedDropZone(grid, folder, barId) {
  const tileAt = (event) => event.target.closest?.("#pinned > button");
  grid.ondragover = (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    clearDropMarks();
    (tileAt(event) ?? grid.querySelector(".pinned-empty"))?.classList.add("drop");
  };
  grid.ondragleave = (event) => !grid.contains(event.relatedTarget) && clearDropMarks();
  grid.ondrop = async (event) => {
    event.preventDefault();
    clearDropMarks();
    const payload = dropPayload(event);
    folder ??= { ...(await chrome.bookmarks.create({ parentId: barId, title: PINNED_FOLDER, index: 0 })), children: [] };
    const target = folder.children.find((c) => c.id === tileAt(event)?.dataset.id);
    if (!payload || (payload.bookmark && target?.id === payload.bookmark.id)) return;
    let index = target ? target.index : folder.children.length;
    if (payload.bookmark?.parentId === folder.id && target && payload.bookmark.index < target.index) index += 1;
    await dropAt(payload, { parentId: folder.id, index });
  };
}

// MARK: Previews
// Hovering a Gmail, Calendar or Chat tile shows a card under the grid: unread mail, the next meetings, recent chats.
// Data is cached and refreshed in the background (and prefetched), so the card shows instantly.

const PEEK_FRESH_MS = 20 * 1000;
const PEEK_PREFETCH_MS = 2 * 60 * 1000;
const peekData = new Map(); // bookmark id → { at, data } or { at, error }
const peekLoading = new Map(); // bookmark id → promise

const peek = () => document.getElementById("peek");
let peekTimer;
let hideTimer;
let peeking; // bookmark id the card is for

function hidePeekSoon() {
  clearTimeout(peekTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (peek().contains(document.activeElement)) return;
    peek().hidden = true;
    peeking = undefined;
  }, 250);
}

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function ago(ms) {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Open the bookmark's own tab, optionally at a specific page (e.g. one email). */
async function openInBookmarkTab(bookmark, url) {
  await openBookmark(bookmark, windowId);
  const tabId = (await boundTabs(windowId)).get(bookmark.id);
  if (url && tabId !== undefined) await chrome.tabs.update(tabId, { url, active: true });
}

function peekMessage(text, setup) {
  const message = el("div", { className: "peek-empty", textContent: text });
  if (setup) {
    const link = el("button", { className: "peek-link", textContent: "Open Options" });
    link.addEventListener("click", () => chrome.runtime.openOptionsPage());
    message.append(" ", link);
  }
  return message;
}

/** The Calendar tile before its address is set: paste it right here. */
function calendarSetup(bookmark) {
  const input = el("input", { className: "peek-input", type: "text", spellcheck: false, placeholder: "https://calendar.google.com/calendar/ical/…" });
  const status = el("div", { className: "peek-sub" });
  const save = el("button", { className: "peek-button", textContent: "Show my meetings" });
  save.addEventListener("click", async () => {
    const error = await saveCalendarAddress(input.value);
    if (error) return (status.textContent = error);
    peekData.delete(bookmark.id);
    status.textContent = "Loading…";
    await refreshPeek(bookmark, "calendar");
    if (peeking === bookmark.id) peek().replaceChildren(el("div", { className: "peek-scroll" }, ...peekContent(bookmark, "calendar")));
  });
  input.addEventListener("keydown", (event) => event.key === "Enter" && save.click());
  return [
    el("div", { className: "peek-head", textContent: "Show your meetings here" }),
    el("div", { className: "peek-empty" }, "Paste your calendar's secret iCal address. ", el("div", { className: "peek-help", textContent: CALENDAR_HELP })),
    input, save, status,
  ];
}

function gmailCard(bookmark, { total, items }) {
  if (!items.length) return [peekMessage("No unread mail")];
  return [
    el("div", { className: "peek-head", textContent: `${total} unread` }),
    ...items.map((item) => {
      const row = el("button", { className: "peek-item" },
        el("div", { className: "peek-line" },
          el("span", { className: "peek-strong", textContent: item.from }),
          el("span", { className: "peek-time", textContent: ago(item.time) })),
        el("div", { className: "peek-title", textContent: item.title }),
        el("div", { className: "peek-sub", textContent: item.summary }));
      row.addEventListener("click", () => openInBookmarkTab(bookmark, item.link));
      return row;
    }),
  ];
}

function calendarCard(bookmark, days) {
  if (!days.some((d) => d.events.length)) return [peekMessage("Nothing else today or tomorrow")];
  const now = Date.now();
  return days.filter((d) => d.events.length).flatMap(({ day, events }) => [
    el("div", { className: "peek-head", textContent: day }),
    ...events.map((event) => {
      const when = event.allDay ? "All day" : `${timeOf(event.start)}–${timeOf(event.end)}`;
      const row = el("button", { className: "peek-item" },
        el("div", { className: "peek-line" },
          el("span", { className: "peek-time", textContent: when }),
          event.start <= now && now < event.end && !event.allDay ? el("span", { className: "peek-now", textContent: "Now" }) : ""),
        el("div", { className: "peek-title", textContent: event.summary }),
        event.location ? el("div", { className: "peek-sub", textContent: event.location }) : "");
      row.addEventListener("click", () => openInBookmarkTab(bookmark));
      return row;
    }),
  ]);
}

function chatCard(bookmark, { tabId, items, namesOnly }) {
  if (!items.length) return [peekMessage("No conversations to show")];
  const unread = items.filter((i) => i.unread).length;
  return [
    el("div", { className: "peek-head", textContent: unread ? `${unread} unread` : "Recent" }),
    ...items.slice(0, 7).map((item) => {
      const row = el("button", { className: `peek-item${item.unread ? " unread" : ""}` },
        el("div", { className: "peek-line" },
          el("span", { className: "peek-strong", textContent: item.name }),
          el("span", { className: "peek-time", textContent: item.time })),
        item.text ? el("div", { className: "peek-sub", textContent: item.text }) : "");
      row.addEventListener("click", () => (item.id && !namesOnly ? openChatConversation(tabId, item.id) : openInBookmarkTab(bookmark)));
      return row;
    }),
  ];
}

const loaders = {
  gmail: (bookmark) => gmailPreview(bookmark.url),
  calendar: () => calendarPreview(),
  chat: async (bookmark) => chatPreview(bookmark, windowId, (await boundTabs(windowId)).get(bookmark.id)),
};
const cards = { gmail: gmailCard, calendar: calendarCard, chat: chatCard };

/** Load fresh data into the cache (one load per tile at a time). */
function refreshPeek(bookmark, kind) {
  if (!peekLoading.has(bookmark.id)) {
    const loading = loaders[kind](bookmark)
      .then((data) => peekData.set(bookmark.id, { at: Date.now(), data }))
      .catch((error) => peekData.set(bookmark.id, { at: Date.now(), error }))
      .finally(() => peekLoading.delete(bookmark.id));
    peekLoading.set(bookmark.id, loading);
  }
  return peekLoading.get(bookmark.id);
}

function peekContent(bookmark, kind) {
  const entry = peekData.get(bookmark.id);
  if (!entry) return [el("div", { className: "peek-empty", textContent: "Loading…" })];
  if (entry.error?.needsSetup && kind === "calendar") return calendarSetup(bookmark);
  if (entry.error) return [peekMessage(entry.error.message, entry.error.needsSetup)];
  return cards[kind](bookmark, entry.data);
}

async function showPeek(tile, bookmark, kind) {
  const card = peek();
  peeking = bookmark.id;
  card.style.top = `${tile.offsetTop + tile.offsetHeight + 8}px`;
  // Card sits 3px from the edge (see .peek); the pointer is 10px wide.
  card.style.setProperty("--peek-arrow-x", `${tile.offsetLeft + tile.offsetWidth / 2 - 3 - 5}px`);
  card.replaceChildren(el("div", { className: "peek-scroll" }, ...peekContent(bookmark, kind)));
  card.hidden = false;
  if (Date.now() - (peekData.get(bookmark.id)?.at ?? 0) < PEEK_FRESH_MS) return;
  await refreshPeek(bookmark, kind);
  if (peeking === bookmark.id) card.replaceChildren(el("div", { className: "peek-scroll" }, ...peekContent(bookmark, kind)));
}

/** Warm the cache for preview tiles that are missing or getting old. */
function prefetchPeeks(bookmarks) {
  for (const bookmark of bookmarks) {
    const kind = previewKind(bookmark.url);
    if (kind && Date.now() - (peekData.get(bookmark.id)?.at ?? 0) > PEEK_PREFETCH_MS) refreshPeek(bookmark, kind);
  }
}

function wirePeek(tile, bookmark, kind) {
  tile.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
    clearTimeout(peekTimer);
    if (dragged) return;
    peekTimer = setTimeout(() => showPeek(tile, bookmark, kind), peeking ? 0 : 350);
  });
  tile.addEventListener("mouseleave", hidePeekSoon);
  tile.addEventListener("mousedown", () => {
    clearTimeout(peekTimer);
    peek().hidden = true;
    peeking = undefined;
  });
}

/** Nothing pinned yet: say how, like Arc's empty favorites. */
function pinnedEmpty() {
  const arc = el("button", { className: "peek-link", textContent: "import from Arc" });
  arc.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html#arc") }));
  return el("div", { className: "pinned-empty" }, "Drag sites here to pin them, or ", arc);
}

function pinnedTile(bookmark, index, tab) {
  const shortcut = index < PINNED_SHORTCUTS ? `  ⌘${index + 1}` : "";
  const kind = previewKind(bookmark.url);
  // Tiles with a preview card skip the tooltip, which would cover the card.
  const tile = el("button", kind ? {} : { title: (bookmark.title || bookmark.url) + shortcut }, icon(bookmark.url, tab));
  if (kind) wirePeek(tile, bookmark, kind);
  const count = unreadCount(tab);
  if (count) tile.append(badge(count));
  tile.dataset.id = bookmark.id;
  draggable(tile, bookmark);
  onRightClick(tile, bookmark, () => tile, "tile");
  return wireBookmark(tile, bookmark, tab);
}

function bookmarkNode(node, ctx) {
  if (node.id === ctx.pinnedId) return [];
  if (node.url) {
    const tab = ctx.tabFor(node.id);
    const row = el("li", { className: "row", title: node.url }, icon(node.url, tab),
      el("span", { className: "title", textContent: node.title || node.url }));
    const count = unreadCount(tab);
    if (count) row.append(badge(count));
    if (tab) row.append(closeButton(tab.id, "Close"));
    onRightClick(row, node, () => row.querySelector(".title"));
    draggable(row, node);
    listDropTarget(row, node);
    return [wireBookmark(row, node, tab)];
  }

  const folderIcon = el("span", { className: "icon folder-icon" });
  folderIcon.innerHTML = FOLDER_ICONS;
  const summary = el("summary", { className: "row" }, folderIcon, el("span", { className: "title", textContent: node.title }));
  onRightClick(summary, node, () => summary.querySelector(".title"));
  listDropTarget(summary, node);
  if (node.parentId !== "0") draggable(summary, node);
  const details = el("details", { open: openFolders.has(node.id) }, summary,
    el("ul", {}, ...(node.children ?? []).flatMap((child) => bookmarkNode(child, ctx))));
  details.addEventListener("toggle", () => {
    details.open ? openFolders.add(node.id) : openFolders.delete(node.id);
    localStorage.setItem("openFolders", JSON.stringify([...openFolders]));
  });
  return [el("li", {}, details)];
}

// Arc-style folder outlines, closed and open (CSS shows the one matching the folder's state).
const FOLDER_ICONS = `<svg class="closed" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path class="body" d="M1.75 4.5c0-.83.67-1.5 1.5-1.5h2.7c.4 0 .78.16 1.06.44l.93.93h4.81c.83 0 1.5.67 1.5 1.5v5.88c0 .83-.67 1.5-1.5 1.5H3.25c-.83 0-1.5-.67-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`
  + `<svg class="opened" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.75 11.6V4.5c0-.83.67-1.5 1.5-1.5h2.7c.4 0 .78.16 1.06.44l.93.93h4.06c.83 0 1.5.67 1.5 1.5v.75" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path class="body" d="M3.1 13h9.15c.55 0 1.04-.34 1.23-.86l1.33-3.6a.8.8 0 0 0-.75-1.08H5.02c-.55 0-1.04.34-1.23.86L1.75 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

function collectIds(node, ids = new Set()) {
  ids.add(node.id);
  node.children?.forEach((child) => collectIds(child, ids));
  return ids;
}

// MARK: Tabs

function tabRow(tab) {
  const row = el("li", { className: "row tab", title: tab.url }, icon(tab.url, tab),
    el("span", { className: "title", textContent: tab.title || tab.url }), closeButton(tab.id, "Close Tab"));
  row.classList.toggle("active", Boolean(tab.active));
  row.classList.toggle("discarded", Boolean(tab.discarded));
  row.addEventListener("click", () => activate(tab.id));
  row.addEventListener("auxclick", (event) => isMiddleClick(event) && close(tab.id));
  row.draggable = true;
  row.addEventListener("dragstart", (event) => {
    draggedTab = tab;
    paused = true;
    event.dataTransfer.effectAllowed = "copyLink";
    event.dataTransfer.setData("text/uri-list", tab.url);
  });
  row.addEventListener("dragend", () => {
    draggedTab = undefined;
    paused = false;
    clearDropMarks();
    render();
  });
  return row;
}

function groupItem(group, tabs) {
  return el("li", { className: `group ${group.color}` },
    el("div", { className: "group-label", textContent: group.title || "Group" }), el("ul", {}, ...tabs.map(tabRow)));
}

/** Tabs in strip order, grouped. */
function tabItems(tabs, groups) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupOf = (t) => (groupById.has(t.groupId) ? t.groupId : NONE);

  const items = [];
  let run = [];
  const flush = () => {
    const group = run.length && groupById.get(groupOf(run[0]));
    items.push(...(group ? [groupItem(group, run)] : run.map(tabRow)));
    run = [];
  };
  for (const tab of tabs) {
    if (run.length && groupOf(run[0]) !== groupOf(tab)) flush();
    run.push(tab);
  }
  flush();
  return items;
}

// MARK: Render

// A link from another app opened a page that is already open (see duplicates.js): offer to go there instead.
async function renderDuplicate() {
  const bar = document.getElementById("duplicate");
  const ask = await pendingAsk(windowId);
  bar.hidden = !ask;
  if (!ask) return bar.replaceChildren();
  const button = (text, onclick) => el("button", { textContent: text, onclick });
  bar.replaceChildren(
    el("div", { className: "duplicate-text", textContent: "Already open: " },
      el("span", { className: "duplicate-title", textContent: ask.title })),
    el("div", { className: "duplicate-actions" },
      button("Switch", () => switchTo(ask.existingId, ask.tabId)),
      button("Keep both", () => chrome.storage.session.remove(ASK)),
      button("Always switch", async () => {
        await chrome.storage.sync.set({ duplicates: "switch" });
        await switchTo(ask.existingId, ask.tabId);
      })),
  );
}

async function render() {
  if (paused) return;
  renderDuplicate().catch(console.warn);
  const [tabs, groups, [root], pinned, bound] = await Promise.all([
    chrome.tabs.query({ windowId }), chrome.tabGroups.query({ windowId }), chrome.bookmarks.getTree(),
    pinnedFolder(), boundTabs(windowId),
  ]);

  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const ctx = { pinnedId: pinned?.id, tabFor: (bookmarkId) => tabById.get(bound.get(bookmarkId)) };
  // A bound tab shows on its bookmark, not in the tab list (unless the bookmark was deleted).
  const bookmarkIds = collectIds(root);
  const boundTabIds = new Set([...bound].filter(([bookmarkId]) => bookmarkIds.has(bookmarkId)).map(([, tabId]) => tabId));

  const pinnedBookmarks = (pinned?.children ?? []).filter((c) => c.url);
  lastPinned = pinnedBookmarks;
  prefetchPeeks(pinnedBookmarks);
  pinnedDropZone(document.getElementById("pinned"), pinned, root.children[0].id);
  document.getElementById("pinned").replaceChildren(...(pinnedBookmarks.length
    ? pinnedBookmarks.map((b, i) => pinnedTile(b, i, ctx.tabFor(b.id)))
    : [pinnedEmpty()]));

  // The bookmarks bar's items sit at the top level; "Other" and "Mobile" stay folders. Other top-level folders, such as
  // Vivaldi's Trash, have no folderType (Chrome 134+) and are left out.
  const [bar, ...others] = root.children;
  const typed = others.some((f) => f.folderType);
  const shown = others.filter((f) => f.children?.length && (!typed || f.folderType === "other" || f.folderType === "mobile"));
  const bookmarks = [...(bar?.children ?? []), ...shown].flatMap((n) => bookmarkNode(n, ctx));
  const empty = !bookmarks.length && !pinnedBookmarks.length;
  document.getElementById("bookmarks").replaceChildren(
    ...(empty ? [el("li", { className: "empty", textContent: "No bookmarks" })] : bookmarks));

  const listed = tabs.filter((t) => !boundTabIds.has(t.id));
  clearable = listed.filter((t) => !t.pinned && t.groupId === NONE);
  document.getElementById("clear").disabled = clearable.length === 0;
  document.getElementById("tabs").replaceChildren(...tabItems(listed, groups));
  document.querySelector(".tab.active")?.scrollIntoView({ block: "nearest" });
  if (renameNext) {
    const header = document.querySelector(`[data-bookmark-id="${renameNext}"]`);
    const bookmark = header && (await chrome.bookmarks.get(renameNext))[0];
    renameNext = undefined;
    if (bookmark) startRename(bookmark, header.querySelector(".title"));
  }
}

/** The Background option; unset keeps the stylesheet's light/dark default. */
async function applyBackground() {
  const { background } = await chrome.storage.sync.get("background");
  if (background) document.documentElement.style.setProperty("--bg", background);
  else document.documentElement.style.removeProperty("--bg");
}

async function start() {
  windowId = (await chrome.windows.getCurrent()).id;
  setInterval(() => prefetchPeeks(lastPinned), PEEK_PREFETCH_MS);
  adoptRestoredTabs().catch(console.warn);
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => event.key === "Escape" && closeMenu());
  window.addEventListener("blur", closeMenu);
  document.getElementById("bookmarks").addEventListener("contextmenu", (event) => {
    if (event.target.closest("[data-bookmark-id]")) return;
    showMenu(event, [["New Folder", () => newFolder()]]);
  });
  // Something dragged in from outside (a page, a link): hold re-renders so drop targets stay put.
  document.addEventListener("dragenter", () => (paused = true));
  document.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget && !dragged && !draggedTab) {
      paused = false;
      clearDropMarks();
    }
  });
  document.addEventListener("drop", () => setTimeout(() => {
    if (!dragged && !draggedTab) {
      paused = false;
      render();
    }
  }));
  // Dropping below the list adds to the end of the bookmarks bar.
  const list = document.getElementById("bookmarks");
  list.addEventListener("dragover", (event) => accepts(event) && event.preventDefault());
  list.addEventListener("drop", async (event) => {
    event.preventDefault();
    const payload = dropPayload(event);
    const [root] = await chrome.bookmarks.getTree();
    if (payload) await dropAt(payload, { parentId: root.children[0].id });
  });
  peek().addEventListener("mouseenter", () => clearTimeout(hideTimer));
  peek().addEventListener("mouseleave", hidePeekSoon);
  applyBackground();
  chrome.storage.onChanged.addListener((changes, area) => area === "sync" && "background" in changes && applyBackground());

  const refresh = debounce(render);
  for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated,
    chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced,
    chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved,
    chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered, chrome.bookmarks.onImportEnded, chrome.storage.onChanged]) {
    event.addListener(refresh);
  }

  document.getElementById("new-tab").addEventListener("click", () => chrome.tabs.create({ windowId }));

  // Like Arc's Clear: close the loose tabs; bookmark tabs, pinned tabs and tab groups stay.
  document.getElementById("clear").addEventListener("click", async () => {
    const ids = clearable.map((t) => t.id);
    if (!ids.length) return;
    // Closing every tab would close the window.
    if ((await chrome.tabs.query({ windowId })).length === ids.length) await chrome.tabs.create({ windowId });
    await chrome.tabs.remove(ids);
  });

  await render();
}

start();
