(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = 'qualityPreference';
  const DEFAULT_PREF = 'highest';
  // Same order as the in-player menu.
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

  const box = document.getElementById('options');
  const status = document.getElementById('status');
  let statusTimer = 0;

  for (const [id, label] of OPTIONS) {
    const row = document.createElement('label');
    row.className = id === 'auto' || id === 'highest' ? 'row wide' : 'row';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'quality';
    input.value = id;
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    box.append(row);
    if (id === 'highest') {
      const sep = document.createElement('div');
      sep.className = 'sep';
      box.append(sep);
    }
  }

  function select(value) {
    const input = box.querySelector(`input[value="${value}"]`) || box.querySelector(`input[value="${DEFAULT_PREF}"]`);
    input.checked = true;
  }

  api.storage.sync.get(KEY).then((r) => select(r[KEY] || DEFAULT_PREF)).catch(() => select(DEFAULT_PREF));

  box.addEventListener('change', async (e) => {
    if (e.target.name !== 'quality') return;
    try {
      await api.storage.sync.set({ [KEY]: e.target.value });
      status.textContent = 'Saved. Applied to open YouTube tabs.';
    } catch {
      status.textContent = 'Could not save. Please try again.';
    }
    status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('show'), 2200);
  });

  // Remembered videos: show how many, and let the user clear them (asks first).
  const OVERRIDES = 'videoOverrides';
  const count = document.getElementById('memory-count');
  const forgetAll = document.getElementById('forget-all');
  let confirmTimer = 0;
  function showMemory(map) {
    const n = Object.keys(map || {}).length;
    count.textContent = n === 0 ? 'No videos remembered' : n === 1 ? '1 video remembered' : `${n} videos remembered`;
    forgetAll.hidden = n === 0;
    forgetAll.textContent = 'Forget all';
    delete forgetAll.dataset.confirm;
  }
  api.storage.local.get(OVERRIDES).then((r) => showMemory(r[OVERRIDES])).catch(() => showMemory({}));
  forgetAll.addEventListener('click', async () => {
    if (!forgetAll.dataset.confirm) { // first click asks, second click clears
      forgetAll.dataset.confirm = '1';
      forgetAll.textContent = 'Click again to confirm';
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { forgetAll.textContent = 'Forget all'; delete forgetAll.dataset.confirm; }, 3000);
      return;
    }
    clearTimeout(confirmTimer);
    try {
      await api.storage.local.set({ [OVERRIDES]: {} });
    } catch {
      count.textContent = 'Could not clear. Please try again.';
    }
  });

  // Users can switch off site access (Firefox treats it as optional); offer a one-click fix.
  const YOUTUBE = { origins: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] };
  const access = document.getElementById('access');
  const checkAccess = () => api.permissions.contains(YOUTUBE)
    .then((ok) => { access.hidden = ok; })
    .catch(() => { access.hidden = true; }); // can't tell: don't show a false alarm
  document.getElementById('grant').addEventListener('click', () => {
    api.permissions.request(YOUTUBE).then(checkAccess).catch(checkAccess); // must run in this click
  });
  checkAccess();

  // Channel defaults: view, change, remove (keyed by the stable channel id).
  const CHANNELS = 'channelPrefs';
  const CHANNEL_ID = /^UC[\w-]{22}$/;
  const VALID = new Set(OPTIONS.map(([id]) => id));
  const list = document.getElementById('channel-list');
  const empty = document.getElementById('channels-empty');
  const clearAll = document.getElementById('channels-clear');
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
    clearAll.textContent = 'Remove all';
    delete clearAll.dataset.confirm;
    if (ids.join() === shownIds) { // same channels: just update values (keeps keyboard focus)
      for (const id of ids) list.querySelector(`select[data-id="${id}"]`).value = channels[id].q;
      return;
    }
    shownIds = ids.join();
    list.replaceChildren(...ids.map((id) => {
      const name = channels[id].name || id;
      const li = document.createElement('li');
      li.className = 'channel';
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/channel/${id}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = name;
      link.title = `${name} (${id})`;
      const pick = document.createElement('select');
      pick.dataset.id = id;
      pick.setAttribute('aria-label', `Default quality for ${name}`);
      for (const [q, label] of OPTIONS) pick.append(new Option(label, q, false, q === channels[id].q));
      pick.addEventListener('change', () => {
        channels[id] = { ...channels[id], q: pick.value };
        saveChannels().then(() => flash(`Saved: ${name} → ${pick.selectedOptions[0].text}`))
          .catch(() => flash('Could not save. Please try again.'));
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove default for ${name}`);
      remove.title = 'Remove';
      remove.addEventListener('click', () => {
        const next = li.nextElementSibling || li.previousElementSibling;
        delete channels[id];
        saveChannels().then(() => {
          flash(`Removed ${name}`);
          (next && next.querySelector('select') || clearAll).focus(); // keep keyboard users in place
        }).catch(() => flash('Could not remove. Please try again.'));
      });
      li.append(link, pick, remove);
      return li;
    }));
  }
  function flash(text) {
    status.textContent = text;
    status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('show'), 2200);
  }
  api.storage.local.get(CHANNELS).then((r) => showChannels(r[CHANNELS])).catch(() => showChannels({}));
  let clearTimer = 0;
  clearAll.addEventListener('click', () => {
    if (!clearAll.dataset.confirm) { // first click asks, second click clears
      clearAll.dataset.confirm = '1';
      clearAll.textContent = 'Click again to confirm';
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { clearAll.textContent = 'Remove all'; delete clearAll.dataset.confirm; }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    channels = {};
    saveChannels().then(() => flash('All channel defaults removed'))
      .catch(() => flash('Could not remove. Please try again.'));
  });

  // Stay in sync if things change in the player while the popup is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) select(changes[KEY].newValue);
    if (area === 'local' && changes[OVERRIDES]) showMemory(changes[OVERRIDES].newValue);
    if (area === 'local' && changes[CHANNELS]) showChannels(changes[CHANNELS].newValue);
  });
})();
