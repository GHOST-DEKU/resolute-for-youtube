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
    row.className = 'row';
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

  // Stay in sync if things change in the player while the popup is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) select(changes[KEY].newValue);
    if (area === 'local' && changes[OVERRIDES]) showMemory(changes[OVERRIDES].newValue);
  });
})();
