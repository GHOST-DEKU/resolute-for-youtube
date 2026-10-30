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
 *  - sync  "hideChat":          true = close YouTube's live chat panel when a stream opens (off unless turned on)
 *  - sync  "cinemaMode":      true = videos open in theater, the top bar hides while they play, the video fills the window (off unless turned on)
 *  - local "cinemaSkip":      { UCchannelId: name } channels where you left theater; cinema mode leaves them alone
 *  - sync  "tabIcons":          false = the tab countdown shows just the time; otherwise ⏱ comes first (on unless turned off)
 *  - sync  "hideTopBar":       true = YouTube's top bar hides while a video plays (off unless turned on)
 *  - sync  "bgSaver":           { on, after: 15|30|60 seconds, to: "tiny"|"large" } background saver
 *  - local "saverStats":        { "YYYY-MM-DD": estimated MB saved } for the last 21 days
 *  - local "saverLast":         { at, from, to, secs, mb } the most recent run, or { at, skipped: reason }
 *  - local "resumeSpots":       { videoId: { t: seconds, at: time saved } } where you stopped watching
 *  - sync  "resumeRewind":      "off" | "5" | "smart" how far back a video starts when it resumes (smart unless changed)
 *  - sync  "resumeRules":       { includeLive, skipStart, endFinished, skipShort } what counts as progress (all on unless turned off)
 *  - sync  "resumeBar":         { flag, back, ghost, button } what shows on the progress bar (all on unless turned off)
 *  - local "resumeOff":         { videoId: true } videos you chose not to save
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
  const HIDE_CHAT = 'hideChat';
  const HIDE_BAR = 'hideTopBar';
  const TAB_ICONS = 'tabIcons';
  const CINEMA = 'cinemaMode';
  const SKIP = 'cinemaSkip';
  const MAX_SKIP = 2000; // shortcut: drops the oldest beyond this; raise if users hit it
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
  const SPOTS = 'resumeSpots';
  const REWIND = 'resumeRewind';
  const RULES = 'resumeRules';
  const BAR = 'resumeBar';        // sync: which extras show on the player's progress bar
  const OFF = 'resumeOff';        // local: videos you told Resolute not to save { videoId: true }
  const MAX_SPOTS = 1000; // shortcut: drops the oldest beyond this; raise if users hit it
  const RULE_KEYS = ['includeLive', 'skipStart', 'endFinished', 'skipShort'];
  const cleanRewind = (v) => (v === 'off' || v === '5' ? v : 'smart');
  const BAR_KEYS = ['flag', 'back', 'ghost', 'button'];
  const cleanBar = (v) => Object.fromEntries(BAR_KEYS.map((k) => [k, !(v && v[k] === false)]));
  const cleanOff = (map) => Object.fromEntries(Object.keys(map && typeof map === 'object' ? map : {}).filter((id) => VIDEO_ID.test(id)).map((id) => [id, true]));
  const cleanRules = (v) => Object.fromEntries(RULE_KEYS.map((k) => [k, !(v && v[k] === false)]));
  /** Only well-formed spots survive; corrupted data is dropped, never applied. */
  function cleanSpots(map) {
    const out = {};
    if (map && typeof map === 'object') {
      for (const [id, v] of Object.entries(map)) {
        if (VIDEO_ID.test(id) && v && Number.isFinite(v.t) && v.t >= 0 && v.t <= 86400 * 2 && Number.isFinite(v.at)) out[id] = { t: Math.floor(v.t), at: v.at };
      }
    }
    return out;
  }
  async function readSpots() {
    try {
      return cleanSpots((await api.storage.local.get(SPOTS))[SPOTS]);
    } catch {
      return {};
    }
  }
  async function readRewind() {
    try {
      return cleanRewind((await api.storage.sync.get(REWIND))[REWIND]);
    } catch {
      return 'smart';
    }
  }
  async function readBar() {
    try {
      return cleanBar((await api.storage.sync.get(BAR))[BAR]);
    } catch {
      return cleanBar(null);
    }
  }
  async function readOff() {
    try {
      return cleanOff((await api.storage.local.get(OFF))[OFF]);
    } catch {
      return {};
    }
  }
  async function readRules() {
    try {
      return cleanRules((await api.storage.sync.get(RULES))[RULES]);
    } catch {
      return cleanRules(null);
    }
  }
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
    send({ type: 'chat', value: await readHideChat() });
    send({ type: 'topbar', value: await readHideBar() });
    send({ type: 'tabicons', value: await readTabIcons() });
    send({ type: 'cinemaSkip', value: await readSkip() }); // before 'cinema', so a skipped channel is known when cinema starts
    send({ type: 'cinema', value: await readCinema() });
    send({ type: 'spots', value: await readSpots() });
    send({ type: 'resumeRewind', value: await readRewind() });
    send({ type: 'resumeRules', value: await readRules() });
    send({ type: 'resumeBar', value: await readBar() });
    send({ type: 'spotsOff', value: await readOff() });
    // Is this the selected tab of its window? (Vivaldi never marks background tabs "hidden", so ask the browser.)
    try {
      const active = await api.runtime.sendMessage({ type: 'amActive' });
      if (typeof active === 'boolean') send({ type: 'tabActive', value: active });
    } catch { /* no background script: the page relies on "hidden" alone */ }
  }
  async function readHideChat() {
    try {
      return (await api.storage.sync.get(HIDE_CHAT))[HIDE_CHAT] === true;
    } catch {
      return false;
    }
  }
  async function readCinema() {
    try {
      return (await api.storage.sync.get(CINEMA))[CINEMA] === true;
    } catch {
      return false;
    }
  }
  const cleanSkip = (map) => {
    const out = {};
    if (map && typeof map === 'object') {
      for (const [id, name] of Object.entries(map)) if (CHANNEL_ID.test(id)) out[id] = typeof name === 'string' ? name.slice(0, 100) : '';
    }
    return out;
  };
  async function readSkip() {
    try {
      return cleanSkip((await api.storage.local.get(SKIP))[SKIP]);
    } catch {
      return {};
    }
  }
  async function readTabIcons() {
    try {
      return (await api.storage.sync.get(TAB_ICONS))[TAB_ICONS] !== false;
    } catch {
      return true;
    }
  }
  async function readHideBar() {
    try {
      return (await api.storage.sync.get(HIDE_BAR))[HIDE_BAR] === true;
    } catch {
      return false;
    }
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
      } else if (msg.type === 'spot' && VIDEO_ID.test(msg.videoId) && Number.isFinite(msg.t) && msg.t >= 0 && msg.t <= 86400 * 2) {
        const map = await readSpots();
        delete map[msg.videoId]; // re-adding moves it to the newest position
        map[msg.videoId] = { t: Math.floor(msg.t), at: Date.now() };
        const ids = Object.keys(map);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SPOTS))) delete map[id];
        await api.storage.local.set({ [SPOTS]: map });
      } else if (msg.type === 'spotClear' && VIDEO_ID.test(msg.videoId)) {
        const map = await readSpots();
        if (msg.videoId in map) {
          delete map[msg.videoId];
          await api.storage.local.set({ [SPOTS]: map });
        }
      } else if (msg.type === 'spotOff' && VIDEO_ID.test(msg.videoId) && typeof msg.off === 'boolean') {
        const map = await readOff();
        delete map[msg.videoId]; // re-adding moves it to the newest position
        if (msg.off) map[msg.videoId] = true;
        const ids = Object.keys(map);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SPOTS))) delete map[id];
        await api.storage.local.set({ [OFF]: map });
      } else if (msg.type === 'cinemaSkip' && CHANNEL_ID.test(msg.channelId) && typeof msg.on === 'boolean') {
        const map = await readSkip();
        delete map[msg.channelId]; // re-adding moves it to the newest position
        if (msg.on) map[msg.channelId] = typeof msg.name === 'string' ? msg.name.trim().slice(0, 100) : '';
        const ids = Object.keys(map);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SKIP))) delete map[id];
        await api.storage.local.set({ [SKIP]: map });
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
      if (area === 'sync' && changes[HIDE_CHAT]) {
        send({ type: 'chat', value: changes[HIDE_CHAT].newValue === true });
      }
      if (area === 'sync' && changes[CINEMA]) {
        send({ type: 'cinema', value: changes[CINEMA].newValue === true });
      }
      if (area === 'local' && changes[SKIP]) {
        send({ type: 'cinemaSkip', value: cleanSkip(changes[SKIP].newValue) });
      }
      if (area === 'sync' && changes[TAB_ICONS]) {
        send({ type: 'tabicons', value: changes[TAB_ICONS].newValue !== false });
      }
      if (area === 'sync' && changes[HIDE_BAR]) {
        send({ type: 'topbar', value: changes[HIDE_BAR].newValue === true });
      }
      if (area === 'sync' && changes[SAVER]) {
        send({ type: 'saver', value: cleanSaver(changes[SAVER].newValue) });
      }
      if (area === 'local' && changes[SPOTS]) {
        send({ type: 'spots', value: cleanSpots(changes[SPOTS].newValue) });
      }
      if (area === 'sync' && changes[REWIND]) {
        send({ type: 'resumeRewind', value: cleanRewind(changes[REWIND].newValue) });
      }
      if (area === 'sync' && changes[BAR]) {
        send({ type: 'resumeBar', value: cleanBar(changes[BAR].newValue) });
      }
      if (area === 'local' && changes[OFF]) {
        send({ type: 'spotsOff', value: cleanOff(changes[OFF].newValue) });
      }
      if (area === 'sync' && changes[RULES]) {
        send({ type: 'resumeRules', value: cleanRules(changes[RULES].newValue) });
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
