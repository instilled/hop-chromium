// The calendar preview's secret iCal address, kept in local storage (it's a credential). Set from Options, the welcome
// page, or right in the Calendar tile's card.

export const CALENDAR_HELP = "Google Calendar → Settings → your calendar → Integrate calendar → Secret address in iCal format.";

export async function calendarAddress() {
  return (await chrome.storage.local.get("calendarIcs")).calendarIcs ?? "";
}

/** Saves the address (empty removes it). Returns an error message, or undefined when saved. Call it straight from a
 *  click or change handler: a calendar outside Google needs the user's OK, which the browser only asks for then. */
export async function saveCalendarAddress(value) {
  value = value.trim();
  if (!value) {
    await chrome.storage.local.remove("calendarIcs");
    return undefined;
  }
  let url;
  try {
    url = new URL(value.replace(/^webcal:/i, "https:"));
  } catch {
    return "That isn't a web address.";
  }
  // Google is covered by the manifest; other calendar hosts need the user's OK.
  if (url.hostname !== "calendar.google.com" && !(await chrome.permissions.request({ origins: [`${url.origin}/*`] }))) {
    return "Hop needs access to that site to read the calendar.";
  }
  await chrome.storage.local.set({ calendarIcs: url.href });
  return undefined;
}
