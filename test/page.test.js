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
const fromExt = (value) => window.dispatchEvent(new window.MessageEvent('message', {
  data: { source: 'yqx-ext', type: 'pref', value }, source: window
}));

window.eval(fs.readFileSync(path.join(__dirname, '..', 'page.js'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  assert.deepStrictEqual(sent[0], { source: 'yqx-page', type: 'hello' }, 'asks extension for preference');
  fromExt('highest');
  await wait(400);

  const btn = document.querySelector('.yqx-button');
  assert.ok(btn, 'button inserted');
  assert.strictEqual(btn.nextElementSibling.className, 'ytp-settings-button', 'sits just before the gear');
  assert.strictEqual(btn.textContent, 'Max', 'label shows preference');
  assert.strictEqual(calls.at(-1), 'hd1080', 'Highest picks top available');

  // Open menu, pick 720p
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  const menu = document.getElementById('yqx-menu');
  assert.ok(menu.classList.contains('yqx-open'), 'menu opens');
  assert.strictEqual(menu.querySelectorAll('[role=menuitemradio]').length, 10, '10 options');
  assert.ok(menu.querySelector('[data-q=hd1440]').classList.contains('yqx-unavailable'), '1440p marked unavailable');
  menu.querySelector('[data-q=hd720]').click();
  assert.ok(!menu.classList.contains('yqx-open'), 'menu closes after choice');
  assert.strictEqual(btn.textContent, '720p', 'label updates');
  assert.strictEqual(calls.at(-1), 'hd720', 'applied immediately');
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'set', value: 'hd720' }, 'saved via extension');

  // Unavailable pick falls back to best below it
  fromExt('hd2160');
  await wait(50);
  assert.strictEqual(calls.at(-1), 'hd1080', '4K on a 1080p video uses 1080p');
  assert.strictEqual(btn.textContent, '4K');

  // YouTube re-renders its controls -> button comes back, never duplicated
  btn.remove();
  document.querySelector('.ytp-right-controls').append(document.createElement('span'));
  await wait(400);
  assert.strictEqual(document.querySelectorAll('.yqx-button').length, 1, 'exactly one button after re-render');

  // Next video gets the preference automatically
  videoId = 'vid2'; levels = ['hd720', 'large', 'auto'];
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(50);
  assert.strictEqual(calls.at(-1), 'hd720', 'next video uses best available up to 4K');

  // Ads: wait, then apply
  videoId = 'vid3'; p.classList.add('ad-showing'); const before = calls.length;
  document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(300);
  assert.strictEqual(calls.length, before, 'no change during ad');
  p.classList.remove('ad-showing');
  await wait(350);
  assert.strictEqual(calls.length, before + 1, 'applied after ad');

  // Keyboard: ArrowDown opens and focuses current item, Escape closes
  btn.focus();
  btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.ok(menu.classList.contains('yqx-open'));
  assert.strictEqual(document.activeElement.dataset.q, 'hd2160', 'focus on selected option');
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
