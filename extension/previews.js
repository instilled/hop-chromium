// Hover previews for pinned Gmail, Google Calendar and Google Chat tiles, like Arc's peeks.
// Gmail: the unread Atom feed, which uses the browser's Google login. Calendar: the secret iCal address from Options.
// Chat: read from the open Chat tab's Home list (Chat has no feed), so it needs that tab open.

import { occurrences, parseICS } from "./ics.js";

const CACHE_MS = 15 * 1000; // the sidebar keeps its own longer cache
const cache = new Map(); // key → { at, value }

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** "gmail", "calendar", "chat", or undefined for sites without a preview. */
export function previewKind(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === "mail.google.com" && pathname.startsWith("/mail")) return "gmail";
    if (hostname === "calendar.google.com") return "calendar";
    if (hostname === "chat.google.com" || (hostname === "mail.google.com" && pathname.startsWith("/chat"))) return "chat";
  } catch {
    // Not a URL.
  }
  return undefined;
}

/** { total, items: [{ from, title, summary, link, time }] } for the account in the bookmark (/mail/u/N/). */
export function gmailPreview(bookmarkUrl) {
  const account = /\/mail\/u\/(\d+)/.exec(bookmarkUrl)?.[1] ?? "0";
  return cached(`gmail:${account}`, async () => {
    const response = await fetch(`https://mail.google.com/mail/u/${account}/feed/atom`, { credentials: "include" });
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 401 || type.includes("text/html")) throw new Error("Sign in to Gmail in this browser profile.");
    if (!response.ok) throw new Error(`Gmail answered ${response.status}.`);
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    const text = (node, selector) => node.querySelector(selector)?.textContent?.trim() ?? "";
    return {
      total: Number(text(xml, "fullcount")) || 0,
      items: [...xml.querySelectorAll("entry")].slice(0, 6).map((entry) => ({
        from: text(entry, "author > name") || text(entry, "author > email"),
        title: text(entry, "title") || "(no subject)",
        summary: text(entry, "summary"),
        link: entry.querySelector("link")?.getAttribute("href"),
        time: Date.parse(text(entry, "issued") || text(entry, "modified")),
      })),
    };
  });
}

/** Today's remaining events and tomorrow's: [{ day: "Today" | "Tomorrow", events: [...] }]. */
export async function calendarPreview() {
  const { calendarIcs } = await chrome.storage.local.get("calendarIcs");
  if (!calendarIcs) throw Object.assign(new Error("Add your calendar's secret iCal address in Options."), { needsSetup: true });
  const events = await cached(`ics:${calendarIcs}`, async () => {
    const response = await fetch(calendarIcs);
    if (!response.ok) throw new Error(`Calendar answered ${response.status}. Check the address in Options.`);
    return parseICS(await response.text());
  });
  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const tomorrowEnd = new Date(midnight);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  const all = occurrences(events, now, tomorrowEnd.getTime());
  return [
    { day: "Today", events: all.filter((e) => e.start < midnight.getTime()) },
    { day: "Tomorrow", events: all.filter((e) => e.start >= midnight.getTime()) },
  ];
}

// MARK: Google Chat

/** Runs inside the Chat page. Home lists conversations as elements with ids like "dm/…" or "space/…"; their text is
 *  name, time, an optional "Unread", then the last message. Falls back to unread conversation names in the nav list. */
function readChatPage() {
  const MARKERS = /^(Unread|Thread|Latest reply|Press tab.*|\d+ Notifications?)$/i;
  const seen = new Set();
  const items = [];
  for (const node of document.querySelectorAll('[role="list"] [id^="dm/"], [role="list"] [id^="space/"]')) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const parts = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    }
    if (parts.length < 2) continue;
    const [name, time, ...rest] = parts;
    const cut = rest.indexOf("Message"); // threads: "Latest reply …" then "Message …"; keep the latest
    const text = (cut >= 0 ? rest.slice(0, cut) : rest).filter((t) => !MARKERS.test(t)).join(" ");
    items.push({ id: node.id, name, time, unread: rest.includes("Unread"), text });
  }
  if (items.length) return { items };
  const unread = [...document.querySelectorAll("a[aria-label]")].map((a) => a.getAttribute("aria-label"))
    .filter((label) => /\bUnread\b/.test(label))
    .map((label) => label.replace(/Press [Tt]ab.*$/, "")
      .replace(/\b(Away|Active|Unread|Do not disturb|\d+ Notifications?|Pinned conversation|Meeting conversation|Conversation|Space)\b/g, "")
      .replace(/\s+/g, " ").trim());
  return { items: unread.map((name) => ({ name, time: "", unread: true, text: "" })), namesOnly: true };
}

/** The Chat tab to read: the tile's own tab, else any Chat tab in the window. */
async function chatTab(bookmark, windowId, boundTabId) {
  if (boundTabId !== undefined) return chrome.tabs.get(boundTabId);
  const [tab] = await chrome.tabs.query({ windowId, url: ["https://chat.google.com/*", "https://mail.google.com/chat/*"] });
  return tab;
}

/** { tabId, items: [{ id, name, time, unread, text }], namesOnly } */
export async function chatPreview(bookmark, windowId, boundTabId) {
  const tab = await chatTab(bookmark, windowId, boundTabId);
  if (!tab) throw new Error("Open Chat once to see messages here.");
  if (tab.discarded) throw new Error("The Chat tab is asleep; open it once to see messages.");
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: readChatPage });
  const best = results.map((r) => r.result).filter(Boolean).sort((a, b) => b.items.length - a.items.length)[0];
  return { tabId: tab.id, items: best?.items ?? [], namesOnly: Boolean(best?.namesOnly) };
}

/** Open one conversation in the Chat tab, as if clicked there. */
export async function openChatConversation(tabId, id) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (target) => document.getElementById(target)?.click(),
    args: [id],
  });
  await chrome.tabs.update(tabId, { active: true });
}
