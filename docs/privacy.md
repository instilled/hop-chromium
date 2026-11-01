# Hop Sidebar privacy policy

Hop Sidebar has no server. It collects nothing, sends nothing to its author or anyone else, and has no analytics or
tracking. Everything it reads stays in your browser.

## What it reads, and why

- **Bookmarks and tabs**, to show them in the sidebar and to open, move, bind and close them when you ask.
- **Gmail:** to show the preview when you hover a pinned Gmail tile, it fetches Gmail's unread feed
  (`mail.google.com/mail/u/N/feed/atom`) directly from Google, signed in with your existing browser login.
- **Google Calendar:** to show the calendar preview, it fetches the secret iCal address you enter in Options, directly
  from that address. If the address isn't on `calendar.google.com`, the browser asks you for access to that one site
  first.
- **Google Chat:** to show the Chat preview, it reads the conversation list from the Chat tab you have open, in your
  browser.

The previews are kept in memory for a few minutes so they appear instantly, and are gone when the sidebar closes.

## What it stores

All of it stays in your browser's extension storage:

- your settings (background colour, how to handle duplicate tabs), synced with your other devices by the browser's
  own sync if you've turned that on;
- the secret iCal address, on this device only;
- which tab belongs to which bookmark, and those tabs' addresses, so they can be matched again after a restart.

Removing the extension deletes all of it.

## Contact

Questions or problems: [github.com/instilled/hop-chromium/issues](https://github.com/instilled/hop-chromium/issues).
