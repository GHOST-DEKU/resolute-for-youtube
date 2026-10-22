/*
 * Bridge between the extension and the page.
 * Runs in the extension's isolated world: it can use extension storage,
 * but it cannot touch YouTube's player API. page.js does the player work,
 * and the two talk through window.postMessage.
 *
 * Stored:
 *  - sync  "qualityPreference": the default for all videos
 *  - sync  "stopAutoplay":      true = videos open paused (off unless the user turns it on)
 *  - local "videoOverrides":    { videoId: quality } for videos the user chose to remember
 *  - local "channelPrefs":      { UCchannelId: { q: quality, name } } channel defaults
 *    (name is only for showing the list; the id is the key, so renames don't matter)
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const AUTOPLAY = 'stopAutoplay';
  const OVERRIDES = 'videoOverrides';
  const CHANNELS = 'channelPrefs';
  const MAX_CHANNELS = 2000; // shortcut: drops the oldest beyond this; raise if users hit it
  const CHANNEL_ID = /^UC[\w-]{22}$/;
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
  async function readAutoplay() {
    try {
      return (await api.storage.sync.get(AUTOPLAY))[AUTOPLAY] === true;
    } catch {
      return false;
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
  /** Only well-formed entries survive; corrupted data is dropped, never applied. */
  function cleanChannels(map) {
    const out = {};
    if (map && typeof map === 'object') {
      for (const [id, v] of Object.entries(map)) {
        if (CHANNEL_ID.test(id) && v && VALID.has(v.q)) {
          out[id] = { q: v.q, name: typeof v.name === 'string' ? v.name.slice(0, 100) : '' };
        }
      }
    }
    return out;
  }
  async function readChannels() {
    try {
      return cleanChannels((await api.storage.local.get(CHANNELS))[CHANNELS]);
    } catch {
      return {};
    }
  }
  async function sendAll() {
    send({ type: 'pref', value: await readPreference() });
    send({ type: 'overrides', value: await readOverrides() });
    send({ type: 'channels', value: await readChannels() });
    send({ type: 'autoplay', value: await readAutoplay() });
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
      } else if (msg.type === 'channel' && CHANNEL_ID.test(msg.channelId)) {
        const map = await readChannels();
        delete map[msg.channelId]; // re-adding moves it to the newest position
        if (VALID.has(msg.value)) {
          const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 100) : '';
          map[msg.channelId] = { q: msg.value, name };
        }
        const ids = Object.keys(map);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CHANNELS))) delete map[id];
        await api.storage.local.set({ [CHANNELS]: map });
      }
    } catch { /* storage unavailable; the page still applies the choice */ }
  });

  // Changes made in the popup or another tab reach this tab's player too.
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[KEY] && VALID.has(changes[KEY].newValue)) {
        send({ type: 'pref', value: changes[KEY].newValue });
      }
      if (area === 'sync' && changes[AUTOPLAY]) {
        send({ type: 'autoplay', value: changes[AUTOPLAY].newValue === true });
      }
      if (area === 'local' && changes[OVERRIDES]) {
        send({ type: 'overrides', value: changes[OVERRIDES].newValue || {} });
      }
      if (area === 'local' && changes[CHANNELS]) {
        send({ type: 'channels', value: cleanChannels(changes[CHANNELS].newValue) });
      }
    });
  } catch { /* ignore */ }

  sendAll();
})();
