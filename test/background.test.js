// Self-check for background.js: which YouTube tabs count as on screen. Run: node test/background.test.js
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
const viv = (id) => JSON.stringify({ tiling: { id, index: 0, layout: 'row' } });
const result = () => Object.fromEntries(sent.splice(0));

(async () => {
  // Plain tabs: only the selected one is on screen
  tabs = [{ id: 1, windowId: 9, active: false, url: 'https://www.youtube.com/watch' }, { id: 2, windowId: 9, active: true, url: 'https://news.example' }];
  on.activated({ tabId: 2, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: false }, 'YouTube in the background: away');
  // Vivaldi tiling: YouTube tiled next to the selected tab stays on screen
  tabs[0].vivExtData = viv('t1'); tabs[1].vivExtData = viv('t1');
  on.updated(1, { vivExtData: tabs[0].vivExtData }, tabs[0]); await tick();
  assert.deepStrictEqual(result(), { 1: true }, 'tiled next to the selected tab: on screen');
  tabs[1].vivExtData = viv('t2');
  on.activated({ tabId: 2, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: false }, 'a different tile group: away');
  // Chrome split view
  delete tabs[0].vivExtData; delete tabs[1].vivExtData;
  tabs[0].splitViewId = 4; tabs[1].splitViewId = 4;
  on.activated({ tabId: 2, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: true }, 'Chrome split view: on screen');
  tabs[0].splitViewId = -1; tabs[1].splitViewId = -1;
  on.activated({ tabId: 2, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: false }, 'splitViewId -1 is not a split');
  tabs[0].vivExtData = '{broken'; on.activated({ tabId: 2, windowId: 9 }); await tick();
  assert.deepStrictEqual(result(), { 1: false }, 'broken vivExtData: treated as not tiled');
  // A page asking on load
  const ask = (tab) => new Promise((r) => { assert.strictEqual(on.message({ type: 'amActive' }, { id: 'me', tab }, r), true); });
  assert.strictEqual(await ask(tabs[0]), false, 'asks on load: in the background');
  tabs[0].vivExtData = viv('t3'); tabs[1].vivExtData = viv('t3');
  assert.strictEqual(await ask(tabs[0]), true, 'asks on load: tiled next to the selected tab');
  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
