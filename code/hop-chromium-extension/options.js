// Sidebar settings, stored in chrome.storage.sync so they follow the browser profile.

import { calendarAddress, saveCalendarAddress } from "./calendar-setting.js";

const text = document.getElementById("background");
const picker = document.getElementById("picker");
const DEFAULT = "#35343E";

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

function show(value) {
  text.value = value ?? "";
  picker.value = isHex(value) ? value : DEFAULT;
}

const save = (value) => (value ? chrome.storage.sync.set({ background: value }) : chrome.storage.sync.remove("background"));

chrome.storage.sync.get("background").then(({ background }) => show(background));
text.addEventListener("change", () => save(text.value.trim()));
picker.addEventListener("input", () => {
  text.value = picker.value;
  save(picker.value);
});
document.getElementById("reset").addEventListener("click", () => {
  show(undefined);
  save("");
});

// MARK: Calendar preview (see calendar-setting.js)

const calendar = document.getElementById("calendar");
const calendarStatus = document.getElementById("calendar-status");

calendarAddress().then((address) => (calendar.value = address));
calendar.addEventListener("change", async () => {
  calendarStatus.textContent = "";
  const error = await saveCalendarAddress(calendar.value);
  calendarStatus.textContent = error ?? (calendar.value.trim() ? "Saved." : "");
});

// MARK: Duplicate tabs from other apps (see duplicates.js)

const duplicates = document.getElementById("duplicates");
chrome.storage.sync.get("duplicates").then((stored) => (duplicates.value = stored.duplicates ?? "ask"));
duplicates.addEventListener("change", () => chrome.storage.sync.set({ duplicates: duplicates.value }));
