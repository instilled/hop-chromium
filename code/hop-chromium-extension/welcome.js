// The page that opens after installing: how to open the sidebar, pin sites, import from Arc, set shortcuts and the
// calendar, and (in Vivaldi) the optional UI mod.

import { countLinks, importArc, parseArcSidebar } from "./arc-import.js";
import { calendarAddress, CALENDAR_HELP, saveCalendarAddress } from "./calendar-setting.js";

const $ = (id) => document.getElementById(id);
const ARC_PATH = "~/Library/Application Support/Arc/StorableSidebar.json";

// Vivaldi adds its own data to every window; Chrome doesn't.
const vivaldi = "vivExtData" in (await chrome.windows.getCurrent());
document.documentElement.classList.toggle("vivaldi", vivaldi);
document.querySelector(".browser-name").textContent = vivaldi ? "Vivaldi" : "Chrome";

async function copy(text, button) {
  await navigator.clipboard.writeText(text);
  const label = button.textContent;
  button.textContent = "(copied)";
  setTimeout(() => (button.textContent = label), 1500);
}
$("copy-arc-path").addEventListener("click", (event) => copy(ARC_PATH, event.currentTarget));
for (const button of document.querySelectorAll(".copy")) button.addEventListener("click", () => copy(button.dataset.copy, button));

// MARK: Import from Arc

let arc;

$("arc-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  $("arc-choices").hidden = true;
  if (!file) return;
  try {
    arc = parseArcSidebar(JSON.parse(await file.text()));
  } catch (error) {
    $("arc-status").textContent = error instanceof SyntaxError ? "That file isn't JSON." : error.message;
    return;
  }
  if (!arc.favorites.length && !arc.spaces.length) {
    $("arc-status").textContent = "No favorites or pinned tabs found in that file.";
    return;
  }
  $("arc-status").textContent = "";
  const option = (kind, item) => {
    const n = countLinks(item.items);
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: true, name: kind, value: item.id });
    const label = document.createElement("label");
    label.append(box, ` ${item.label} `, Object.assign(document.createElement("span"), { className: "muted", textContent: `${n} site${n === 1 ? "" : "s"}` }));
    return label;
  };
  const heading = (text) => Object.assign(document.createElement("h3"), { textContent: text });
  $("arc-list").replaceChildren(
    ...(arc.favorites.length ? [heading("Favorites → pinned sites"), ...arc.favorites.map((f) => option("favorites", f))] : []),
    ...(arc.spaces.length ? [heading("Spaces → a bookmark folder each"), ...arc.spaces.map((s) => option("spaces", s))] : []),
  );
  $("arc-choices").hidden = false;
});

$("arc-choices").addEventListener("submit", async (event) => {
  event.preventDefault();
  const chosen = (kind) => new Set([...event.target.querySelectorAll(`input[name=${kind}]:checked`)].map((b) => b.value));
  const favorites = arc.favorites.filter((f) => chosen("favorites").has(f.id));
  const spaces = arc.spaces.filter((s) => chosen("spaces").has(s.id));
  $("arc-status").textContent = "Importing…";
  try {
    const added = await importArc({ favorites, spaces });
    $("arc-status").textContent = added ? `Added ${added} bookmark${added === 1 ? "" : "s"}. Have a look in the sidebar.`
      : "Everything was already there.";
    $("arc-choices").hidden = true;
  } catch (error) {
    $("arc-status").textContent = `Import failed: ${error.message}`;
  }
});

if (location.hash === "#arc") $("arc").scrollIntoView();

// MARK: Shortcuts

$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

// MARK: Calendar

$("calendar-help").textContent = CALENDAR_HELP;
$("calendar").value = await calendarAddress();
$("calendar").addEventListener("change", async () => {
  const error = await saveCalendarAddress($("calendar").value);
  $("calendar-status").textContent = error ?? ($("calendar").value.trim() ? "Saved." : "");
});

// MARK: Vivaldi UI mod

$("save-mod").addEventListener("click", async () => {
  // Saving into a folder of its own needs the downloads permission, asked for only here.
  if (!(await chrome.permissions.request({ permissions: ["downloads"] }))) {
    $("mod-status").textContent = "Hop needs permission to save the file.";
    return;
  }
  await chrome.downloads.download({
    url: chrome.runtime.getURL("vivaldi/hide-panel-bar.css"),
    filename: "Hop Sidebar Vivaldi mod/hide-panel-bar.css",
    conflictAction: "overwrite",
  });
  $("mod-status").textContent = "Saved.";
});
