(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const THEME = 'uiTheme';
  const OVERRIDES = 'videoOverrides';
  const CHANNELS = 'channelPrefs';
  const AUTOPLAY = 'stopAutoplay';
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

  // ---------- open videos paused ----------
  const autoplay = $('autoplay');
  api.storage.sync.get(AUTOPLAY).then((r) => { autoplay.checked = r[AUTOPLAY] === true; }).catch(() => {});
  autoplay.addEventListener('change', async () => {
    const on = autoplay.checked;
    try {
      await api.storage.sync.set({ [AUTOPLAY]: on });
      flash(on ? 'Videos will open paused' : 'Autoplay is back on');
    } catch {
      autoplay.checked = !on; // show the setting that is really saved
      flash('Could not save. Please try again.');
    }
  });

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
    if (area === 'sync' && changes[AUTOPLAY]) autoplay.checked = changes[AUTOPLAY].newValue === true;
    if (area === 'sync' && changes[THEME]) applyTheme(changes[THEME].newValue);
    if (area === 'local' && changes[OVERRIDES]) showMemory(changes[OVERRIDES].newValue);
    if (area === 'local' && changes[CHANNELS]) showChannels(changes[CHANNELS].newValue);
  });
})();
