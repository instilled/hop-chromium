// Import from Arc: its sidebar lives in ~/Library/Application Support/Arc/StorableSidebar.json. Favorites (one set per
// Arc profile) become the "Pinned" folder; each space's pinned tabs become a bookmark folder named after the space,
// with Arc's folders kept as subfolders. Importing again only adds what isn't there yet.

import { PINNED_FOLDER } from "./bookmark-tabs.js";

/** Arc stores maps as flat arrays: key, value, key, value, … */
const values = (list) => (list ?? []).filter((_, i) => i % 2 === 1);
const pairs = (list) => values(list).map((value, i) => [list[i * 2], value]);

/** The sidebar's favorites and spaces as bookmark trees: { favorites: [{ id, label, items }], spaces: [{ id, label, items }] }.
 *  Items are { title, url } or { title, children }. Throws if the file isn't Arc's sidebar. */
export function parseArcSidebar(json) {
  const container = json?.sidebar?.containers?.find((c) => c.spaces && c.items);
  if (!container) throw new Error("That isn't Arc's sidebar file (StorableSidebar.json).");
  const items = new Map(values(container.items).map((item) => [item.id, item]));

  const tree = (id) => {
    const item = items.get(id);
    if (!item) return undefined;
    const { tab, list, itemContainer } = item.data ?? {};
    if (tab) return tab.savedURL ? { title: item.title || tab.savedTitle || tab.savedURL, url: tab.savedURL } : undefined;
    const children = (item.childrenIds ?? []).map(tree).filter(Boolean);
    if (list) return children.length ? { title: item.title || "Folder", children } : undefined;
    if (itemContainer) return { children };
    return undefined;
  };
  const profileName = (profile) => (profile?.custom ? profile.custom._0?.directoryBasename : "Default profile");

  const favorites = pairs(container.topAppsContainerIDs)
    .map(([profile, id]) => ({ id, label: `Favorites (${profileName(profile)})`, items: tree(id)?.children ?? [] }))
    .filter((f) => f.items.length);
  const spaces = values(container.spaces).map((space) => {
    const ids = space.containerIDs ?? [];
    const pinned = ids[ids.indexOf("pinned") + 1];
    const label = space.title || "Untitled space";
    return { id: space.id, label, items: (ids.includes("pinned") && tree(pinned)?.children) || [] };
  }).filter((s) => s.items.length);
  return { favorites, spaces };
}

export const countLinks = (items) => items.reduce((n, i) => n + (i.url ? 1 : countLinks(i.children)), 0);

/** Adds `items` under `parentId`, merging into folders of the same name and skipping addresses already there. */
async function addTree(parentId, items) {
  let added = 0;
  const existing = await chrome.bookmarks.getChildren(parentId);
  for (const item of items) {
    if (item.url) {
      if (existing.some((e) => e.url === item.url)) continue;
      existing.push(await chrome.bookmarks.create({ parentId, title: item.title, url: item.url }));
      added++;
    } else {
      const folder = existing.find((e) => !e.url && e.title === item.title)
        ?? await chrome.bookmarks.create({ parentId, title: item.title });
      existing.push(folder);
      added += await addTree(folder.id, item.children);
    }
  }
  return added;
}

/** Imports the chosen favorites (into Pinned) and spaces (one folder each). Returns how many bookmarks were added. */
export async function importArc({ favorites, spaces }) {
  const [root] = await chrome.bookmarks.getTree();
  const bar = root.children[0];
  let added = 0;
  if (favorites.length) {
    const pinned = (await chrome.bookmarks.search({ title: PINNED_FOLDER })).find((n) => !n.url)
      ?? await chrome.bookmarks.create({ parentId: bar.id, title: PINNED_FOLDER, index: 0 });
    for (const f of favorites) added += await addTree(pinned.id, f.items.filter((i) => i.url));
  }
  for (const space of spaces) added += await addTree(bar.id, [{ title: space.label, children: space.items }]);
  return added;
}
