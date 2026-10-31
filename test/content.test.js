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
let changeListener = null;
const chrome = { runtime: { id: 'me', onMessage: { addListener: (fn) => { bgListener = fn; } }, sendMessage: async (m) => { runtimeSent.push(m); return m.type === 'amActive' ? false : undefined; } }, storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (fn) => { changeListener = fn; } } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'), { window, chrome, globalThis: { chrome } });
const fromPage = (data) => Promise.all(listeners.map((fn) => fn({ source: window, data: { source: 'yqx-page', ...data } })));
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  await tick();
  assert.deepStrictEqual(posted.map((m) => m.type), ['pref', 'overrides', 'channels', 'autoplay', 'saver', 'chat', 'topbar', 'tabicons', 'cinemaSkip', 'cinema', 'spots', 'resumeRewind', 'resumeRules', 'resumeBar', 'spotsOff', 'chOff', 'tabActive'], 'sends default, remembered videos, channel defaults, autoplay, saver, chat, top bar, tab icons, cinema and resume settings');
  assert.strictEqual(posted[7].value, true, 'tab countdown icons are on by default');
  assert.strictEqual(posted[5].value, false, 'live chat stays visible by default');
  assert.strictEqual(posted[6].value, false, 'top bar stays visible by default');
  assert.strictEqual(JSON.stringify(posted[4].value), '{"on":false,"after":30,"to":"tiny"}', 'saver off by default');
  assert.strictEqual(posted[0].value, 'hd1080');
  assert.strictEqual(JSON.stringify(posted[8].value), '{}', 'no channels left out by default');
  assert.strictEqual(posted[9].value, false, 'cinema mode is off by default');
  assert.strictEqual(posted[16].value, false, 'tells the page whether its tab is selected');
  assert.strictEqual(JSON.stringify(posted[15].value), '{}', 'no channels switched off by default');
  assert.strictEqual(JSON.stringify(posted[13].value), '{"flag":true,"back":true,"ghost":true,"button":true}', 'every bar extra is on by default');
  assert.strictEqual(JSON.stringify(posted[14].value), '{}', 'no videos left out by default');
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

  // ---- resume: where you stopped ----
  assert.strictEqual(JSON.stringify(posted[10].value), '{}', 'no saved spots by default');
  assert.strictEqual(posted[11].value, 'smart', 'smart rewind by default');
  assert.strictEqual(JSON.stringify(posted[12].value), '{"includeLive":true,"skipStart":true,"endFinished":true,"skipShort":true}', 'every rule on by default');
  await fromPage({ type: 'spot', videoId: 'dQw4w9WgXcQ', t: 754.9 });
  assert.strictEqual(store.local.resumeSpots.dQw4w9WgXcQ.t, 754, 'saves a spot in whole seconds');
  assert.ok(store.local.resumeSpots.dQw4w9WgXcQ.at > 0, 'with the time it was saved');
  await fromPage({ type: 'spot', videoId: 'bad id!', t: 5 });
  await fromPage({ type: 'spot', videoId: 'abcdefghijk', t: -1 });
  await fromPage({ type: 'spot', videoId: 'abcdefghijk', t: 'soon' });
  await fromPage({ type: 'spot', videoId: 'abcdefghijk', t: 1e9 });
  assert.strictEqual(Object.keys(store.local.resumeSpots).join(), 'dQw4w9WgXcQ', 'rejects bad ids and times');
  await fromPage({ type: 'spot', videoId: 'second12345', t: 10 });
  await fromPage({ type: 'spot', videoId: 'dQw4w9WgXcQ', t: 800 });
  assert.strictEqual(Object.keys(store.local.resumeSpots).join(), 'second12345,dQw4w9WgXcQ', 'saving again moves it to the newest place');
  await fromPage({ type: 'spotClear', videoId: 'second12345' });
  assert.strictEqual(Object.keys(store.local.resumeSpots).join(), 'dQw4w9WgXcQ', 'clears a finished video');
  store.local.resumeSpots = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`old${String(i).padStart(8, '0')}`, { t: 5, at: 1 }]));
  await fromPage({ type: 'spot', videoId: 'newest12345', t: 20 });
  const kept = Object.keys(store.local.resumeSpots);
  assert.ok(kept.length === 1000 && kept[999] === 'newest12345' && !kept.includes('old00000000'), 'keeps the newest 1000 spots');
  store.local.resumeSpots = { good1234567: { t: 5, at: 1 }, bad: { t: 5, at: 1 }, worse123456: { t: 'x', at: 1 }, huge1234567: { t: 1e9, at: 1 } };
  posted.length = 0;
  changeListener({ resumeSpots: { newValue: store.local.resumeSpots } }, 'local');
  assert.strictEqual(Object.keys(posted[0].value).join(), 'good1234567', 'only well-formed spots reach the page');
  changeListener({ resumeRewind: { newValue: '5' } }, 'sync');
  changeListener({ resumeRewind: { newValue: 'banana' } }, 'sync');
  assert.strictEqual(posted.slice(1).map((m) => m.value).join(), '5,smart', 'unknown rewind falls back to smart');
  changeListener({ resumeRules: { newValue: { skipStart: false, includeLive: 'no' } } }, 'sync');
  assert.strictEqual(JSON.stringify(posted[3].value), '{"includeLive":true,"skipStart":false,"endFinished":true,"skipShort":true}', 'a rule is off only when it is exactly false');

  // ---- resume: progress-bar extras and "don't save this video" ----
  await fromPage({ type: 'spotOff', videoId: 'dQw4w9WgXcQ', off: true });
  await fromPage({ type: 'spotOff', videoId: 'second12345', off: true });
  await fromPage({ type: 'spotOff', videoId: 'bad id!', off: true });
  await fromPage({ type: 'spotOff', videoId: 'abcdefghijk', off: 'yes' });
  assert.strictEqual(Object.keys(store.local.resumeOff).join(), 'dQw4w9WgXcQ,second12345', 'saves videos you chose not to save, rejects bad input');
  await fromPage({ type: 'spotOff', videoId: 'dQw4w9WgXcQ', off: false });
  assert.strictEqual(Object.keys(store.local.resumeOff).join(), 'second12345', 'saving again removes it');
  posted.length = 0;
  changeListener({ resumeOff: { newValue: { good1234567: true, bad: true } } }, 'local');
  changeListener({ resumeBar: { newValue: { ghost: false, flag: 'no' } } }, 'sync');
  assert.strictEqual(Object.keys(posted[0].value).join(), 'good1234567', 'only well-formed ids reach the page');
  assert.strictEqual(JSON.stringify(posted[1].value), '{"flag":true,"back":true,"ghost":false,"button":true}', 'an extra is off only when exactly false');

  // ---- resume: "don't save this channel" ----
  const UCa = `UC${'a'.repeat(22)}`, UCb = `UC${'b'.repeat(22)}`;
  await fromPage({ type: 'spot', videoId: 'a1a1a1a1a1a', t: 120, channelId: UCa });
  await fromPage({ type: 'spot', videoId: 'a2a2a2a2a2a', t: 130, channelId: UCa });
  await fromPage({ type: 'spot', videoId: 'b1b1b1b1b1b', t: 140, channelId: UCb });
  await fromPage({ type: 'spot', videoId: 'old00000001', t: 150 });
  assert.strictEqual(store.local.resumeSpots.a1a1a1a1a1a.c, UCa, 'a spot remembers its channel');
  assert.ok(!('c' in store.local.resumeSpots.old00000001), 'no channel id given: none stored');
  await fromPage({ type: 'spotChOff', channelId: 'nope', off: true });
  await fromPage({ type: 'spotChOff', channelId: UCa, off: 'yes' });
  assert.ok(!store.local.resumeChOff, 'bad channel id or value: nothing saved');
  await fromPage({ type: 'spotChOff', channelId: UCa, name: '  Alpha  ', off: true, videoId: 'old00000001' });
  assert.strictEqual(JSON.stringify(store.local.resumeChOff), JSON.stringify({ [UCa]: 'Alpha' }), 'the channel is saved with a trimmed name');
  const left = () => Object.keys(store.local.resumeSpots).filter((id) => /^[ab]\d/.test(id) || id.startsWith('old')).join();
  assert.strictEqual(left(), 'b1b1b1b1b1b', 'its spots and the video on screen are deleted, other channels stay');
  await fromPage({ type: 'spot', videoId: 'a3a3a3a3a3a', t: 90, channelId: UCa });
  assert.ok(!('a3a3a3a3a3a' in store.local.resumeSpots), 'a stale player cannot save a spot for a switched-off channel');
  await fromPage({ type: 'spotChOff', channelId: UCa, off: false });
  assert.deepStrictEqual(Object.keys(store.local.resumeChOff), [], 'saving again removes it');
  assert.strictEqual(left(), 'b1b1b1b1b1b', 'and brings no spots back');
  posted.length = 0;
  changeListener({ resumeChOff: { newValue: { [UCb]: 'Beta', bad: 'x' } } }, 'local');
  assert.strictEqual(posted[0].type + JSON.stringify(posted[0].value), 'chOff' + JSON.stringify({ [UCb]: 'Beta' }), 'only well-formed channel ids reach the page');

  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
