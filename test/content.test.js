// Self-check for content.js storage bridge. Run: node test/content.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = { sync: { qualityPreference: 'hd1080' }, local: {} };
const area = (name) => ({
  get: async (k) => ({ [k]: store[name][k] }),
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
  assert.deepStrictEqual(posted.map((m) => m.type), ['pref', 'overrides'], 'sends default and remembered videos');
  assert.strictEqual(posted[0].value, 'hd1080');

  await fromPage({ type: 'remember', videoId: 'dQw4w9WgXcQ', value: 'large' });
  assert.deepStrictEqual(store.local.videoOverrides, { dQw4w9WgXcQ: 'large' }, 'remembers a video');
  await fromPage({ type: 'remember', videoId: 'dQw4w9WgXcQ', value: null });
  assert.deepStrictEqual(store.local.videoOverrides, {}, 'forgets a video');
  await fromPage({ type: 'remember', videoId: 'bad id!', value: 'large' });
  await fromPage({ type: 'remember', videoId: 'abcdefghijk', value: 'nonsense' });
  assert.deepStrictEqual(store.local.videoOverrides, {}, 'rejects bad input');
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

  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
