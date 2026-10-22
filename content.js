/*
 * Bridge between the extension and the page.
 * Runs in the extension's isolated world: it can use extension storage,
 * but it cannot touch YouTube's player API. page.js does the player work,
 * and the two talk through window.postMessage.
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const DEFAULT_PREF = 'highest';
  const VALID = new Set([
    'auto', 'highest', 'tiny', 'small', 'medium', 'large',
    'hd720', 'hd1080', 'hd1440', 'hd2160'
  ]);
  const FROM_PAGE = 'yqx-page';
  const FROM_EXT = 'yqx-ext';

  const sendToPage = (value) =>
    window.postMessage({ source: FROM_EXT, type: 'pref', value }, '*');

  async function readPreference() {
    try {
      const stored = await api.storage.sync.get(KEY);
      return VALID.has(stored[KEY]) ? stored[KEY] : DEFAULT_PREF;
    } catch {
      return DEFAULT_PREF; // e.g. extension was reloaded while the tab stayed open
    }
  }

  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== FROM_PAGE) return;

    if (msg.type === 'hello') {
      sendToPage(await readPreference());
    } else if (msg.type === 'set' && VALID.has(msg.value)) {
      try {
        await api.storage.sync.set({ [KEY]: msg.value });
      } catch { /* storage unavailable; the page still applies the choice */ }
    }
  });

  // Changes made in the popup (or in another tab) reach this tab's player too.
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[KEY] && VALID.has(changes[KEY].newValue)) {
        sendToPage(changes[KEY].newValue);
      }
    });
  } catch { /* ignore */ }

  readPreference().then(sendToPage);
})();
