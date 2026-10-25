(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const THEME = 'uiTheme';
  const OVERRIDES = 'videoOverrides';
  const CHANNELS = 'channelPrefs';
  const HOLD = { opened: 'holdOpened', next: 'holdNext' };
  const OLD_AUTOPLAY = 'stopAutoplay'; // older single switch: counts as both until either is set
  const DEFAULT_PREF = 'highest';
  const CHANNEL_ID = /^UC[\w-]{22}$/;
  // Same order as the in-player menu: two modes, then resolutions.
  const OPTIONS = [
    ['auto', 'Auto'],
    ['highest', 'Highest available'],
    ['tiny', '144p'],
    ['small', '240p'],
    ['medium', '360p'],
    ['large', '480p'],
    ['hd720', '720p'],
    ['hd1080', '1080p'],
    ['hd1440', '1440p'],
    ['hd2160', '2160p (4K)']
  ];
  const SHORT = { highest: 'Highest', hd2160: '4K' };
  const VALID = new Set(OPTIONS.map(([id]) => id));
  const labelOf = (q) => (OPTIONS.find(([id]) => id === q) || OPTIONS[1])[1];
  const $ = (id) => document.getElementById(id);

  const svg = (d, size = 18) => {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.style.width = s.style.height = `${size}px`;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };
  const CHECK = 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z';
  const CLOSE = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

  // ---------- snackbar feedback ----------
  const status = $('status');
  let statusTimer = 0;
  function flash(text) {
    status.textContent = text;
    status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('show'), 2400);
  }

  // ---------- confirm dialog (for destructive "remove all" actions) ----------
  const dialog = $('confirm');
  function confirmAction(title, text, okLabel) {
    return new Promise((resolve) => {
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      $('confirm-ok').textContent = okLabel;
      dialog.returnValue = '';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
      dialog.showModal();
      dialog.querySelector('[value=cancel]').focus(); // safe choice focused first
    });
  }

  // ---------- theme: system / light / dark ----------
  const themeGroup = $('theme');
  function applyTheme(t) {
    const theme = ['light', 'dark'].includes(t) ? t : 'system';
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    for (const b of themeGroup.querySelectorAll('button')) {
      const on = b.dataset.theme === theme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1; // one tab stop; arrows move inside (radio group pattern)
    }
  }
  themeGroup.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    applyTheme(b.dataset.theme);
    api.storage.sync.set({ [THEME]: b.dataset.theme }).catch(() => {});
  });
  themeGroup.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const buttons = [...themeGroup.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next.focus();
    next.click();
    e.preventDefault();
  });
  applyTheme('system');
  api.storage.sync.get(THEME).then((r) => applyTheme(r[THEME])).catch(() => {});

  // ---------- global default: segmented (modes) + chips (resolutions) ----------
  const box = $('options');
  for (const [id, label] of OPTIONS) {
    const choice = document.createElement('label');
    choice.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'quality';
    input.value = id;
    input.setAttribute('aria-label', label);
    const face = document.createElement('span');
    face.className = 'face';
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.append(svg(CHECK));
    face.append(tick, document.createTextNode(SHORT[id] || label));
    choice.append(input, face);
    (id === 'auto' || id === 'highest' ? $('modes') : $('resolutions')).append(choice);
  }
  function select(value) {
    const input = box.querySelector(`input[value="${VALID.has(value) ? value : DEFAULT_PREF}"]`);
    input.checked = true;
  }
  api.storage.sync.get(KEY).then((r) => select(r[KEY])).catch(() => select(DEFAULT_PREF));
  box.addEventListener('change', async (e) => {
    if (e.target.name !== 'quality') return;
    try {
      await api.storage.sync.set({ [KEY]: e.target.value });
      flash(`Global default: ${labelOf(e.target.value)}`);
    } catch {
      flash('Could not save. Please try again.');
    }
  });

  // ---------- start paused: two independent switches ----------
  const holdSwitch = { opened: $('ap-opened'), next: $('ap-next') };
  const showHold = (r) => {
    const old = r[OLD_AUTOPLAY] === true;
    for (const k of ['opened', 'next']) holdSwitch[k].checked = typeof r[HOLD[k]] === 'boolean' ? r[HOLD[k]] : old;
  };
  const readHold = () => api.storage.sync.get([HOLD.opened, HOLD.next, OLD_AUTOPLAY]).then(showHold).catch(() => {});
  readHold();
  for (const k of ['opened', 'next']) {
    holdSwitch[k].addEventListener('change', async () => {
      const on = holdSwitch[k].checked;
      try {
        // Save both, so an old single switch never decides the other one later.
        await api.storage.sync.set({ [HOLD.opened]: holdSwitch.opened.checked, [HOLD.next]: holdSwitch.next.checked });
        flash(k === 'opened'
          ? (on ? 'Videos you open will start paused' : 'Videos you open will play')
          : (on ? 'Next videos will start paused' : 'Next videos will play by themselves'));
      } catch {
        holdSwitch[k].checked = !on; // show the setting that is really saved
        flash('Could not save. Please try again.');
      }
    });
  }

  // ---------- hide live chat ----------
  const HIDE_CHAT = 'hideChat';
  const hcOn = $('hc-on');
  const showHideChat = (v) => { hcOn.checked = v === true; };
  api.storage.sync.get(HIDE_CHAT).then((r) => showHideChat(r[HIDE_CHAT])).catch(() => {});
  hcOn.addEventListener('change', async () => {
    const on = hcOn.checked;
    try {
      await api.storage.sync.set({ [HIDE_CHAT]: on });
      flash(on ? 'Live chat will be hidden' : 'Live chat will show');
    } catch {
      hcOn.checked = !on; // show the setting that is really saved
      flash('Could not save. Please try again.');
    }
  });

  // ---------- background saver: setting + this week's estimate (Sunday to Saturday) ----------
  const SAVER = 'bgSaver';
  const STATS = 'saverStats';
  const svOn = $('sv-on');
  const svOpts = $('sv-opts');
  const svSupported = 'pictureInPictureElement' in document; // same browser as the YouTube tab
  const cleanSaver = (v) => ({
    on: !!(v && v.on === true),
    after: v && [15, 30, 60].includes(v.after) ? v.after : 30,
    to: v && v.to === 'large' ? 'large' : 'tiny'
  });
  let saverSetting = cleanSaver(null);
  function showSaver(v) {
    saverSetting = cleanSaver(v);
    svOn.checked = svSupported && saverSetting.on;
    svOpts.classList.toggle('off', !svOn.checked);
    const a = document.querySelector(`input[name="sv-after"][value="${saverSetting.after}"]`);
    const t = document.querySelector(`input[name="sv-to"][value="${saverSetting.to}"]`);
    if (a) a.checked = true;
    if (t) t.checked = true;
  }
  if (!svSupported) {
    svOn.disabled = true;
    $('sv-unsupported').hidden = false;
  }
  async function saveSaver(message) {
    const next = {
      on: svOn.checked,
      after: Number((document.querySelector('input[name="sv-after"]:checked') || {}).value) || 30,
      to: (document.querySelector('input[name="sv-to"]:checked') || {}).value === 'large' ? 'large' : 'tiny'
    };
    try {
      await api.storage.sync.set({ [SAVER]: next });
      saverSetting = next;
      svOpts.classList.toggle('off', !next.on);
      flash(message(next));
    } catch {
      showSaver(saverSetting); // show what is really saved
      flash('Could not save. Please try again.');
    }
  }
  svOn.addEventListener('change', () => saveSaver((n) => (n.on ? 'Background saver on' : 'Background saver off')));
  for (const r of document.querySelectorAll('input[name="sv-after"]')) {
    r.addEventListener('change', () => saveSaver((n) => `Saver starts after ${n.after === 60 ? '1 minute' : `${n.after} seconds`}`));
  }
  for (const r of document.querySelectorAll('input[name="sv-to"]')) {
    r.addEventListener('change', () => saveSaver((n) => `Saver drops to ${n.to === 'large' ? '480p' : 'the lowest quality'}`));
  }
  api.storage.sync.get(SAVER).then((r) => showSaver(r[SAVER])).catch(() => showSaver(null));

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function showStats(map) {
    const stats = map && typeof map === 'object' ? map : {};
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay()); // weeks run Sunday to Saturday
    const todayKey = dayKey(new Date());
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      return { mb: typeof stats[k] === 'number' && stats[k] > 0 ? stats[k] : 0, today: k === todayKey };
    });
    const total = week.reduce((a, b) => a + b.mb, 0);
    const big = total >= 1000;
    const text = big ? (total / 1000).toFixed(1) : String(Math.round(total));
    // Rolling odometer: each digit is a column of 0-9 that slides to its value.
    const digits = $('sv-digits');
    digits.replaceChildren(...[...text].map((c) => {
      if (!/\d/.test(c)) { const sep = document.createElement('span'); sep.className = 'sv-sep'; sep.textContent = c; return sep; }
      const col = document.createElement('span');
      col.className = 'sv-dg';
      col.dataset.v = c;
      for (let i = 0; i < 10; i++) { const n = document.createElement('span'); n.textContent = i; col.append(n); }
      return col;
    }));
    $('sv-unit').textContent = `${big ? 'GB' : 'MB'} saved this week · estimate`;
    $('sv-odo').setAttribute('aria-label', `About ${text} ${big ? 'GB' : 'MB'} saved this week (estimate)`);
    const bars = $('sv-week');
    bars.replaceChildren(...week.map((d) => { const b = document.createElement('i'); if (d.today) b.className = 'today'; return b; }));
    const max = Math.max(...week.map((d) => d.mb), 1);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const col of digits.querySelectorAll('.sv-dg')) col.style.transform = `translateY(-${Number(col.dataset.v) * 30}px)`;
      [...bars.children].forEach((b, i) => { b.style.height = `${Math.max(3, Math.round((week[i].mb / max) * 44))}px`; });
    }));
  }
  api.storage.local.get(STATS).then((r) => showStats(r[STATS])).catch(() => showStats({}));

  // "Last time": proof of what the saver actually did, since quality is already back when you return.
  const QLABEL = { tiny: '144p', small: '240p', medium: '360p', large: '480p', hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '4K', highres: '8K' };
  const LAST = 'saverLast';
  const NB = '\u00A0'; // keeps a number and its unit on one line
  const span = (s) => (s < 60 ? `${s}${NB}s` : s < 3600 ? `${Math.floor(s / 60)}${NB}min${s % 60 ? ` ${s % 60}${NB}s` : ''}` : `${Math.floor(s / 3600)}${NB}h ${Math.round((s % 3600) / 60)}${NB}min`);
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}${NB}min ago` : m < 1440 ? `${Math.round(m / 60)}${NB}h ago` : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  const WHY = {
    'back-early': () => `you came back before ${saverSetting.after === 60 ? '1\u00A0min' : `${saverSetting.after}\u00A0s`}`,
    paused: () => 'the video was paused (a paused video uses no data)',
    muted: () => 'the video was muted, so your browser paused it in the background (no data used)',
    pip: () => 'the video was in picture-in-picture',
    'already-low': () => `it was already at ${saverSetting.to === 'large' ? '480p' : 'the lowest quality'} or lower`,
    'no-video': () => 'no video was playing in that tab',
    'no-quality': () => 'YouTube didn\u2019t report the video\u2019s quality'
  };
  function showLast(v) {
    const el = $('sv-last');
    if (v && WHY[v.skipped]) {
      el.replaceChildren('Last time (' + ago(v.at) + '): ');
      const b = document.createElement('b');
      b.textContent = 'didn\u2019t lower it';
      el.append(b, ', because ' + WHY[v.skipped]() + '.');
      return;
    }
    if (!v || !QLABEL[v.from] || !QLABEL[v.to] || !(v.secs > 0)) { el.textContent = 'Hasn\u2019t lowered a video yet.'; return; }
    el.replaceChildren('Last time: ');
    const b = document.createElement('b');
    b.textContent = `${QLABEL[v.from]} \u2192 ${QLABEL[v.to]}`;
    el.append(b, ` for ${span(v.secs)}${v.mb >= 1 ? ` \u00B7 about ${Math.round(v.mb)}${NB}MB` : ''} \u00B7 ${ago(v.at)}`);
  }
  api.storage.local.get(LAST).then((r) => showLast(r[LAST])).catch(() => showLast(null));

  // ---------- remembered videos ----------
  const count = $('memory-count');
  const forgetAll = $('forget-all');
  function showMemory(map) {
    const n = Object.keys(map && typeof map === 'object' ? map : {}).length;
    count.textContent = n === 0 ? 'No videos remembered' : n === 1 ? '1 video remembered' : `${n} videos remembered`;
    forgetAll.hidden = n === 0;
  }
  api.storage.local.get(OVERRIDES).then((r) => showMemory(r[OVERRIDES])).catch(() => showMemory({}));
  forgetAll.addEventListener('click', async () => {
    const ok = await confirmAction('Forget all remembered videos?',
      'Each of those videos will use its channel default or your global default again.', 'Forget all');
    if (!ok) return forgetAll.focus();
    try {
      await api.storage.local.set({ [OVERRIDES]: {} });
      flash('Remembered videos cleared');
    } catch {
      flash('Could not clear. Please try again.');
    }
  });

  // ---------- channel defaults: view, change, remove (keyed by the stable channel id) ----------
  const list = $('channel-list');
  const empty = $('channels-empty');
  const clearAll = $('channels-clear');
  const channelCount = $('channel-count');
  let channels = {};
  let shownIds = '';
  const clean = (map) => Object.fromEntries(Object.entries(map && typeof map === 'object' ? map : {})
    .filter(([id, v]) => CHANNEL_ID.test(id) && v && VALID.has(v.q)));
  const saveChannels = () => api.storage.local.set({ [CHANNELS]: channels });

  function showChannels(map) {
    channels = clean(map);
    const ids = Object.keys(channels).sort((a, b) =>
      (channels[a].name || a).localeCompare(channels[b].name || b, undefined, { sensitivity: 'base' }));
    empty.hidden = ids.length > 0;
    clearAll.hidden = ids.length === 0;
    channelCount.textContent = ids.length ? `${ids.length} channel${ids.length === 1 ? '' : 's'} saved` : 'Beat the global default';
    if (ids.join() === shownIds) { // same channels: just update values (keeps keyboard focus)
      for (const id of ids) list.querySelector(`select[data-id="${id}"]`).value = channels[id].q;
      return;
    }
    shownIds = ids.join();
    list.replaceChildren(...ids.map((id) => {
      const name = channels[id].name || id;
      const li = document.createElement('li');
      li.className = 'channel';
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = (channels[id].name || '?').trim().charAt(0).toUpperCase() || '?';
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/channel/${id}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = name;
      link.title = `${name} (${id})`;
      const pick = document.createElement('select');
      pick.dataset.id = id;
      pick.setAttribute('aria-label', `Default quality for ${name}`);
      for (const [q, label] of OPTIONS) pick.append(new Option(SHORT[q] || label, q, false, q === channels[id].q));
      pick.addEventListener('change', () => {
        channels[id] = { ...channels[id], q: pick.value };
        saveChannels().then(() => flash(`${name}: ${labelOf(pick.value)}`))
          .catch(() => flash('Could not save. Please try again.'));
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn remove';
      remove.append(svg(CLOSE));
      remove.setAttribute('aria-label', `Remove default for ${name}`);
      remove.title = 'Remove';
      remove.addEventListener('click', () => {
        const next = li.nextElementSibling || li.previousElementSibling;
        delete channels[id];
        saveChannels().then(() => {
          flash(`Removed ${name}`);
          ((next && next.querySelector('select')) || box.querySelector('input:checked')).focus(); // keep keyboard users in place
        }).catch(() => flash('Could not remove. Please try again.'));
      });
      li.append(avatar, link, pick, remove);
      return li;
    }));
  }
  api.storage.local.get(CHANNELS).then((r) => showChannels(r[CHANNELS])).catch(() => showChannels({}));
  clearAll.addEventListener('click', async () => {
    const n = Object.keys(channels).length;
    const ok = await confirmAction(`Remove all ${n} channel default${n === 1 ? '' : 's'}?`,
      'Videos from these channels will use your global default again.', 'Remove all');
    if (!ok) return clearAll.focus();
    channels = {};
    saveChannels().then(() => flash('All channel defaults removed'))
      .catch(() => flash('Could not remove. Please try again.'));
  });

  // ---------- YouTube access (users can switch it off; Firefox treats it as optional) ----------
  const YOUTUBE = { origins: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] };
  const access = $('access');
  const checkAccess = () => api.permissions.contains(YOUTUBE)
    .then((ok) => { access.hidden = ok; })
    .catch(() => { access.hidden = true; }); // can't tell: don't show a false alarm
  $('grant').addEventListener('click', () => {
    api.permissions.request(YOUTUBE).then(checkAccess).catch(checkAccess); // must run in this click
  });
  checkAccess();

  // ---------- stay in sync with changes made in the player or another window ----------
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) select(changes[KEY].newValue);
    if (area === 'sync' && (changes[HOLD.opened] || changes[HOLD.next] || changes[OLD_AUTOPLAY])) readHold();
    if (area === 'sync' && changes[SAVER]) showSaver(changes[SAVER].newValue);
    if (area === 'sync' && changes[HIDE_CHAT]) showHideChat(changes[HIDE_CHAT].newValue);
    if (area === 'local' && changes[STATS]) showStats(changes[STATS].newValue);
    if (area === 'local' && changes[LAST]) showLast(changes[LAST].newValue);
    if (area === 'sync' && changes[THEME]) applyTheme(changes[THEME].newValue);
    if (area === 'local' && changes[OVERRIDES]) showMemory(changes[OVERRIDES].newValue);
    if (area === 'local' && changes[CHANNELS]) showChannels(changes[CHANNELS].newValue);
  });
})();
