// Sidebar settings, stored in chrome.storage.sync so they follow the browser profile.

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

// MARK: Calendar preview (secret iCal address; kept in local storage, it's a credential)

const calendar = document.getElementById("calendar");
const calendarStatus = document.getElementById("calendar-status");

chrome.storage.local.get("calendarIcs").then(({ calendarIcs }) => (calendar.value = calendarIcs ?? ""));

calendar.addEventListener("change", async () => {
  const value = calendar.value.trim();
  calendarStatus.textContent = "";
  if (!value) return chrome.storage.local.remove("calendarIcs");
  let url;
  try {
    url = new URL(value);
  } catch {
    calendarStatus.textContent = "That isn't a web address.";
    return;
  }
  // Google is covered by the manifest; other calendar hosts need the user's OK.
  if (url.hostname !== "calendar.google.com") {
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) {
      calendarStatus.textContent = "Hop needs access to that site to read the calendar.";
      return;
    }
  }
  await chrome.storage.local.set({ calendarIcs: url.href });
  calendarStatus.textContent = "Saved.";
});

// MARK: Duplicate tabs from other apps (see duplicates.js)

const duplicates = document.getElementById("duplicates");
chrome.storage.sync.get("duplicates").then((stored) => (duplicates.value = stored.duplicates ?? "ask"));
duplicates.addEventListener("change", () => chrome.storage.sync.set({ duplicates: duplicates.value }));
