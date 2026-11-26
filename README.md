## Hi there 👋

<!--
**ML-Jebbeli/ml-jebbeli** is a ✨ _special_ ✨ repository because its `README.md` (this file) appears on your GitHub profile.

Here are some ideas to get you started:

- 🔭 I’m currently working on ...
- 🌱 I’m currently learning ...
- 👯 I’m looking to collaborate on ...
- 🤔 I’m looking for help with ...
- 💬 Ask me about ...
- 📫 How to reach me: ...
- 😄 Pronouns: ...
- ⚡ Fun fact: ...
-->

## Assistant workspace

Open the site's «دستیار هوشمند» link or visit `assistant.html` directly. The floating widget and standalone workspace share conversations, drafts, and answers through versioned local storage on the same origin. The standalone history list includes a delete action for each conversation. Selection is kept per tab. Browser storage does not sync across devices, browsers, profiles, or the GitHub Pages and Cloudflare preview origins. Clearing that origin's site data clears its conversation history.

History keeps up to 30 conversations and the latest 60 exchanges per conversation. At the conversation limit, delete a conversation to make room. If browser storage is unavailable or full, the interface shows a warning and keeps new changes in the current page's memory. The Worker receives the current question and up to six messages from completed exchanges in the selected conversation. The request body limit is 32 KiB. The site does not send an unsubmitted draft.

Run the frontend and content checks with `npm ci`, `npx playwright install chromium`, `npm test`, and `npm run test:content`. The browser tests simulate Worker responses. Sending live requests is enabled only on the two approved hostnames.

The homepage banner, header and mobile menu use the production assistant URL in a separate tab. For the embedded compatibility interface, open `/?legacy-chat=1` on either approved host. This opt-in URL keeps the Classic and Focused layouts available for regression testing and loads their JavaScript only when requested.

Conversation data remains in the existing version 1 localStorage format. An empty IndexedDB object store coordinates writes across tabs, including browsers without Web Locks. If IndexedDB is unavailable, writable chat state is kept in the current page. If a write hits the browser quota, the page retains the unsaved changes and tries to save again on a later change when the stored snapshot is still current. If another tab has written in the meantime, the page keeps its own changes in memory and honors deletions. Clearing site data removes the persisted history.

The frontend uses a two-million UTF-16 code-unit serialization budget and pauses new sends at that limit. Existing history stays readable and deleting conversations can free space. New Worker responses are limited to 256 KiB of decoded JSON and 32,768 UTF-16 code units per answer. Older oversized answers display a bounded text preview and retain their original copy action. After a tab closes or refreshes during a send, its pending claim expires within the request's 60-second window. A retry is always explicit.

Private browsing may clear history when its last private window closes or restrict browser storage. If the app reports page-only storage, keep the page open while you need those unsaved changes.
