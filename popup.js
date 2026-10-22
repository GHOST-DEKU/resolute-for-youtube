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

  // Stay in sync if the choice changes in the player while the popup is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) select(changes[KEY].newValue);
  });
})();
