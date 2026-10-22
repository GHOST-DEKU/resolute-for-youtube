// Self-check: runs page.js against a fake YouTube player in jsdom.
// Run: npm i jsdom && node test/page.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div id="movie_player" class="html5-video-player">
    <video></video>
    <div class="ytp-chrome-bottom"><div class="ytp-chrome-controls">
      <div class="ytp-right-controls"><button class="ytp-subtitles-button"></button><button class="ytp-settings-button"></button></div>
    </div></div>
  </div></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

// Fake player API
let levels = ['hd1080', 'hd720', 'large', 'medium', 'auto'];
let videoId = 'vid1';
let playing = 'medium';
const calls = [];
const p = document.getElementById('movie_player');
Object.assign(p, {
  getAvailableQualityLevels: () => levels,
  getVideoData: () => ({ video_id: videoId }),
  getPlaybackQuality: () => playing,
  setPlaybackQualityRange: (a, b) => { calls.push(a); playing = a; },
  setPlaybackQuality: () => {}
});

// Capture messages page.js sends to the extension (postMessage in jsdom has no event.source, so stub it).
const sent = [];
window.postMessage = (msg) => sent.push(JSON.parse(JSON.stringify(msg)));
const toPage = (type, value) => window.dispatchEvent(new window.MessageEvent('message', {
  data: { source: 'yqx-ext', type, value }, source: window
}));
const fromExt = (value) => toPage('pref', value);

window.eval(fs.readFileSync(path.join(__dirname, '..', 'page.js'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = () => document.querySelector('.yqx-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));

(async () => {
  assert.deepStrictEqual(sent[0], { source: 'yqx-page', type: 'hello' }, 'asks extension for preference');
  fromExt('highest');
  await wait(400);
  assert.ok(document.querySelector('.yqx-button').classList.contains('yqx-pending'), 'waits for remembered videos too');
  toPage('overrides', { vidR: 'small' });
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

  // No toolbar at all -> floating fallback
  document.querySelector('.ytp-chrome-bottom').remove();
  await wait(400);
  assert.ok(document.querySelector('.yqx-button').classList.contains('yqx-floating'), 'floating fallback');

  console.log('All checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
