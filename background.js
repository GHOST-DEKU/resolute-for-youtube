/*
 * Background: shows one notification while the background saver has lowered a tab,
 * and clears it when you come back. Clicking it takes you back to that tab.
 */
const api = globalThis.browser ?? globalThis.chrome;
const idFor = (tabId) => `saver-${tabId}`;

api.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only our own content scripts, from a real tab.
  if (sender.id !== api.runtime.id || !sender.tab || !msg) return;
  if (msg.type === 'amActive') { reply(sender.tab.active === true); return; }
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
// shortcut: with Vivaldi tab tiling, a tiled YouTube tab you are not clicking in counts as away; fix if users tile videos
api.tabs.onActivated.addListener(({ tabId, windowId }) => {
  api.tabs.query({ windowId, url: ['https://www.youtube.com/*'] }).then((tabs) => {
    for (const t of tabs) api.tabs.sendMessage(t.id, { type: 'tabActive', on: t.id === tabId }).catch(() => {});
  }).catch(() => {});
});

api.notifications?.onClicked.addListener((id) => {
  const tabId = Number(id.replace('saver-', ''));
  if (!Number.isInteger(tabId)) return;
  api.tabs.update(tabId, { active: true }).then((t) => api.windows.update(t.windowId, { focused: true })).catch(() => {});
  api.notifications.clear(id);
});
