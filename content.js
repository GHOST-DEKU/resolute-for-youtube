/*
 * Bridge between the extension and the page.
 * Runs in the extension's isolated world: it can use extension storage,
 * but it cannot touch YouTube's player API. page.js does the player work,
 * and the two talk through window.postMessage.
 *
 * Stored:
 *  - sync  "qualityPreference": the default for all videos
 *  - local "videoOverrides":    { videoId: quality } for videos the user chose to remember
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const OVERRIDES = 'videoOverrides';
  const MAX_REMEMBERED = 1000; // shortcut: drops the oldest beyond this; raise if users hit it
  const DEFAULT_PREF = 'highest';
  const VALID = new Set([
    'auto', 'highest', 'tiny', 'small', 'medium', 'large',
    'hd720', 'hd1080', 'hd1440', 'hd2160'
  ]);
  const VIDEO_ID = /^[\w-]{6,20}$/;
  const FROM_PAGE = 'yqx-page';
  const FROM_EXT = 'yqx-ext';

  const send = (msg) => window.postMessage({ source: FROM_EXT, ...msg }, '*');

  async function readPreference() {
    try {
      const stored = await api.storage.sync.get(KEY);
      return VALID.has(stored[KEY]) ? stored[KEY] : DEFAULT_PREF;
    } catch {
      return DEFAULT_PREF; // e.g. extension was reloaded while the tab stayed open
    }
  }
  async function readOverrides() {
    try {
      const stored = await api.storage.local.get(OVERRIDES);
      const map = stored[OVERRIDES];
      return map && typeof map === 'object' ? map : {};
    } catch {
      return {};
    }
  }
  async function sendAll() {
    send({ type: 'pref', value: await readPreference() });
    send({ type: 'overrides', value: await readOverrides() });
  }

  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== FROM_PAGE) return;

    try {
      if (msg.type === 'hello') {
        await sendAll();
      } else if (msg.type === 'set' && VALID.has(msg.value)) {
        await api.storage.sync.set({ [KEY]: msg.value });
      } else if (msg.type === 'remember' && VIDEO_ID.test(msg.videoId)) {
        const map = await readOverrides();
        delete map[msg.videoId]; // re-adding moves it to the newest position
        if (VALID.has(msg.value)) map[msg.videoId] = msg.value;
        const ids = Object.keys(map);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_REMEMBERED))) delete map[id];
        await api.storage.local.set({ [OVERRIDES]: map });
      }
    } catch { /* storage unavailable; the page still applies the choice */ }
  });

  // Changes made in the popup or another tab reach this tab's player too.
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[KEY] && VALID.has(changes[KEY].newValue)) {
        send({ type: 'pref', value: changes[KEY].newValue });
      }
      if (area === 'local' && changes[OVERRIDES]) {
        send({ type: 'overrides', value: changes[OVERRIDES].newValue || {} });
      }
    });
  } catch { /* ignore */ }

  sendAll();
})();
