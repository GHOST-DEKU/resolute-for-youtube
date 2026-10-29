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
const runtimeSent = [];
let bgListener = null;
const chrome = { runtime: { id: 'me', onMessage: { addListener: (fn) => { bgListener = fn; } }, sendMessage: async (m) => { runtimeSent.push(m); return m.type === 'amActive' ? false : undefined; } }, storage: { sync: area('sync'), local: area('local'), onChanged: { addListener() {} } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'), { window, chrome, globalThis: { chrome } });
const fromPage = (data) => Promise.all(listeners.map((fn) => fn({ source: window, data: { source: 'yqx-page', ...data } })));
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  await tick();
  assert.deepStrictEqual(posted.map((m) => m.type), ['pref', 'overrides', 'channels', 'autoplay', 'saver', 'chat', 'topbar', 'tabicons', 'cinemaSkip', 'cinema', 'tabActive'], 'sends default, remembered videos, channel defaults, autoplay, saver, chat, top bar, tab icons and cinema settings');
  assert.strictEqual(posted[7].value, true, 'tab countdown icons are on by default');
  assert.strictEqual(posted[5].value, false, 'live chat stays visible by default');
  assert.strictEqual(posted[6].value, false, 'top bar stays visible by default');
  assert.strictEqual(JSON.stringify(posted[4].value), '{"on":false,"after":30,"to":"tiny"}', 'saver off by default');
  assert.strictEqual(posted[0].value, 'hd1080');
  assert.strictEqual(JSON.stringify(posted[8].value), '{}', 'no channels left out by default');
  assert.strictEqual(posted[9].value, false, 'cinema mode is off by default');
  assert.strictEqual(posted[10].value, false, 'tells the page whether its tab is selected');
  bgListener({ type: 'tabActive', on: true }, { id: 'me' });
  bgListener({ type: 'tabActive', on: true }, { id: 'someone-else' });
  bgListener({ type: 'tabActive', on: 'yes' }, { id: 'me' });
  assert.strictEqual(posted.filter((m) => m.type === 'tabActive').length, 2, 'forwards only valid messages from its own background');
  runtimeSent.length = 0;
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
  await fromPage({ type: 'cinemaSkip', channelId: CH, name: '  Alpha  ', on: true });
  assert.deepStrictEqual(store.local.cinemaSkip, { [CH]: 'Alpha' }, 'saves a channel that stays normal');
  await fromPage({ type: 'cinemaSkip', channelId: 'nope', name: 'x', on: true });
  await fromPage({ type: 'cinemaSkip', channelId: CH, name: 'x', on: 'yes' });
  assert.deepStrictEqual(Object.keys(store.local.cinemaSkip), [CH], 'rejects bad ids and values');
  await fromPage({ type: 'cinemaSkip', channelId: CH, name: 'Alpha', on: false });
  assert.deepStrictEqual(store.local.cinemaSkip, {}, 'going back into theater forgets the channel');
  await fromPage({ type: 'channel', channelId: CH, value: null });
  assert.deepStrictEqual(store.local.channelPrefs, {}, 'removes channel default');
  // Corrupted storage is cleaned on read
  store.local.channelPrefs = { junk: 1, [CH]: { q: 'hd720', name: 7 }, ['UC' + 'c'.repeat(22)]: 'oops' };
  await fromPage({ type: 'channel', channelId: 'UC' + 'd'.repeat(22), value: 'large', name: 'Delta' });
  assert.deepStrictEqual(store.local.channelPrefs, {
    [CH]: { q: 'hd720', name: '' }, ['UC' + 'd'.repeat(22)]: { q: 'large', name: 'Delta' }
  }, 'corrupted entries dropped, valid ones kept');

  // Background saver: daily estimates
  const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  store.local.saverStats = { '2000-01-01': 5, junk: 'x' };
  for (let i = 0; i < 25; i++) store.local.saverStats[`2001-01-${String(i + 1).padStart(2, '0')}`] = 1;
  await fromPage({ type: 'saved', mb: 12.34 });
  await fromPage({ type: 'saved', mb: 0.5 });
  await fromPage({ type: 'saved', mb: -3 });
  await fromPage({ type: 'saved', mb: 'lots' });
  assert.strictEqual(store.local.saverStats[day], 12.8, 'adds up today, rejects bad values');
  assert.ok(!('junk' in store.local.saverStats) && !('2000-01-01' in store.local.saverStats), 'drops junk and oldest days');
  assert.strictEqual(Object.keys(store.local.saverStats).length, 21, 'keeps the last 21 days');
  await fromPage({ type: 'saved', mb: 16.2, from: 'hd1080', to: 'tiny', secs: 130 });
  assert.strictEqual(store.local.saverLast.from + '>' + store.local.saverLast.to + ':' + store.local.saverLast.secs, 'hd1080>tiny:130', 'remembers the last run');
  const statsBefore = JSON.stringify(store.local.saverStats);
  await fromPage({ type: 'saved', mb: 0, from: 'hd720', to: 'tiny', secs: 3 });
  assert.strictEqual(store.local.saverLast.secs, 3, 'a short run still counts as "last time"');
  await fromPage({ type: 'saved', mb: 1, from: '<b>x</b>', to: 'tiny', secs: 5 });
  assert.strictEqual(store.local.saverLast.secs, 3, 'rejects bad quality names');
  await fromPage({ type: 'saverSkip', reason: 'paused' });
  assert.strictEqual(store.local.saverLast.skipped, 'paused', 'remembers why it did not lower');
  await fromPage({ type: 'saverSkip', reason: 'muted' });
  assert.strictEqual(store.local.saverLast.skipped, 'muted', 'muted is a known reason');
  await fromPage({ type: 'saverSkip', reason: 'paused' });
  await fromPage({ type: 'saverSkip', reason: '<script>' });
  assert.strictEqual(store.local.saverLast.skipped, 'paused', 'rejects unknown reasons');

  await fromPage({ type: 'saverOn', label: '144p', title: 'x'.repeat(300) });
  await fromPage({ type: 'saverOff' });
  await fromPage({ type: 'saverOn', label: 144, title: 'x' });
  assert.deepStrictEqual(runtimeSent.map((m) => m.type), ['saverOn', 'saverOff'], 'passes the notification on, rejects bad input');
  assert.strictEqual(runtimeSent[0].title.length, 100, 'video title capped');

  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
