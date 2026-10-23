/*
 * Bridge between the extension and the page.
 * Runs in the extension's isolated world: it can use extension storage,
 * but it cannot touch YouTube's player API. page.js does the player work,
 * and the two talk through window.postMessage.
 *
 * Stored:
 *  - sync  "qualityPreference": the default for all videos
 *  - sync  "holdOpened":        true = videos you open start paused (off unless turned on)
 *  - sync  "holdNext":          true = the next video in a queue/playlist starts paused (off unless turned on)
 *    (older versions stored one "stopAutoplay" switch; it counts as both until either is set)
 *  - sync  "bgSaver":           { on, after: 15|30|60 seconds, to: "tiny"|"large" } background saver
 *  - local "saverStats":        { "YYYY-MM-DD": estimated MB saved } for the last 21 days
 *  - local "saverLast":         { at, from, to, secs, mb } the most recent run, or { at, skipped: reason }
 *  - local "videoOverrides":    { videoId: quality } for videos the user chose to remember
 *  - local "channelPrefs":      { UCchannelId: { q: quality, name } } channel defaults
 *    (name is only for showing the list; the id is the key, so renames don't matter)
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const HOLD_OPENED = 'holdOpened';
  const HOLD_NEXT = 'holdNext';
  const OLD_AUTOPLAY = 'stopAutoplay';
  const SAVER = 'bgSaver';
  const STATS = 'saverStats';
  const LAST = 'saverLast';
  const QUALITY_ID = /^(tiny|small|medium|large|hd720|hd1080|hd1440|hd2160|highres)$/;
  const KEEP_DAYS = 21;
  const cleanSaver = (v) => ({
    on: !!(v && v.on === true),
    after: v && [15, 30, 60].includes(v.after) ? v.after : 30,
    to: v && v.to === 'large' ? 'large' : 'tiny'
  });
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const isPair = (v) => v && typeof v === 'object' && typeof v.opened === 'boolean' && typeof v.next === 'boolean';
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
      const r = await api.storage.sync.get([HOLD_OPENED, HOLD_NEXT, OLD_AUTOPLAY]);
      const old = r[OLD_AUTOPLAY] === true;
      return {
        opened: typeof r[HOLD_OPENED] === 'boolean' ? r[HOLD_OPENED] : old,
        next: typeof r[HOLD_NEXT] === 'boolean' ? r[HOLD_NEXT] : old
      };
    } catch {
      return { opened: false, next: false };
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
    send({ type: 'saver', value: await readSaver() });
    // Is this the selected tab of its window? (Vivaldi never marks background tabs "hidden", so ask the browser.)
    try {
      const active = await api.runtime.sendMessage({ type: 'amActive' });
      if (typeof active === 'boolean') send({ type: 'tabActive', value: active });
    } catch { /* no background script: the page relies on "hidden" alone */ }
  }
  async function readSaver() {
    try {
      return cleanSaver((await api.storage.sync.get(SAVER))[SAVER]);
    } catch {
      return cleanSaver(null);
    }
  }

  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== FROM_PAGE) return;

    try {
      if (msg.type === 'hello') {
        await sendAll();
      } else if (msg.type === 'autoplay' && isPair(msg.value)) {
        await api.storage.sync.set({ [HOLD_OPENED]: msg.value.opened, [HOLD_NEXT]: msg.value.next });
      } else if (msg.type === 'saverSkip' && ['back-early', 'paused', 'muted', 'pip', 'already-low', 'no-video', 'no-quality'].includes(msg.reason)) {
        await api.storage.local.set({ [LAST]: { at: Date.now(), skipped: msg.reason } });
      } else if (msg.type === 'saverOn' && typeof msg.label === 'string' && typeof msg.title === 'string') {
        await api.runtime.sendMessage({ type: 'saverOn', label: msg.label.slice(0, 20), title: msg.title.slice(0, 100) });
      } else if (msg.type === 'saverOff') {
        await api.runtime.sendMessage({ type: 'saverOff' });
      } else if (msg.type === 'saved' && typeof msg.mb === 'number' && msg.mb >= 0 && msg.mb <= 100000) {
        if (QUALITY_ID.test(msg.from) && QUALITY_ID.test(msg.to) && Number.isInteger(msg.secs) && msg.secs > 0 && msg.secs <= 86400 * 7) {
          await api.storage.local.set({ [LAST]: { at: Date.now(), from: msg.from, to: msg.to, secs: msg.secs, mb: msg.mb } });
        }
        if (msg.mb === 0) return;
        const stored = (await api.storage.local.get(STATS))[STATS];
        const stats = {};
        if (stored && typeof stored === 'object') {
          for (const [k, v] of Object.entries(stored)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && v >= 0) stats[k] = v;
        }
        const day = today();
        stats[day] = Math.round(((stats[day] || 0) + msg.mb) * 10) / 10;
        const days = Object.keys(stats).sort();
        for (const k of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete stats[k];
        await api.storage.local.set({ [STATS]: stats });
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
      if (area === 'sync' && (changes[HOLD_OPENED] || changes[HOLD_NEXT] || changes[OLD_AUTOPLAY])) {
        readAutoplay().then((value) => send({ type: 'autoplay', value }));
      }
      if (area === 'sync' && changes[SAVER]) {
        send({ type: 'saver', value: cleanSaver(changes[SAVER].newValue) });
      }
      if (area === 'local' && changes[OVERRIDES]) {
        send({ type: 'overrides', value: changes[OVERRIDES].newValue || {} });
      }
      if (area === 'local' && changes[CHANNELS]) {
        send({ type: 'channels', value: cleanChannels(changes[CHANNELS].newValue) });
      }
    });
  } catch { /* ignore */ }

  try {
    api.runtime.onMessage.addListener((msg, sender) => {
      if (sender.id === api.runtime.id && msg && msg.type === 'tabActive' && typeof msg.on === 'boolean') send({ type: 'tabActive', value: msg.on });
    });
  } catch { /* ignore */ }

  sendAll();
})();
