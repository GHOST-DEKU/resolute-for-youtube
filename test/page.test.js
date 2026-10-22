// Self-check: runs page.js against a fake YouTube player in jsdom.
// Run: npm i jsdom && node test/page.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <ytd-masthead><div id="center"><yt-searchbox></yt-searchbox><div id="voice-search-button"></div></div></ytd-masthead>
  <div id="movie_player" class="html5-video-player">
    <video></video>
    <div class="ytp-chrome-bottom"><div class="ytp-chrome-controls">
      <div class="ytp-right-controls"><button class="ytp-subtitles-button"></button><button class="ytp-settings-button"></button></div>
    </div></div>
  </div></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://www.youtube.com/watch?v=vid1' });
const { window } = dom;
const { document } = window;

// Fake player API
let levels = ['hd1080', 'hd720', 'large', 'medium', 'auto'];
let videoId = 'vid1';
let playing = 'medium';
const calls = [];
const UC = (c) => `UC${c.repeat(22)}`; // valid-looking channel id
const CH_A = UC('a'); const CH_B = UC('b');
let channelOf = {}; // videoId -> { id, name }; unknown videos fall back to channel "Other"
let responseLag = false; // true = player data still describes the previous video
let lastResponseVid = 'vid1';
const p = document.getElementById('movie_player');
Object.assign(p, {
  getPlayerResponse: () => {
    const v = responseLag ? lastResponseVid : videoId;
    if (!responseLag) lastResponseVid = videoId;
    const c = channelOf[v] || { id: UC('z'), name: 'Other' };
    return c.id === null ? { videoDetails: { videoId: v } } : { videoDetails: { videoId: v, channelId: c.id, author: c.name } };
  },
  getAvailableQualityLevels: () => levels,
  getVideoData: () => ({ video_id: videoId }),
  getPlaybackQuality: () => playing,
  setPlaybackQualityRange: (a, b) => { calls.push(a); playing = a; },
  setPlaybackQuality: () => {},
  pauseVideo: () => { pauses += 1; }
});
let pauses = 0;
let videoPaused = true; // jsdom can't play media, so the test sets this
const videoEl = p.querySelector('video');
Object.defineProperty(videoEl, 'paused', { get: () => videoPaused });

// Capture messages page.js sends to the extension (postMessage in jsdom has no event.source, so stub it).
const sent = [];
window.postMessage = (msg) => sent.push(JSON.parse(JSON.stringify(msg)));
const toPage = (type, value) => window.dispatchEvent(new window.MessageEvent('message', {
  data: { source: 'yqx-ext', type, value }, source: window
}));
const fromExt = (value) => toPage('pref', value);

window.eval(fs.readFileSync(path.join(__dirname, '..', 'page.js'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let overridesBackup = {};
const open = () => document.querySelector('.yqx-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));

(async () => {
  assert.deepStrictEqual(sent[0], { source: 'yqx-page', type: 'hello' }, 'asks extension for preference');
  fromExt('highest');
  await wait(400);
  assert.ok(document.querySelector('.yqx-button').classList.contains('yqx-pending'), 'waits for remembered videos too');
  toPage('overrides', { vidR: 'small' });
  await wait(400);
  assert.ok(document.querySelector('.yqx-button').classList.contains('yqx-pending'), 'waits for channel defaults too');
  toPage('channels', {});
  await wait(400);

  const btn = document.querySelector('.yqx-button');
  assert.ok(!btn.classList.contains('yqx-pending'), 'button shown once ready');
  assert.strictEqual(btn.nextElementSibling.className, 'ytp-settings-button', 'sits just before the gear');
  assert.strictEqual(btn.textContent, 'Max', 'label shows default');
  assert.strictEqual(calls.at(-1), 'hd1080', 'Highest picks top available');
  const menu = document.getElementById('yqx-menu');
  const remember = menu.querySelector('.yqx-remember');
  const makeDef = menu.querySelector('.yqx-default');

  // Pick 720p: this video only, nothing saved
  open();
  assert.ok(menu.classList.contains('yqx-open'), 'menu opens');
  assert.strictEqual(menu.querySelectorAll('[role=menuitemradio]').length, 10, '10 options');
  assert.ok(menu.querySelector('[data-q=hd1440]').classList.contains('yqx-unavailable'), '1440p marked unavailable');
  assert.strictEqual(makeDef.getAttribute('aria-disabled'), 'true', 'already the default');
  const sentBefore = sent.length;
  menu.querySelector('[data-q=hd720]').click();
  assert.ok(!menu.classList.contains('yqx-open'), 'menu closes after choice');
  assert.strictEqual(btn.textContent, '720p', 'label updates');
  assert.strictEqual(btn.querySelector('.yqx-pill').dataset.from, 'now', 'marked as this video only');
  assert.strictEqual(calls.at(-1), 'hd720', 'applied immediately');
  assert.strictEqual(sent.length, sentBefore, 'a plain pick saves nothing');

  // Remember it for this video (menu stays open)
  open();
  remember.click();
  assert.ok(menu.classList.contains('yqx-open'), 'menu stays open after remember');
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'remember', videoId: 'vid1', value: 'hd720' });
  assert.strictEqual(remember.getAttribute('aria-checked'), 'true');
  assert.strictEqual(btn.querySelector('.yqx-pill').dataset.from, 'remembered');

  // Make it the default
  makeDef.click();
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'set', value: 'hd720' });
  toPage('pref', 'hd720'); // storage echo
  toPage('overrides', { vidR: 'small', vid1: 'hd720' });
  assert.strictEqual(makeDef.getAttribute('aria-disabled'), 'true');

  // Forget for this video: quality stays as is
  const callsBefore = calls.length;
  remember.click();
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'remember', videoId: 'vid1', value: null });
  assert.strictEqual(calls.length, callsBefore, 'forgetting does not change quality');
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  assert.ok(!menu.classList.contains('yqx-open'), 'outside click closes');

  // A pick for now beats a new default; a fresh video then uses the new default
  fromExt('hd2160');
  await wait(50);
  assert.strictEqual(btn.textContent, '720p', 'this video keeps its own pick');
  videoId = 'vid5';
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(50);
  assert.strictEqual(calls.at(-1), 'hd1080', '4K on a 1080p video uses 1080p');
  assert.strictEqual(btn.textContent, '4K');

  // A pick for now does not follow you to the next video
  open(); menu.querySelector('[data-q=medium]').click();
  assert.strictEqual(calls.at(-1), 'medium');
  videoId = 'vid2'; levels = ['hd720', 'large', 'medium', 'auto'];
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(50);
  assert.strictEqual(calls.at(-1), 'hd720', 'next video uses default (best up to 4K)');
  assert.strictEqual(btn.textContent, '4K');

  // A remembered video gets its own quality
  videoId = 'vidR'; levels = ['hd720', 'large', 'medium', 'small', 'auto'];
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(50);
  assert.strictEqual(calls.at(-1), 'small', 'remembered video uses its own quality');
  assert.strictEqual(btn.querySelector('.yqx-pill').dataset.from, 'remembered');

  // Default Auto after a forced pick resets to auto on the next video
  fromExt('auto');
  await wait(50);
  videoId = 'vid4';
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(50);
  assert.strictEqual(calls.at(-1), 'auto', 'resets to Auto');

  // YouTube re-renders its controls -> button comes back, never duplicated
  btn.remove();
  document.querySelector('.ytp-right-controls').append(document.createElement('span'));
  await wait(400);
  assert.strictEqual(document.querySelectorAll('.yqx-button').length, 1, 'exactly one button after re-render');

  // Ads: wait, then apply
  fromExt('hd720'); await wait(50);
  videoId = 'vid3'; p.classList.add('ad-showing'); const before = calls.length;
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(300);
  assert.strictEqual(calls.length, before, 'no change during ad');
  p.classList.remove('ad-showing');
  await wait(350);
  assert.strictEqual(calls.length, before + 1, 'applied after ad');

  // Keyboard: ArrowDown opens on current option, End reaches bottom rows, Escape closes
  btn.focus();
  btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.ok(menu.classList.contains('yqx-open'));
  assert.strictEqual(document.activeElement.dataset.q, 'hd720', 'focus on selected option');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.ok(document.activeElement.classList.contains('yqx-default'), 'keyboard reaches bottom rows');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!menu.classList.contains('yqx-open'));
  assert.strictEqual(document.activeElement, btn, 'focus back on button');

  // ---------- per-channel defaults ----------
  const go = async (vid, ms = 80) => { videoId = vid; document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(ms); };
  const chanRow = menu.querySelector('.yqx-channel');
  const chanRemove = menu.querySelector('.yqx-channel-remove');
  const pillFrom = () => btn.querySelector('.yqx-pill').dataset.from;
  fromExt('highest'); await wait(50);
  levels = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];
  channelOf = { a1: { id: CH_A, name: 'Alpha' }, a2: { id: CH_A, name: 'Alpha' }, b1: { id: CH_B, name: 'Beta' } };
  toPage('channels', { [CH_A]: { q: 'hd1080', name: 'Alpha' }, [CH_B]: { q: 'hd2160', name: 'Beta' } });
  await go('a1');
  assert.strictEqual(calls.at(-1), 'hd1080', 'channel A default 1080p applied');
  assert.strictEqual(pillFrom(), 'channel');
  assert.match(menu.querySelector('.yqx-chan').textContent, /Alpha · channel default 1080p/, 'menu shows channel default');
  await go('b1');
  assert.strictEqual(calls.at(-1), 'hd2160', 'switching to channel B uses 4K');
  levels = ['hd1080', 'hd720', 'large', 'auto'];
  await go('a2');
  assert.strictEqual(calls.at(-1), 'hd1080', 'same channel, next video: 1080p');
  channelOf.b2 = { id: CH_B, name: 'Beta' };
  await go('b2');
  assert.strictEqual(calls.at(-1), 'hd1080', 'channel B wants 4K, video has max 1080p: uses highest below');
  await go('c1');
  assert.strictEqual(calls.at(-1), 'hd1080', 'channel without default: global Highest');
  assert.strictEqual(pillFrom(), 'default');
  assert.match(menu.querySelector('.yqx-chan').textContent, /no channel default \(global: Highest available\)/);

  // Remembered video beats channel default
  overridesBackup = { a3: 'medium' }; channelOf.a3 = { id: CH_A, name: 'Alpha' }; levels.push('medium');
  toPage('overrides', overridesBackup);
  await go('a3');
  assert.strictEqual(calls.at(-1), 'medium', 'remembered video wins over its channel');

  // Set a channel default from the menu (channel without one)
  channelOf.c2 = { id: UC('c'), name: 'Gamma' };
  await go('c2');
  open(); menu.querySelector('[data-q=large]').click();
  assert.strictEqual(calls.at(-1), 'large');
  open();
  assert.strictEqual(chanRow.querySelector('.yqx-label').textContent, 'Set as default for this channel');
  chanRow.click();
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'channel', channelId: UC('c'), value: 'large', name: 'Gamma' });
  assert.match(menu.querySelector('.yqx-now').textContent, /Saved for Gamma/, 'clear feedback');
  assert.strictEqual(pillFrom(), 'channel');
  assert.strictEqual(chanRow.querySelector('.yqx-note').textContent, 'Remove');
  // Update: pick another quality, row offers update + separate remove
  menu.querySelector('[data-q=hd720]').click(); open();
  assert.strictEqual(chanRow.querySelector('.yqx-label').textContent, 'Update channel default');
  assert.ok(!chanRemove.hidden, 'remove row shown while they differ');
  chanRow.click();
  assert.deepStrictEqual(sent.at(-1).value, 'hd720', 'channel default updated');
  assert.ok(chanRemove.hidden);
  // Remove: quality keeps playing, falls back to global next time
  const before2 = calls.length;
  chanRow.click();
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'channel', channelId: UC('c'), value: null });
  assert.strictEqual(calls.length, before2, 'removing does not change what plays now');
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));

  // Missing channel id: never guesses; waits briefly, then global default
  channelOf.x1 = { id: null };
  toPage('channels', { [CH_A]: { q: 'hd720', name: 'Alpha' } });
  await go('x1', 2600);
  assert.strictEqual(calls.at(-1), 'hd1080', 'no channel id: global default');
  open();
  assert.strictEqual(chanRow.getAttribute('aria-disabled'), 'true', 'channel row disabled');
  assert.match(menu.querySelector('.yqx-chan').textContent, /Channel not detected/);
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));

  // Stale player data (still the previous video) is never trusted for the new video
  channelOf.a4 = { id: CH_A, name: 'Alpha' };
  lastResponseVid = 'b1'; responseLag = true;            // data still says channel B's video
  videoId = 'a4'; document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(400);
  assert.notStrictEqual(calls.at(-1), 'hd2160', "channel B's 4K never applied to channel A's video");
  responseLag = false;                                    // data catches up
  await wait(800);
  assert.strictEqual(calls.at(-1), 'hd720', "then channel A's own default applies");

  // Channel renamed: same id, stored name refreshed
  toPage('channels', { [CH_A]: { q: 'hd720', name: 'Old Alpha Name' } });
  channelOf.a5 = { id: CH_A, name: 'Alpha Renamed' };
  await go('a5');
  assert.strictEqual(calls.at(-1), 'hd720', 'renamed channel still matched by id');
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'channel', channelId: CH_A, value: 'hd720', name: 'Alpha Renamed' });

  // Corrupted storage is ignored safely
  toPage('channels', { notAnId: { q: 'hd720' }, [CH_B]: { q: 'bogus' }, [UC('d')]: null });
  channelOf.d1 = { id: UC('d'), name: 'Delta' };
  await go('d1');
  assert.strictEqual(calls.at(-1), 'hd1080', 'corrupted entries ignored -> global default');

  // Global default change applies to channels without their own default
  fromExt('hd720'); await wait(80);
  assert.strictEqual(calls.at(-1), 'hd720', 'new global default applied');

  // ---------- open videos paused ----------
  const startsPlaying = async (vid) => {
    videoId = vid; videoPaused = false;
    videoEl.dispatchEvent(new window.Event('playing'));
    await wait(20);
  };
  let before3 = pauses;
  await startsPlaying('ap0');
  assert.strictEqual(pauses, before3, 'setting off: autoplay left alone');
  toPage('autoplay', true);
  await startsPlaying('ap1');
  assert.strictEqual(pauses, before3 + 1, 'setting on: video that starts by itself is paused');
  await startsPlaying('ap1');
  assert.strictEqual(pauses, before3 + 1, 'pressing play afterwards is never undone');
  p.querySelector('.ytp-chrome-bottom').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await startsPlaying('ap2');
  assert.strictEqual(pauses, before3 + 1, 'click in the player = you asked to play');
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  await startsPlaying('ap3');
  assert.strictEqual(pauses, before3 + 1, 'K key = you asked to play');
  await wait(1050);
  const search = document.createElement('input'); document.body.append(search);
  search.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  open(); // opening the quality menu isn't a play request either
  menu.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await startsPlaying('ap4');
  assert.strictEqual(pauses, before3 + 2, 'typing a space in search or using the menu does not count as play');
  p.classList.add('ad-showing');
  await startsPlaying('ap5');
  assert.strictEqual(pauses, before3 + 2, 'ads are not touched');
  p.classList.remove('ad-showing');
  await startsPlaying('ap5');
  assert.strictEqual(pauses, before3 + 3, 'the real video after the ad opens paused');
  toPage('autoplay', false);
  await startsPlaying('ap6');
  assert.strictEqual(pauses, before3 + 3, 'turning it off restores autoplay');

  // Same switch beside the search box
  const ap = document.getElementById('yqx-autoplay');
  assert.ok(ap, 'switch added to the top bar');
  assert.strictEqual(ap.previousElementSibling.id, 'voice-search-button', 'sits right after the mic button');
  assert.strictEqual(ap.getAttribute('aria-pressed'), 'false');
  ap.click();
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'autoplay', value: true }, 'saves the setting');
  assert.strictEqual(ap.getAttribute('aria-pressed'), 'true');
  await startsPlaying('ap7');
  assert.strictEqual(pauses, before3 + 4, 'switch works immediately');
  toPage('autoplay', false); // changed in the popup
  assert.strictEqual(ap.getAttribute('aria-pressed'), 'false', 'follows the popup');
  ap.remove(); await wait(400);
  assert.strictEqual(document.querySelectorAll('#yqx-autoplay').length, 1, 'comes back once if YouTube re-renders the bar');
  videoPaused = true;

  // No toolbar at all -> floating fallback
  document.querySelector('.ytp-chrome-bottom').remove();
  await wait(400);
  assert.ok(document.querySelector('.yqx-button').classList.contains('yqx-floating'), 'floating fallback');

  console.log('All checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
