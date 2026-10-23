/*
 * Background: shows one notification while the background saver has lowered a tab,
 * and clears it when you come back. Clicking it takes you back to that tab.
 */
const api = globalThis.browser ?? globalThis.chrome;
const idFor = (tabId) => `saver-${tabId}`;
const YT = ['https://www.youtube.com/*'];
// Tabs shown side by side share a group: Chrome's split view (Tab.splitViewId, Chrome 155+)
// or Vivaldi's tab tiling (vivExtData.tiling.id). '' = not side by side, or the browser doesn't say.
function tileOf(t) {
  if (typeof t.splitViewId === 'number' && t.splitViewId > -1) return `s${t.splitViewId}`;
  try {
    const id = JSON.parse(t.vivExtData || '{}').tiling?.id;
    return id ? `v${id}` : '';
  } catch {
    return '';
  }
}
// On screen = the selected tab, or tiled/split next to it.
const onScreen = (t, active) => !!active && (t.id === active.id || (tileOf(t) !== '' && tileOf(t) === tileOf(active)));
async function tellWindow(windowId) {
  const [active] = await api.tabs.query({ windowId, active: true });
  for (const t of await api.tabs.query({ windowId, url: YT })) {
    api.tabs.sendMessage(t.id, { type: 'tabActive', on: onScreen(t, active) }).catch(() => {});
  }
}

api.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only our own content scripts, from a real tab.
  if (sender.id !== api.runtime.id || !sender.tab || !msg) return;
  if (msg.type === 'amActive') {
    api.tabs.query({ windowId: sender.tab.windowId, active: true })
      .then(([active]) => reply(onScreen(sender.tab, active)), () => reply(true));
    return true; // answer comes later
  }
  const id = idFor(sender.tab.id);
  if (msg.type === 'saverOn' && /^\d{3,4}p( \([48]K\))?$/.test(msg.label)) {
    const title = typeof msg.title === 'string' ? msg.title.slice(0, 100) : '';
    Promise.resolve(api.notifications.create(id, {
      type: 'basic',
      iconUrl: api.runtime.getURL('icons/icon128.png'),
      title: `Background saver: ${msg.label}`,
      message: (title ? `“${title}”` : 'Your video') + ' is playing at a lower quality while you’re away. It goes back up when you return.'
    })).catch(() => {}); // no notifications here (e.g. Firefox on Android): the tab title still shows it
  } else if (msg.type === 'saverOff') {
    Promise.resolve(api.notifications.clear(id)).catch(() => {});
  }
});

// Which tab is selected in each window. Vivaldi keeps background tabs "visible" to the page,
// so the saver also needs this to know you've switched away. Stateless: works after the worker restarts.
// Tabs tiled or split next to the selected one count as on screen.
api.tabs.onActivated.addListener(({ windowId }) => { tellWindow(windowId).catch(() => {}); });
// Tiling or untiling changes what's on screen without selecting another tab.
api.tabs.onUpdated.addListener((id, info, tab) => {
  if ('vivExtData' in info || 'splitViewId' in info) tellWindow(tab.windowId).catch(() => {});
});

api.notifications?.onClicked.addListener((id) => {
  const tabId = Number(id.replace('saver-', ''));
  if (!Number.isInteger(tabId)) return;
  api.tabs.update(tabId, { active: true }).then((t) => api.windows.update(t.windowId, { focused: true })).catch(() => {});
  api.notifications.clear(id);
});
