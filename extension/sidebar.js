// Hop Sidebar: pinned bookmarks, bookmarks and this window's tabs. Everything re-renders from Chrome's state on each change.

import { boundTabs, openBookmark, pinnedFolder } from "./bookmark-tabs.js";

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const HIDDEN_TITLE = "Hop"; // the collapsed group background.js keeps inactive tabs in
const PINNED_SHORTCUTS = 6;

let windowId;
let paused = false; // while renaming or dragging; re-rendering would throw away the text field or the drag
let dragged; // the bookmark being dragged

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function faviconFor(url, tab) {
  if (tab?.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) return tab.favIconUrl;
  const src = new URL(chrome.runtime.getURL("/_favicon/"));
  src.searchParams.set("pageUrl", url || "about:blank");
  src.searchParams.set("size", "32");
  return src.href;
}

const icon = (url, tab) => el("img", { className: "icon", src: faviconFor(url, tab), alt: "" });
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

function onRightClick(node, bookmark, target, className) {
  node.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    startRename(bookmark, target(), className);
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
// Tiles reorder by dragging; any bookmark dropped on the grid moves into the Pinned folder.

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
function pinnedDropZone(grid, folder) {
  const tileAt = (event) => event.target.closest?.("#pinned > button");
  grid.ondragover = (event) => {
    if (!dragged) return;
    event.preventDefault();
    grid.querySelectorAll(".drop").forEach((t) => t.classList.remove("drop"));
    tileAt(event)?.classList.add("drop");
  };
  grid.ondragleave = (event) => !grid.contains(event.relatedTarget) && grid.querySelectorAll(".drop").forEach((t) => t.classList.remove("drop"));
  grid.ondrop = async (event) => {
    event.preventDefault();
    const target = folder.children.find((c) => c.id === tileAt(event)?.dataset.id);
    if (!dragged || target?.id === dragged.id) return;
    let index = target ? target.index : folder.children.length;
    // Chrome counts the index before removing the bookmark from its old spot.
    if (dragged.parentId === folder.id && target && dragged.index < target.index) index += 1;
    await chrome.bookmarks.move(dragged.id, { parentId: folder.id, index });
  };
}

function pinnedTile(bookmark, index, tab) {
  const shortcut = index < PINNED_SHORTCUTS ? `  ⌘${index + 1}` : "";
  const tile = el("button", { title: (bookmark.title || bookmark.url) + shortcut }, icon(bookmark.url, tab));
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
    return [wireBookmark(row, node, tab)];
  }

  const summary = el("summary", { className: "row" }, el("span", { className: "icon" }),
    el("span", { className: "title", textContent: node.title }));
  onRightClick(summary, node, () => summary.querySelector(".title"));
  const details = el("details", { open: openFolders.has(node.id) }, summary,
    el("ul", {}, ...(node.children ?? []).flatMap((child) => bookmarkNode(child, ctx))));
  details.addEventListener("toggle", () => {
    details.open ? openFolders.add(node.id) : openFolders.delete(node.id);
    localStorage.setItem("openFolders", JSON.stringify([...openFolders]));
  });
  return [el("li", {}, details)];
}

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
  return row;
}

function groupItem(group, tabs) {
  return el("li", { className: `group ${group.color}` },
    el("div", { className: "group-label", textContent: group.title || "Group" }), el("ul", {}, ...tabs.map(tabRow)));
}

/** Tabs in strip order, grouped. The hidden group's tabs count as ungrouped. While hiding, ungrouped tabs keep
 *  their opening order instead, because hiding keeps reshuffling the strip. */
function tabItems(tabs, groups, hiding) {
  const groupById = new Map(groups.filter((g) => g.title !== HIDDEN_TITLE).map((g) => [g.id, g]));
  const groupOf = (t) => (groupById.has(t.groupId) ? t.groupId : NONE);
  const ordered = hiding
    ? [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned && groupOf(t) !== NONE),
       ...tabs.filter((t) => !t.pinned && groupOf(t) === NONE).sort((a, b) => a.id - b.id)]
    : tabs;

  const items = [];
  let run = [];
  const flush = () => {
    const group = run.length && groupById.get(groupOf(run[0]));
    items.push(...(group ? [groupItem(group, run)] : run.map(tabRow)));
    run = [];
  };
  for (const tab of ordered) {
    if (run.length && groupOf(run[0]) !== groupOf(tab)) flush();
    run.push(tab);
  }
  flush();
  return items;
}

// MARK: Render

async function render() {
  if (paused) return;
  const [tabs, groups, [root], pinned, bound, { hideInactive }] = await Promise.all([
    chrome.tabs.query({ windowId }), chrome.tabGroups.query({ windowId }), chrome.bookmarks.getTree(),
    pinnedFolder(), boundTabs(windowId), chrome.storage.local.get("hideInactive"),
  ]);

  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const ctx = { pinnedId: pinned?.id, tabFor: (bookmarkId) => tabById.get(bound.get(bookmarkId)) };
  // A bound tab shows on its bookmark, not in the tab list (unless the bookmark was deleted).
  const bookmarkIds = collectIds(root);
  const boundTabIds = new Set([...bound].filter(([bookmarkId]) => bookmarkIds.has(bookmarkId)).map(([, tabId]) => tabId));

  const pinnedBookmarks = (pinned?.children ?? []).filter((c) => c.url);
  if (pinned) pinnedDropZone(document.getElementById("pinned"), pinned);
  document.getElementById("pinned").replaceChildren(...pinnedBookmarks.map((b, i) => pinnedTile(b, i, ctx.tabFor(b.id))));

  // The bookmarks bar's items sit at the top level; "Other" and "Mobile" stay folders. Other top-level folders, such as
  // Vivaldi's Trash, have no folderType (Chrome 134+) and are left out.
  const [bar, ...others] = root.children;
  const typed = others.some((f) => f.folderType);
  const shown = others.filter((f) => f.children?.length && (!typed || f.folderType === "other" || f.folderType === "mobile"));
  const bookmarks = [...(bar?.children ?? []), ...shown].flatMap((n) => bookmarkNode(n, ctx));
  const empty = !bookmarks.length && !pinnedBookmarks.length;
  document.getElementById("bookmarks").replaceChildren(
    ...(empty ? [el("li", { className: "empty", textContent: "No bookmarks" })] : bookmarks));

  document.getElementById("hide-inactive").classList.toggle("on", hideInactive === true);
  const listed = tabs.filter((t) => !boundTabIds.has(t.id));
  document.getElementById("tabs").replaceChildren(...tabItems(listed, groups, hideInactive === true));
  document.querySelector(".tab.active")?.scrollIntoView({ block: "nearest" });
}

async function start() {
  windowId = (await chrome.windows.getCurrent()).id;

  const refresh = debounce(render);
  for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated,
    chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced,
    chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved,
    chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered, chrome.bookmarks.onImportEnded, chrome.storage.onChanged]) {
    event.addListener(refresh);
  }

  document.getElementById("hide-inactive").addEventListener("click", async () => {
    const { hideInactive } = await chrome.storage.local.get("hideInactive");
    await chrome.storage.local.set({ hideInactive: hideInactive !== true });
  });

  await render();
}

start();
