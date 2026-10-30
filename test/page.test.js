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
  pauseVideo: () => { pauses += 1; videoPaused = true; },
  playVideo: () => { plays += 1; }
});
let pauses = 0;
let plays = 0;
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

let vis = 'visible';
let pipEl = null;
Object.defineProperty(document, 'visibilityState', { get: () => vis, configurable: true });
Object.defineProperty(document, 'pictureInPictureElement', { get: () => pipEl, configurable: true });
const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = 'https://www.youtube.com/favicon.ico'; document.head.append(icon);
const titleEl = document.createElement('title'); titleEl.textContent = 'Lo-fi beats - YouTube'; document.head.append(titleEl);
// jsdom events are never "trusted"; let a click/key with detail 7 stand in for the user, and keep detail 0 (Resolute's own click) untrusted.
const pageSrc = fs.readFileSync(path.join(__dirname, '..', 'page.js'), 'utf8');
const patchedSrc = pageSrc.replace('const fromUser = (e) => e.isTrusted;', 'const fromUser = (e) => e.isTrusted || e.detail === 7;');
assert.notStrictEqual(patchedSrc, pageSrc, 'trust check found for the test');
window.eval(patchedSrc);
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

  // ---------- autoplay control: "Videos I open" and "Next in queue or playlist" ----------
  const startsPlaying = async (vid) => {
    videoId = vid; videoPaused = false;
    videoEl.dispatchEvent(new window.Event('playing'));
    await wait(20);
  };
  const ends = () => videoEl.dispatchEvent(new window.Event('ended'));
  const both = (opened, next) => toPage('autoplay', { opened, next });
  let before3 = pauses;
  await startsPlaying('ap0');
  assert.strictEqual(pauses, before3, 'both off: autoplay left alone');
  both(true, true);
  await startsPlaying('ap0');
  assert.strictEqual(pauses, before3, 'switching on never pauses the video already playing');
  await wait(1050);
  await startsPlaying('ap1');
  assert.strictEqual(pauses, before3 + 1, 'opened video that starts by itself is paused');
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
  assert.strictEqual(pauses, before3 + 3, 'the real video after the ad starts paused');

  // Independent settings: "next" = previous video ended and no click/key since
  both(true, false);
  ends(); await startsPlaying('nx1');
  assert.strictEqual(pauses, before3 + 3, 'only "Videos I open" on: next video in a playlist plays');
  ends(); document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await startsPlaying('nx2');
  assert.strictEqual(pauses, before3 + 4, 'after the end you clicked another video: that is "opened" -> paused');
  both(false, true);
  ends(); await startsPlaying('nx3');
  assert.strictEqual(pauses, before3 + 5, 'only "Next" on: the video that follows starts paused');
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await startsPlaying('nx4');
  assert.strictEqual(pauses, before3 + 5, 'only "Next" on: a video you open plays');
  both(false, false);
  ends(); await startsPlaying('nx5');
  assert.strictEqual(pauses, before3 + 5, 'both off: everything autoplays again');
  videoPaused = true;

  // The unfolding split button beside the search box
  const ap = document.getElementById('yqx-autoplay');
  const apm = document.getElementById('yqx-apm');
  assert.ok(ap && apm, 'button and menu added');
  assert.strictEqual(ap.previousElementSibling.id, 'voice-search-button', 'sits right after the mic button');
  const lead = ap.querySelector('.yqx-au-lead');
  const trail = ap.querySelector('.yqx-au-trail');
  assert.strictEqual(ap.dataset.level, '0');
  assert.match(ap.querySelector('.yqx-ms-shape').style.clipPath, /^polygon\(/, 'shape drawn as a morphable polygon');
  assert.strictEqual(lead.querySelector('.yqx-in').textContent, 'Autoplay', 'label says the state');
  // unfold on hover
  ap.dispatchEvent(new window.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  assert.ok(ap.classList.contains('yqx-open'), 'unfolds when pointed at');
  assert.strictEqual(trail.tabIndex, 0, 'chevron reachable once unfolded');
  // shape/words: one click switches both
  lead.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.deepStrictEqual(sent.at(-1), { source: 'yqx-page', type: 'autoplay', value: { opened: true, next: true } }, 'shape click pauses all');
  assert.strictEqual(ap.dataset.level, '2', 'both on = solid');
  assert.strictEqual(lead.querySelector('.yqx-in').textContent, 'No autoplay', 'label rolls to the new state');
  assert.match(lead.getAttribute('aria-label'), /Videos wait for you/);
  await startsPlaying('ap7');
  assert.strictEqual(pauses, before3 + 6, 'works immediately');
  // 1A: the button says the video is waiting, until it plays (any way)
  assert.ok(ap.classList.contains('yqx-held'), 'held video: button shows it');
  assert.strictEqual(lead.querySelector('.yqx-in').textContent, 'Video waiting');
  assert.ok(ap.classList.contains('yqx-open'), 'unfolds on its own');
  assert.strictEqual(ap.querySelector('.yqx-au-go').tabIndex, 0, 'Play segment reachable');
  const playsBefore = plays;
  ap.querySelector('.yqx-au-go').click();
  assert.strictEqual(plays, playsBefore + 1, 'Play segment plays the video');
  lead.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.strictEqual(plays, playsBefore + 2, 'while waiting, the shape plays too (no settings change)');
  assert.deepStrictEqual(sent.at(-1).value, { opened: true, next: true }, 'settings untouched while waiting');
  // the user presses Space / the player's button instead: the video just starts playing
  videoPaused = false; videoEl.dispatchEvent(new window.Event('playing')); await wait(20);
  assert.ok(!ap.classList.contains('yqx-held'), 'any play releases the button');
  assert.strictEqual(lead.querySelector('.yqx-in').textContent, 'Playing', 'says Playing once');
  assert.strictEqual(pauses, before3 + 6, 'a play you start is never undone');
  await wait(1500);
  assert.strictEqual(lead.querySelector('.yqx-in').textContent, 'No autoplay', 'then back to the setting');
  videoPaused = true; videoEl.dispatchEvent(new window.Event('pause'));
  videoPaused = false; videoEl.dispatchEvent(new window.Event('playing')); await wait(20);
  assert.ok(!ap.classList.contains('yqx-held') && lead.querySelector('.yqx-in').textContent === 'No autoplay', 'your own pause/play stays quiet');
  // held, then you open a different video yourself: nothing to explain
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })); await wait(1050);
  await startsPlaying('ap8');
  assert.ok(ap.classList.contains('yqx-held'));
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  await startsPlaying('ap9');
  assert.ok(!ap.classList.contains('yqx-held') && lead.querySelector('.yqx-in').textContent !== 'Playing', 'a different video clears it silently');
  ap.dispatchEvent(new window.PointerEvent('pointerleave', { pointerType: 'mouse' }));
  await wait(1500);
  lead.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.deepStrictEqual(sent.at(-1).value, { opened: false, next: false }, 'not waiting: click allows autoplay again');
  // chevron: menu with a switch per setting
  trail.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.ok(apm.classList.contains('yqx-show'), 'chevron opens the menu');
  assert.strictEqual(trail.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(apm.querySelectorAll('[role=menuitemcheckbox]').length, 2, 'two switches');
  apm.querySelector('.yqx-apm-row-opened').click();
  assert.deepStrictEqual(sent.at(-1).value, { opened: true, next: false }, 'saves "Videos I open" alone');
  assert.strictEqual(ap.dataset.level, '1', 'one on = soft tint');
  assert.strictEqual(lead.querySelector('.yqx-in').textContent, 'Opened wait');
  assert.ok(apm.classList.contains('yqx-show'), 'menu stays open after a switch');
  const rowNext = apm.querySelector('.yqx-apm-row-next');
  rowNext.focus();
  rowNext.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.strictEqual(ap.dataset.next, 'true', 'Space toggles the focused switch');
  rowNext.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!apm.classList.contains('yqx-show'), 'Escape closes');
  assert.strictEqual(document.activeElement, trail, 'focus back on the chevron');
  trail.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  assert.ok(!apm.classList.contains('yqx-show'), 'outside click closes');
  trail.blur();
  ap.dispatchEvent(new window.PointerEvent('pointerleave', { pointerType: 'mouse' }));
  await wait(20);
  assert.ok(!ap.classList.contains('yqx-open'), 'folds back when the pointer leaves');
  both(false, false); // changed in the popup
  assert.strictEqual(ap.dataset.level, '0', 'follows the popup');
  assert.strictEqual(apm.querySelector('.yqx-apm-row-opened').getAttribute('aria-checked'), 'false');
  ap.remove(); await wait(400);
  assert.strictEqual(document.querySelectorAll('#yqx-autoplay').length, 1, 'comes back once if YouTube re-renders the bar');

  // ---------- background saver (5A) ----------
  videoPaused = false; playing = 'hd1080'; levels = ['hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];
  fromExt('highest'); await wait(50);
  videoId = 'bg1'; document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(80);
  const hide = (h) => { vis = h ? 'hidden' : 'visible'; document.dispatchEvent(new window.Event('visibilitychange')); };
  const savedMsgs = () => sent.filter((m) => m.type === 'saved');
  hide(true); await wait(150);
  assert.strictEqual(playing, 'hd1080', 'saver off by default: nothing changes');
  hide(false);
  toPage('saver', { on: true, after: 0.1, to: 'tiny' });
  hide(true); await wait(60);
  assert.strictEqual(playing, 'hd1080', 'waits for the delay');
  await wait(120);
  assert.strictEqual(playing, 'tiny', 'hidden + playing: drops to the lowest');
  assert.ok(document.title.startsWith('144p · '), 'tab title shows it');
  assert.strictEqual(sent.filter((x) => x.type === 'saverOn' && x.label === '144p').length, 1, 'asks for the "it is running" notification once');
  const icons = () => [...document.querySelectorAll('link[rel~="icon"]')];
  assert.ok(icons().length === 1 && icons()[0].href.startsWith('data:image/svg+xml') && icons()[0].type === 'image/svg+xml', 'tab icon: only the leaf icon while saving');
  assert.ok(!icon.isConnected, "YouTube's own icon is taken out (not edited in place)");
  titleEl.textContent = 'Next video - YouTube'; await wait(20);
  assert.ok(document.title.startsWith('144p · '), 'title prefix survives YouTube renaming the tab');
  videoId = 'bg2'; document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(80);
  assert.strictEqual(playing, 'tiny', 'next playlist video while away stays low');
  const before5 = savedMsgs().length;
  await wait(200);
  hide(false); await wait(80);
  assert.strictEqual(playing, 'hd1080', 'back on the tab: quality restored');
  assert.strictEqual(document.title, 'Next video - YouTube', 'title restored');
  assert.strictEqual(sent.filter((x) => x.type === 'saverOff').length, 1, 'notification cleared on return');
  assert.ok(icon.isConnected && icons().length === 1 && icons()[0] === icon && icon.href === 'https://www.youtube.com/favicon.ico', "YouTube's own icon put back, untouched");
  assert.strictEqual(savedMsgs().length, before5, 'a run under 1 second is too short to report');
  hide(true); await wait(1300);
  videoPaused = true; videoEl.dispatchEvent(new window.Event('pause')); await wait(500); // paused time isn't counted
  videoPaused = false; hide(false); await wait(50);
  const m = savedMsgs().at(-1);
  assert.ok(m && m.mb >= 0.5 && m.mb < 1, `estimate counts playing time only (${m && m.mb} MB)`);
  assert.ok(m.from === 'hd1080' && m.to === 'tiny' && m.secs === 1, 'reports what really happened, for the popup');
  // PiP: never lowered, and lowering stops if you enter PiP
  pipEl = videoEl; hide(true); await wait(200);
  assert.strictEqual(playing, 'hd1080', 'in picture-in-picture: never lowered');
  assert.ok(!document.title.startsWith('144p'), 'and the tab says nothing');
  hide(false); pipEl = null;
  hide(true); await wait(200);
  assert.strictEqual(playing, 'tiny');
  document.dispatchEvent(new window.Event('enterpictureinpicture')); await wait(80);
  assert.strictEqual(playing, 'hd1080', 'entering PiP restores at once');
  hide(false);
  const skips = () => sent.filter((x) => x.type === 'saverSkip').map((x) => x.reason);
  // hidden tab stops reporting a quality (Chromium may stop decoding the picture): still lowered
  playing = 'unknown'; hide(true); playing = 'unknown'; await wait(200);
  assert.strictEqual(playing, 'tiny', 'quality unknown while hidden: uses the one you left at');
  hide(false); await wait(50); playing = 'hd1080';
  // came back before the delay
  toPage('saver', { on: true, after: 0.3, to: 'tiny' });
  hide(true); await wait(80); hide(false); await wait(20);
  assert.strictEqual(skips().at(-1), 'back-early', 'says you came back too early');
  toPage('saver', { on: true, after: 0.1, to: 'tiny' });
  pipEl = videoEl; hide(true); await wait(200); hide(false); pipEl = null;
  assert.strictEqual(skips().at(-1), 'pip', 'says it was in picture-in-picture');
  // 480p option, paused video, setting off
  toPage('saver', { on: true, after: 0.1, to: 'large' });
  hide(true); await wait(200);
  assert.strictEqual(playing, 'large', '"Drop to 480p" uses 480p');
  hide(false); await wait(50);
  videoPaused = true; hide(true); await wait(200);
  assert.strictEqual(playing, 'hd1080', 'a paused video uses no data: left alone');
  assert.strictEqual(skips().at(-1), 'paused', 'says it was paused');
  hide(false); await wait(20); videoEl.muted = true; hide(true); await wait(200);
  assert.strictEqual(skips().at(-1), 'muted', 'muted + paused: says the browser paused it'); videoEl.muted = false;
  hide(false); videoPaused = false;
  // Vivaldi: the page stays "visible", but the browser says another tab is selected
  toPage('saver', { on: true, after: 0.1, to: 'tiny' }); await wait(20);
  toPage('tabActive', false); await wait(1800);
  assert.strictEqual(playing, 'hd1080', 'another tab selected but still drawn (split or tiled next to it): left alone');
  const rafReal = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0; // Vivaldi stops drawing a background tab
  toPage('tabActive', false); await wait(300);
  assert.strictEqual(playing, 'hd1080', 'still checking: nothing yet');
  await wait(1500);
  assert.strictEqual(playing, 'tiny', 'another tab selected and no longer drawn (page still "visible"): lowered');
  const offs = sent.filter((x) => x.type === 'saverOff').length;
  toPage('tabActive', false); await wait(50); // you move between other tabs
  assert.strictEqual(playing, 'tiny', 'switching between other tabs is not coming back');
  await wait(1700);
  assert.strictEqual(playing, 'tiny', 'still low after the re-check');
  assert.strictEqual(sent.filter((x) => x.type === 'saverOff').length, offs, 'notification not cleared');
  hide(true); await wait(200); hide(false); await wait(20);
  assert.strictEqual(playing, 'tiny', 'a "visible" blip alone is not coming back while another tab is selected');
  toPage('tabActive', true); await wait(80);
  assert.strictEqual(playing, 'hd1080', 'tab selected again: restored');
  window.requestAnimationFrame = rafReal;
  toPage('saver', { on: false, after: 0.1, to: 'tiny' });
  hide(true); await wait(200);
  assert.strictEqual(playing, 'hd1080', 'switched off: left alone');
  hide(false);
  videoPaused = true;

  // Hide live chat: YouTube's close button, once per video; "Show chat" then stays open
  window.history.pushState({}, '', '/watch?v=live1');
  const chatFrame = document.createElement('ytd-live-chat-frame');
  chatFrame.innerHTML = '<iframe id="chatframe"></iframe>';
  document.body.append(chatFrame);
  const chatDoc = chatFrame.querySelector('iframe').contentDocument;
  let closes = 0;
  chatDoc.body.innerHTML = '<yt-live-chat-header-renderer><div id="close-button"><button></button></div></yt-live-chat-header-renderer>';
  chatDoc.querySelector('button').addEventListener('click', () => { closes += 1; });
  window.dispatchEvent(new window.Event('resize')); await wait(700);
  assert.strictEqual(closes, 0, 'off by default: chat left alone');
  toPage('chat', true); await wait(700);
  assert.strictEqual(closes, 0, 'waits until the chat has drawn');
  chatDoc.body.insertAdjacentHTML('beforeend', '<yt-live-chat-item-list-renderer><div id="items"><div id="m1"></div></div></yt-live-chat-item-list-renderer>');
  await wait(700);
  assert.strictEqual(closes, 1, 'chat closed once it is ready');
  document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(1200);
  assert.strictEqual(closes, 1, 'never closed again for the same video (Show chat stays open)');
  window.history.pushState({}, '', '/watch?v=live2');
  document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(700);
  assert.strictEqual(closes, 2, 'next stream: closed again');
  toPage('chat', false);
  window.history.pushState({}, '', '/watch?v=live3');
  document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(700);
  assert.strictEqual(closes, 2, 'switched off: chat left alone');
  chatFrame.remove();
  window.history.pushState({}, '', '/watch?v=vid1');

  // Hide the top bar while a video plays: away on play, back on pause / pointer / focus / menu
  {
    const holder = document.createElement('div');
    holder.innerHTML = '<div id="masthead-container"><ytd-masthead><input id="srch" role="combobox" aria-expanded="true"><button id="acct" aria-expanded="false"></button></ytd-masthead></div><div id="page-manager"></div>';
    document.body.append(holder);
    const root = document.documentElement;
    const was = videoPaused;
    const evt = (el, type) => el.dispatchEvent(new window.Event(type));
    const gone = () => root.hasAttribute('yqx-bar-gone');
    videoPaused = false;
    await wait(50);
    assert.ok(!root.hasAttribute('yqx-bar') && !gone(), 'off by default: nothing changes');
    toPage('topbar', true); await wait(50);
    assert.ok(root.hasAttribute('yqx-bar') && gone(), 'switched on and playing: the bar is away');
    assert.ok(document.getElementById('yqx-bar-style').textContent.includes('#page-manager'), 'styles are added once the bar is managed');
    videoPaused = true; evt(videoEl, 'pause'); await wait(20);
    assert.ok(!gone(), 'paused: the bar comes back');
    videoPaused = false; evt(videoEl, 'playing'); await wait(20);
    assert.ok(gone(), 'playing again: away again');
    const zone = document.getElementById('yqx-bar-zone');
    evt(zone, 'pointerenter'); await wait(20);
    assert.ok(!gone(), 'pointer on the top edge: the bar comes back');
    evt(zone, 'pointerleave'); await wait(300);
    assert.ok(!gone(), 'a quick slip off the edge does not hide it');
    await wait(500);
    assert.ok(gone(), 'pointer left for good: away again');
    const search = document.getElementById('srch');
    search.focus(); await wait(30);
    assert.ok(!gone(), 'search focused ("/" or click): the bar stays');
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30);
    assert.ok(gone(), 'Escape in the search box lets the bar go');
    evt(zone, 'pointerenter'); search.focus(); await wait(30);
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30);
    assert.ok(gone(), 'Escape also drops a pointer hold: the bar goes at once');
    const acct = document.getElementById('acct');
    acct.setAttribute('aria-expanded', 'true'); evt(zone, 'pointerenter'); evt(zone, 'pointerleave'); await wait(1300);
    assert.ok(!gone(), 'a menu from the bar is open: it stays');
    acct.setAttribute('aria-expanded', 'false'); await wait(1300);
    assert.ok(gone(), 'menu closed: away again');
    Object.defineProperty(document, 'fullscreenElement', { get: () => videoEl, configurable: true });
    evt(document, 'fullscreenchange'); await wait(20);
    assert.ok(!gone(), 'fullscreen: left to YouTube');
    delete document.fullscreenElement;
    evt(document, 'fullscreenchange'); await wait(20);
    assert.ok(gone(), 'out of fullscreen: away again');
    window.history.pushState({}, '', '/feed/subscriptions');
    document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(20);
    assert.ok(!root.hasAttribute('yqx-bar') && !gone(), 'other pages: the bar is always there');
    window.history.pushState({}, '', '/watch?v=vid1');
    document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(20);
    assert.ok(gone(), 'back on a watch page: away while playing');
    toPage('topbar', false); await wait(20);
    assert.ok(!root.hasAttribute('yqx-bar') && !gone(), 'switched off: the bar returns');
    holder.remove(); videoPaused = was;
  }

  // Cinema mode: theater on open, bar away, learns from your own theater toggles
  {
    const fx = document.createElement('ytd-watch-flexy');
    const holder = document.createElement('div');
    holder.innerHTML = '<div id="masthead-container"><ytd-masthead></ytd-masthead></div><div id="page-manager"></div>';
    document.body.append(fx, holder);
    const btn = document.createElement('button'); btn.className = 'ytp-size-button';
    document.getElementById('movie_player').append(btn);
    let presses = 0;
    btn.addEventListener('click', () => { presses += 1; fx.toggleAttribute('theater'); }); // YouTube flips theater
    const root = document.documentElement;
    const was = videoPaused;
    const evt = (el, type) => el.dispatchEvent(new window.Event(type));
    const userClick = () => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 7 }));
    const skips = () => sent.filter((m) => m.type === 'cinemaSkip');
    videoPaused = true; // not playing yet, so the bar logic stays out of the way
    toPage('cinemaSkip', {}); await wait(700);
    assert.strictEqual(presses, 0, 'off by default: theater left alone');
    toPage('cinema', true); await wait(900);
    assert.strictEqual(presses, 1, 'opens in theater with YouTube\'s own button');
    assert.ok(fx.hasAttribute('theater') && root.hasAttribute('yqx-cin'), 'cinema is active once theater is on');
    await wait(700);
    assert.strictEqual(presses, 1, 'once per video');
    videoPaused = false; evt(videoEl, 'playing'); await wait(30);
    assert.ok(root.hasAttribute('yqx-bar-gone'), 'the bar goes away while it plays');
    videoPaused = true; evt(videoEl, 'pause'); await wait(30);
    assert.ok(!root.hasAttribute('yqx-bar-gone'), 'and comes back on pause');
    assert.strictEqual(skips().length, 0, 'its own click is never taken for yours');
    userClick(); await wait(700);
    assert.ok(!fx.hasAttribute('theater') && !root.hasAttribute('yqx-cin'), 'you leave theater: cinema ends with it');
    assert.deepStrictEqual(skips().map((m) => m.on), [true], 'leaving theater teaches it: this channel stays normal');
    videoId = 'vidB';
    window.history.pushState({}, '', '/watch?v=vidB');
    document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(900);
    assert.strictEqual(presses, 2, 'the next video of that channel stays normal');
    userClick(); await wait(700);
    assert.ok(fx.hasAttribute('theater'), 'you go back into theater');
    assert.deepStrictEqual(skips().map((m) => m.on), [true, false], 'going back into theater undoes it');
    videoId = 'vidC';
    window.history.pushState({}, '', '/watch?v=vidC');
    fx.removeAttribute('theater');
    document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(900);
    assert.ok(fx.hasAttribute('theater'), 'the channel opens in theater again');
    toPage('cinemaSkip', { [UC('z')]: 'Other' });
    videoId = 'vidD';
    window.history.pushState({}, '', '/watch?v=vidD');
    fx.removeAttribute('theater');
    document.dispatchEvent(new window.Event('yt-navigate-finish')); await wait(900);
    assert.ok(!fx.hasAttribute('theater'), 'a channel saved as "stays normal" is left alone');
    toPage('cinema', false); await wait(50);
    assert.ok(!root.hasAttribute('yqx-cin'), 'switched off: nothing is forced');
    videoId = 'vid1';
    window.history.pushState({}, '', '/watch?v=vid1');
    toPage('cinemaSkip', {});
    fx.remove(); holder.remove(); btn.remove(); videoPaused = was;
  }

  // ---------- time left at your speed ----------
  {
    const outer = document.createElement('div'); outer.className = 'ytp-time-display';
    const disp = document.createElement('div'); disp.className = 'ytp-time-contents'; // real YouTube: display > wrapper > contents
    disp.innerHTML = '<span class="ytp-time-current">2:07</span> / <span class="ytp-time-duration">10:34</span>';
    outer.append(disp);
    p.querySelector('.ytp-chrome-bottom').prepend(outer);
    let dur = 634, cur = 127, rate = 1.5, adOn = false, live = false;
    Object.defineProperty(videoEl, 'duration', { get: () => dur, configurable: true });
    Object.defineProperty(videoEl, 'currentTime', { get: () => cur, configurable: true });
    Object.defineProperty(videoEl, 'playbackRate', { get: () => rate, configurable: true });
    Object.defineProperty(p, 'clientWidth', { get: () => 900, configurable: true });
    p.getVideoData = () => ({ video_id: videoId, isLive: live });
    const tick = async () => { videoEl.dispatchEvent(new window.Event('timeupdate')); await wait(10); };
    const box = () => disp.querySelector('.yqx-left');
    videoPaused = false; vis = 'visible';
    await tick();
    assert.strictEqual(box().textContent, '· 5:38 left 1.5×', 'player: real time left at 1.5x (507s / 1.5 = 338s)');
    rate = 1; await tick();
    assert.strictEqual(box().textContent, '· 8:27 left', 'at 1x: no speed tag, always shown');
    rate = 2; cur = 600; await tick();
    assert.strictEqual(box().textContent, '· 0:17 left 2×', 'follows the speed');
    adOn = true; p.classList.add('ad-showing'); await tick();
    assert.ok(box().hidden, 'hidden during an ad'); p.classList.remove('ad-showing');
    live = true; await tick(); assert.ok(box().hidden, 'hidden for live streams'); live = false;
    dur = Infinity; await tick(); assert.ok(box().hidden, 'hidden when the length is unknown'); dur = 634;
    Object.defineProperty(p, 'clientWidth', { get: () => 400, configurable: true }); await tick();
    assert.ok(box().hidden, 'hidden in a small player'); Object.defineProperty(p, 'clientWidth', { get: () => 900, configurable: true });
    box().remove(); await tick(); assert.strictEqual(disp.querySelectorAll('.yqx-left').length, 1, 'comes back once if YouTube rebuilds the time display');
    // tab: only while away
    cur = 127; rate = 1.5; await tick();
    assert.ok(!/⏱/.test(document.title), 'on the tab: title untouched');
    vis = 'hidden'; document.dispatchEvent(new window.Event('visibilitychange')); await wait(20);
    assert.ok(document.title.startsWith('⏱ 6m · Next video'), `away: "⏱ 6m · title" (got ${document.title})`);
    assert.ok(icons().length === 1 && icons()[0] === icon, "no saver: YouTube's icon stays");
    rate = 1; await tick(); assert.ok(document.title.startsWith('⏱ 9m · '), 'speed change updates the tab');
    videoPaused = true; await tick(); assert.ok(document.title.startsWith('⏱ 9m · '), 'paused: the clock stays');
    videoPaused = false; await tick();
    toPage('tabicons', false); await wait(20);
    assert.ok(document.title.startsWith('9m · Next video'), 'icons off: just the time');
    videoPaused = true; await tick(); assert.ok(document.title.startsWith('9m · '), 'icons off + paused: still just the time');
    toPage('tabicons', true); videoPaused = false; await tick();
    assert.ok(document.title.startsWith('⏱ 9m · '), 'icons back on');
    videoPaused = false; cur = 580; rate = 1; await tick(); assert.ok(document.title.startsWith('⏱ 54s · '), 'under a minute: seconds');
    dur = 8000; cur = 0; await tick(); assert.ok(document.title.startsWith('⏱ 2h 14m · '), 'hours');
    dur = 634; cur = 127; rate = 1.5; await tick();
    titleEl.textContent = 'Next - YouTube'; await wait(20);
    assert.ok(document.title.startsWith('⏱ 6m · Next'), 'survives YouTube renaming the tab');
    vis = 'visible'; document.dispatchEvent(new window.Event('visibilitychange')); await wait(20);
    assert.strictEqual(document.title, 'Next - YouTube', 'back: title restored');
    toPage('tabActive', false); await wait(20);
    assert.ok(document.title.startsWith('⏱ 6m · Next'), 'another tab selected: countdown shows at once, without waiting for the drawn check');
    toPage('tabActive', true); await wait(20);
    assert.strictEqual(document.title, 'Next - YouTube', 'selected again: gone at once');
    // together with the background saver
    toPage('saver', { on: true, after: 0.1, to: 'tiny' }); playing = 'hd1080';
    vis = 'hidden'; document.dispatchEvent(new window.Event('visibilitychange')); await wait(350);
    assert.ok(document.title.startsWith('144p · ⏱ 6m · Next'), `saver + time: "144p · ⏱ 6m · title" (got ${document.title})`);
    assert.ok(icons().length === 1 && icons()[0].href.startsWith('data:image/svg+xml'), 'saver keeps its leaf icon');
    cur = 400; await tick(); assert.ok(document.title.startsWith('144p · ⏱ 3m · '), 'time keeps counting while saver runs');
    assert.strictEqual(icons().length, 1, 'still one icon');
    vis = 'visible'; document.dispatchEvent(new window.Event('visibilitychange')); await wait(80);
    assert.strictEqual(document.title, 'Next - YouTube', 'back: both gone');
    assert.ok(icon.isConnected && icons().length === 1 && icons()[0] === icon, "YouTube's icon is back");
    toPage('saver', { on: false, after: 0.1, to: 'tiny' });
    outer.remove(); delete videoEl.duration; delete videoEl.currentTime; delete videoEl.playbackRate; delete p.clientWidth; await wait(20);
  }

  // No toolbar at all -> floating fallback
  document.querySelector('.ytp-chrome-bottom').remove();
  await wait(400);
  assert.ok(document.querySelector('.yqx-button').classList.contains('yqx-floating'), 'floating fallback');

  // ---- resume: go back to where you stopped ----
  {
    let curT = 0, dur = 600, live = false;
    const seeks = [];
    Object.assign(p, {
      getCurrentTime: () => curT, getDuration: () => dur,
      seekTo: (t) => { seeks.push(t); curT = t; },
      getVideoData: () => ({ video_id: videoId, isLive: live })
    });
    const spotsSent = () => sent.filter((m) => m.type === 'spot');
    const pill = () => document.getElementById('yqx-resume');
    const open = async (id, at = 0) => { // a new video starts
      document.dispatchEvent(new window.Event('yt-navigate-start'));
      videoId = id; curT = at; seeks.length = 0; sent.length = 0;
      videoEl.dispatchEvent(new window.Event('playing'));
      await wait(560);
    };
    const tickTime = async (t) => { curT = t; videoEl.dispatchEvent(new window.Event('timeupdate')); await wait(5); };
    const hourAgo = Date.now() - 30 * 60e3; // under an hour: smart rewind = 2 s
    toPage('resumeRules', { includeLive: true, skipStart: true, endFinished: true, skipShort: true });
    toPage('resumeRewind', 'smart');
    toPage('spots', { resume0001: { t: 300, at: hourAgo }, shortvid01: { t: 100, at: hourAgo }, livevid001: { t: 500, at: hourAgo }, doneVid001: { t: 400, at: hourAgo } });
    await wait(20);

    await open('resume0001');
    assert.deepStrictEqual(seeks, [298], 'jumps to the saved spot, 2 s back (smart, away under an hour)');
    assert.ok(pill() && pill().textContent.includes('Resumed at 4:58') && pill().querySelector('button'), 'shows the pill with Start over');
    await tickTime(298.5); await tickTime(299.5);
    assert.strictEqual(spotsSent().length, 0, 'the jump itself is not saved over your spot');
    await tickTime(310);
    assert.strictEqual(spotsSent().length, 1, 'real progress is saved');
    await tickTime(312);
    assert.strictEqual(spotsSent().length, 1, 'but not more than every 5 seconds');
    pill().querySelector('button').click(); await wait(10);
    assert.strictEqual(seeks[seeks.length - 1], 0, 'Start over goes to 0:00');
    assert.ok(pill().textContent.includes('Back at the start') && !pill().querySelector('button'), 'confirms, no button');
    await wait(1500);
    assert.ok(!pill() || !pill().classList.contains('yqx-on'), 'pill fades away');

    // rewind modes (the spot above moved on with your progress; put it back)
    toPage('spots', { resume0001: { t: 300, at: hourAgo } });
    toPage('resumeRewind', 'off'); await open('resume0001'); assert.deepStrictEqual(seeks, [300], 'Exact: no rewind');
    toPage('resumeRewind', '5'); await open('resume0001'); assert.deepStrictEqual(seeks, [295], '5 seconds');
    toPage('resumeRewind', 'smart');
    toPage('spots', { resume0001: { t: 300, at: Date.now() - 3 * 86400e3 } }); await open('resume0001'); assert.deepStrictEqual(seeks, [295], 'smart: days away = 5 s');
    toPage('spots', { resume0001: { t: 300, at: Date.now() - 30 * 86400e3 } }); await open('resume0001'); assert.deepStrictEqual(seeks, [290], 'smart: weeks away = 10 s');

    // reasons to leave it alone
    toPage('spots', { resume0001: { t: 300, at: hourAgo }, shortvid01: { t: 100, at: hourAgo }, livevid001: { t: 500, at: hourAgo } });
    dur = 120; await open('shortvid01'); assert.deepStrictEqual(seeks, [], 'videos under 3 min are left alone'); dur = 600;
    toPage('resumeRules', { skipShort: false }); dur = 120; await open('shortvid01'); assert.deepStrictEqual(seeks, [98], 'short videos resume when that switch is off'); dur = 600;
    toPage('resumeRules', { includeLive: false }); live = true; await open('livevid001'); assert.deepStrictEqual(seeks, [], 'live streams skipped when the switch is off');
    toPage('resumeRules', { includeLive: true }); await open('livevid001'); assert.deepStrictEqual(seeks, [498], 'live streams resume when on'); live = false;
    await open('resume0001', 298); assert.deepStrictEqual(seeks, [], 'YouTube already resumed it: no second jump');
    window.history.pushState({}, '', '/watch?v=resume0001&t=45'); await open('resume0001'); assert.deepStrictEqual(seeks, [], 'a link with its own time wins');
    window.history.pushState({}, '', '/shorts/resume0001'); await open('resume0001'); assert.deepStrictEqual(seeks, [], 'Shorts never resume');
    await tickTime(50); await tickTime(60); assert.strictEqual(spotsSent().length, 0, 'Shorts are never saved');
    window.history.pushState({}, '', '/watch?v=vid1');
    p.classList.add('ad-showing'); await open('resume0001'); assert.deepStrictEqual(seeks, [], 'waits out ads'); p.classList.remove('ad-showing');

    // saving rules
    toPage('resumeRules', { skipStart: true, endFinished: true, skipShort: true, includeLive: true });
    await open('fresh000001');
    await tickTime(4); assert.strictEqual(spotsSent().length, 0, 'first 10 seconds are not saved');
    await tickTime(30); assert.strictEqual(spotsSent().length, 1, 'then it is');
    sent.length = 0; await tickTime(585);
    assert.ok(sent.some((m) => m.type === 'spotClear' && m.videoId === 'fresh000001'), 'last 30 seconds = finished, spot cleared');
    sent.length = 0; videoEl.dispatchEvent(new window.Event('pause')); assert.strictEqual(spotsSent().length, 0, 'finished video is not saved again on pause');
    await open('fresh000002'); await tickTime(100); sent.length = 0; curT = 130;
    videoEl.dispatchEvent(new window.Event('pause')); assert.strictEqual(spotsSent().length, 1, 'pausing saves at once');
    sent.length = 0; videoEl.dispatchEvent(new window.Event('ended')); assert.ok(sent.some((m) => m.type === 'spotClear' && m.videoId === 'fresh000002'), 'a video that ends starts fresh next time');
    await open('fresh000003'); toPage('resumeRules', { skipStart: false }); await tickTime(3); assert.strictEqual(spotsSent().length, 1, 'ignore-first-10-s off: saves right away');
    toPage('resumeRules', { skipStart: true });
    await open('fresh000004'); document.dispatchEvent(new window.Event('visibilitychange')); // still visible: nothing
    await tickTime(40); sent.length = 0; curT = 75; vis = 'hidden'; document.dispatchEvent(new window.Event('visibilitychange')); vis = 'visible'; document.dispatchEvent(new window.Event('visibilitychange'));
    assert.strictEqual(spotsSent().length, 1, 'leaving the tab saves');
    document.getElementById('yqx-resume')?.remove();
  }

  console.log('All checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
