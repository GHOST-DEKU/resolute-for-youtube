// Self-check for content.js storage bridge. Run: node test/content.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = { sync: { qualityPreference: 'hd1080', stopAutoplay: true }, local: {} };
const area = (name) => ({
  get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).map((x) => [x, store[name][x]])),
  set: async (o) => { Object.assign(store[name], JSON.parse(JSON.stringify(o))); }
});
const listeners = [];
const posted = [];
const window = {
  postMessage: (m) => posted.push(m),
  addEventListener: (t, fn) => listeners.push(fn)
};
const chrome = { storage: { sync: area('sync'), local: area('local'), onChanged: { addListener() {} } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'), { window, chrome, globalThis: { chrome } });
const fromPage = (data) => Promise.all(listeners.map((fn) => fn({ source: window, data: { source: 'yqx-page', ...data } })));
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  await tick();
  assert.deepStrictEqual(posted.map((m) => m.type), ['pref', 'overrides', 'channels', 'autoplay'], 'sends default, remembered videos, channel defaults and autoplay setting');
  assert.strictEqual(posted[0].value, 'hd1080');
  assert.strictEqual(JSON.stringify(posted[3].value), '{"opened":true,"next":true}', 'old single switch counts as both');

  await fromPage({ type: 'remember', videoId: 'dQw4w9WgXcQ', value: 'large' });
  assert.deepStrictEqual(store.local.videoOverrides, { dQw4w9WgXcQ: 'large' }, 'remembers a video');
  await fromPage({ type: 'remember', videoId: 'dQw4w9WgXcQ', value: null });
  assert.deepStrictEqual(store.local.videoOverrides, {}, 'forgets a video');
  await fromPage({ type: 'remember', videoId: 'bad id!', value: 'large' });
  await fromPage({ type: 'remember', videoId: 'abcdefghijk', value: 'nonsense' });
  assert.deepStrictEqual(store.local.videoOverrides, {}, 'rejects bad input');
  await fromPage({ type: 'autoplay', value: { opened: false, next: true } });
  assert.strictEqual(store.sync.holdOpened, false, 'saves "videos I open" from the page');
  assert.strictEqual(store.sync.holdNext, true, 'saves "next in queue" from the page');
  await fromPage({ type: 'autoplay', value: { opened: 'yes', next: true } });
  await fromPage({ type: 'autoplay', value: true });
  assert.strictEqual(store.sync.holdOpened, false, 'rejects anything but two booleans');
  await fromPage({ type: 'set', value: 'hd720' });
  assert.strictEqual(store.sync.qualityPreference, 'hd720', 'saves default');

  // Keeps only the newest 1000
  const big = {};
  for (let i = 0; i < 1000; i++) big[`vid${String(i).padStart(5, '0')}`] = 'hd720';
  store.local.videoOverrides = big;
  await fromPage({ type: 'remember', videoId: 'newestVideo', value: 'small' });
  const keys = Object.keys(store.local.videoOverrides);
  assert.strictEqual(keys.length, 1000);
  assert.ok(!keys.includes('vid00000') && keys.at(-1) === 'newestVideo', 'drops the oldest');

  // Channel defaults
  const CH = 'UC' + 'a'.repeat(22);
  await tick();
  assert.deepStrictEqual(posted.slice(0, 3).map((m) => m.type), ['pref', 'overrides', 'channels'], 'sends channel defaults too');
  await fromPage({ type: 'channel', channelId: CH, value: 'hd1080', name: '  Alpha  ' });
  assert.deepStrictEqual(store.local.channelPrefs, { [CH]: { q: 'hd1080', name: 'Alpha' } }, 'saves channel default');
  await fromPage({ type: 'channel', channelId: CH, value: 'hd2160', name: 'Alpha' });
  assert.strictEqual(store.local.channelPrefs[CH].q, 'hd2160', 'updates channel default');
  await fromPage({ type: 'channel', channelId: 'not-a-channel', value: 'hd720', name: 'x' });
  await fromPage({ type: 'channel', channelId: 'UC' + 'b'.repeat(22), value: 'bogus', name: 'x' });
  await fromPage({ type: 'channel', channelId: CH, value: 'hd720', name: 'x'.repeat(500) });
  assert.strictEqual(Object.keys(store.local.channelPrefs).length, 1, 'rejects bad ids and qualities');
  assert.strictEqual(store.local.channelPrefs[CH].name.length, 100, 'name length capped');
  await fromPage({ type: 'channel', channelId: CH, value: null });
  assert.deepStrictEqual(store.local.channelPrefs, {}, 'removes channel default');
  // Corrupted storage is cleaned on read
  store.local.channelPrefs = { junk: 1, [CH]: { q: 'hd720', name: 7 }, ['UC' + 'c'.repeat(22)]: 'oops' };
  await fromPage({ type: 'channel', channelId: 'UC' + 'd'.repeat(22), value: 'large', name: 'Delta' });
  assert.deepStrictEqual(store.local.channelPrefs, {
    [CH]: { q: 'hd720', name: '' }, ['UC' + 'd'.repeat(22)]: { q: 'large', name: 'Delta' }
  }, 'corrupted entries dropped, valid ones kept');

  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
