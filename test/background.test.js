// Self-check for background.js: tells YouTube tabs whether they are selected. Run: node test/background.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let tabs = [];
const sent = [];
const on = {};
const ev = (name) => ({ addListener: (fn) => { on[name] = fn; } });
const chrome = {
  runtime: { id: 'me', onMessage: ev('message'), getURL: (p) => p },
  notifications: { create: async () => {}, clear: async () => {}, onClicked: ev('click') },
  tabs: {
    onActivated: ev('activated'), onUpdated: ev('updated'),
    query: async (q) => tabs.filter((t) => t.windowId === q.windowId && (q.active === undefined || t.active === q.active) && (!q.url || t.url.includes('youtube'))),
    sendMessage: async (id, m) => { sent.push([id, m.on]); }
  }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), { chrome, globalThis: { chrome } });
const tick = () => new Promise((r) => setTimeout(r, 10));
const result = () => Object.fromEntries(sent.splice(0));

(async () => {
  tabs = [{ id: 1, windowId: 9, active: false, url: 'https://www.youtube.com/watch' }, { id: 2, windowId: 9, active: true, url: 'https://news.example' },
    { id: 3, windowId: 8, active: false, url: 'https://www.youtube.com/watch' }];
  on.activated({ tabId: 2, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: false }, 'YouTube tabs in that window are told they are not selected; other windows untouched');
  tabs[0].active = true; tabs[1].active = false;
  on.activated({ tabId: 1, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: true }, 'selected again');
  const ask = (tab) => new Promise((r) => { assert.strictEqual(on.message({ type: 'amActive' }, { id: 'me', tab }, r), true); });
  assert.strictEqual(await ask(tabs[0]), true, 'asks on load: selected');
  assert.strictEqual(await ask({ ...tabs[2] }), false, 'asks on load: in the background');
  assert.strictEqual(on.message({ type: 'amActive' }, { id: 'other', tab: tabs[0] }, () => {}), undefined, 'ignores other extensions');
  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
