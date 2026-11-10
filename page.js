/*
 * Resolute for YouTube — in-player quality button and menu, autoplay control, live chat hiding, background saver.
 *
 * Runs in the page's own JavaScript world ("MAIN" world) because YouTube's
 * player API (methods on #movie_player) is only reachable from there.
 * It never edits YouTube's files; it only adds its own elements and calls
 * the player's public methods. Every player call is wrapped so that if
 * YouTube changes something, playback keeps working and only this button
 * stops working.
 *
 * Which quality a video gets (first match wins):
 *   1. a pick made in the menu for this video right now (not saved)
 *   2. a quality the user chose to remember for this video
 *   3. the default the user saved for this video's channel
 *   4. the default for all videos ("Auto" lets YouTube decide)
 * Saved values live in extension storage; content.js passes them here.
 *
 * Optional autoplay control, two independent settings:
 *   - "Videos I open": a video you open (click, link, new tab) starts paused.
 *   - "Next in queue or playlist": a video that follows another one by itself starts paused.
 * "Next" means the previous video ended and you haven't clicked or typed since.
 * A play you start yourself (click/tap in the player, K, Space, media key) is never undone.
 * When Resolute holds a video, the autoplay button says so ("Video waiting" + Play) until it plays,
 * however you press play.
 *
 * Optional background saver: when the tab is hidden and the video keeps playing (not in
 * picture-in-picture, not an ad), quality drops after a delay and comes back when you return.
 * The tab's title and icon show it while it's on. Savings are an estimate.
 *
 * Optional live chat hiding: when a stream (or a stream replay) opens, its chat panel is closed with
 * YouTube's own close button, once per video. YouTube's "Show chat" brings it back and it stays open.
 *
 * Optional top bar hiding: on a /watch page the bar slides away while the video plays, and the page
 * moves up with it. It comes back on pause, when the pointer is on the top edge or the bar, while the
 * bar has keyboard focus (YouTube's "/" focuses the search box), or while one of its menus is open.
 * Only YouTube's own bar element is moved with CSS; nothing is removed.
 *
 * Optional cinema mode: a video opens in theater (YouTube's own theater button, once per video), the top
 * bar hides while it plays, and the video fills the window at its own shape (never stretched or cropped).
 * Resume: while a video plays its spot is saved every few seconds. Open it again and the player jumps back
 * (a little before the spot, as set in the popup) with a pill: "Resumed at 12:29 · Start over". If YouTube
 * already resumed it, or the link has its own time (t=), nothing happens. Shorts are never saved; live
 * streams, the first 10 s, the last 30 s and videos under 3 minutes follow the switches in the popup.
 * Playback speed: the left half of the quality pill. A speed you pick (chips, slider, scroll on the pill, or
 * YouTube's own controls) sticks to that video; the same speed on 3 videos of a channel offers to keep it for the
 * channel. Order: this video, music at 1×, channel, default. Live goes back to 1× at live; Shorts are never touched.
 * Leaving theater yourself teaches it: that channel's videos stay normal next time; going back into
 * theater there undoes that. Your own clicks and the T key count; Resolute's own click never does.
 * Optional ambient glow (/watch only): the picture's colours glow under the player and fill its black bars (bars
 * of the window and bars inside the video itself; nothing is cropped). It follows cuts fast, ignores 1-2 frame
 * flashes, draws less often when drawing gets slow, rests on still pictures, dims while paused, stays off during
 * ads, and tints the quality pill and autoplay button. It replaces YouTube's own ambient mode while it's on.
 */
(() => {
  'use strict';
  if (window.__yqxPageLoaded) return; // never run twice in the same frame
  window.__yqxPageLoaded = true;

  const FROM_PAGE = 'yqx-page';
  const FROM_EXT = 'yqx-ext';
  const DEFAULT_PREF = 'highest';

  // Menu options, in the requested order. ids are YouTube's quality names.
  const OPTIONS = [
    { id: 'auto', label: 'Auto', short: 'Auto' },
    { id: 'highest', label: 'Highest available', short: 'Max' },
    { id: 'tiny', label: '144p', short: '144p' },
    { id: 'small', label: '240p', short: '240p' },
    { id: 'medium', label: '360p', short: '360p' },
    { id: 'large', label: '480p', short: '480p' },
    { id: 'hd720', label: '720p', short: '720p' },
    { id: 'hd1080', label: '1080p', short: '1080p' },
    { id: 'hd1440', label: '1440p', short: '1440p' },
    { id: 'hd2160', label: '2160p (4K)', short: '4K' }
  ];
  const VALID = new Set(OPTIONS.map((o) => o.id));
  const HEIGHT = {
    tiny: 144, small: 240, medium: 360, large: 480,
    hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, highres: 4320
  };
  const optionById = (id) => OPTIONS.find((o) => o.id === id) || OPTIONS[1];
  const heightLabel = (q) =>
    q === 'hd2160' ? '2160p (4K)' : q === 'highres' ? '4320p (8K)' : HEIGHT[q] ? `${HEIGHT[q]}p` : '';

  // ---------- state ----------
  let preference = DEFAULT_PREF; // default for all videos
  let prefKnown = false;
  let overrides = {};            // { videoId: quality } remembered on purpose
  let overridesKnown = false;
  let channels = {};             // { UCchannelId: { q, name } } channel defaults
  let channelsKnown = false;
  let temp = null;               // { vid, q } pick for the current video only
  let holdOpened = false;        // "Videos I open" start paused
  let modeNo = 'play';           // video ended, no queue/playlist continues: 'play' | 'wait' | 'stop'
  let modeQ = 'play';            // video ended, a queue/playlist continues: same three
  let autoplayKnown = false;
  let heldVid = '';              // video whose first start was already checked
  let lastPlayGesture = 0;       // time of the user's last play-like input
  let lastInput = 0;             // time of the user's last click/tap/key anywhere (not on our own controls)
  let saver = { on: false, after: 30, to: 'tiny' }; // background saver setting
  let saverTimer = 0;
  let saverActive = null;        // { q, fromQ, ms, t0 } while the saver has lowered quality
  const PIP_KNOWN = 'pictureInPictureElement' in document; // without it the saver can't tell PiP apart, so it stays off
  let endedAt = 0;               // when a video last played to its end
  let endedVid = '';
  let endedQueue = false;        // was a queue/playlist running when it ended
  const channelCache = new Map(); // videoId -> { id, name } once detected
  const renamed = new Set();      // "id|name" pairs whose stored name we already refreshed
  let flashTimer = 0;
  let lastApplied = '';   // "videoId|quality" already applied
  let lastVideoId = '';
  let forcedEarlier = false;
  let applyTimer = 0;
  let verifyTimer = 0;
  const hookedPlayers = new WeakSet();
  const ui = {
    btn: null, pill: null, menu: null, list: null, now: null, tip: null,
    items: new Map(), open: false, viaKeyboard: false, keepAlive: 0, tipText: ''
  };

  // ---------- player helpers (all fail-safe) ----------
  function getPlayer() {
    const p = document.getElementById('movie_player');
    return p && typeof p.getAvailableQualityLevels === 'function' ? p : null;
  }
  function call(p, fn, ...args) {
    try {
      return typeof p[fn] === 'function' ? p[fn](...args) : undefined;
    } catch {
      return undefined;
    }
  }
  function videoIdOf(p) {
    const data = call(p, 'getVideoData');
    return (data && data.video_id) || '';
  }
  /** Qualities this video really has, highest first (empty = not known yet). */
  function availableLevels(p) {
    const levels = call(p, 'getAvailableQualityLevels');
    return Array.isArray(levels)
      ? levels.filter((q) => HEIGHT[q]).sort((a, b) => HEIGHT[b] - HEIGHT[a])
      : [];
  }
  function playingLabel(p) {
    const q = call(p, 'getPlaybackQuality');
    if (!q || !HEIGHT[q]) return '';
    const data = call(p, 'getAvailableQualityData'); // gives labels like "1080p60"
    if (Array.isArray(data)) {
      const match = data.find((d) => d && d.quality === q && d.qualityLabel);
      if (match) return String(match.qualityLabel);
    }
    return heightLabel(q);
  }
  /** Which real quality to use for a preference on this video. */
  function resolveTarget(pref, levels) {
    if (!levels.length || pref === 'auto') return '';
    if (pref === 'highest') return levels[0];
    const want = HEIGHT[pref];
    // Not available? Use the best one below it (or the lowest if none is below).
    return levels.find((q) => HEIGHT[q] <= want) || levels[levels.length - 1];
  }
  const ready = () => prefKnown && overridesKnown && channelsKnown;
  const CHANNEL_ID = /^UC[\w-]{22}$/;

  /**
   * The channel of a video, from the player's own data for that exact video.
   * Uses the stable "UC…" channel id, never the display name. Returns null when unsure,
   * so one channel's setting can never be applied to another channel's video.
   */
  function channelFor(p, vid) {
    if (!vid) return null;
    if (channelCache.has(vid)) return channelCache.get(vid);
    const sources = [
      () => p && call(p, 'getPlayerResponse'),
      () => window.ytInitialPlayerResponse // first page load; checked against the video id below
    ];
    for (const get of sources) {
      let details = null;
      try { details = (get() || {}).videoDetails; } catch { details = null; }
      if (details && details.videoId === vid && CHANNEL_ID.test(details.channelId)) {
        const found = { id: details.channelId, name: String(details.author || '').trim().slice(0, 100) };
        if (channelCache.size > 500) channelCache.clear(); // keep memory small on long sessions
        channelCache.set(vid, found);
        return found;
      }
    }
    return null;
  }
  function channelPref(ch) {
    const saved = ch && channels[ch.id];
    return saved && VALID.has(saved.q) ? saved : null;
  }
  function currentVid(p) {
    // During ads YouTube may report the ad's id, so keep the last real video.
    if (!p) return '';
    return p.classList.contains('ad-showing') && lastVideoId ? lastVideoId : videoIdOf(p);
  }
  /** Quality this video should use, and where that choice comes from. */
  function choiceFor(vid) {
    let base;
    const saved = channelPref(channelFor(getPlayer(), vid));
    if (vid && VALID.has(overrides[vid])) base = { q: overrides[vid], from: 'remembered' };
    else if (saved) base = { q: saved.q, from: 'channel' };
    else base = { q: preference, from: 'default' };
    return temp && temp.vid === vid && temp.q !== base.q ? { q: temp.q, from: 'now' } : base;
  }
  function forceQuality(p, q) {
    call(p, 'setPlaybackQualityRange', q, q);
    call(p, 'setPlaybackQuality', q);
  }

  // ---------- applying the preference ----------
  function scheduleApply(force) {
    clearTimeout(applyTimer);
    clearTimeout(verifyTimer);
    let tries = 0;
    let channelTries = 0;

    const attempt = () => {
      const p = getPlayer();
      const vid = p ? videoIdOf(p) : '';
      const levels = p ? availableLevels(p) : [];
      const waiting = !ready() || !p || !vid || !levels.length || p.classList.contains('ad-showing');
      if (waiting) {
        // Wait for the player, the video's quality list, or the end of an ad.
        tries += 1;
        if (tries <= 120) applyTimer = setTimeout(attempt, tries < 20 ? 250 : 1000);
        return;
      }

      // Give the channel id a moment to appear (avoids switching twice: global, then channel),
      // but only when a channel default could actually change the result.
      const ch = channelFor(p, vid);
      const channelMatters = !force && Object.keys(channels).length > 0 &&
        !(temp && temp.vid === vid) && !VALID.has(overrides[vid]);
      if (!ch && channelMatters && channelTries < 8) {
        channelTries += 1;
        applyTimer = setTimeout(attempt, 250);
        return;
      }
      refreshChannelName(ch);

      if (temp && temp.vid !== vid) temp = null; // a pick "for now" ends with its video
      const want = saverActive ? saverActive.q : choiceFor(vid).q;
      const key = `${vid}|${want}`;
      if (!force && key === lastApplied) {
        updateUI();
        return;
      }
      lastApplied = key;
      lastVideoId = vid;

      if (want === 'auto') {
        // Undo a quality we forced earlier (it can carry over to the next video); otherwise YouTube decides.
        if (force || forcedEarlier) forceQuality(p, 'auto');
        forcedEarlier = false;
      } else {
        const target = resolveTarget(want, levels);
        forceQuality(p, target);
        forcedEarlier = true;
        // YouTube sometimes changes quality again just after a video starts.
        verifyTimer = setTimeout(() => {
          const p2 = getPlayer();
          if (p2 && !saverActive && videoIdOf(p2) === vid && call(p2, 'getPlaybackQuality') !== target &&
              availableLevels(p2).includes(target)) {
            forceQuality(p2, target);
          }
          updateUI();
        }, 1500);
      }
      updateUI();
    };
    attempt();
  }

  function checkVideoChange() {
    const p = getPlayer();
    if (!p) return;
    const vid = videoIdOf(p);
    if (vid && vid !== lastVideoId) {
      lastVideoId = vid;
      scheduleApply(false);
    } else if (vid && lastApplied.startsWith(`${vid}|`) && lastApplied !== `${vid}|${choiceFor(vid).q}`) {
      scheduleApply(false); // e.g. the channel id showed up late and has its own default
    }
    updateUI();
  }

  /** Channels can be renamed; keep the stored display name current (id stays the key). */
  function refreshChannelName(ch) {
    const saved = channelPref(ch);
    if (!saved || !ch.name || saved.name === ch.name || renamed.has(`${ch.id}|${ch.name}`)) return;
    renamed.add(`${ch.id}|${ch.name}`); // once per name, so a storage echo can't loop
    channels[ch.id] = { q: saved.q, name: ch.name };
    postToExt({ type: 'channel', channelId: ch.id, value: saved.q, name: ch.name });
  }

  function hookPlayer(p) {
    if (hookedPlayers.has(p)) return;
    hookedPlayers.add(p);
    // YouTube's own player events (the player replaces addEventListener with its API version).
    call(p, 'addEventListener', 'onStateChange', checkVideoChange);
    call(p, 'addEventListener', 'onPlaybackQualityChange', () => updateUI());
    // Close the menu when YouTube hides its controls.
    new MutationObserver(() => {
      if (ui.open && p.classList.contains('ytp-autohide')) closeMenu(false);
    }).observe(p, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------- autoplay control ----------
  const PLAY_KEYS = new Set([' ', 'k', 'K', 'MediaPlayPause', 'MediaPlay']);
  function holdIfAutoplayed() {
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (!v || v.paused || p.classList.contains('ad-showing')) return false; // ads: wait for the real video
    const vid = videoIdOf(p);
    if (!vid || vid === heldVid) return false;  // only the first start of each video
    heldVid = vid; // tracked even when off, so switching on never pauses the video already playing
    const next = endedAt > 0 && endedVid !== vid && endedAt > lastInput; // followed on by itself
    const mode = next ? (endedQueue ? modeQ : modeNo) : holdOpened ? 'wait' : 'play';
    endedAt = 0;
    if (Date.now() - lastPlayGesture < 1000) return false; // you pressed play: leave it playing
    if (mode === 'play') return false; // 'stop' that didn't stop (YouTube went on anyway) still waits
    call(p, 'pauseVideo');
    markHeld(vid);
    return true;
  }
  // A queue or playlist is running. shortcut: playlist id / "list=" only; YouTube's separate "Add to queue" list is not checked, upgrade if it proves different.
  function inQueue() {
    const p = getPlayer();
    return !!(p && call(p, 'getPlaylistId')) || new URL(location.href).searchParams.has('list');
  }
  // YouTube's own autoplay switch is hidden (see CSS); Resolute turns it on or off to match "No queue" (stops = off).
  let autonavTimer = 0;
  function syncAutonav() {
    clearTimeout(autonavTimer);
    if (!IS_TOP || !autoplayKnown || !location.pathname.startsWith('/watch')) return;
    const attempt = (n) => {
      const t = document.querySelector('.ytp-autonav-toggle-button');
      if (!t) { if (n < 12) autonavTimer = setTimeout(() => attempt(n + 1), 800); return; } // the player may not be drawn yet
      if (inQueue()) return;
      if ((t.getAttribute('aria-checked') === 'true') !== (modeNo !== 'stop')) t.click();
    };
    attempt(0);
  }
  const ownControl = (t) => !!(mast.btn && t && t.nodeType === 1 && (mast.btn.contains(t) || mast.menu.contains(t)));

  // ---------- background saver: lower quality while you're on another tab ----------
  // Rough YouTube bitrates (Mbit/s) per quality, only to estimate what was saved. shortcut: fixed table, not measured
  const MBPS = { tiny: 0.1, small: 0.3, medium: 0.6, large: 1.1, hd720: 2.5, hd1080: 4.5, hd1440: 9, hd2160: 18, highres: 30 };
  const inPip = () => !!document.pictureInPictureElement;
  let tabActive = true;           // the browser says this is the selected tab of its window
  let drawn = true;              // the page is still being painted (checked only when another tab is selected)
  // Away = hidden, or another tab is selected AND this page stopped being drawn. Vivaldi keeps background
  // tabs "visible" but stops drawing them; a tab split or tiled next to the selected one keeps being drawn.
  const away = () => document.visibilityState === 'hidden' || (!tabActive && !drawn);
  let probeId = 0;
  function checkDrawn() {
    const id = ++probeId;
    let frames = -1;
    setTimeout(() => { // let the switch settle, then count frames for 1 s
      if (id !== probeId) return;
      frames = 0;
      const tick = () => { if (id === probeId && frames >= 0) { frames++; requestAnimationFrame(tick); } };
      requestAnimationFrame(tick);
      setTimeout(() => {
        if (id !== probeId) return;
        drawn = frames >= 5; // Vivaldi measured: 20-60 fps on screen, 0-1 in a background tab
        frames = -1;
        awayChanged();
      }, 1000);
    }, 500);
  }
  let saverFromQ = '';           // quality when you left the tab (hidden tabs may stop reporting it)
  // Why the saver didn't lower a video: the popup's "Last time" line shows it, so you never have to guess.
  const saverSkip = (reason) => postToExt({ type: 'saverSkip', reason });
  function armSaver() {
    clearTimeout(saverTimer);
    saverTimer = 0;
    if (!IS_TOP || !saver.on || !PIP_KNOWN || !away()) return;
    saverFromQ = call(getPlayer() || {}, 'getPlaybackQuality') || '';
    saverTimer = setTimeout(startSaver, saver.after * 1000);
  }
  function startSaver() {
    saverTimer = 0;
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (saverActive || !saver.on || !away()) return;
    if (!p || !v) { saverSkip('no-video'); return; }
    if (v.paused) { saverSkip(v.muted ? 'muted' : 'paused'); return; } // browsers pause muted videos in background tabs
    if (inPip()) { saverSkip('pip'); return; }
    if (p.classList.contains('ad-showing')) { saverTimer = setTimeout(startSaver, 5000); return; } // ads: try after
    const levels = availableLevels(p);
    const now = call(p, 'getPlaybackQuality');
    // Chromium may stop decoding a hidden tab's picture, and YouTube then reports no quality: use the one you left at.
    const fromQ = HEIGHT[now] ? now : HEIGHT[saverFromQ] ? saverFromQ : (levels[0] || '');
    const target = resolveTarget(saver.to, levels.length ? levels : Object.keys(HEIGHT));
    if (!target || !HEIGHT[fromQ]) { saverSkip('no-quality'); return; }
    if (HEIGHT[fromQ] <= HEIGHT[target]) { saverSkip('already-low'); return; } // nothing to save
    saverActive = { q: saver.to, fromQ, target, ms: 0, t0: Date.now() };
    forceQuality(p, target);
    forcedEarlier = true;
    lastApplied = `${videoIdOf(p)}|${saver.to}`;
    tabRefresh();
    const data = call(p, 'getVideoData');
    postToExt({ type: 'saverOn', label: heightLabel(target), title: (data && data.title) || '' }); // the "it's running" notification
  }
  function endSaver() {
    clearTimeout(saverTimer);
    if (!saverActive) return;
    const a = saverActive;
    saverActive = null;
    postToExt({ type: 'saverOff' });
    if (a.t0) a.ms += Date.now() - a.t0;
    tabRefresh();
    const mb = Math.max(0, ((MBPS[a.fromQ] || 0) - (MBPS[a.target] || 0)) * a.ms / 8000);
    // Every run is reported (the popup's "Last time" line is your proof it happened); only real savings are added up.
    if (a.ms >= 1000) postToExt({ type: 'saved', mb: Math.round(mb * 10) / 10, from: a.fromQ, to: a.target, secs: Math.round(a.ms / 1000) });
    scheduleApply(true); // back to the quality you chose
  }
  // Count only time the video was actually playing.
  function saverPlaying(isPlaying) {
    if (!saverActive) return;
    if (isPlaying && !saverActive.t0) saverActive.t0 = Date.now();
    if (!isPlaying && saverActive.t0) { saverActive.ms += Date.now() - saverActive.t0; saverActive.t0 = 0; }
  }
  // The tab is all you can see while away: prefix its title ("144p · …") and swap its icon for Resolute's leaf.
  const tab = { prefix: '', obs: null, icon: null, saved: [] };
  const LEAF_ICON = (() => {
    const pts = Array.from({ length: 56 }, (_, i) => {
      const t = (i / 56) * Math.PI * 2;
      const r = 14.4 + 1.6 * Math.cos(7 * t);
      return `${(16 + r * Math.cos(t)).toFixed(1)},${(16 + r * Math.sin(t)).toFixed(1)}`;
    }).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><polygon points="${pts}" fill="#d8a32a"/>` +
      '<path d="M16 8.5c4.6 2 7.5 6 6.2 10.8-1.3 3.9-5.8 5.1-9.5 4.1l-3 .5-.5-.8 2.3-2.8c-2.6-3.4-1.5-9.2 4.5-11.8z" fill="#3a2a00"/></svg>';
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  })();
  function tabMark(label, leaf) {
    if (tab.obs) { tab.obs.disconnect(); tab.obs = null; }
    if (tab.prefix && document.title.startsWith(tab.prefix)) document.title = document.title.slice(tab.prefix.length);
    tab.prefix = '';
    // Browsers (Chromium/Vivaldi especially) don't always repaint the tab when an icon's href changes in place,
    // but always pick up a new icon element. So: take YouTube's icons out, add ours, and put theirs back after.
    if (leaf && !tab.icon) {
      tab.saved = [...document.querySelectorAll('link[rel~="icon"]')].map((l) => [l, l.parentNode, l.nextSibling]);
      tab.saved.forEach(([l]) => l.remove());
      tab.icon = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: LEAF_ICON });
      tab.icon.id = 'yqx-saver-icon';
      (document.head || document.documentElement).append(tab.icon);
    } else if (!leaf && tab.icon) {
      tab.icon.remove();
      tab.icon = null;
      for (const [l, parent, next] of tab.saved) parent.insertBefore(l, next && next.parentNode === parent ? next : null);
      tab.saved = [];
    }
    if (!label) return;
    tab.prefix = `${label} · `;
    const keep = () => { if (!document.title.startsWith(tab.prefix)) document.title = tab.prefix + document.title; };
    keep();
    const t = document.querySelector('title');
    if (t) { tab.obs = new MutationObserver(keep); tab.obs.observe(t, { childList: true, characterData: true, subtree: true }); } // YouTube retitles on the next video
  }

  // ---------- time left at your speed ----------
  // In the player: "· 5:36 left 1.5×" after YouTube's time. In the tab, while you are away: "⏱ 6m" (saver: "144p · ⏱ 6m · …").
  const leftNow = () => {
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (!p || !v || p.classList.contains('ad-showing') || !(v.duration > 0) || !isFinite(v.duration)) return null; // ads, live, not loaded
    const d = call(p, 'getVideoData');
    if (d && d.isLive) return null;
    const rate = v.playbackRate > 0 ? v.playbackRate : 1;
    return { p, v, rate, secs: Math.max(0, v.duration - v.currentTime) / rate };
  };
  const clock = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; // floored, like YouTube's own clock
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const shortLeft = (s) => { // rounded up so it never says "0m" while time remains
    s = Math.ceil(s);
    if (s >= 3600) { const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60); return m === 60 ? `${h + 1}h` : `${h}h ${m}m`; }
    return s >= 60 ? `${Math.ceil(s / 60)}m` : `${s}s`;
  };
  const leftEl = { box: null, txt: null, x: null };
  function leftUpdate() {
    const n = leftNow();
    const disp = n && (n.p.querySelector('.ytp-time-contents') || n.p.querySelector('.ytp-time-display')); // the clock pill itself, so it grows with it
    if (!n || !disp || n.p.clientWidth < 520) { if (leftEl.box) leftEl.box.hidden = true; return; } // small player: no room
    if (!leftEl.box) {
      leftEl.box = el('span', 'yqx-left');
      leftEl.txt = document.createTextNode('');
      leftEl.x = el('span', 'yqx-left-x');
      leftEl.box.append(leftEl.txt, leftEl.x);
    }
    if (leftEl.box.parentElement !== disp) disp.append(leftEl.box); // YouTube may rebuild its time display
    leftEl.box.hidden = false;
    const t = `· ${clock(n.secs)} left`;
    if (leftEl.txt.data !== t) leftEl.txt.data = t;
    const x = n.rate === 1 ? '' : ` ${String(+n.rate.toFixed(2))}×`;
    if (leftEl.x.textContent !== x) leftEl.x.textContent = x;
  }
  const elsewhere = () => document.visibilityState === 'hidden' || !tabActive; // another tab is selected
  let tabIcons = true; // popup switch: ⏱ / ⏸ in front of the time
  let tabLast = null;
  function tabRefresh() {
    const n = elsewhere() ? leftNow() : null; // not the drawn-check `away()`: that waits 1.5 s+ and the countdown needs no such care
    const parts = [];
    if (saverActive) parts.push(heightLabel(saverActive.target));
    const sign = tabIcons ? '⏱ ' : ''; // same clock paused or playing
    if (n) parts.push(`${sign}${shortLeft(n.secs)}`);
    const key = `${parts.join(' · ')}|${!!saverActive}`;
    if (key === tabLast && (!parts.length || document.title.startsWith(`${parts.join(' · ')} · `))) return;
    tabLast = key;
    tabMark(parts.join(' · '), !!saverActive);
  }
  for (const type of ['timeupdate', 'ratechange', 'pause', 'playing', 'seeked', 'durationchange', 'emptied']) {
    document.addEventListener(type, (e) => {
      const p = getPlayer();
      if (p && e.target instanceof HTMLVideoElement && p.contains(e.target)) { leftUpdate(); tabRefresh(); }
    }, true);
  }

  // ---------- playback speed: the left half of the quality pill ----------
  // Which speed a video gets (first match wins): the speed saved for that video; music stays at 1×;
  // the speed saved for its channel; your default (1× unless you change it).
  // Any speed you pick (Resolute's chips, slider or scrolling on the pill, or YouTube's own gear menu and
  // Shift + > / <) sticks to that video. Learning: each video counts once, as the speed you watched it at longest,
  // and only after 2 minutes at that speed. When 3 of your last 4 videos of a channel share one exact speed, the
  // next video of that channel opens with a chip: "Orbit Lab at 1.5× again?" Keep / No. Once kept, 2 of your last
  // 3 videos at another speed offer to change it. A live stream goes back to 1× once it catches up to live.
  // Shorts are never touched.
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const SP_MIN = 0.25, SP_MAX = 3, LEARN_AT = 3, LEARN_OF = 4, CHANGE_AT = 2, CHANGE_OF = 3, WATCHED = 120;
  const cleanRate = (r) => (typeof r === 'number' && r >= SP_MIN - 1e-9 && r <= SP_MAX + 1e-9 ? Math.round(r * 20) / 20 : null);
  const fmtRate = (r) => `${+r.toFixed(2)}×`;
  let spDef = 1;
  let spVids = {};   // { videoId: rate }
  let spChs = {};    // { UCchannelId: { r, name } }
  let spPicks = {};  // { UCchannelId: { n: name, h: [[videoId, speed], …] last 4 videos, no: [speeds you said No to] } }
  const spGot = new Set(); // which of the four stores have arrived
  let spRules = { music: true, live: true }; // popup switches
  const sp = {
    btn: null, pill: null, menu: null, now: null, chan: null, offer: null, live: null, fine: null, out: null,
    chips: new Map(), rows: {}, open: false, keepAlive: 0, flashTimer: 0, saveTimer: 0, tipText: '',
    vid: '', expect: 0, applied: 1, picked: false, liveDone: false, fights: 0, appliedAt: 0, down: false, gesture: 0,
    watch: { vid: '', acc: {}, last: 0, sent: '' }, chip: null, chipText: null, chipKeep: null, chipTimer: 0, chipOffer: null,
    offerVid: '', asked: new Set()
  };
  const spKnown = () => spGot.size === 4;
  const spOwn = (t) => !!(sp.btn && t && t.nodeType === 1 && (sp.btn.contains(t) || sp.menu.contains(t)));

  function spCtx() {
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (!p || !v || location.pathname.startsWith('/shorts/') || p.classList.contains('ad-showing')) return null;
    const vid = videoIdOf(p);
    return vid ? { p, v, vid } : null;
  }
  function isMusic(p, vid) {
    let r = null;
    try { r = call(p, 'getPlayerResponse') || window.ytInitialPlayerResponse; } catch { r = null; }
    const m = r && r.videoDetails && r.videoDetails.videoId === vid && r.microformat && r.microformat.playerMicroformatRenderer;
    return !!(m && m.category === 'Music');
  }
  /** The speed this video should get, and where it comes from (skipVideo: what it would get without its own). */
  function spChoice(c, skipVideo) {
    const ch = channelFor(c.p, c.vid);
    if (!skipVideo && spVids[c.vid] != null) return { r: spVids[c.vid], from: 'video', ch };
    if (spRules.music && isMusic(c.p, c.vid)) return { r: 1, from: 'music', ch };
    if (ch && spChs[ch.id]) return { r: spChs[ch.id].r, from: 'channel', ch };
    return { r: spDef, from: 'default', ch };
  }
  function setRate(c, r) {
    sp.expect = r;
    if (r <= 2) call(c.p, 'setPlaybackRate', r); // YouTube's own call keeps its gear menu in step
    try { if (Math.abs(c.v.playbackRate - r) > 0.001) c.v.playbackRate = r; } catch { /* read-only in odd players */ } // above 2× only the video takes it
  }
  function spApply() {
    const c = spCtx();
    if (c && spKnown()) {
      if (c.vid !== sp.vid) Object.assign(sp, { vid: c.vid, picked: false, liveDone: false, fights: 0, appliedAt: Date.now() });
      const r = sp.liveDone ? 1 : sp.picked ? sp.applied : spChoice(c).r;
      const off = Math.abs(c.v.playbackRate - r) > 0.001;
      if (r !== sp.expect || (off && sp.fights++ < 8)) setRate(c, r); // a few tries if YouTube puts its own back
      sp.applied = r;
    }
    spUpdate();
  }
  /** A speed you chose: it sticks to this video (soon = wait for the scroll or slider to settle before saving). */
  function spPick(r, soon) {
    const c = spCtx();
    if (!c || !spKnown()) return;
    r = Math.min(SP_MAX, Math.max(SP_MIN, Math.round(r * 20) / 20));
    if (c.vid !== sp.vid) spApply();
    Object.assign(sp, { picked: true, applied: r, liveDone: false });
    setRate(c, r);
    const base = spChoice(c, true).r;
    if (r === base) delete spVids[c.vid]; else spVids[c.vid] = r;
    clearTimeout(sp.saveTimer);
    const commit = () => {
      postToExt({ type: 'speedVid', videoId: c.vid, value: spVids[c.vid] != null ? spVids[c.vid] : null });
      spUpdate();
    };
    if (soon) sp.saveTimer = setTimeout(commit, 700); else commit();
    spUpdate();
  }
  /** What a video of this channel tells: the speed you watched longest, once it reaches 2 minutes. */
  function spTrack(c) {
    const w = sp.watch;
    if (w.vid !== c.vid) Object.assign(w, { vid: c.vid, acc: {}, last: 0, sent: '' });
    const now = performance.now();
    if (c.v.paused || sp.down) { w.last = 0; return; } // press-and-hold 2× is never your speed
    if (w.last && now - w.last < 2000) {
      const r = cleanRate(Math.round(c.v.playbackRate * 100) / 100);
      if (r) w.acc[r] = (w.acc[r] || 0) + (now - w.last) / 1000;
    }
    w.last = now;
    let main = '', most = 0;
    for (const [r, secs] of Object.entries(w.acc)) if (secs > most) { main = r; most = secs; }
    if (!main || most < WATCHED || main === w.sent) return;
    const ch = channelFor(c.p, c.vid);
    if (!ch || (spRules.music && isMusic(c.p, c.vid))) return; // music held at 1× says nothing about the channel
    w.sent = main;
    const m = spPicks[ch.id] || (spPicks[ch.id] = {});
    if (ch.name) m.n = ch.name; // the popup's Learning list shows it
    m.h = [...(Array.isArray(m.h) ? m.h : []).filter((e) => e[0] !== c.vid), [c.vid, Number(main)]].slice(-LEARN_OF);
    postToExt({ type: 'speedWatch', channelId: ch.id, videoId: c.vid, rate: Number(main), name: ch.name });
  }
  /**
   * What the channel's recent videos suggest, or null.
   * No channel speed yet: 3 of the last 4 videos at one exact speed (not your default) → keep it.
   * A channel speed already kept: 2 of the last 3 at one other speed → change it (or back to the default).
   */
  function spOffer(ch) {
    const m = ch && spPicks[ch.id];
    if (!m || !Array.isArray(m.h)) return null;
    const no = Array.isArray(m.no) ? m.no : [];
    const kept = spChs[ch.id] ? spChs[ch.id].r : null;
    const recent = m.h.slice(kept != null ? -CHANGE_OF : -LEARN_OF);
    const need = kept != null ? CHANGE_AT : LEARN_AT;
    const base = kept != null ? kept : spDef;
    for (const [, r] of recent) {
      if (r === base || no.includes(r) || recent.filter((e) => e[1] === r).length < need) continue;
      return { r, kind: kept == null ? 'keep' : r === spDef ? 'normal' : 'change' };
    }
    return null;
  }
  function spSetChannel(c, ch, r) {
    spChs[ch.id] = { r, name: ch.name };
    postToExt({ type: 'speedCh', channelId: ch.id, value: r, name: ch.name });
    // videos of this channel saved at this same speed now simply follow the channel
    const m = spPicks[ch.id] || {};
    for (const id of new Set([c.vid, ...(Array.isArray(m.h) ? m.h.map((e) => e[0]) : [])])) {
      if (spVids[id] === r) { delete spVids[id]; postToExt({ type: 'speedVid', videoId: id, value: null }); }
    }
  }
  /** Keep / Change / Back to normal (yes), or No: from the chip or the menu. */
  function spAnswer(yes) {
    const c = spCtx();
    const ch = c && channelFor(c.p, c.vid);
    const o = spOffer(ch);
    spHideChip();
    if (!o) return;
    sp.asked.add(`${ch.id}|${o.kind}|${o.r}`);
    const name = ch.name || 'this channel';
    if (!yes) {
      const m = spPicks[ch.id];
      m.no = [...(Array.isArray(m.no) ? m.no : []), o.r]; // never offered again for this speed here
      postToExt({ type: 'speedNo', channelId: ch.id, rate: o.r });
    } else if (o.kind === 'normal') {
      delete spChs[ch.id];
      postToExt({ type: 'speedCh', channelId: ch.id, value: null });
      spFlash(`${name} is back to ${spDef === 1 ? 'normal' : 'your default'}`);
    } else {
      spSetChannel(c, ch, o.r);
      spFlash(`${fmtRate(o.r)} for ${name}`);
    }
    if (yes && spVids[c.vid] == null) { sp.picked = false; spApply(); } // this video follows the answer at once
    spUpdate();
    if (sp.open) sp.rows.channel.focus({ preventScroll: true });
  }
  const spAsk = (o, name) => (o.kind === 'keep' ? `${name} at ${fmtRate(o.r)} again?`
    : o.kind === 'change' ? `${name} at ${fmtRate(o.r)} now?` : `${name} back to ${spDef === 1 ? 'normal speed' : 'your default'}?`);
  const spYes = (o) => (o.kind === 'keep' ? 'Keep' : o.kind === 'change' ? 'Change' : 'Yes');
  /** The chip above the speed pill when a video of a channel with an offer opens. Gone after 8 s. */
  function spMaybeChip(c) {
    if (sp.offerVid === c.vid) return;
    const ch = channelFor(c.p, c.vid);
    if (!ch) return; // the channel id can come a moment later; the next check tries again
    sp.offerVid = c.vid;
    const o = spOffer(ch);
    const key = o && `${ch.id}|${o.kind}|${o.r}`;
    if (!o || sp.asked.has(key) || spVids[c.vid] != null) return; // each offer once while the page is open
    sp.asked.add(key);
    setTimeout(() => { const c2 = spCtx(); if (c2 && c2.vid === c.vid && !sp.open) spShowChip(c2, ch, o); }, 1200); // once it is playing
  }
  function spShowChip(c, ch, o) {
    if (!sp.chip) {
      const chip = el('div', 'yqs-chip', { role: 'group', 'aria-label': 'Speed suggestion' });
      const mark = el('span', 'yqs-chip-mark', { 'aria-hidden': 'true' });
      const text = el('span', 'yqs-chip-text', { role: 'status' });
      const keep = el('button', 'yqs-chip-yes', { type: 'button' });
      const no = el('button', 'yqs-chip-no', { type: 'button' });
      no.textContent = 'No';
      keep.addEventListener('click', () => spAnswer(true));
      no.addEventListener('click', () => spAnswer(false));
      chip.append(mark, text, keep, no);
      for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup']) {
        chip.addEventListener(type, (e) => e.stopPropagation()); // never pauses the video or reaches YouTube's shortcuts
      }
      chip.addEventListener('pointerenter', () => clearTimeout(sp.chipTimer)); // stays while you read it
      chip.addEventListener('pointerleave', () => { sp.chipTimer = setTimeout(spHideChip, 4000); });
      Object.assign(sp, { chip, chipText: text, chipKeep: keep, chipMark: mark });
    }
    sp.chipMark.textContent = (ch.name || '?').trim().charAt(0).toUpperCase() || '?';
    sp.chipText.textContent = spAsk(o, ch.name || 'This channel');
    sp.chipKeep.textContent = spYes(o);
    if (sp.chip.parentElement !== c.p) c.p.append(sp.chip);
    positionMenu(sp.btn, sp.chip);
    sp.chip.style.maxHeight = '';
    sp.chip.classList.add('yqs-show');
    nudgeControls(); // the pill it points at stays visible
    clearTimeout(sp.chipTimer);
    sp.chipTimer = setTimeout(spHideChip, 8000);
  }
  function spHideChip() {
    clearTimeout(sp.chipTimer);
    if (sp.chip) sp.chip.classList.remove('yqs-show');
  }

  function spRateChange() {
    const c = spCtx();
    if (!c || !spKnown()) return;
    if (c.vid !== sp.vid) { spApply(); return; }
    const r = c.v.playbackRate;
    if (Math.abs(r - sp.expect) < 0.001 || sp.down) return; // ours, or YouTube's press-and-hold 2× (only while held)
    // Right after your click or key press it's yours (YouTube's gear menu, Shift + > / <), but not while a video is just opening.
    const yours = Date.now() - sp.gesture < 1500 && Date.now() - sp.appliedAt > 2000;
    if (!yours) { spApply(); return; } // YouTube changed it by itself: put the right one back
    const cr = cleanRate(r);
    if (cr) spPick(cr, false);
    else Object.assign(sp, { expect: r, applied: r, picked: true }); // outside Resolute's range: used, not saved
  }
  function spLiveCheck() {
    const c = spCtx();
    if (!c || !spRules.live || sp.liveDone || !(c.v.playbackRate > 1)) return;
    const d = call(c.p, 'getVideoData');
    if (!d || !d.isLive) return;
    const s = c.v.seekable;
    const end = s && s.length ? s.end(s.length - 1) : 0;
    if (end && end - c.v.currentTime < 8) { // shortcut: within 8 s of the newest part counts as live; tune if YouTube's delay differs
      sp.liveDone = true;
      setRate(c, 1);
      sp.applied = 1;
      spFlash('Caught up to live · back to 1×');
      spUpdate();
    }
  }

  // ---------- speed: button and menu ----------
  function spBuild() {
    const btn = el('button', 'ytp-button yqx-button yqs-button yqx-pending', {
      id: 'yqs-button', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      'aria-controls': 'yqs-menu', 'aria-label': 'Playback speed'
    });
    const pill = el('span', 'yqx-pill', { 'aria-hidden': 'true' });
    btn.append(pill);
    btn.addEventListener('click', (e) => {
      if (btn.classList.contains('yqx-floating')) e.stopPropagation(); // don't pause the video
      const byKeyboard = e.detail === 0;
      if (sp.open) spClose(byKeyboard); else spOpen(byKeyboard);
      if (!byKeyboard) btn.blur(); // Space/K still pause the video
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); spOpen(true); }
      else if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      else if (e.key === 'Escape' && sp.open) { e.stopPropagation(); spClose(true); }
    });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
    // Scroll on the pill: 0.05 up or down.
    btn.addEventListener('wheel', (e) => {
      if (!spCtx()) return;
      e.preventDefault();
      e.stopPropagation();
      spPick(sp.applied + (e.deltaY < 0 ? 0.05 : -0.05), true);
    }, { passive: false });
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(btn, sp.tipText); });
    btn.addEventListener('pointerleave', hideTip);
    btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) showTip(btn, sp.tipText); });
    btn.addEventListener('blur', hideTip);

    const menu = el('div', 'yqx-menu yqs-menu', { id: 'yqs-menu', role: 'menu', 'aria-label': 'Playback speed' });
    const head = el('div', 'yqx-head');
    const headRow = el('div', 'yqx-headrow', { 'aria-hidden': 'true' });
    const title = el('span', 'yqx-title');
    title.textContent = 'Speed';
    const now = el('span', 'yqx-now');
    headRow.append(title, now);
    const chan = el('div', 'yqx-chan', { 'aria-hidden': 'true' });
    const offer = el('div', 'yqs-offer', { role: 'group' });
    offer.hidden = true;
    const offerText = el('span', 'yqs-offer-text');
    const keep = el('div', 'yqx-item yqs-keep', { role: 'menuitem', tabindex: '-1' });
    keep.textContent = 'Keep';
    const no = el('div', 'yqx-item yqs-no', { role: 'menuitem', tabindex: '-1' });
    no.textContent = 'No';
    offer.append(offerText, keep, no);
    head.append(headRow, chan, offer);
    const live = el('div', 'yqx-live', { role: 'status', 'aria-live': 'polite' });
    const list = el('div', 'yqx-list');
    const grid = el('div', 'yqx-grid', { role: 'group', 'aria-label': 'Speeds' });
    for (const r of SPEEDS) {
      const item = el('div', 'yqx-item yqx-chip', { role: 'menuitemradio', tabindex: '-1', 'aria-checked': 'false' });
      item.dataset.r = String(r);
      const label = el('span', 'yqx-label');
      label.textContent = fmtRate(r);
      item.append(label, el('span', 'yqx-note'));
      item.addEventListener('click', () => spPick(r, false));
      grid.append(item);
      sp.chips.set(r, item);
    }
    const fineRow = el('label', 'yqs-fine');
    const fine = el('input', '', { type: 'range', min: String(SP_MIN), max: String(SP_MAX), step: '0.05', 'aria-label': 'Fine speed' });
    const out = el('output', '');
    const lo = el('span', 'yqs-end', { 'aria-hidden': 'true' });
    lo.textContent = fmtRate(SP_MIN);
    const hi = el('span', 'yqs-end', { 'aria-hidden': 'true' });
    hi.textContent = fmtRate(SP_MAX);
    fine.addEventListener('input', () => spPick(Number(fine.value), true));
    fineRow.append(lo, fine, hi, out);
    list.append(grid, fineRow);
    const foot = el('div', 'yqx-foot');
    const row = (key, iconName, onClick) => {
      const r = el('div', `yqx-item yqx-action yqs-${key}`, { role: 'menuitem', tabindex: '-1' });
      const box = el('span', 'yqx-iconbox');
      box.append(icon(iconName, 'yqx-icon'));
      r.append(box, el('span', 'yqx-label'), el('span', 'yqx-note'));
      r.addEventListener('click', () => { if (r.getAttribute('aria-disabled') !== 'true') onClick(); });
      foot.append(r);
      return r;
    };
    sp.rows.forget = row('forget', 'close', spForget);
    sp.rows.channel = row('channel', 'channel', spToggleChannel);
    sp.rows.def = row('default', 'star', spToggleDefault);
    keep.addEventListener('click', () => spAnswer(true));
    no.addEventListener('click', () => spAnswer(false));
    menu.append(head, list, foot, live);

    menu.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.yqx-item');
      const active = document.activeElement;
      if (item && active && active.classList.contains('yqx-item') && active !== item) item.focus({ preventScroll: true });
    });
    menu.addEventListener('keydown', spKey);
    menu.addEventListener('keyup', (e) => e.stopPropagation());
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
                        'touchstart', 'touchend', 'contextmenu', 'wheel']) {
      menu.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }
    Object.assign(sp, { btn, pill, menu, now, chan, offer, offerText, live, fine, out });
  }
  function spEnsure(p, floating) {
    if (!sp.btn) spBuild();
    if (sp.btn.parentElement !== ui.btn.parentElement) ui.btn.parentElement.insertBefore(sp.btn, ui.btn);
    sp.btn.classList.toggle('yqx-floating', floating); // shortcut: hidden in the rare no-toolbar fallback; give it its own spot if that matters
    if (sp.menu.parentElement !== p) p.append(sp.menu);
    document.querySelectorAll('.yqs-button').forEach((b) => { if (b !== sp.btn) b.remove(); });
    document.querySelectorAll('.yqs-menu').forEach((m) => { if (m !== sp.menu) m.remove(); });
    spUpdate();
  }
  function spOpen(byKeyboard) {
    if (sp.open || !spCtx() || !spKnown()) return;
    closeMenu(false);
    hideTip();
    spHideChip(); // the menu shows the same offer
    sp.open = true;
    spUpdate();
    positionMenu(sp.btn, sp.menu);
    sp.menu.classList.add('yqx-open');
    sp.btn.setAttribute('aria-expanded', 'true');
    clearInterval(sp.keepAlive);
    sp.keepAlive = setInterval(nudgeControls, 1500);
    if (byKeyboard) (sp.menu.querySelector('.yqx-chip.yqx-checked') || sp.menu.querySelector('.yqx-chip')).focus({ preventScroll: true });
  }
  function spClose(returnFocus) {
    if (!sp.open) return;
    sp.open = false;
    sp.menu.classList.remove('yqx-open');
    sp.btn.setAttribute('aria-expanded', 'false');
    clearInterval(sp.keepAlive);
    if (returnFocus) sp.btn.focus({ preventScroll: true });
    else if (sp.menu.contains(document.activeElement)) document.activeElement.blur();
  }
  function spKey(e) {
    if (e.target === sp.fine && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      e.stopPropagation(); // the slider moves itself
      return;
    }
    const items = [...sp.menu.querySelectorAll('.yqx-item, input')].filter((n) => !n.closest('[hidden]'));
    const i = items.indexOf(document.activeElement);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': items[(i + 1) % items.length].focus({ preventScroll: true }); break;
      case 'ArrowUp': case 'ArrowLeft': items[(i - 1 + items.length) % items.length].focus({ preventScroll: true }); break;
      case 'Home': items[0].focus({ preventScroll: true }); break;
      case 'End': items[items.length - 1].focus({ preventScroll: true }); break;
      case 'Enter': case ' ': if (i >= 0 && items[i] !== sp.fine) items[i].click(); break;
      case 'Escape': case 'Tab': spClose(true); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    e.stopPropagation(); // keep YouTube's shortcuts out while in the menu
  }
  function spFlash(message) {
    if (!sp.now) return;
    clearTimeout(sp.flashTimer);
    sp.now.textContent = `✓ ${message}`;
    sp.now.classList.add('yqx-flash');
    sp.live.textContent = message;
    sp.flashTimer = setTimeout(() => { sp.flashTimer = 0; sp.now.classList.remove('yqx-flash'); spUpdate(); }, 1800);
  }
  function spForget() {
    const c = spCtx();
    if (!c || spVids[c.vid] == null) return;
    delete spVids[c.vid];
    postToExt({ type: 'speedVid', videoId: c.vid, value: null });
    sp.picked = false;
    spApply();
    spFlash('Forgotten for this video');
    if (sp.menu.contains(document.activeElement) && document.activeElement.hidden) sp.rows.channel.focus({ preventScroll: true });
  }
  function spToggleChannel() {
    const c = spCtx();
    const ch = c && channelFor(c.p, c.vid);
    if (!ch) return;
    const r = sp.applied;
    if (spChs[ch.id] && spChs[ch.id].r === r) {
      delete spChs[ch.id];
      postToExt({ type: 'speedCh', channelId: ch.id, value: null });
      if (r !== spChoice(c, true).r) { spVids[c.vid] = r; postToExt({ type: 'speedVid', videoId: c.vid, value: r }); } // this video keeps playing at it
      spFlash('Channel speed removed');
    } else {
      spSetChannel(c, ch, r);
      spFlash(`${fmtRate(r)} for ${ch.name || 'this channel'}`);
    }
    spUpdate();
  }
  function spToggleDefault() {
    const c = spCtx();
    if (!c) return;
    const r = sp.applied;
    if (spDef === r) { // tapping it again goes back to normal; this video keeps its speed for now
      if (r === 1) return;
      spDef = 1;
      sp.picked = true;
      spFlash('Default is normal (1×) again');
    } else {
      spDef = r;
      if (spVids[c.vid] === r) { delete spVids[c.vid]; postToExt({ type: 'speedVid', videoId: c.vid, value: null }); }
      spFlash(`${fmtRate(r)} is your default`);
    }
    postToExt({ type: 'speedDefault', value: spDef });
    spUpdate();
  }
  const spGap = (s) => { s = Math.round(Math.abs(s)); return s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`; };
  function spSetRow(row, label, note, disabled, on) {
    row.querySelector('.yqx-label').textContent = label;
    row.querySelector('.yqx-note').textContent = note;
    row.setAttribute('aria-label', note ? `${label}, ${note}` : label);
    if (disabled) row.setAttribute('aria-disabled', 'true'); else row.removeAttribute('aria-disabled');
    row.classList.toggle('yqx-on', !!on);
  }
  function spUpdate() {
    if (!sp.btn) return;
    const c = spCtx();
    sp.btn.classList.toggle('yqx-pending', !spKnown() || !c);
    if (ui.btn) ui.btn.classList.toggle('yqx-joined', !sp.btn.classList.contains('yqx-pending') && !sp.btn.classList.contains('yqx-floating') &&
      sp.btn.nextElementSibling === ui.btn); // squared inner corners only when the two halves sit side by side
    if (!c || !spKnown()) { if (sp.open) spClose(false); return; }
    const r = Math.round(c.v.playbackRate * 100) / 100 || 1;
    const choice = spChoice(c);
    const ch = choice.ch;
    const chName = (ch && ch.name) || 'this channel';
    const from = sp.liveDone ? 'live' : sp.picked && r !== choice.r ? 'video' : choice.from;
    const said = { video: 'this video', channel: `from ${chName}`, music: 'music stays at 1×', live: 'caught up to live',
      default: spDef === 1 ? 'normal' : 'your default' }[from];
    const text = fmtRate(r);
    if (sp.pill.textContent !== text) {
      const animate = sp.pill.textContent !== '';
      sp.pill.textContent = text;
      if (animate) { sp.pill.classList.remove('yqx-swap'); void sp.pill.offsetWidth; sp.pill.classList.add('yqx-swap'); }
    }
    sp.pill.dataset.from = from === 'video' ? 'remembered' : from === 'channel' ? 'channel' : '';
    sp.tipText = `Speed: ${text} (${said}) · scroll to fine-tune`;
    if (ui.tip && ui.tip.classList.contains('yqx-show') && sp.btn.matches(':hover, :focus-visible')) ui.tip.textContent = sp.tipText;
    sp.btn.setAttribute('aria-label', `Playback speed: ${text}, ${said}`);
    if (!sp.open) return;

    if (!sp.flashTimer) sp.now.textContent = `${text} · ${said}`;
    const chR = ch && spChs[ch.id] ? spChs[ch.id].r : null;
    sp.chan.textContent = !ch ? 'Channel not detected' : chR != null ? `${chName} · always ${fmtRate(chR)}` : `${chName} · no channel speed`;
    sp.chan.classList.toggle('yqx-chan-set', chR != null);
    const offer = spOffer(ch);
    sp.offer.hidden = offer == null;
    if (offer != null) {
      sp.offerText.textContent = offer.kind === 'keep' ? `You watched 3 of your last 4 videos here at ${fmtRate(offer.r)}. Keep it for ${chName}?`
        : offer.kind === 'change' ? `Lately you watch ${chName} at ${fmtRate(offer.r)}. Change it?` : `Lately you watch ${chName} at ${fmtRate(offer.r)}. Back to ${spDef === 1 ? 'normal' : 'your default'}?`;
      sp.offer.querySelector('.yqs-keep').textContent = spYes(offer);
    }
    // time saved against normal speed (nothing to show for live streams or an unknown length)
    const left = isFinite(c.v.duration) && c.v.duration > 0 ? Math.max(0, c.v.duration - c.v.currentTime) : 0;
    for (const [s, item] of sp.chips) {
      const on = Math.abs(s - r) < 0.001;
      item.classList.toggle('yqx-checked', on);
      item.setAttribute('aria-checked', String(on));
      const d = left * (1 - 1 / s);
      const note = !left ? '' : s === 1 ? 'normal' : Math.abs(d) < 1 ? '' : `${d > 0 ? '−' : '+'}${spGap(d)}`;
      item.querySelector('.yqx-note').textContent = note;
      item.setAttribute('aria-label', fmtRate(s) + (note && s !== 1 ? `, ${d > 0 ? 'saves' : 'adds'} ${spGap(d)}` : ''));
    }
    if (document.activeElement !== sp.fine) sp.fine.value = String(r);
    sp.out.textContent = text;

    const saved = spVids[c.vid];
    sp.rows.forget.hidden = saved == null;
    if (saved != null) spSetRow(sp.rows.forget, "Forget this video's speed", fmtRate(saved));
    if (!ch) spSetRow(sp.rows.channel, 'Speed for this channel', 'Channel not detected', true);
    else if (chR === r) spSetRow(sp.rows.channel, `Used for ${chName}`, 'Remove', false, true);
    else spSetRow(sp.rows.channel, `Use ${text} for ${chName}`, chR != null ? `now ${fmtRate(chR)}` : '', false);
    if (spDef === r) spSetRow(sp.rows.def, r === 1 ? 'Default is normal (1×)' : `Default is ${text}`, r === 1 ? '' : 'Back to 1×', r === 1, true);
    else spSetRow(sp.rows.def, `Make ${text} the default`, spDef !== 1 ? `now ${fmtRate(spDef)}` : '', false);
  }
  /** Saved speeds from the extension; true when the message was one of them. */
  function spMessage(msg) {
    const v = msg.value;
    if (msg.type === 'speedRules') {
      spRules = { music: !(v && v.music === false), live: !(v && v.live === false) };
      spApply();
      return true;
    }
    if (msg.type === 'speedDefault') {
      spDef = cleanRate(v) || 1;
    } else if (msg.type === 'speedVideos' && v && typeof v === 'object') {
      spVids = {};
      for (const [id, r] of Object.entries(v)) if (/^[\w-]{6,20}$/.test(id) && cleanRate(r)) spVids[id] = cleanRate(r);
    } else if (msg.type === 'speedChannels' && v && typeof v === 'object') {
      spChs = {};
      for (const [id, x] of Object.entries(v)) if (CHANNEL_ID.test(id) && x && cleanRate(x.r)) spChs[id] = { r: cleanRate(x.r), name: String(x.name || '') };
    } else if (msg.type === 'speedPicks' && v && typeof v === 'object') {
      spPicks = {};
      for (const [id, m] of Object.entries(v)) if (CHANNEL_ID.test(id) && m && typeof m === 'object') spPicks[id] = { ...m };
    } else {
      return false;
    }
    spGot.add(msg.type);
    spApply();
    return true;
  }
  const spOurs = (t) => { const p = getPlayer(); return p && t instanceof HTMLVideoElement && p.contains(t); };
  for (const type of ['loadedmetadata', 'playing', 'durationchange']) {
    document.addEventListener(type, (e) => { if (spOurs(e.target)) spApply(); }, true);
  }
  document.addEventListener('ratechange', (e) => { if (spOurs(e.target)) { spRateChange(); spUpdate(); } }, true);
  document.addEventListener('timeupdate', (e) => {
    if (!spOurs(e.target)) return;
    spLiveCheck();
    const c = spCtx();
    if (c && spKnown()) { spTrack(c); spMaybeChip(c); }
    if (sp.open) spUpdate();
  }, true);
  document.addEventListener('pointerdown', (e) => {
    sp.down = true;
    if (!spOwn(e.target)) sp.gesture = Date.now();
    if (sp.open && !spOwn(e.target)) spClose(false);
  }, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { sp.down = false; }, true);
  window.addEventListener('blur', () => { sp.down = false; }); // a release outside the window never reaches us
  document.addEventListener('keydown', (e) => {
    if (!spOwn(e.target)) sp.gesture = Date.now();
    if (sp.open && e.key === 'Escape' && !sp.menu.contains(e.target)) spClose(false);
  }, true);

  // ---------- autoplay button next to YouTube's search box (top page only) ----------
  // Material 3 Expressive "unfolding split button". At rest it is one small shape beside the mic button:
  //   the glyph  ▶ → ⏸            = videos you open start paused
  //   the wavy ring unwinds       = next videos in a queue/playlist start paused
  //   the shape: circle → cookie → rounded square, tinted soft → solid = how much is on
  // Pointing at it unfolds a split button: [shape + words] switches both settings, [chevron] opens a menu
  // with a switch for each. It floats over empty space, so YouTube's layout never moves.
  const IS_TOP = window === window.top && location.hostname === 'www.youtube.com';
  const mast = { btn: null, lead: null, segs: [], go: null, trail: null, menu: null, rows: {}, chips: [], live: null, hover: false, hi: -1, open: false,
    held: false, heldFor: '', flash: false, timer: 0 };
  const ORDER = ['play', 'wait', 'stop'];
  const WORDS = { play: 'plays', wait: 'waits', stop: 'stops' };
  const SEGS = [
    { k: 'opened', cap: 'Opened', name: 'Opened, a video I click or tap' },
    { k: 'noQueue', cap: 'No queue', name: 'No queue or playlist, a video ends and nothing follows' },
    { k: 'queue', cap: 'Queue', name: 'Queue or playlist, a video ends and the queue continues' }
  ];
  const stateOf = (k) => (k === 'opened' ? Number(holdOpened) : ORDER.indexOf(k === 'noQueue' ? modeNo : modeQ));
  const wordOf = (k) => WORDS[ORDER[stateOf(k)]];
  const NS = 'http://www.w3.org/2000/svg';
  // Shapes are polygons with the same number of points, so clip-path can morph between them.
  const SHAPES = (() => {
    const N = 72;
    const poly = (f) => `polygon(${Array.from({ length: N }, (_, i) => {
      const t = (i / N) * Math.PI * 2;
      const r = f(t);
      return `${(50 + r * Math.cos(t)).toFixed(2)}% ${(50 + r * Math.sin(t)).toFixed(2)}%`;
    }).join(',')})`;
    return [
      poly(() => 50), // circle
      poly((t) => 45 + 5 * Math.cos(7 * t)), // 7-sided cookie
      poly((t) => (0.92 * 50) / ((Math.abs(Math.cos(t)) ** 5 + Math.abs(Math.sin(t)) ** 5) ** 0.2)) // rounded square
    ];
  })();
  // Wavy ring like M3 Expressive's wavy progress: smooth wavy arc + flat faint track with small end gaps.
  const WAVE = (() => {
    let d = '';
    for (let i = 0; i <= 320; i++) {
      const t = (i / 320) * Math.PI * 2;
      const r = 20.5 + 1.35 * Math.sin(8 * t);
      d += `${i ? 'L' : 'M'}${(24 + r * Math.cos(t)).toFixed(3)} ${(24 + r * Math.sin(t)).toFixed(3)}`;
    }
    return `${d}Z`;
  })();
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }
  function ring(cls) {
    const svg = svgEl('svg', { class: cls, viewBox: '0 0 48 48', 'aria-hidden': 'true' });
    svg.append(svgEl('circle', { class: 'yqx-track', cx: '24', cy: '24', r: '20.5', pathLength: '100' }),
      svgEl('path', { class: 'yqx-act', d: WAVE, pathLength: '100' }));
    return svg;
  }
  function glyph() { // two halves of ▶ that become the two bars of ⏸
    const g = el('span', 'yqx-ap-glyph');
    g.append(el('i', 'yqx-ap-l'), el('i', 'yqx-ap-r'));
    return g;
  }
  const QUEUE_ICON = 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z';
  function segIcon(k) {
    if (k === 'opened') return glyph();
    const wrap = el('span', 'yqx-segico');
    if (k === 'noQueue') {
      const nx = el('span', 'yqx-apm-next'); // skip-next
      nx.append(el('i'), el('i'));
      wrap.append(nx);
    } else {
      const svg = svgEl('svg', { viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true' });
      svg.append(svgEl('path', { d: QUEUE_ICON, fill: 'currentColor' }));
      wrap.append(svg);
    }
    return wrap;
  }
  function buildMast() {
    const btn = el('span', 'yqx-au', { id: 'yqx-autoplay' });
    const row = el('span', 'yqx-au-row');
    const segs = SEGS.map((sg, i) => {
      const b = el('button', 'yqx-au-lead yqx-seg', { type: 'button', 'data-k': sg.k, 'data-i': String(i) });
      if (i) b.tabIndex = -1;
      const ms = el('span', 'yqx-ms', { 'aria-hidden': 'true' });
      const core = el('span', 'yqx-ms-core');
      core.append(segIcon(sg.k));
      if (i === 0) ms.append(ring('yqx-wave'));
      ms.append(el('span', 'yqx-ms-shape'), core);
      if (i === 0) ms.append(el('span', 'yqx-held-dot'), el('span', 'yqx-badge'));
      const lbl = el('span', 'yqx-au-lbl', { 'aria-hidden': 'true' });
      const inn = el('span', 'yqx-in');
      inn.append(el('span', 'cap'), el('span', 'st'));
      lbl.append(inn);
      b.append(ms, lbl);
      row.append(b);
      return b;
    });
    const lead = segs[0];
    const trail = el('button', 'yqx-au-trail', {
      type: 'button', tabindex: '-1', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'yqx-apm', 'aria-label': 'Autoplay settings'
    });
    const chev = svgEl('svg', { class: 'yqx-chev', viewBox: '0 0 12 12', 'aria-hidden': 'true' });
    chev.append(svgEl('path', { d: 'M2 4.2 6 8l4-3.8', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    trail.append(chev);
    // Shown only while Resolute holds a video: [shape + "Video waiting"][▶ Play]
    const go = el('button', 'yqx-au-go', { type: 'button', tabindex: '-1', 'aria-label': 'Play video' });
    const tri = el('span', 'yqx-tri', { 'aria-hidden': 'true' });
    const goText = el('span');
    goText.textContent = 'Play';
    go.append(tri, goText);
    row.append(go, trail);
    btn.append(row);

    // The menu: a switch for "Opened", and Plays / Waits / Stops for the two "ended" cases.
    const menu = el('div', 'yqx-apm', { id: 'yqx-apm', role: 'menu', 'aria-label': 'Autoplay' });
    const title = el('div', 'yqx-apm-title', { 'aria-hidden': 'true' });
    title.textContent = 'Autoplay';
    const list = el('div', 'yqx-apm-list');
    const iconBox = (k) => {
      const ico = el('span', 'yqx-apm-ico', { 'aria-hidden': 'true' });
      ico.append(segIcon(k));
      return ico;
    };
    const textBox = (name, hint) => {
      const text = el('span', 'yqx-apm-text');
      const b = el('span', 'yqx-apm-name');
      b.textContent = name;
      const sm = el('span', 'yqx-apm-hint');
      sm.textContent = hint;
      text.append(b, sm);
      return text;
    };
    const r = el('div', 'yqx-apm-row yqx-apm-row-opened', { role: 'menuitemcheckbox', tabindex: '-1', 'aria-checked': 'false', 'aria-label': 'Opened: a video I click or tap, starts paused' });
    const sw = el('span', 'yqx-apm-sw', { 'aria-hidden': 'true' });
    const knob = el('i');
    const check = svgEl('svg', { class: 'yqx-sw-on', viewBox: '0 0 24 24' });
    check.append(svgEl('path', { d: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z' }));
    const cross = svgEl('svg', { class: 'yqx-sw-off', viewBox: '0 0 24 24' });
    cross.append(svgEl('path', { d: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' }));
    knob.append(check, cross);
    sw.append(knob);
    r.append(iconBox('opened'), textBox('Opened', 'A video I click or tap starts paused'), sw);
    r.addEventListener('click', () => cycle('opened'));
    list.append(r);
    mast.rows.opened = r;
    mast.chips = [];
    for (const [k, name, hint] of [['noQueue', 'No queue or playlist', 'A video ends and nothing follows'], ['queue', 'Queue or playlist', 'A video ends and the queue continues']]) {
      const pr = el('div', 'yqx-apm-row yqx-apm-pick', { role: 'group', 'aria-label': name });
      const top = el('span', 'yqx-apm-top');
      top.append(iconBox(k), textBox(name, hint));
      const chips = el('div', 'yqx-apm-chips', { role: 'radiogroup', 'aria-label': name });
      for (const m of ORDER) {
        const c = el('button', 'yqx-apm-chip', { type: 'button', role: 'radio', tabindex: '-1', 'aria-checked': 'false', 'data-k': k, 'data-m': m });
        c.textContent = m === 'play' ? 'Plays' : m === 'wait' ? 'Waits' : 'Stops';
        c.addEventListener('click', () => setMode(k, m));
        chips.append(c);
        mast.chips.push(c);
      }
      pr.append(top, chips);
      list.append(pr);
    }
    const foot = el('div', 'yqx-apm-foot', { 'aria-hidden': 'true' });
    foot.textContent = 'Pressing play always works.';
    const live = el('div', 'yqx-live', { role: 'status', 'aria-live': 'polite' });
    menu.append(title, list, foot, live);

    const narrow = () => btn.classList.contains('yqx-ap-end');
    segs.forEach((b, i) => {
      b.addEventListener('click', (e) => {
        if (mast.held && i === 0) { playHeld(); return; } // while a video waits, the first shape means "play it"
        if (narrow()) { // no room to unfold: the shape opens the menu
          if (mast.open) closeApMenu(e.detail === 0);
          else openApMenu(lead, e.detail === 0);
          return;
        }
        cycle(SEGS[i].k);
      });
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { mast.hi = i; layout(); } });
      b.addEventListener('pointerleave', () => { if (mast.hi === i) { mast.hi = -1; layout(); } });
      b.addEventListener('focus', () => { if (b.matches(':focus-visible')) { mast.hi = i; layout(); } });
    });
    trail.addEventListener('click', (e) => {
      if (mast.open) closeApMenu(e.detail === 0);
      else openApMenu(trail, e.detail === 0);
    });
    go.addEventListener('click', playHeld);
    for (const b of [...segs, go, trail]) {
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openApMenu(narrow() ? lead : trail, true); }
        if ([' ', 'Enter', 'ArrowDown', 'ArrowUp', 'k', 'K'].includes(e.key)) e.stopPropagation(); // keep YouTube's shortcuts out
      });
    }
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { mast.hover = true; unfold(); } });
    btn.addEventListener('pointerleave', () => { mast.hover = false; mast.hi = -1; fold(); });
    btn.addEventListener('focusin', () => { if (btn.querySelector(':focus-visible')) unfold(); });
    btn.addEventListener('focusout', () => setTimeout(fold));
    menu.addEventListener('keydown', onApMenuKey);
    menu.addEventListener('keyup', (e) => e.stopPropagation());
    menu.addEventListener('pointermove', (e) => {
      const t = e.target.closest('.yqx-apm-row-opened');
      if (t && menu.contains(document.activeElement) && document.activeElement !== t) t.focus({ preventScroll: true });
    });
    Object.assign(mast, { btn, lead, segs, go, trail, menu, live });
  }
  // ---------- "Video waiting": the button explains a held video until it plays ----------
  function markHeld(vid) {
    if (!mast.btn) return; // embeds have no top bar
    clearTimeout(mast.timer);
    Object.assign(mast, { held: true, heldFor: vid, flash: false });
    mast.btn.classList.add('yqx-held');
    mast.go.tabIndex = 0;
    mast.live.textContent = 'Resolute paused this video. Press play to start it.';
    updateMast();
    unfold();
    mast.timer = setTimeout(() => { mast.timer = 0; fold(); }, 5000); // then just the dot stays
  }
  function clearHeld() {
    if (!mast.held) return;
    clearTimeout(mast.timer);
    mast.timer = 0;
    mast.held = false;
    mast.btn.classList.remove('yqx-held');
    mast.go.tabIndex = -1;
    updateMast();
  }
  /** The held video started (any way: our Play, the player, Space/K, a media key): say so once, then step aside. */
  function releaseHeld() {
    const p = getPlayer();
    if (!mast.held) return;
    if (!p || videoIdOf(p) !== mast.heldFor) { clearHeld(); return; } // a different video: nothing to say
    clearHeld();
    mast.flash = true;
    updateMast();
    unfold();
    mast.timer = setTimeout(() => { mast.flash = false; mast.timer = 0; fold(); updateMast(); }, 1400);
  }
  function playHeld() {
    lastPlayGesture = Date.now();
    call(getPlayer(), 'playVideo');
  }
  function saveHold() {
    postToExt({ type: 'autoplay', value: { opened: holdOpened, noQueue: modeNo, queue: modeQ } });
    updateMast();
    syncAutonav();
  }
  const SAY = {
    opened: ['Opened videos will play', 'Opened videos will start paused'],
    noQueue: { play: 'With no queue, the next video plays by itself', wait: 'With no queue, the next video starts paused', stop: 'With no queue, nothing plays next' },
    queue: { play: 'In a queue or playlist, the next video plays by itself', wait: 'In a queue or playlist, the next video starts paused', stop: 'In a queue or playlist, nothing plays next' }
  };
  function setMode(k, m) {
    if (k === 'opened') holdOpened = m === 'wait';
    else if (k === 'noQueue') modeNo = m;
    else modeQ = m;
    saveHold();
    mast.live.textContent = k === 'opened' ? SAY.opened[Number(holdOpened)] : SAY[k][m];
  }
  /** One click moves a segment to its next state: plays, waits, (stops). */
  function cycle(k) {
    const n = k === 'opened' ? 2 : 3;
    setMode(k, ORDER[(stateOf(k) + 1) % n]);
  }
  /** Sizes of the three segments. Their total never changes, so the menu arrow stays under the pointer. */
  function layout() {
    const b = mast.btn;
    if (!b) return;
    const open = b.classList.contains('yqx-open') && !b.classList.contains('yqx-ap-end');
    const held = mast.held || mast.flash;
    const hi = held ? 0 : mast.hi;
    let w;
    if (!open) w = [40, 0, 0];
    else if (held) w = [40 + 8 - 3 + mast.segs[0].querySelector('.yqx-in').offsetWidth + 16, 0, 0];
    else {
      const H = mast.segs.map((sg) => 40 + 8 - 3 + sg.querySelector('.yqx-in').offsetWidth + 16);
      const R = Math.ceil((Math.max(...H) + 80) / 3);
      w = hi < 0 ? [R, R, R] : H.map((h, i) => (i === hi ? h : (3 * R - H[hi]) / 2));
    }
    mast.segs.forEach((sg, i) => {
      sg.style.width = open || i === 0 ? `${w[i]}px` : '';
      sg.style.paddingLeft = open && i !== hi ? `${Math.max(0, (w[i] - 40) / 2)}px` : '';
      sg.classList.toggle('yqx-hv', open && i === hi);
      if (i) sg.tabIndex = open && !held ? 0 : -1;
    });
    paintSegs();
  }
  /** Each segment's own shape and tint: circle (plays), cookie (waits), square (stops). Folded, the one shape shows the total. */
  function paintSegs() {
    const b = mast.btn;
    const open = b.classList.contains('yqx-open');
    const some = SEGS.filter((sg) => stateOf(sg.k) > 0).length;
    const total = some === 0 ? 0 : some === 3 ? 2 : 1;
    mast.segs.forEach((sg, i) => {
      const l = i === 0 && !open ? total : stateOf(SEGS[i].k);
      sg.dataset.l = String(l);
      sg.querySelector('.yqx-ms-shape').style.clipPath = SHAPES[l];
    });
  }
  /** Unfold into the split button (not in narrow windows, where there is no room). */
  function unfold() {
    if (!mast.btn || mast.btn.classList.contains('yqx-ap-end')) return;
    mast.btn.classList.add('yqx-open');
    mast.trail.tabIndex = 0;
    layout();
  }
  function fold() {
    if (!mast.btn || mast.hover || mast.open || mast.timer || mast.btn.contains(document.activeElement)) return;
    mast.btn.classList.remove('yqx-open');
    mast.trail.tabIndex = -1;
    layout();
  }
  function openApMenu(anchor, byKeyboard) {
    if (mast.open) return;
    mast.open = true;
    mast.anchor = anchor;
    placeApMenu();
    mast.menu.classList.add('yqx-show');
    mast.trail.setAttribute('aria-expanded', 'true');
    mast.btn.classList.add('yqx-menu-open');
    if (byKeyboard) mast.rows.opened.focus({ preventScroll: true });
  }
  function closeApMenu(returnFocus) {
    if (!mast.open) return;
    mast.open = false;
    mast.menu.classList.remove('yqx-show');
    mast.trail.setAttribute('aria-expanded', 'false');
    mast.btn.classList.remove('yqx-menu-open');
    if (returnFocus && mast.anchor) mast.anchor.focus({ preventScroll: true });
    else if (mast.menu.contains(document.activeElement)) document.activeElement.blur();
    setTimeout(fold);
  }
  function placeApMenu() {
    const r = (mast.anchor || mast.btn).getBoundingClientRect();
    const w = mast.menu.offsetWidth || 312;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const narrow = mast.btn.classList.contains('yqx-ap-end');
    let left = narrow ? r.right - w : r.left - 8;
    left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8));
    mast.menu.style.left = `${left}px`;
    mast.menu.style.top = `${r.bottom + 10}px`;
    mast.menu.style.transformOrigin = `${Math.round(r.left + r.width / 2 - left)}px 0`;
  }
  function onApMenuKey(e) {
    const items = [mast.rows.opened, ...mast.chips];
    const i = items.indexOf(document.activeElement);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': items[(i + 1) % items.length].focus(); break;
      case 'ArrowUp': case 'ArrowLeft': items[(i + items.length - 1) % items.length].focus(); break;
      case 'Home': items[0].focus(); break;
      case 'End': items[items.length - 1].focus(); break;
      case ' ': case 'Enter': if (i >= 0) items[i].click(); break;
      case 'Escape': case 'Tab': closeApMenu(true); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    e.stopPropagation(); // keep YouTube's shortcuts out while in the menu
  }
  function updateMast() {
    if (!mast.btn) return;
    const b = mast.btn;
    const stops = SEGS.some((sg) => stateOf(sg.k) === 2);
    b.dataset.opened = String(holdOpened);
    b.dataset.next = String(modeNo !== 'play' && modeQ !== 'play'); // the ring shows while some next video plays by itself
    b.dataset.stop = String(stops);
    const narrow = b.classList.contains('yqx-ap-end');
    const mid = mast.held ? 'Video waiting' : mast.flash ? 'Playing' : '';
    mast.segs.forEach((sg, i) => {
      const k = SEGS[i].k;
      sg.querySelector('.cap').textContent = i === 0 && mid ? '' : SEGS[i].cap;
      sg.querySelector('.st').textContent = i === 0 && mid ? mid : wordOf(k);
      sg.setAttribute('aria-label', i === 0 && mast.held ? 'Video waiting: Resolute paused it. Play'
        : narrow ? `Autoplay settings. ${SEGS[i].name}: ${wordOf(k)}. Opens the menu`
        : `${SEGS[i].name}: ${wordOf(k)}. Click to change`);
    });
    mast.rows.opened.setAttribute('aria-checked', String(holdOpened));
    for (const c of mast.chips) c.setAttribute('aria-checked', String((c.dataset.k === 'noQueue' ? modeNo : modeQ) === c.dataset.m));
    mast.menu.dataset.opened = String(holdOpened);
    layout();
    // new words, new widths (only if still unfolded by the time the frame comes)
    if (b.classList.contains('yqx-open')) requestAnimationFrame(() => { if (b.classList.contains('yqx-open')) layout(); });
  }
  function ensureMast() {
    if (!IS_TOP || !autoplayKnown) return;
    const center = document.querySelector('ytd-masthead #center');
    if (!center) return;
    injectStyle();
    if (!mast.btn) buildMast();
    // Narrow windows hide the search box; then sit at the start of the right-hand icons instead.
    const end = document.querySelector('ytd-masthead #end');
    const narrow = !center.offsetWidth && end && end.offsetWidth > 0;
    const parent = narrow ? end : center;
    if (narrow && mast.btn.classList.contains('yqx-open')) { mast.hover = false; fold(); }
    mast.btn.classList.toggle('yqx-ap-end', !!narrow);
    if (mast.btn.parentElement !== parent) {
      const voice = center.querySelector(':scope > #voice-search-button');
      if (narrow) end.prepend(mast.btn);
      else if (voice) voice.after(mast.btn);
      else center.append(mast.btn);
    }
    if (document.body && mast.menu.parentElement !== document.body) document.body.append(mast.menu);
    // The menu follows YouTube's theme, which lives on <html dark>.
    mast.menu.toggleAttribute('dark', document.documentElement.hasAttribute('dark'));
    document.querySelectorAll('.yqx-au').forEach((x) => { if (x !== mast.btn) x.remove(); });
    document.querySelectorAll('.yqx-apm').forEach((x) => { if (x !== mast.menu) x.remove(); });
    if (mast.open) placeApMenu();
    updateMast();
  }

  // ---------- building the UI ----------
  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }
  const ICONS = {
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    pin: 'M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5a3 3 0 0 1-3 3v2h5.97v7l1 1 1-1v-7H19v-2a3 3 0 0 1-3-3z',
    star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    channel: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
    flag: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z',
    undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
    start: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
    block: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  };
  function icon(name, className) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }

  function buildUI() {
    // Button (inside YouTube's control bar)
    const btn = el('button', 'ytp-button yqx-button yqx-pending', {
      id: 'yqx-button', type: 'button',
      'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'yqx-menu',
      'aria-label': 'Video quality'
    });
    const pill = el('span', 'yqx-pill', { 'aria-hidden': 'true' });
    btn.append(pill);

    btn.addEventListener('click', (e) => {
      if (btn.classList.contains('yqx-floating')) e.stopPropagation(); // don't pause the video
      const byKeyboard = e.detail === 0;
      if (ui.open) {
        closeMenu(byKeyboard);
      } else {
        openMenu(byKeyboard);
      }
      // After a mouse click, give focus back so Space/K still pause the video.
      if (!byKeyboard) btn.blur();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        openMenu(true);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation(); // the button handles these, not YouTube's shortcuts
      } else if (e.key === 'Escape' && ui.open) {
        e.stopPropagation();
        closeMenu(true);
      }
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
    });
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(); });
    btn.addEventListener('pointerleave', hideTip);
    btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) showTip(); });
    btn.addEventListener('blur', hideTip);

    // Menu (inside the player, so it also works in fullscreen)
    const menu = el('div', 'yqx-menu', { id: 'yqx-menu', role: 'menu', 'aria-label': 'Video quality' });
    const head = el('div', 'yqx-head', { 'aria-hidden': 'true' });
    const headRow = el('div', 'yqx-headrow');
    const title = el('span', 'yqx-title');
    title.textContent = 'Quality';
    const now = el('span', 'yqx-now');
    headRow.append(title, now);
    const chan = el('div', 'yqx-chan'); // which channel, and whether it has its own default
    head.append(headRow, chan);
    const live = el('div', 'yqx-live', { role: 'status', 'aria-live': 'polite' }); // spoken feedback
    const list = el('div', 'yqx-list');
    const foot = el('div', 'yqx-foot');
    menu.append(head, list, foot, live); // only the list scrolls; title and save rows stay visible

    // Auto + Highest as a connected two-button group; resolutions as a compact chip grid.
    const seg = el('div', 'yqx-seg', { role: 'group', 'aria-label': 'Automatic modes' });
    const grid = el('div', 'yqx-grid', { role: 'group', 'aria-label': 'Resolutions' });
    list.append(seg, grid);
    for (const o of OPTIONS) {
      const mode = o.id === 'auto' || o.id === 'highest';
      const item = el('div', mode ? 'yqx-item yqx-mode' : 'yqx-item yqx-chip',
        { role: 'menuitemradio', tabindex: '-1', 'aria-checked': 'false' });
      item.dataset.q = o.id;
      const label = el('span', 'yqx-label');
      label.textContent = mode ? o.short === 'Max' ? 'Highest' : o.label : o.short;
      const note = el('span', 'yqx-note');
      item.append(icon('check', 'yqx-check'), label, note);
      item.addEventListener('click', () => choose(o.id, false));
      (mode ? seg : grid).append(item);
      ui.items.set(o.id, item);
    }

    // Saving is always a deliberate extra step.
    const footRow = (key, iconName, role, onClick) => {
      const row = el('div', `yqx-item yqx-action yqx-${key}`, { role, tabindex: '-1' });
      const label = el('span', 'yqx-label');
      const note = el('span', 'yqx-note');
      const box = el('span', 'yqx-iconbox');
      box.append(icon(iconName, 'yqx-icon'));
      row.append(box, label, note);
      row.addEventListener('click', () => {
        if (row.getAttribute('aria-disabled') !== 'true') onClick();
      });
      foot.append(row);
      return row;
    };
    ui.rememberRow = footRow('remember', 'pin', 'menuitemcheckbox', toggleRemember);
    ui.channelRow = footRow('channel', 'channel', 'menuitemcheckbox', toggleChannel);
    ui.channelRemoveRow = footRow('channel-remove', 'close', 'menuitem', removeChannel);
    ui.defaultRow = footRow('default', 'star', 'menuitem', makeDefault);

    // Hovering an item moves keyboard focus with it (like native menus).
    menu.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.yqx-item');
      const active = document.activeElement;
      if (item && active && active.classList.contains('yqx-item') && active !== item) {
        item.focus({ preventScroll: true });
      }
    });

    const fadeIfMore = () => list.classList.toggle('yqx-more',
      list.scrollTop + list.clientHeight < list.scrollHeight - 2);
    list.addEventListener('scroll', fadeIfMore, { passive: true });
    ui.fadeIfMore = fadeIfMore;
    menu.addEventListener('keydown', onMenuKey);
    menu.addEventListener('keyup', (e) => e.stopPropagation());
    // Keep clicks/taps inside the menu from reaching the player (which would pause/play).
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
                        'touchstart', 'touchend', 'contextmenu', 'wheel']) {
      menu.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }

    const tip = el('div', 'yqx-tip', { 'aria-hidden': 'true' });

    Object.assign(ui, { btn, pill, menu, list, now, chan, live, tip });
  }

  function injectStyle() {
    if (document.getElementById('yqx-style')) return;
    const style = el('style', '', { id: 'yqx-style' });
    style.textContent = CSS;
    (document.head || document.documentElement).append(style);
  }

  /** Make sure exactly one button/menu exists and sits in the right place. */
  function ensureUI() {
    const p = getPlayer();
    if (!p) return;
    injectStyle();
    hookPlayer(p);
    if (!ui.btn) buildUI();

    // Find the best spot: just before YouTube's settings (gear) button.
    const settings = p.querySelector('.ytp-chrome-bottom .ytp-settings-button');
    const right = p.querySelector('.ytp-chrome-bottom .ytp-right-controls');
    let parent;
    let before = null;
    let floating = false;
    if (settings && settings.parentElement) {
      parent = settings.parentElement;
      before = settings;
    } else if (right) {
      parent = right;
      before = right.firstElementChild;
    } else {
      parent = p; // fallback: small button just above the progress bar
      floating = true;
    }
    // Only move the button when it is not in the right container
    // (never fight other extensions over the exact order).
    if (ui.btn.parentElement !== parent) parent.insertBefore(ui.btn, before);
    ui.btn.classList.toggle('yqx-floating', floating);
    if (ui.menu.parentElement !== p) p.append(ui.menu);
    if (ui.tip.parentElement !== p) p.append(ui.tip);
    spEnsure(p, floating);

    // Remove any stray copies (should never happen, but keeps it to one button).
    document.querySelectorAll('.yqx-button:not(.yqs-button)').forEach((b) => { if (b !== ui.btn) b.remove(); });
    document.querySelectorAll('.yqx-menu:not(.yqs-menu)').forEach((m) => { if (m !== ui.menu) m.remove(); });

    updateUI();
  }

  // ---------- updating the UI ----------
  function setPill(text) {
    if (ui.pill.textContent === text) return;
    const animate = ui.pill.textContent !== '';
    ui.pill.textContent = text;
    if (animate) {
      ui.pill.classList.remove('yqx-swap');
      void ui.pill.offsetWidth; // restart the animation
      ui.pill.classList.add('yqx-swap');
    }
  }

  function setRow(row, label, note, disabled) {
    row.querySelector('.yqx-label').textContent = label;
    row.querySelector('.yqx-note').textContent = note;
    row.setAttribute('aria-label', note ? `${label}, ${note}` : label);
    if (disabled) row.setAttribute('aria-disabled', 'true');
    else row.removeAttribute('aria-disabled');
  }

  function updateUI() {
    if (!ui.btn) return;
    ui.btn.classList.toggle('yqx-pending', !ready());
    if (!ready()) return;

    const p = getPlayer();
    const vid = currentVid(p);
    const choice = choiceFor(vid);
    const opt = optionById(choice.q);
    const levels = p ? availableLevels(p) : [];
    const known = levels.length > 0;
    const playing = p ? playingLabel(p) : '';
    const target = resolveTarget(choice.q, levels);
    const source = {
      now: 'this video only', remembered: 'remembered for this video',
      channel: 'default for this channel', default: 'default'
    }[choice.from];
    const ch = channelFor(p, vid);
    const saved = channelPref(ch);

    setPill(opt.short);
    ui.pill.dataset.from = choice.from;
    ui.tipText = `Quality: ${opt.label} (${source})${playing ? ` · Playing ${playing}` : ''}`;
    if (ui.tip.classList.contains('yqx-show')) ui.tip.textContent = ui.tipText;
    ui.btn.setAttribute('aria-label',
      `Video quality: ${opt.label}, ${source}${playing ? `. Now playing ${playing}` : ''}`);
    if (!flashTimer) ui.now.textContent = playing ? `Playing ${playing}` : '';
    ui.chan.textContent = !vid ? ''
      : !ch ? 'Channel not detected · channel defaults off for this video'
      : saved ? `${ch.name || 'This channel'} · channel default ${optionById(saved.q).label}`
      : `${ch.name || 'This channel'} · no channel default (global: ${optionById(preference).label})`;
    ui.chan.classList.toggle('yqx-chan-set', !!saved);

    // Bottom rows: save on purpose.
    const remembered = choice.from === 'remembered';
    setRow(ui.rememberRow, remembered ? 'Remembered for this video' : 'Remember for this video',
      remembered ? 'Forget' : opt.label, !vid);
    ui.rememberRow.setAttribute('aria-checked', String(remembered));
    ui.rememberRow.classList.toggle('yqx-on', remembered);
    // Channel row: set / update / remove this channel's default.
    const chName = ch && ch.name ? ch.name : 'this channel';
    if (!ch) {
      setRow(ui.channelRow, 'Default for this channel', 'Channel not detected', true);
    } else if (!saved) {
      setRow(ui.channelRow, 'Set as default for this channel', opt.label, false);
    } else if (saved.q === choice.q) {
      setRow(ui.channelRow, `Default for ${chName}`, 'Remove', false);
    } else {
      setRow(ui.channelRow, 'Update channel default', `${optionById(saved.q).label} → ${opt.label}`, false);
    }
    const channelOn = !!saved && saved.q === choice.q;
    ui.channelRow.setAttribute('aria-checked', String(channelOn));
    ui.channelRow.classList.toggle('yqx-on', channelOn);
    ui.channelRemoveRow.hidden = !saved || channelOn; // separate remove only while they differ
    if (saved) setRow(ui.channelRemoveRow, 'Remove channel default', optionById(saved.q).label, false);

    const isDefault = choice.q === preference;
    setRow(ui.defaultRow, isDefault ? 'Your default for all videos' : 'Make default for all videos',
      isDefault ? '' : opt.label, isDefault);
    ui.defaultRow.classList.toggle('yqx-on', isDefault);

    for (const o of OPTIONS) {
      const item = ui.items.get(o.id);
      const checked = o.id === choice.q;
      let note = '';
      let unavailable = false;
      if (o.id === 'highest') {
        note = known ? { hd2160: '4K', highres: '8K' }[levels[0]] || heightLabel(levels[0]) : '';
      } else if (o.id !== 'auto' && known && !levels.includes(o.id)) {
        unavailable = true;
        note = 'Not available';
      }
      if (checked && HEIGHT[o.id] && known && target && target !== o.id) {
        note = `Using ${heightLabel(target)}`;
      }
      item.setAttribute('aria-checked', String(checked));
      item.classList.toggle('yqx-checked', checked);
      item.classList.toggle('yqx-unavailable', unavailable);
      item.querySelector('.yqx-note').textContent = note;
      if (item.classList.contains('yqx-chip')) {
        if (note) item.title = unavailable ? `${o.label} isn't offered by this video` : `${note} (best this video offers)`;
        else item.removeAttribute('title');
      }
      item.setAttribute('aria-label',
        o.label + (unavailable ? ', not available on this video' : note ? `, ${note}` : ''));
    }
  }

  // ---------- menu open / close / keyboard ----------
  function positionMenu(btn = ui.btn, menu = ui.menu) {
    const p = getPlayer();
    if (!p || !btn) return;
    const pr = p.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const bar = p.querySelector('.ytp-chrome-bottom');
    const floating = btn.classList.contains('yqx-floating');
    const top = !floating && bar ? Math.min(bar.getBoundingClientRect().top, br.top) : br.top;
    const gap = 12;
    const bottom = Math.max(gap, pr.bottom - top + gap);
    let right = Math.max(gap, pr.right - br.right);
    const width = menu.offsetWidth;
    if (width && right + width > pr.width - gap) right = Math.max(gap, pr.width - width - gap);
    menu.style.bottom = `${bottom}px`;
    menu.style.right = `${right}px`;
    menu.style.maxHeight = `${Math.max(120, pr.height - bottom - gap)}px`;
  }

  function nudgeControls() {
    // Keeps YouTube's controls visible while the menu is open (like its own menus).
    const p = getPlayer();
    if (!p || !ui.btn) return;
    const r = ui.btn.getBoundingClientRect();
    p.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    }));
  }

  function openMenu(byKeyboard) {
    if (ui.open || !getPlayer() || !ready()) return;
    spClose(false);
    ensureUI();
    hideTip();
    ui.open = true;
    ui.viaKeyboard = byKeyboard;
    positionMenu();
    ui.menu.classList.add('yqx-open');
    ui.btn.setAttribute('aria-expanded', 'true');
    clearInterval(ui.keepAlive);
    ui.keepAlive = setInterval(nudgeControls, 1500);
    const current = ui.items.get(choiceFor(currentVid(getPlayer())).q);
    ui.list.scrollTop = 0;
    reveal(current); // scroll only if the current pick is out of view
    ui.fadeIfMore();
    if (byKeyboard) focusItem(current);
  }

  function closeMenu(returnFocus) {
    if (!ui.open) return;
    ui.open = false;
    ui.menu.classList.remove('yqx-open');
    ui.btn.setAttribute('aria-expanded', 'false');
    clearInterval(ui.keepAlive);
    if (returnFocus) ui.btn.focus({ preventScroll: true });
    else if (ui.menu.contains(document.activeElement)) document.activeElement.blur();
  }

  function focusItem(item) {
    if (!item) return;
    item.focus({ preventScroll: true });
    reveal(item);
  }
  function reveal(item) {
    const list = ui.list;
    if (!list.contains(item)) return; // bottom rows never scroll
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop - 8;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight + 32; // clear of the fade
    }
  }

  function onMenuKey(e) {
    const items = [...ui.menu.querySelectorAll('.yqx-item:not([hidden])')];
    const i = items.indexOf(document.activeElement);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight': focusItem(items[(i + 1) % items.length]); break;
      case 'ArrowUp':
      case 'ArrowLeft': focusItem(items[(i - 1 + items.length) % items.length]); break;
      case 'Home': focusItem(items[0]); break;
      case 'End': focusItem(items[items.length - 1]); break;
      case 'Enter':
      case ' ':
        if (i >= 0 && items[i].dataset.q) choose(items[i].dataset.q, true);
        else if (i >= 0) items[i].click(); // bottom rows keep the menu open
        break;
      case 'Escape':
      case 'Tab':
        closeMenu(true);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
    e.stopPropagation(); // keep YouTube's shortcuts (K, F, arrows…) out while in the menu
  }

  /** A pick in the list changes only this video and saves nothing. */
  function choose(id, byKeyboard) {
    const vid = currentVid(getPlayer());
    if (!VALID.has(id) || !vid) return;
    temp = { vid, q: id };
    closeMenu(byKeyboard);
    updateUI();
    scheduleApply(true); // apply to the current video right away
  }

  /** Bottom row 1: remember (or forget) this video's quality. */
  function toggleRemember() {
    const vid = currentVid(getPlayer());
    if (!vid) return;
    const choice = choiceFor(vid);
    if (choice.from === 'remembered') {
      delete overrides[vid];
      temp = { vid, q: choice.q }; // forgetting doesn't change what's playing now
      postToExt({ type: 'remember', videoId: vid, value: null });
      flash('Forgotten for this video');
    } else {
      overrides[vid] = choice.q;
      temp = null;
      postToExt({ type: 'remember', videoId: vid, value: choice.q });
      flash('Remembered for this video');
    }
    updateUI();
  }

  /** Short confirmation in the menu header (and for screen readers). */
  function flash(message) {
    clearTimeout(flashTimer);
    ui.now.textContent = `✓ ${message}`;
    ui.now.classList.add('yqx-flash');
    ui.live.textContent = message;
    flashTimer = setTimeout(() => {
      flashTimer = 0;
      ui.now.classList.remove('yqx-flash');
      updateUI();
    }, 1800);
  }

  /** Bottom row: save this video's quality as its channel's default (or remove it). */
  function toggleChannel() {
    const p = getPlayer();
    const vid = currentVid(p);
    const ch = channelFor(p, vid);
    if (!ch) return;
    const q = choiceFor(vid).q;
    const saved = channelPref(ch);
    if (saved && saved.q === q) {
      removeChannel();
      return;
    }
    channels[ch.id] = { q, name: ch.name };
    if (temp && temp.vid === vid && temp.q === q) temp = null; // now it's simply the channel default
    postToExt({ type: 'channel', channelId: ch.id, value: q, name: ch.name });
    flash(saved ? `Channel default updated to ${optionById(q).label}` : `Saved for ${ch.name || 'this channel'}`);
    updateUI();
  }

  function removeChannel() {
    const p = getPlayer();
    const vid = currentVid(p);
    const ch = channelFor(p, vid);
    if (!ch || !channels[ch.id]) return;
    const choice = choiceFor(vid);
    delete channels[ch.id];
    if (choice.from === 'channel') temp = { vid, q: choice.q }; // removing doesn't change what's playing now
    postToExt({ type: 'channel', channelId: ch.id, value: null });
    flash('Channel default removed');
    updateUI();
    // The remove row may have just vanished; keep keyboard focus on something visible.
    if (ui.menu.contains(document.activeElement) && document.activeElement.hidden) focusItem(ui.channelRow);
  }

  /** Bottom row: make this video's quality the default for all videos. */
  function makeDefault() {
    const vid = currentVid(getPlayer());
    const q = choiceFor(vid).q;
    if (q === preference) return;
    preference = q;
    if (temp && temp.vid === vid) temp = null; // now it's simply the default
    postToExt({ type: 'set', value: q });
    lastApplied = `${vid}|${choiceFor(vid).q}`; // already playing; no need to re-apply
    flash('Saved as default for all videos');
    updateUI();
  }

  // ---------- tooltip ----------
  function showTip(btn = ui.btn, text = ui.tipText) {
    const p = getPlayer();
    if (ui.open || sp.open || !p || !ready() || !ui.tip) return;
    ui.tip.textContent = text;
    const pr = p.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const bar = p.querySelector('.ytp-chrome-bottom');
    const floating = btn.classList.contains('yqx-floating');
    const top = !floating && bar ? Math.min(bar.getBoundingClientRect().top, br.top) : br.top;
    ui.tip.style.bottom = `${pr.bottom - top + 8}px`;
    const w = ui.tip.offsetWidth;
    const center = br.left + br.width / 2 - pr.left;
    ui.tip.style.left = `${Math.min(Math.max(8, center - w / 2), Math.max(8, pr.width - w - 8))}px`;
    ui.tip.classList.add('yqx-show');
  }
  function hideTip() {
    if (ui.tip) ui.tip.classList.remove('yqx-show');
  }

  // ---------- messages from the extension ----------
  function postToExt(msg) {
    window.postMessage({ source: FROM_PAGE, ...msg }, '*');
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== FROM_EXT) return;
    if (msg.type === 'pref' && VALID.has(msg.value)) {
      const changed = !prefKnown || msg.value !== preference;
      preference = msg.value;
      prefKnown = true;
      // A new default from the popup applies to the current video too (unless it has its own pick).
      if (changed) scheduleApply(false);
    } else if (msg.type === 'overrides' && msg.value && typeof msg.value === 'object') {
      overrides = { ...msg.value };
      overridesKnown = true;
      scheduleApply(false);
    } else if (msg.type === 'autoplay' && msg.value && typeof msg.value.opened === 'boolean' && ORDER.includes(msg.value.noQueue) && ORDER.includes(msg.value.queue)) {
      holdOpened = msg.value.opened;
      modeNo = msg.value.noQueue;
      modeQ = msg.value.queue;
      autoplayKnown = true;
      ensureMast();
      updateMast();
      syncAutonav();
      return;
    } else if (msg.type === 'tabActive' && typeof msg.value === 'boolean') {
      tabActive = msg.value;
      tabRefresh(); // the tab countdown follows at once
      // Selected: on screen. Not selected: keep the last answer until the re-check, so switching
      // between other tabs never looks like coming back (that restored quality and cleared the notification).
      if (tabActive) { probeId++; drawn = true; } else checkDrawn();
      awayChanged();
      return;
    } else if (msg.type === 'saver' && msg.value && typeof msg.value.on === 'boolean') {
      const v = msg.value;
      saver = {
        on: v.on,
        after: typeof v.after === 'number' && v.after > 0 && v.after <= 600 ? v.after : 30,
        to: v.to === 'large' ? 'large' : 'tiny'
      };
      if (!saver.on) endSaver(); else armSaver();
      return;
    } else if (msg.type === 'chat' && typeof msg.value === 'boolean') {
      hideChat = msg.value;
      checkChat();
      return;
    } else if (msg.type === 'cinemaSkip' && msg.value && typeof msg.value === 'object') {
      cinemaSkip = new Set(Object.keys(msg.value).filter((id) => CHANNEL_ID.test(id)));
      return;
    } else if (msg.type === 'glowStrength' && Number.isFinite(msg.value) && msg.value >= 10 && msg.value <= 100) {
      document.documentElement.style.setProperty('--yqx-gk', String(Math.round(msg.value) / 60)); // 60 = Lamp, the default
      return;
    } else if (msg.type === 'glow' && typeof msg.value === 'boolean') {
      glowOn = msg.value;
      glowSync();
      return;
    } else if (msg.type === 'cinema' && typeof msg.value === 'boolean') {
      cinemaOn = msg.value;
      updateBar();
      checkCinema();
      return;
    } else if (msg.type === 'spots' && msg.value && typeof msg.value === 'object') {
      spots = {};
      for (const [id, v] of Object.entries(msg.value)) {
        if (/^[\w-]{6,20}$/.test(id) && v && Number.isFinite(v.t) && Number.isFinite(v.at)) spots[id] = { t: v.t, at: v.at };
      }
      spotsKnown = true;
      updateResumeUI();
      scheduleResume(300); // a video that started before this arrived still gets its turn
      return;
    } else if (msg.type === 'resumeRewind' && ['off', '5', 'smart'].includes(msg.value)) {
      resumeRewind = msg.value;
      return;
    } else if (msg.type === 'resumeBar' && msg.value && typeof msg.value === 'object') {
      for (const k of Object.keys(barOpts)) barOpts[k] = msg.value[k] !== false;
      updateResumeUI();
      return;
    } else if (msg.type === 'chOff' && msg.value && typeof msg.value === 'object') {
      chOff = {};
      for (const id of Object.keys(msg.value)) if (CHANNEL_ID.test(id)) chOff[id] = String(msg.value[id] || '');
      updateResumeUI();
      return;
    } else if (msg.type === 'spotsOff' && msg.value && typeof msg.value === 'object') {
      spotsOff = {};
      for (const id of Object.keys(msg.value)) if (/^[\w-]{6,20}$/.test(id)) spotsOff[id] = true;
      updateResumeUI();
      return;
    } else if (msg.type === 'resumeRules' && msg.value && typeof msg.value === 'object') {
      for (const k of Object.keys(resumeRules)) resumeRules[k] = msg.value[k] !== false;
      return;
    } else if (spMessage(msg)) {
      return;
    } else if (msg.type === 'tabicons' && typeof msg.value === 'boolean') {
      tabIcons = msg.value;
      tabRefresh();
      return;
    } else if (msg.type === 'topbar' && typeof msg.value === 'boolean') {
      hideBar = msg.value;
      updateBar();
      return;
    } else if (msg.type === 'channels' && msg.value && typeof msg.value === 'object') {
      // Keep only well-formed entries; anything corrupted is ignored, never applied.
      channels = {};
      for (const [id, v] of Object.entries(msg.value)) {
        if (CHANNEL_ID.test(id) && v && VALID.has(v.q)) channels[id] = { q: v.q, name: String(v.name || '') };
      }
      channelsKnown = true;
      scheduleApply(false);
    } else {
      return;
    }
    updateUI();
  });

  // If the bridge never answers (very unlikely), still work with what we have.
  setTimeout(() => {
    if (!ready()) {
      prefKnown = true;
      overridesKnown = true;
      channelsKnown = true;
      updateUI();
      scheduleApply(false);
    }
    if (spGot.size < 4) { spGot.add('speedDefault').add('speedVideos').add('speedChannels').add('speedPicks'); spApply(); }
  }, 3000);

  // ---------- hide live chat: YouTube's own close button, once per video ----------
  let hideChat = false;
  let chatDoneFor = ''; // video whose chat was closed (or given up on); "Show chat" then stays yours
  let chatTimer = 0;
  let chatTries = 0;
  let chatVid = '';
  const watchVid = () => (location.pathname === '/watch' && new URLSearchParams(location.search).get('v')) || '';
  /** true = nothing left to do for this video. */
  function tryHideChat() {
    const vid = watchVid();
    if (!hideChat || !vid || chatDoneFor === vid || !document.querySelector('ytd-live-chat-frame')) return true;
    if (vid !== chatVid) { chatVid = vid; chatTries = 0; }
    let doc = null;
    try { doc = document.querySelector('iframe#chatframe')?.contentDocument; } catch { /* not ours to read */ }
    // Wait until the chat has drawn; a click before that is ignored by YouTube.
    const loaded = doc && doc.querySelector('yt-live-chat-item-list-renderer #items [id], yt-live-chat-item-list-renderer #empty-state-message');
    const close = loaded && doc.querySelector('yt-live-chat-header-renderer #close-button button');
    if (close) close.click();
    else if (++chatTries < 120) return false; // shortcut: gives up after ~60 s (e.g. chat turned off by the creator); raise if late chats get missed
    chatDoneFor = vid;
    return true;
  }
  function checkChat() {
    if (!IS_TOP || chatTimer || tryHideChat()) return;
    chatTimer = setInterval(() => {
      if (tryHideChat()) { clearInterval(chatTimer); chatTimer = 0; }
    }, 500);
  }

  // ---------- hide the top bar while a video plays ----------
  // Two attributes on <html> drive the CSS: "yqx-bar" = the feature is on and this is a watch page
  // (transitions apply), "yqx-bar-gone" = the bar is away right now.
  let hideBar = false;
  let barHover = false; // pointer on the top edge or on the bar
  let barHoldT = 0;
  const BAR_LEAVE_MS = 600; // a quick slip off the edge doesn't make the bar flicker
  const barBox = () => document.getElementById('masthead-container');
  const barOnWatch = () => IS_TOP && location.pathname === '/watch' && (hideBar || cinemaActive());
  /** Something is using the bar: a focused field (search), an open menu (account, notifications, ours). */
  function barBusy() {
    const box = barBox();
    if (!box) return false;
    try {
      if (box.matches(':focus-within')) return true;
      // Buttons only: YouTube's search box (a combobox input) says aria-expanded="true" even when idle; its focus is covered above.
      if (box.querySelector('button[aria-expanded="true"]')) return true;
    } catch { /* selector unsupported: treat as idle */ }
    return mast.open;
  }
  function barVideoPlaying() {
    const p = getPlayer();
    const v = p && p.querySelector('video');
    return !!v && !v.paused && !v.ended;
  }
  function updateBar() {
    const root = document.documentElement;
    const on = barOnWatch();
    root.toggleAttribute('yqx-bar', on);
    root.toggleAttribute('yqx-cin', IS_TOP && cinemaActive());
    ensureBar(); // idempotent: style, hover strip, and the theater watcher
    // Fullscreen: YouTube already hides its bar there, so leave it to YouTube.
    root.toggleAttribute('yqx-bar-gone', on && !document.fullscreenElement && barVideoPlaying() && !barHover && !barBusy());
  }
  function barHold() { clearTimeout(barHoldT); barHoldT = 0; if (!barHover) { barHover = true; updateBar(); } }
  function barRelease() {
    clearTimeout(barHoldT);
    barHoldT = setTimeout(function tick() {
      const box = barBox(), zone = document.getElementById('yqx-bar-zone');
      const pointed = (box && box.matches(':hover')) || (zone && zone.matches(':hover')); // pointer sits still on the bar
      if (pointed || barBusy()) { barHoldT = setTimeout(tick, BAR_LEAVE_MS); return; } // a menu is open or the pointer is still there
      barHoldT = 0; barHover = false; updateBar();
    }, BAR_LEAVE_MS);
  }
  function ensureBar() {
    if (!IS_TOP) return;
    if (!document.getElementById('yqx-bar-style')) {
      const style = el('style', '', { id: 'yqx-bar-style' });
      style.textContent = BAR_CSS;
      (document.head || document.documentElement).append(style);
    }
    let zone = document.getElementById('yqx-bar-zone');
    if (!zone) {
      zone = el('div', '', { id: 'yqx-bar-zone', 'aria-hidden': 'true' });
      zone.addEventListener('pointerenter', barHold);
      zone.addEventListener('pointerleave', barRelease);
      (document.body || document.documentElement).append(zone);
    }
    const fx = flexy();
    if (fx && !fx.__yqxTheater) { // theater flips by YouTube, by you, or by cinema mode: the bar follows
      fx.__yqxTheater = true;
      new MutationObserver(updateBar).observe(fx, { attributes: true, attributeFilter: ['theater'] });
    }
    const box = barBox();
    if (box && !box.__yqxBar) {
      box.__yqxBar = true;
      box.addEventListener('pointerenter', barHold);
      box.addEventListener('pointerleave', barRelease);
    }
  }
  for (const type of ['playing', 'pause', 'ended', 'emptied']) document.addEventListener(type, (e) => {
    if (e.target instanceof HTMLVideoElement) updateBar();
  }, true);
  // focusin/out: the focused element changes after focusout, so look one tick later.
  for (const type of ['focusin', 'focusout']) document.addEventListener(type, () => { if (hideBar) setTimeout(updateBar, 0); }, true);
  document.addEventListener('fullscreenchange', updateBar);
  document.addEventListener('keydown', (e) => {
    // Escape in the search box means "done": leave the box and drop any pointer hold, so the bar goes now.
    if (e.key !== 'Escape' || !barOnWatch()) return;
    const t = e.target, box = barBox();
    if (!(t instanceof HTMLInputElement) || !box || !box.contains(t)) return;
    clearTimeout(barHoldT); barHoldT = 0; barHover = false;
    setTimeout(() => { if (document.activeElement === t) t.blur(); updateBar(); }, 0);
  }, true);
  const BAR_CSS = `
#yqx-bar-zone{position:fixed;top:0;left:0;right:0;height:12px;z-index:2147483000;pointer-events:none}
html[yqx-bar][yqx-bar-gone] #yqx-bar-zone{pointer-events:auto}
html[yqx-bar]{--yqx-bar-sp:linear(0,.0105 1.4%,.0436 3%,.1754 6.6%,.4153 11.8%,.6593 17.9%,.8448 24.5%,.9578 31.8%,1.0148 39.8%,1.0306 47.6%,1.0222 58.5%,1.0039 76%,1)}
html[yqx-bar] #masthead-container{
  transition:transform .6s var(--yqx-bar-sp),opacity .35s cubic-bezier(.2,0,0,1),filter .45s cubic-bezier(.2,0,0,1)}
html[yqx-bar] #page-manager.ytd-app{transition:margin-top .5s cubic-bezier(.2,0,0,1)}
/* Away: slides up and softens, the page takes its place. Still focusable, so "/" and Tab reach the search box. */
html[yqx-bar][yqx-bar-gone] #masthead-container{transform:translateY(-100%);opacity:0;filter:blur(6px);pointer-events:none}
html[yqx-bar][yqx-bar-gone] #page-manager.ytd-app{margin-top:0}
/* Cinema: the player takes the whole window, the bar floats over it, and YouTube's "cover" crop is turned off. */
html[yqx-cin] .html5-video-player .html5-main-video{object-fit:contain!important}
html[yqx-cin] body ytd-watch-flexy[theater] #full-bleed-container,
html[yqx-cin] body ytd-watch-flexy[theater] #player-theater-container{height:100vh!important;min-height:100vh!important;max-height:100vh!important}
html[yqx-cin] #page-manager.ytd-app{margin-top:0!important}
@media (prefers-reduced-motion: reduce){
  html[yqx-bar] #masthead-container{transition:opacity .2s linear}
  html[yqx-bar] #page-manager.ytd-app{transition:none}
}`;

  // ---------- cinema mode: theater on open, the bar away, the video filling the window ----------
  let cinemaOn = false;
  let cinemaSkip = new Set();   // channel ids where the user left theater: they stay normal
  let cinemaDoneFor = '';       // video already handled (entered, skipped, or given up on)
  let cinemaTimer = 0;
  let cinemaTries = 0;
  let cinemaVid = '';
  const flexy = () => document.querySelector('ytd-watch-flexy');
  const isTheater = () => !!(flexy() && flexy().hasAttribute('theater'));
  const cinemaActive = () => IS_TOP && cinemaOn && location.pathname === '/watch' && isTheater() && !document.fullscreenElement;
  /** true = nothing left to do for this video. */
  function tryCinema() {
    const vid = watchVid();
    if (!cinemaOn || !vid || cinemaDoneFor === vid) return true;
    if (vid !== cinemaVid) { cinemaVid = vid; cinemaTries = 0; }
    const btn = document.querySelector('.ytp-size-button');
    const ch = channelFor(getPlayer(), vid);
    // The button is hidden in narrow windows; then there is nothing to press.
    if (!(ch && btn && flexy() && getComputedStyle(btn).display !== 'none')) {
      if (++cinemaTries < 40) return false; // shortcut: gives up after ~20 s (narrow window, no theater button); raise if slow pages are missed
      cinemaDoneFor = vid;
      return true;
    }
    cinemaDoneFor = vid;
    if (!cinemaSkip.has(ch.id) && !isTheater() && !document.fullscreenElement) btn.click(); // YouTube's own button, same as pressing T
    return true;
  }
  function checkCinema() {
    if (!IS_TOP || cinemaTimer || tryCinema()) return;
    cinemaTimer = setInterval(() => {
      if (tryCinema()) { clearInterval(cinemaTimer); cinemaTimer = 0; }
    }, 500);
  }
  /** Your own switch of theater (button or T) is a choice: out of theater = "not on this channel"; back in = undo. */
  function learnTheater() {
    const vid = watchVid();
    const ch = vid && channelFor(getPlayer(), vid);
    if (!cinemaOn || !ch) return;
    setTimeout(() => {
      if (document.fullscreenElement) return; // T does nothing there
      const stay = !isTheater();
      if (stay === cinemaSkip.has(ch.id)) return;
      if (stay) cinemaSkip.add(ch.id); else cinemaSkip.delete(ch.id);
      postToExt({ type: 'cinemaSkip', channelId: ch.id, name: ch.name, on: stay });
    }, 400);
  }
  // Resolute's own btn.click() is not trusted, so it is never mistaken for you.
  const fromUser = (e) => e.isTrusted;
  document.addEventListener('click', (e) => {
    if (fromUser(e) && e.target instanceof Element && e.target.closest('.ytp-size-button')) learnTheater();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!fromUser(e) || e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || location.pathname !== '/watch') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    learnTheater();
  }, true);

  // ---------- resume: go back to where you stopped ----------
  let spots = {};                 // { videoId: { t: seconds, at: time saved } }
  let spotsKnown = false;
  let resumeRewind = 'smart';     // "off" | "5" | "smart"
  const resumeRules = { includeLive: true, skipStart: true, endFinished: true, skipShort: true };
  let resumeVid = '';             // video whose resume was already decided (saving waits for that, so a fresh 0:00 never overwrites the old spot)
  let resumeTimer = 0;
  let spotSent = { vid: '', t: -99 };
  let skipWin = { vid: '', from: 0, to: 0 }; // the few seconds between where a resume landed and your old spot: not progress, so they never move the spot back
  let pillTimer = 0;
  const SPOT_EVERY = 5, START_SKIP = 10, END_SKIP = 30, SHORT_UNDER = 180, PILL_MS = 6000;

  /** How far before your spot the video starts. Smart: 2 s after under an hour away, 5 s under a week, else 10 s. */
  function rewindSecs(spot) {
    if (resumeRewind === 'off') return 0;
    if (resumeRewind === '5') return 5;
    const away = Date.now() - spot.at;
    return away < 3600e3 ? 2 : away < 7 * 86400e3 ? 5 : 10;
  }
  /** What kind of video this is, and why it should be left alone ('' = it counts). */
  function resumeInfo(p, v) {
    const data = call(p, 'getVideoData');
    const live = !!(data && data.isLive);
    const d = call(p, 'getDuration') || v.duration;
    const dur = Number.isFinite(d) && d > 0 ? d : 0;
    let skip = '';
    if (location.pathname.startsWith('/shorts/')) skip = 'shorts'; // never saved, no switch for it
    else if (live && !resumeRules.includeLive) skip = 'live';
    else if (!live && resumeRules.skipShort && dur > 0 && dur < SHORT_UNDER) skip = 'short';
    return { live, dur, skip };
  }
  function clearSpot(vid) {
    if (!vid || !spots[vid]) return;
    delete spots[vid];
    spotSent = { vid: '', t: -99 };
    postToExt({ type: 'spotClear', videoId: vid });
    updateResumeUI();
  }
  /** Remember where you are. Called as the video plays, and once more when you pause, leave or close the tab. */
  function saveSpot(final) {
    if (!IS_TOP || !spotsKnown) return;
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (!v || p.classList.contains('ad-showing')) return; // ad time is not your video's time
    const vid = videoIdOf(p);
    if (!vid || vid !== resumeVid || spotsOff[vid] || chOffNow(vid)) return;
    const info = resumeInfo(p, v);
    if (info.skip) return;
    const raw = call(p, 'getCurrentTime');
    const t = Number.isFinite(raw) ? raw : v.currentTime;
    if (!Number.isFinite(t) || t < 0) return;
    if (!info.live && resumeRules.endFinished && info.dur > 0 && info.dur - t <= END_SKIP) { clearSpot(vid); return; } // finished
    if (resumeRules.skipStart && t < START_SKIP) return;
    if (skipWin.vid === vid && t >= skipWin.from && t < skipWin.to) return;
    if (spotSent.vid === vid && Math.abs(t - spotSent.t) < (final ? 1 : SPOT_EVERY)) return;
    spotSent = { vid, t };
    spots[vid] = { t: Math.floor(t), at: Date.now() };
    const ch = channelFor(p, vid);
    postToExt({ type: 'spot', videoId: vid, t, channelId: ch ? ch.id : undefined });
  }

  function hideResumePill() {
    clearTimeout(pillTimer);
    const box = document.getElementById('yqx-resume');
    if (!box) return;
    box.classList.remove('yqx-on');
    getPlayer()?.classList.remove('yqx-pilled');
    setTimeout(() => { if (!box.classList.contains('yqx-on')) box.remove(); }, 600);
  }
  function showResumePill(p, text, withButton) {
    clearTimeout(pillTimer);
    document.getElementById('yqx-resume')?.remove();
    const box = el('div', 'yqx-resume', { id: 'yqx-resume', role: 'status', 'aria-live': 'polite' });
    const ico = el('span', 'yqx-resume-ico', { 'aria-hidden': 'true' });
    ico.append(icon('history', ''));
    const txt = el('span', 'yqx-resume-txt');
    txt.textContent = text;
    box.append(ico, txt);
    if (withButton) {
      const btn = el('button', 'yqx-resume-btn', { type: 'button' });
      btn.textContent = 'Start over';
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't pause the video
        const pl = getPlayer();
        if (pl) call(pl, 'seekTo', 0, true);
        skipWin = { vid: '', from: 0, to: 0 }; // from here on, every second you watch counts
        showResumePill(p, 'Back at the start', false);
      });
      box.append(btn);
      box.append(el('span', 'yqx-resume-drain', { 'aria-hidden': 'true' }));
    }
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    p.append(box);
    p.classList.add('yqx-pilled'); // the flag's label steps aside while this shows
    void box.offsetWidth; // so the first frame is the hidden one and the entrance animates
    box.classList.add('yqx-on');
    pillTimer = setTimeout(hideResumePill, withButton ? PILL_MS : 1400);
  }
  /** Once per video, shortly after it starts: jump to the saved spot unless there is a reason not to. */
  function tryResume() {
    resumeTimer = 0;
    if (!IS_TOP || !spotsKnown) return;
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (!v || p.classList.contains('ad-showing')) return; // ads: wait for the real video
    const vid = videoIdOf(p);
    if (!vid || vid === resumeVid) return;
    resumeVid = vid; // one decision per video
    const spot = spots[vid];
    anchor = spot ? { vid, t: spot.t, at: spot.at } : null; // where you left off before this viewing; the bar controls use it
    updateResumeUI();
    if (!spot || spotsOff[vid] || chOffNow(vid) || /[?&](t|start)=/.test(location.search)) return; // nothing saved, you said not to save the video or its channel, or the link has its own time
    const info = resumeInfo(p, v);
    if (info.skip) return;
    const target = Math.max(0, spot.t - rewindSecs(spot));
    const raw = call(p, 'getCurrentTime');
    const cur = Number.isFinite(raw) ? raw : v.currentTime;
    if (!(cur < target - 3)) return; // already there (YouTube resumed it) or you moved on
    if (info.live && v.seekable && v.seekable.length && target > v.seekable.end(v.seekable.length - 1)) return; // the stream no longer holds that moment
    ourSeekUntil = Date.now() + 1500;
    call(p, 'seekTo', target, true);
    skipWin = { vid, from: target, to: spot.t };
    showResumePill(p, `Resumed at ${clock(target)}`, true);
  }
  const scheduleResume = (ms) => { clearTimeout(resumeTimer); resumeTimer = setTimeout(tryResume, ms); };

  // ---------- resume: controls on the player ----------
  // A flag on the progress bar where you stopped, a lighter stripe up to it, a "Back to" chip after a long skip,
  // and a button by the clock with a small menu. They all read `anchor`: the spot you came with, which does not
  // move while you watch (the saved spot does).
  const barOpts = { flag: true, back: true, ghost: true, button: true };
  let spotsOff = {};              // videos you chose not to save { videoId: true }
  let chOff = {};                 // channels you chose not to save { UCchannelId: name }
  const chOffNow = (vid) => { const c = channelFor(getPlayer(), vid); return c && c.id in chOff ? c : null; }; // null when the channel is unknown: then nothing is blocked
  let anchor = null;              // { vid, t, at }
  let rc = null;                  // the controls, built on first use
  let menuOpen = false;
  let backTimer = 0;
  let backFrom = 0;
  let backShownAt = 0;
  let seekGesture = 0;            // last click, tap or key: a long jump right after one is yours, not YouTube's
  let ourSeekUntil = 0;           // our own seeks (resume, Jump, Start over) never offer "Back to"
  let lastT = 0;                  // playback time before any seek
  let lastTVid = '';
  let lastLayout = 0;
  const BACK_MIN = 30, BACK_MS = 8000;

  const ago = (at) => {
    const m = Math.floor((Date.now() - at) / 60e3);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
    const d = Math.floor(h / 24);
    if (d < 14) return d === 1 ? 'yesterday' : `${d} days ago`;
    const w = Math.floor(d / 7);
    return w < 9 ? `${w} weeks ago` : `${Math.floor(d / 30)} months ago`;
  };
  const stopBubble = (node, types) => { for (const t of types) node.addEventListener(t, (e) => e.stopPropagation()); }; // keep YouTube from seeking or pausing when you use ours
  const MOUSE = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick'];

  /** The video on screen, if these controls apply (not Shorts, not left out by your rules). */
  function resumeCtx() {
    if (!IS_TOP) return null;
    const p = getPlayer();
    const v = p && p.querySelector('video');
    const vid = p && videoIdOf(p);
    if (!v || !vid) return null;
    const info = resumeInfo(p, v);
    if (info.skip) return null;
    return { p, v, vid, info, a: anchor && anchor.vid === vid ? anchor : null, off: !!spotsOff[vid], chn: chOffNow(vid) };
  }

  function makeMarker(cls, iconName, onClick) {
    const box = el('div', `yqx-mkr ${cls}`);
    const tip = el('button', 'yqx-mtip', { type: 'button' });
    const label = el('span', 'yqx-mlab');
    tip.append(icon(iconName, ''), label, el('span', 'yqx-mdrain', { 'aria-hidden': 'true' }));
    stopBubble(tip, MOUSE);
    tip.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    tip.addEventListener('pointerenter', () => progHover(true));
    tip.addEventListener('pointerleave', () => progHover(false));
    box.append(el('span', 'yqx-mk', { 'aria-hidden': 'true' }), tip);
    return { box, tip, label };
  }
  function progHover(on) {
    if (!rc) return;
    clearTimeout(rc.hoverT);
    if (on) rc.layer.classList.add('yqx-hover');
    else rc.hoverT = setTimeout(() => rc.layer.classList.remove('yqx-hover'), 160);
  }
  function buildResumeUI() {
    const layer = el('div', 'yqx-rlayer');
    const ghost = el('div', 'yqx-ghost', { 'aria-hidden': 'true' });
    const fm = makeMarker('yqx-fm', 'flag', () => { const x = resumeCtx(); if (x && x.a) jumpTo(x.p, x.a.t, true); });
    const bm = makeMarker('yqx-bm', 'undo', () => { const x = resumeCtx(); if (x) jumpTo(x.p, backFrom, false); hideBack(); });
    layer.append(ghost, fm.box, bm.box);
    const btn = el('button', 'ytp-button yqx-rbutton', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    const pill = el('span', 'yqx-rpill');
    btn.append(pill);
    stopBubble(btn, MOUSE);
    btn.addEventListener('click', (e) => { e.stopPropagation(); menuOpen ? closeResumeMenu(false) : openResumeMenu(); });
    const menu = el('div', 'yqx-rmenu', { role: 'menu', 'aria-label': 'Resume options' });
    stopBubble(menu, [...MOUSE, 'click']);
    menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) onResumeAction(b.dataset.act); });
    menu.addEventListener('keydown', (e) => {
      const bs = [...menu.querySelectorAll('button:not(:disabled)')];
      const i = bs.indexOf(document.activeElement);
      if (!bs.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeResumeMenu(true); }
    });
    rc = { p: null, layer, ghost, fm, bm, btn, pill, menu, pillKey: null, geo: '', hoverT: 0, hoverEl: null, ro: null };
  }

  /** Put the flag, stripe and chip on the bar's real position (it moves with window size, theater and fullscreen). */
  function layoutResume() {
    if (!rc || !rc.p || !rc.layer.isConnected) return;
    const p = rc.p;
    const bar = p.querySelector('.ytp-progress-bar') || p.querySelector('.ytp-progress-bar-container');
    if (!bar) return;
    const pr = p.getBoundingClientRect(), br = bar.getBoundingClientRect();
    if (!br.width || !pr.width) return;
    const fill = p.querySelector('.ytp-play-progress'), fr = fill && fill.getBoundingClientRect();
    const cy = (fr && fr.height ? fr.top + fr.height / 2 : br.top + br.height / 2) - pr.top; // the drawn line, so marks sit on it
    const x0 = br.left - pr.left, w = br.width, dur = rc.dur || 0;
    const key = [x0, w, cy, pr.width, dur, rc.fmT, backFrom].join('|');
    if (key === rc.geo) return;
    rc.geo = key;
    const put = (m, t) => {
      const x = x0 + (dur ? Math.max(0, Math.min(1, t / dur)) : 0) * w;
      const edge = Math.max(0, 70 - x) || Math.min(0, pr.width - 70 - x); // keep the label inside the player
      m.box.style.left = `${x}px`;
      m.box.style.top = `${cy}px`;
      m.tip.style.setProperty('--yqx-tx', `calc(-50% + ${edge}px)`);
    };
    put(rc.fm, rc.fmT || 0);
    put(rc.bm, backFrom);
    rc.ghost.style.left = `${x0}px`;
    rc.ghost.style.top = `${cy}px`;
    rc.ghost.style.width = `${(dur ? Math.max(0, Math.min(1, (rc.fmT || 0) / dur)) : 0) * w}px`;
  }

  /** Make the controls match the video on screen. Safe to call often: it only touches what changed. */
  function updateResumeUI() {
    const ctx = resumeCtx();
    if (!ctx) { if (rc) { rc.btn.hidden = true; rc.layer.classList.add('yqx-gone'); closeResumeMenu(false); hideBack(); } return; }
    if (!rc) buildResumeUI();
    const { p, v, info, a, off, chn } = ctx;
    rc.p = p;
    // the button sits just after the clock
    const left = p.querySelector('.ytp-left-controls');
    const clockEl = left && left.querySelector('.ytp-time-display');
    if (left && rc.btn.parentElement !== left) (clockEl ? clockEl.after(rc.btn) : left.append(rc.btn));
    else if (clockEl && rc.btn.previousElementSibling !== clockEl) clockEl.after(rc.btn);
    rc.btn.hidden = !(left && barOpts.button);
    const key = `${a ? a.t : -1}|${off}|${chn ? 1 : 0}`;
    if (key !== rc.pillKey) {
      rc.pillKey = key;
      rc.pill.replaceChildren(icon(chn ? 'block' : 'history', '')); // a channel you switched off gets a slashed icon
      if (a) { const t = el('span'); t.textContent = clock(a.t); rc.pill.append(t); }
      rc.pill.classList.toggle('yqx-bare', !a);
      rc.pill.classList.toggle('yqx-nospot', !a);
      rc.pill.classList.toggle('yqx-nosave', off || !!chn);
      rc.btn.setAttribute('aria-label', (a ? `Resume options. Left off at ${clock(a.t)}` : 'Resume options. Nothing saved before') + (chn ? '. Not saving this channel' : off ? '. Not saving this video' : ''));
    }
    // the bar
    if (rc.layer.parentElement !== p) p.append(rc.layer);
    if (rc.menu.parentElement !== p) p.append(rc.menu);
    rc.layer.classList.remove('yqx-gone');
    const marks = !info.live && info.dur > 0 && !!a;
    rc.dur = info.dur;
    rc.fmT = a ? a.t : 0;
    rc.fm.box.classList.toggle('yqx-on', barOpts.flag && marks);
    rc.ghost.classList.toggle('yqx-on', barOpts.ghost && marks);
    if (a && rc.fm.label.textContent !== clock(a.t)) rc.fm.label.textContent = clock(a.t);
    const cont = p.querySelector('.ytp-progress-bar-container');
    if (cont && rc.hoverEl !== cont) { // the bar lives in YouTube's DOM and can be replaced
      rc.hoverEl = cont;
      cont.addEventListener('pointerenter', () => progHover(true));
      cont.addEventListener('pointerleave', () => progHover(false));
    }
    if (!rc.ro && typeof ResizeObserver === 'function') { rc.ro = new ResizeObserver(() => layoutResume()); rc.ro.observe(p); }
    p.classList.toggle('yqx-passed', !!a && v.currentTime >= a.t - 0.5);
    layoutResume();
  }

  function jumpTo(p, t, offerBack) {
    const from = call(p, 'getCurrentTime');
    if (offerBack && Number.isFinite(from) && Math.abs(from - t) >= BACK_MIN) showBack(from);
    ourSeekUntil = Date.now() + 1500;
    call(p, 'seekTo', t, true);
  }
  function showBack(from) {
    const ctx = resumeCtx();
    if (!barOpts.back || !rc || !ctx || ctx.info.live || !(ctx.info.dur > 0)) return;
    clearTimeout(backTimer);
    backFrom = from;
    backShownAt = Date.now();
    rc.bm.label.textContent = `Back to ${clock(from)}`;
    rc.bm.box.classList.remove('yqx-on');
    void rc.bm.box.offsetWidth; // restart the countdown line
    rc.bm.box.classList.add('yqx-on');
    ctx.p.classList.toggle('yqx-bmnear', !!ctx.a && Math.abs(from - ctx.a.t) < 150); // two labels would overlap: the chip wins
    layoutResume();
    backTimer = setTimeout(hideBack, BACK_MS);
  }
  function hideBack() {
    clearTimeout(backTimer);
    backTimer = 0;
    if (rc) rc.bm.box.classList.remove('yqx-on');
    getPlayer()?.classList.remove('yqx-bmnear');
  }

  function openResumeMenu() {
    const ctx = resumeCtx();
    if (!ctx || !rc || rc.btn.hidden) return;
    const { p, vid, a, off, chn, info } = ctx;
    const m = rc.menu;
    const head = el('div', 'yqx-mh');
    const top = el('div');
    const b = el('b');
    const small = el('small');
    if (a) {
      b.textContent = `Left off at ${clock(a.t)}`;
      small.textContent = `Saved ${ago(a.at)}${info.dur > 0 ? ` · of ${clock(info.dur)}` : ''}`;
    } else {
      b.textContent = 'Nothing saved before';
      small.textContent = off ? 'This video is not being saved' : 'Your spot is saved as you watch';
    }
    if (chn) small.textContent = `Not saved: ${chn.name || 'this channel'}`;
    top.append(b, small);
    head.append(top);
    if (a && !info.live && info.dur > 0) {
      const track = el('div', 'yqx-mt', { 'aria-hidden': 'true' });
      const pct = `${Math.max(0, Math.min(100, (a.t / info.dur) * 100)).toFixed(1)}%`;
      const fill = el('i'); fill.style.width = pct;
      const dot = el('u'); dot.style.left = pct;
      track.append(fill, dot);
      head.append(track);
    }
    const row = (act, ic, text, disabled, sub) => {
      const r = el('button', sub ? 'yqx-rrow yqx-two' : 'yqx-rrow', { type: 'button', role: 'menuitem', 'data-act': act });
      r.disabled = !!disabled;
      const t = el('span', 'yqx-tx');
      const l1 = el('span'); l1.textContent = text;
      t.append(l1);
      if (sub) { const s = el('small'); s.textContent = sub; t.append(s); }
      r.append(icon(ic, ''), t);
      return r;
    };
    const ch = channelFor(p, vid);
    m.replaceChildren(head, el('hr'),
      row('jump', 'history', a ? `Jump to ${clock(a.t)}` : 'Jump to your spot', !a),
      row('start', 'start', 'Start over', false),
      row('pause', off ? 'check' : 'block', off ? 'Save this video again' : 'Don’t save this video', false),
      row('chan', chn ? 'check' : 'channel', chn ? 'Save this channel again' : 'Don’t save this channel', !ch, ch ? ch.name || 'Unnamed channel' : 'Channel not detected'),
      row('forget', 'trash', 'Forget this spot', !a && !spots[vid]));
    const pr = p.getBoundingClientRect(), br = rc.btn.getBoundingClientRect(), w = m.offsetWidth || 246;
    m.style.left = `${Math.max(8, Math.min(pr.width - w - 8, br.left - pr.left))}px`;
    m.style.bottom = `${Math.max(8, pr.bottom - br.top + 10)}px`;
    m.classList.add('yqx-on');
    rc.btn.setAttribute('aria-expanded', 'true');
    menuOpen = true;
    m.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  function closeResumeMenu(refocus) {
    if (!menuOpen || !rc) return;
    rc.menu.classList.remove('yqx-on');
    rc.btn.setAttribute('aria-expanded', 'false');
    menuOpen = false;
    if (refocus) rc.btn.focus({ preventScroll: true });
  }
  function onResumeAction(act) {
    const ctx = resumeCtx();
    closeResumeMenu(true);
    if (!ctx) return;
    const { p, vid, a } = ctx;
    if (act === 'jump' && a) jumpTo(p, a.t, true);
    else if (act === 'start') { skipWin = { vid: '', from: 0, to: 0 }; jumpTo(p, 0, true); }
    else if (act === 'pause') {
      const off = !spotsOff[vid];
      if (off) spotsOff[vid] = true; else delete spotsOff[vid];
      postToExt({ type: 'spotOff', videoId: vid, off });
      showResumePill(p, off ? 'This video won’t be saved' : 'Saving this video again', false);
    } else if (act === 'chan') {
      const c = channelFor(p, vid);
      if (!c) return;
      const off = !(c.id in chOff);
      if (off) { chOff[c.id] = c.name; delete spots[vid]; } else delete chOff[c.id];
      postToExt({ type: 'spotChOff', channelId: c.id, name: c.name, off, videoId: vid });
      showResumePill(p, off ? 'This channel won’t be saved' : 'Saving this channel again', false);
    } else if (act === 'forget') {
      clearSpot(vid);
      if (anchor && anchor.vid === vid) anchor = null;
      showResumePill(p, 'Spot forgotten', false);
    }
    updateResumeUI();
  }

  // ---------- ambient glow: the picture's colours under the player, in its black bars, and on Resolute's glass ----------
  let glowOn = false;
  const GW = 48, GH = 27, AW = 80, AH = 120; // glow buffer (tiny: the blur does the rest) and bar check (tall, so bar edges land within a few pixels)
  const gl = {
    v: null, outer: null, ox: null, fill: null, fx: null, bx: null, ax: null, img: null, acc: null, readable: true,
    bars: { t: 0, r: 0, b: 0, l: 0 }, sc: null, cand: '', candN: 0, anAt: 0, cut: 0, still: 0, ms: 0, every: 1, n: 0,
    last: 0, req: 0, cb: false, tintAt: 0, tint: '', placeAt: 0, ro: null, fit: null
  };
  const glowWanted = () => IS_TOP && glowOn && location.pathname === '/watch';
  /** Black bars baked into the picture, as fractions of each side. Bars come in pairs (letterbox or pillarbox),
   *  so one dark edge alone is part of the scene, not a bar. An all-dark frame has no bars. */
  function glowBars(d, w, h) {
    const lum = (i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const dark = (x0, y0, dx, dy, n) => {
      let sum = 0, max = 0;
      for (let k = 0; k < n; k++) { const l = lum(((y0 + dy * k) * w + x0 + dx * k) * 4); sum += l; if (l > max) max = l; }
      return sum / n < 12 && max < 32;
    };
    const lim = (n) => Math.floor(n / 3);
    let t = 0, b = 0, l = 0, r = 0;
    while (t < lim(h) && dark(0, t, 1, 0, w)) t++;
    while (b < lim(h) && dark(0, h - 1 - b, 1, 0, w)) b++;
    while (l < lim(w) && dark(l, 0, 0, 1, h)) l++;
    while (r < lim(w) && dark(w - 1 - r, 0, 0, 1, h)) r++;
    const none = { t: 0, r: 0, b: 0, l: 0 };
    if (t >= lim(h) || l >= lim(w)) return none; // a third or more is dark: a dark scene
    const pair = (a, c) => (a >= 2 && c >= 2 && Math.abs(a - c) <= 2 ? Math.min(a, c) : 0);
    const v = pair(t, b), sd = pair(l, r);
    return { t: v / h, b: v / h, l: sd / w, r: sd / w };
  }
  /** Where the picture sits inside the <video> box. YouTube usually sizes the box to the picture; cinema uses "contain". */
  function glowFit(v) {
    const ew = v.clientWidth, eh = v.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
    if (!ew || !eh || !vw || !vh) return null;
    const fit = getComputedStyle(v).objectFit;
    if (fit === 'fill') return { x: 0, y: 0, w: ew, h: eh, ew, eh, cover: false };
    const sc = fit === 'cover' ? Math.max(ew / vw, eh / vh) : Math.min(ew / vw, eh / vh);
    const w = vw * sc, h = vh * sc;
    return { x: (ew - w) / 2, y: (eh - h) / 2, w, h, ew, eh, cover: fit === 'cover' };
  }
  /** Hide the bars inside the video (clip them off the <video>), so the lit bars behind show through. Nothing is cropped from the picture. */
  function glowClip() {
    const v = gl.v, f = gl.fit, b = gl.bars;
    if (!v) return;
    if (!f || f.cover || !(b.t || b.l)) { v.style.removeProperty('clip-path'); return; }
    // +1px on a bar's side: scaling the video blends its last black row into the first picture row
    const px = (n, bar) => `${Math.max(0, n + (bar ? 1 : 0)).toFixed(1)}px`;
    v.style.setProperty('clip-path', `inset(${px(f.y + b.t * f.h, b.t)} ${px(f.ew - f.x - f.w + b.r * f.w, b.r)} ${px(f.eh - f.y - f.h + b.b * f.h, b.b)} ${px(f.x + b.l * f.w, b.l)})`);
  }
  function glowPlace() {
    gl.placeAt = performance.now();
    const p = getPlayer();
    if (!p) return;
    const r = p.getBoundingClientRect();
    p.style.setProperty('--yqx-gb', `${Math.round(r.width * 0.035)}px`);
    if (gl.v) { gl.fit = glowFit(gl.v); glowClip(); }
    const c = gl.outer && gl.outer.parentElement;
    if (!c || !r.width) return;
    const cr = c.getBoundingClientRect();
    Object.assign(gl.outer.style, {
      left: `${r.left - cr.left - r.width * 0.08}px`, top: `${r.top - cr.top - r.height * 0.12}px`,
      width: `${r.width * 1.16}px`, height: `${r.height * 1.24}px`
    });
    gl.outer.style.setProperty('--yqx-gob', `${Math.round(r.width * 0.06)}px`);
  }
  const glowCanvas = (id) => el('canvas', '', { id, width: String(GW), height: String(GH), 'aria-hidden': 'true' });
  function glowReset() { // a new video: start the colours and the bars over
    gl.acc = null; gl.bars = { t: 0, r: 0, b: 0, l: 0 }; gl.cand = ''; gl.candN = 0; gl.cut = 0; gl.still = 0; gl.last = 0;
    if (gl.v) gl.v.style.removeProperty('clip-path');
    document.documentElement.removeAttribute('yqx-glow-live');
  }
  function glowStop() {
    if (gl.req) { try { gl.cb ? gl.v.cancelVideoFrameCallback(gl.req) : cancelAnimationFrame(gl.req); } catch { /* gone */ } }
    gl.req = 0;
  }
  function glowTeardown() {
    glowStop();
    if (glowTold) glowTell('off');
    const root = document.documentElement;
    for (const a of ['yqx-glow', 'yqx-glow-live', 'yqx-glow-dim', 'yqx-glow-ad', 'yqx-glow-tint']) root.removeAttribute(a);
    if (gl.v) gl.v.style.removeProperty('clip-path');
    if (gl.ro) { gl.ro.disconnect(); gl.ro = null; }
    if (gl.outer) gl.outer.remove();
    if (gl.fill) gl.fill.remove();
    gl.outer = gl.fill = gl.v = null;
  }
  /** Attach to the current player and video (YouTube can swap them), then start if the video plays. */
  function glowSync() {
    if (!glowWanted()) { glowTeardown(); return; }
    const p = getPlayer();
    const v = p && p.querySelector('video.html5-main-video, video');
    if (!p || !v) return;
    const root = document.documentElement;
    if (!document.getElementById('yqx-glow-style')) {
      const style = el('style', '', { id: 'yqx-glow-style' });
      style.textContent = GLOW_CSS;
      (document.head || document.documentElement).append(style);
    }
    if (!gl.bx) {
      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c.getContext('2d', { willReadFrequently: true }); };
      gl.bx = mk(GW, GH); gl.ax = mk(AW, AH);
      if (!gl.bx || !gl.ax) { gl.bx = gl.ax = null; return; } // no canvas here: nothing to draw with
      gl.img = gl.bx.createImageData(GW, GH);
    }
    if (gl.v !== v) { if (gl.v) gl.v.style.removeProperty('clip-path'); glowStop(); gl.v = v; glowReset(); }
    if (!gl.fill || !p.contains(gl.fill)) {
      if (gl.fill) gl.fill.remove();
      gl.fill = el('div', '', { id: 'yqx-glow-fill', 'aria-hidden': 'true' });
      const c = glowCanvas('yqx-glow-fill-c');
      gl.fill.append(c);
      gl.fx = c.getContext('2d');
      const box = p.querySelector('.html5-video-container');
      p.insertBefore(gl.fill, box && box.parentElement === p ? box : p.firstChild); // under the video, over the player's black
    }
    const content = document.querySelector('#content.ytd-app');
    if (content && (!gl.outer || gl.outer.parentElement !== content)) {
      if (gl.outer) gl.outer.remove();
      gl.outer = glowCanvas('yqx-glow-outer');
      gl.ox = gl.outer.getContext('2d');
      content.prepend(gl.outer);
    }
    if (!gl.fx || (gl.outer && !gl.ox)) return;
    if (!gl.ro && typeof ResizeObserver === 'function') {
      gl.ro = new ResizeObserver(() => glowPlace());
      gl.ro.observe(p);
      if (content) gl.ro.observe(content);
    }
    root.setAttribute('yqx-glow', '');
    glowPlace();
    root.toggleAttribute('yqx-glow-dim', v.paused || v.ended);
    glowStart();
  }
  function glowStart() {
    const v = gl.v;
    if (gl.req || !v || !glowWanted() || v.paused || v.ended || document.hidden) return;
    document.documentElement.removeAttribute('yqx-glow-dim');
    gl.cb = typeof v.requestVideoFrameCallback === 'function'; // only on new frames (Firefox caps it near 24 fps: plenty for a glow)
    gl.req = gl.cb ? v.requestVideoFrameCallback(glowTick) : requestAnimationFrame(glowTick);
  }
  function glowTick(now) {
    gl.req = 0;
    const v = gl.v, p = getPlayer();
    if (!v || !v.isConnected || !p || !p.contains(v)) { glowSync(); return; } // YouTube swapped the video
    if (!glowWanted() || v.paused || v.ended || document.hidden) return; // starts again on play, return or navigation
    glowStart();
    const root = document.documentElement;
    const ad = p.classList.contains('ad-showing');
    root.toggleAttribute('yqx-glow-ad', ad);
    if (ad) { gl.last = 0; return; } // no ad colours on your page
    if (now - gl.placeAt > 1000) glowPlace(); // catches layout shifts the observer can't see
    // Self-tuning: the video comes first. Slow draws = draw less often; a still picture = rest.
    gl.every = gl.still > 1 ? 12 : gl.ms > 6 ? 4 : gl.ms > 3 ? 2 : 1;
    if (++gl.n % gl.every) return;
    const dt = gl.last ? Math.min(1, (now - gl.last) / 1000) : 0;
    gl.last = now;
    const t0 = performance.now();
    if (glowDraw(dt)) root.setAttribute('yqx-glow-live', '');
    gl.ms += (performance.now() - t0 - gl.ms) * 0.2;
  }
  function glowDraw(dt) {
    const v = gl.v, vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh || v.readyState < 2) return false;
    if (gl.readable && performance.now() - gl.anAt > 100) glowAnalyse(v, vw, vh);
    const b = gl.bars, sx = b.l * vw, sy = b.t * vh, sw = vw * (1 - b.l - b.r), sh = vh * (1 - b.t - b.b); // colours from the picture, never from its bars
    if (gl.readable) {
      try {
        gl.bx.drawImage(v, sx, sy, sw, sh, 0, 0, GW, GH);
        const cur = gl.bx.getImageData(0, 0, GW, GH).data;
        if (!gl.acc) gl.acc = Float32Array.from(cur);
        const acc = gl.acc;
        let diff = 0;
        for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - acc[i]) + Math.abs(cur[i + 1] - acc[i + 1]) + Math.abs(cur[i + 2] - acc[i + 2]);
        diff /= (cur.length / 4) * 3;
        gl.still = diff < 0.6 ? gl.still + dt : 0;
        // A big change that lasts 3 draws is a cut: follow it fast. Shorter is a flash: ease past it.
        gl.cut = diff > 38 ? gl.cut + 1 : 0;
        const k = gl.cut >= 3 ? 1 - Math.exp(-dt / 0.06) : 1 - Math.exp(-dt / (diff > 38 ? 1.2 : 0.45));
        const o = gl.img.data;
        let R = 0, G = 0, B = 0;
        for (let i = 0; i < cur.length; i++) { acc[i] += (cur[i] - acc[i]) * k; o[i] = acc[i]; }
        for (let i = 0; i < cur.length; i += 4) { R += acc[i]; G += acc[i + 1]; B += acc[i + 2]; }
        if (gl.ox) gl.ox.putImageData(gl.img, 0, 0);
        gl.fx.putImageData(gl.img, 0, 0);
        if (performance.now() - gl.tintAt > 250) { // the glass follows the scene a few times a second
          gl.tintAt = performance.now();
          const n = cur.length / 4, tint = `${R / n | 0},${G / n | 0},${B / n | 0}`;
          if (tint !== gl.tint) { gl.tint = tint; document.documentElement.style.setProperty('--yqx-tint', tint); }
          document.documentElement.setAttribute('yqx-glow-tint', '');
          glowTell('on', glowThirds(acc));
        }
        return true;
      } catch {
        gl.readable = false; // a protected picture: still drawable, just not readable
        document.documentElement.removeAttribute('yqx-glow-tint');
      }
    }
    // Without reading pixels: a plain half-second fade, no cut, still or bar checks.
    const a = dt ? 1 - Math.exp(-dt / 0.5) : 1;
    for (const x of [gl.ox, gl.fx]) {
      if (!x) continue;
      x.globalAlpha = a; x.drawImage(v, sx, sy, sw, sh, 0, 0, GW, GH); x.globalAlpha = 1;
    }
    return true;
  }
  /** The left, middle and right colours of the glow, for the popup's live icon and background. */
  function glowThirds(acc) {
    return [0, 1, 2].map((t) => {
      const c = [0, 0, 0];
      let n = 0;
      for (let y = 0; y < GH; y++) for (let x = Math.floor(t * GW / 3); x < Math.floor((t + 1) * GW / 3); x++, n++) {
        const i = (y * GW + x) * 4; c[0] += acc[i]; c[1] += acc[i + 1]; c[2] += acc[i + 2];
      }
      return c.map((v) => Math.round(v / n));
    });
  }
  let glowTold = '';
  function glowTell(state, colors) { // only changes are sent: the popup asks the content script for the latest
    const p = getPlayer(), d = p && call(p, 'getVideoData');
    const msg = { type: 'glowNow', state, colors: colors || null, title: (d && typeof d.title === 'string' && d.title) || '' };
    const key = JSON.stringify(msg);
    if (key !== glowTold) { glowTold = key; postToExt(msg); }
  }
  function glowAnalyse(v, vw, vh) {
    gl.anAt = performance.now();
    try {
      gl.ax.drawImage(v, 0, 0, vw, vh, 0, 0, AW, AH);
      const r = glowBars(gl.ax.getImageData(0, 0, AW, AH).data, AW, AH);
      const key = `${r.t.toFixed(3)},${r.l.toFixed(3)}`;
      // The same bars for a full second before anything moves: a dark scene never makes the picture jump.
      if (key !== gl.cand) { gl.cand = key; gl.candN = 0; return; }
      if (++gl.candN !== 10) return;
      if (r.t) [r.t, r.b] = glowEdges(v, vw, vh, 'y', r.t, AH);
      if (r.l) [r.l, r.r] = glowEdges(v, vw, vh, 'x', r.l, AW);
      const b = gl.bars;
      if (['t', 'r', 'b', 'l'].every((k) => Math.abs(b[k] - r[k]) < 0.002)) return;
      gl.bars = r;
      glowClip();
    } catch { gl.readable = false; }
  }
  /** Exact bar edges in the video's own pixels: three 1-pixel strips across the picture, the first lit pixel wins.
   *  Kept near the rough answer, so dark content at the edge of a strip can't move it far. */
  function glowEdges(v, vw, vh, axis, rough, steps) {
    const n = Math.min(axis === 'y' ? vh : vw, 2160);
    if (!gl.sc) { gl.sc = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); }
    const c = gl.sc.canvas;
    if (axis === 'y') { c.width = 3; c.height = n; } else { c.width = n; c.height = 3; }
    for (let k = 0; k < 3; k++) {
      const at = (k + 1) / 4;
      if (axis === 'y') gl.sc.drawImage(v, vw * at, 0, 1, vh, k, 0, 1, n);
      else gl.sc.drawImage(v, 0, vh * at, vw, 1, 0, k, n, 1);
    }
    const d = gl.sc.getImageData(0, 0, c.width, c.height).data;
    const L = (k, i) => { const j = (axis === 'y' ? i * 3 + k : k * n + i) * 4; return d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11; };
    // Past the first lit pixel, skip the soft dark seam video compression leaves at a bar's edge (a few pixels at most).
    const edge = (k, at) => {
      let i = 0; while (i < n && L(k, at(i)) <= 24) i++;
      for (let g = 0; g < 6 && i + 3 < n && L(k, at(i)) < 0.8 * L(k, at(i + 3)); g++) i++;
      return i;
    };
    let a = n, z = n;
    for (let k = 0; k < 3; k++) { a = Math.min(a, edge(k, (i) => i)); z = Math.min(z, edge(k, (i) => n - 1 - i)); }
    const lo = (rough - 1 / steps) * n, hi = (rough + 2 / steps) * n, keep = (e) => Math.min(hi, Math.max(lo, e)) / n;
    return [keep(a), keep(z)];
  }
  for (const type of ['playing', 'loadedmetadata', 'pause', 'ended', 'emptied']) document.addEventListener(type, (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !glowOn) return;
    if (type === 'emptied' || type === 'loadedmetadata') { if (v === gl.v) { glowReset(); gl.fit = glowFit(v); } return; }
    if (type === 'playing') { glowSync(); return; }
    if (v === gl.v && glowWanted()) { document.documentElement.setAttribute('yqx-glow-dim', ''); if (gl.acc) glowTell('paused', glowThirds(gl.acc)); } // hold the colours, dim slowly
  }, true);
  document.addEventListener('visibilitychange', () => { if (glowOn && !document.hidden) glowStart(); });
  document.addEventListener('fullscreenchange', () => { if (glowOn) setTimeout(glowPlace, 100); });
  const GLOW_CSS = `
html[yqx-glow] #cinematics,html[yqx-glow] #cinematics-container,html[yqx-glow] #cinematics-full-bleed-container{display:none!important}
html[yqx-glow] #content.ytd-app{position:relative;z-index:0}
#yqx-glow-outer{position:absolute;z-index:-1;pointer-events:none;opacity:0;filter:blur(var(--yqx-gob,60px)) saturate(1.35);
  transition:opacity .9s cubic-bezier(.34,.8,.34,1)}
/* Strength: --yqx-gk is 0.5 (Candle) to 1.67 (Daylight), 1 = Lamp. Past full opacity it brightens instead. */
html[yqx-glow-live] #yqx-glow-outer{opacity:min(1,calc(.8 * var(--yqx-gk,1)));filter:blur(var(--yqx-gob,60px)) saturate(1.35) brightness(calc(1 + max(0, var(--yqx-gk,1) - 1) * .4))}
html[yqx-glow-live]:not([dark]) #yqx-glow-outer{opacity:min(1,calc(.45 * var(--yqx-gk,1)));filter:blur(var(--yqx-gob,60px)) saturate(1.9)}
html[yqx-glow-live][yqx-cin] #yqx-glow-outer{opacity:0}
#yqx-glow-fill{position:absolute;inset:0;overflow:hidden;pointer-events:none;opacity:0;transition:opacity .6s cubic-bezier(.34,.8,.34,1)}
#yqx-glow-fill canvas{position:absolute;left:-10%;top:-10%;width:120%;height:120%;filter:blur(var(--yqx-gb,24px)) saturate(1.25)}
html[yqx-glow-live] #yqx-glow-fill{opacity:min(1,var(--yqx-gk,1))}
html[yqx-glow] #movie_player .html5-video-container{background:transparent}
html[yqx-glow] #movie_player .html5-main-video{transition:clip-path .45s cubic-bezier(.2,0,0,1)}
html[yqx-glow-live][yqx-glow-dim] #yqx-glow-outer{opacity:min(1,calc(.3 * var(--yqx-gk,1)));transition-duration:3s}
html[yqx-glow-live][yqx-glow-dim] #yqx-glow-fill{opacity:min(1,calc(.45 * var(--yqx-gk,1)));transition-duration:3s}
html[yqx-glow-live][yqx-glow-ad] #yqx-glow-outer,html[yqx-glow-live][yqx-glow-ad] #yqx-glow-fill{opacity:0}
html[yqx-glow-tint]:not([yqx-glow-ad]) #movie_player .yqx-pill{background:rgba(var(--yqx-tint),.42);box-shadow:inset 0 0 0 1px rgba(255,255,255,.26),0 0 14px rgba(var(--yqx-tint),.4)}
html[yqx-glow-tint]:not([yqx-glow-ad]) .yqx-au:not(.yqx-open) .yqx-ms-shape{background:rgba(var(--yqx-tint),.32)}
@media (prefers-reduced-motion: reduce){#yqx-glow-outer,#yqx-glow-fill,html[yqx-glow] #movie_player .html5-main-video{transition:none}}`;

  // ---------- lifecycle ----------
  let ensureQueued = false;
  function queueEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    setTimeout(() => {
      ensureQueued = false;
      ensureUI();
      ensureMast();
      checkChat();
      checkCinema();
      ensureBar();
      updateResumeUI();
    }, 150);
  }

  document.addEventListener('yt-navigate-start', () => { saveSpot(true); hideResumePill(); hideBack(); closeResumeMenu(false); lastT = 0; resumeVid = ''; closeMenu(false); spClose(false); spHideChip(); sp.vid = ''; clearHeld(); });
  document.addEventListener('yt-navigate-finish', () => { syncAutonav(); updateBar(); checkCinema(); if (glowOn) glowSync(); });
  for (const type of ['yt-navigate-finish', 'yt-player-updated', 'yt-page-data-updated']) {
    document.addEventListener(type, () => {
      ensureUI();
      scheduleApply(false);
      checkChat();
    });
  }
  // Media events don't bubble, but the capture phase sees them (works in embeds too).
  for (const type of ['loadedmetadata', 'playing']) {
    document.addEventListener(type, (e) => {
      const p = getPlayer();
      if (p && e.target instanceof HTMLVideoElement && p.contains(e.target)) {
        checkVideoChange();
        scheduleResume(e.type === 'playing' ? 500 : 2500);
        updateResumeUI();
        if (e.type === 'loadedmetadata') syncAutonav();
        if (e.type === 'playing') {
          saverPlaying(true);
          if (!holdIfAutoplayed() && mast.held) releaseHeld(); // a later start = someone pressed play
        }
      }
    }, true);
  }
  document.addEventListener('pause', (e) => { if (e.target instanceof HTMLVideoElement) { saverPlaying(false); saveSpot(true); } }, true);
  document.addEventListener('timeupdate', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLVideoElement)) return;
    saveSpot(false);
    const p = getPlayer();
    if (!p || !p.contains(t) || p.classList.contains('ad-showing')) return; // ad time is not your video's time
    lastT = t.currentTime;
    lastTVid = videoIdOf(p);
    if (rc && anchor && Date.now() - lastLayout > 800) { lastLayout = Date.now(); p.classList.toggle('yqx-passed', t.currentTime >= anchor.t - 0.5); layoutResume(); }
  }, true);
  // A long jump right after your click or key press is yours: offer a way back. Jumps YouTube makes by itself never are.
  for (const type of ['pointerdown', 'pointerup', 'keydown']) document.addEventListener(type, () => { seekGesture = Date.now(); }, true);
  document.addEventListener('seeking', (e) => {
    const t = e.target;
    const p = getPlayer();
    if (!(t instanceof HTMLVideoElement) || !p || !p.contains(t) || p.classList.contains('ad-showing')) return;
    const vid = videoIdOf(p), from = lastT, to = t.currentTime, first = vid !== lastTVid;
    lastT = to;
    lastTVid = vid;
    if (first || from < 3 || Date.now() < ourSeekUntil || Date.now() - seekGesture > 1500) return;
    if (Math.abs(to - from) >= BACK_MIN && Date.now() - backShownAt > 1500) showBack(from); // one chip per drag, pointing at where it began
  }, true);
  document.addEventListener('pointerdown', (e) => { if (menuOpen && rc && !rc.menu.contains(e.target) && !rc.btn.contains(e.target)) closeResumeMenu(false); }, true);
  document.addEventListener('keydown', (e) => { if (menuOpen && e.key === 'Escape' && rc && !rc.menu.contains(e.target)) closeResumeMenu(true); }, true);
  window.addEventListener('pagehide', () => saveSpot(true));
  function awayChanged() {
    tabRefresh();
    if (away()) { if (!saverTimer && !saverActive) armSaver(); return; } // both signals may fire: keep one timer
    if (saverTimer && saver.on && !saverActive) saverSkip('back-early'); // you returned before the delay
    endSaver();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSpot(true); });
  document.addEventListener('visibilitychange', awayChanged);
  document.addEventListener('enterpictureinpicture', () => endSaver(), true); // never lower a video you're watching in PiP
  // A video that plays to its end: the next one to start without any input from you counts as "next".
  document.addEventListener('ended', (e) => {
    const p = getPlayer();
    if (p && e.target instanceof HTMLVideoElement && p.contains(e.target) && !p.classList.contains('ad-showing')) {
      endedAt = Date.now();
      endedVid = videoIdOf(p);
      endedQueue = inQueue();
      // "Stops" in a queue: don't let the page hear that the video ended, so it doesn't move on. shortcut: unverified on live YouTube; if it does not hold, the next video still starts paused.
      if (endedQueue && modeQ === 'stop') e.stopPropagation();
      clearSpot(endedVid); // watched to the end: next time starts fresh
    }
  }, true);
  // Remember when the user asks for playback, so their own play is never paused.
  document.addEventListener('pointerdown', (e) => {
    if (!ownControl(e.target)) lastInput = Date.now();
    if (mast.open && !ownControl(e.target)) closeApMenu(false);
    const p = getPlayer();
    const ours = ui.menu && (ui.menu.contains(e.target) || ui.btn.contains(e.target)); // quality menu isn't "play"
    if (p && p.contains(e.target) && !ours) lastPlayGesture = Date.now();
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (ownControl(t)) return; // keys on our own button/menu aren't "play"
    lastInput = Date.now();
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); // e.g. a space in search
    if (PLAY_KEYS.has(e.key) && !typing) lastPlayGesture = Date.now();
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (ui.open && !ui.menu.contains(e.target) && !ui.btn.contains(e.target)) closeMenu(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (ui.open && e.key === 'Escape' && !ui.menu.contains(e.target)) closeMenu(false);
    if (mast.open && e.key === 'Escape' && !ownControl(e.target)) closeApMenu(false);
  }, true);
  const relayout = () => requestAnimationFrame(() => {
    if (ui.open) positionMenu();
    if (sp.open) positionMenu(sp.btn, sp.menu);
    if (sp.chip && sp.chip.classList.contains('yqs-show')) { positionMenu(sp.btn, sp.chip); sp.chip.style.maxHeight = ''; }
    hideTip();
    ensureMast(); // wide <-> narrow top bar
    layoutResume();
  });
  window.addEventListener('resize', relayout);
  document.addEventListener('fullscreenchange', relayout);

  new MutationObserver(queueEnsure).observe(document.documentElement, { childList: true, subtree: true });
  postToExt({ type: 'hello' });
  queueEnsure();

  // ---------- styles (match YouTube's player look; the player UI is dark in both site themes) ----------
  // Material 3 Expressive-inspired styling (not an official implementation). The player UI is
  // dark in both YouTube themes, so the menu always uses the dark tonal palette.
  // Roles: primary = global default, secondary = this video, tertiary = channel.
  const CSS = `
.yqx-left{margin-left:6px;white-space:nowrap;opacity:.95}.yqx-left[hidden]{display:none}.yqx-left-x{color:#ffb4ab;font-weight:500}
#movie_player{
  --yqx-primary:#ffb4ab;--yqx-on-primary:#690005;--yqx-primary-container:#93000a;--yqx-on-primary-container:#ffdad6;
  --yqx-secondary:#e7bdb8;--yqx-secondary-container:#5d3f3c;--yqx-on-secondary-container:#ffdad6;
  --yqx-tertiary:#dec48c;--yqx-tertiary-container:#564419;--yqx-on-tertiary-container:#fbdfa6;
  --yqx-success:#9ed69e;
  --yqx-surface:rgba(30,20,19,.58);--yqx-surface-high:rgba(255,255,255,.08);--yqx-surface-highest:rgba(255,255,255,.12);
  --yqx-glass-edge:rgba(255,255,255,.14);
  --yqx-on-surface:#f1dedc;--yqx-on-surface-variant:#d8c2bf;--yqx-outline-variant:#534341;
  --yqx-inverse-surface:#f1dedc;--yqx-inverse-on-surface:#392e2d;
  --yqx-spring-fast:cubic-bezier(.42,1.67,.21,.9);--yqx-spring:cubic-bezier(.38,1.21,.22,1);
  --yqx-ease:cubic-bezier(.34,.8,.34,1);--yqx-exit:cubic-bezier(.3,0,.8,.15);
}
/* ---------- control-bar button: tonal pill ---------- */
#movie_player .yqx-button{width:auto!important;min-width:48px;padding:0 6px!important;display:inline-flex!important;
  align-items:center;justify-content:center;vertical-align:top;color:#fff;cursor:pointer;opacity:1}
#movie_player .yqx-button.yqx-pending{display:none!important}
#movie_player .yqx-button:focus-visible{outline:none;box-shadow:none}
.yqx-pill{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:40px;height:26px;
  padding:0 10px;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;
  font:600 12px/1 "YouTube Sans","Roboto",Arial,sans-serif;letter-spacing:.2px;white-space:nowrap;text-shadow:none;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);
  transition:background-color .2s var(--yqx-ease),color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast),transform .35s var(--yqx-spring-fast)}
#movie_player .yqx-button:hover .yqx-pill{background:rgba(255,255,255,.26)}
#movie_player .yqx-button:active .yqx-pill{transform:scale(.92)}
#movie_player .yqx-button[aria-expanded="true"] .yqx-pill{background:var(--yqx-primary);color:var(--yqx-on-primary);box-shadow:none;border-radius:9px}
#movie_player .yqx-button:focus-visible .yqx-pill{outline:3px solid var(--yqx-primary);outline-offset:2px}
#movie_player.ytp-big-mode .yqx-pill{height:32px;padding:0 13px;font-size:15px}
/* source dot: hollow ring = this video only (not saved); filled = saved, coloured by where it's saved */
.yqx-pill::after{content:"";position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;box-sizing:border-box;
  box-shadow:0 0 0 1.5px rgba(15,15,15,.75);opacity:0;transform:scale(.3);
  transition:opacity .2s var(--yqx-ease),transform .35s var(--yqx-spring-fast),background-color .2s var(--yqx-ease)}
.yqx-pill[data-from="now"]::after{opacity:1;transform:none;background:#1f1f25;border:2px solid #fff}
.yqx-pill[data-from="remembered"]::after{opacity:1;transform:none;background:var(--yqx-secondary)}
.yqx-pill[data-from="channel"]::after{opacity:1;transform:none;background:var(--yqx-tertiary)}
.yqx-pill.yqx-swap{animation:yqx-swap .4s var(--yqx-spring)}
@keyframes yqx-swap{from{opacity:0;transform:translateY(4px) scale(.9)}to{opacity:1;transform:none}}

#movie_player .yqx-button.yqx-floating{position:absolute;right:12px;bottom:64px;height:36px;z-index:60;padding:0 4px!important;
  border-radius:999px;background:rgba(0,0,0,.55);transition:opacity .25s var(--yqx-ease)}
#movie_player.ytp-autohide .yqx-button.yqx-floating{opacity:0;pointer-events:none}

/* ---------- menu ---------- */
#movie_player .yqx-menu{position:absolute;z-index:72;box-sizing:border-box;min-width:320px;max-width:calc(100% - 24px);
  display:flex;flex-direction:column;overflow:hidden;padding:8px;border-radius:28px;
  background:var(--yqx-surface);color:var(--yqx-on-surface);
  -webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);
  box-shadow:inset 0 0 0 1px var(--yqx-glass-edge),0 16px 40px rgba(0,0,0,.35);
  font:400 13px/1.3 "YouTube Sans","Roboto",Arial,sans-serif;text-shadow:none;user-select:none;-webkit-user-select:none;
  opacity:0;visibility:hidden;transform:translateY(10px) scale(.94);transform-origin:bottom right;
  transition:opacity .15s var(--yqx-exit),transform .2s var(--yqx-exit),visibility 0s linear .2s}
#movie_player .yqx-menu.yqx-open{opacity:1;visibility:visible;transform:none;
  transition:opacity .2s var(--yqx-ease),transform .5s var(--yqx-spring),visibility 0s}
.yqx-head{flex:none;padding:8px 12px 10px}
.yqx-headrow{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.yqx-title{font:500 16px/1.2 "YouTube Sans","Roboto",Arial,sans-serif;color:var(--yqx-on-surface)}
.yqx-now{font-size:12px;color:var(--yqx-on-surface-variant);white-space:nowrap}
.yqx-now.yqx-flash{color:var(--yqx-success);animation:yqx-swap .4s var(--yqx-spring)}
.yqx-chan{display:inline-block;max-width:100%;box-sizing:border-box;margin-top:6px;padding:4px 10px;border-radius:999px;
  font-size:12px;color:var(--yqx-on-surface-variant);background:var(--yqx-surface-highest);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:top}
.yqx-chan:empty{display:none}
.yqx-chan.yqx-chan-set{background:var(--yqx-tertiary-container);color:var(--yqx-on-tertiary-container)}
.yqx-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.yqx-list{position:relative;flex:1 1 auto;min-height:72px;overflow-y:auto;overscroll-behavior:contain;padding:2px;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.yqx-list.yqx-more{-webkit-mask-image:linear-gradient(#000 calc(100% - 28px),transparent);mask-image:linear-gradient(#000 calc(100% - 28px),transparent)}
.yqx-foot{flex:none;margin-top:8px;padding-top:6px;border-top:1px solid var(--yqx-glass-edge)}
.yqx-item[hidden]{display:none}

/* list rows: pills; the selected one fills and morphs to a rounded square */
.yqx-item{position:relative;display:flex;align-items:center;gap:10px;height:40px;padding:0 14px 0 10px;border-radius:20px;
  cursor:pointer;outline:none;color:var(--yqx-on-surface);
  transition:background-color .2s var(--yqx-ease),color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast)}
.yqx-item:hover{background:rgba(255,255,255,.10)}
.yqx-item:active{background:rgba(228,225,233,.12)}
#movie_player .yqx-menu .yqx-item:focus-visible{outline:2px solid var(--yqx-primary);outline-offset:2px}
.yqx-item.yqx-checked{background:var(--yqx-primary);color:var(--yqx-on-primary);border-radius:12px}
.yqx-check{width:18px;height:18px;flex:none;opacity:0;transform:scale(.3) rotate(-25deg);
  transition:opacity .15s var(--yqx-ease),transform .35s var(--yqx-spring-fast)}
.yqx-checked .yqx-check{opacity:1;transform:none}
.yqx-label{flex:1;white-space:nowrap}
.yqx-checked .yqx-label{font-weight:500}
.yqx-note{font-size:12px;color:var(--yqx-on-surface-variant);white-space:nowrap}
.yqx-checked .yqx-note{color:inherit;opacity:.85}
/* resolutions: 4-column chip grid */
.yqx-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.yqx-item.yqx-chip{justify-content:center;gap:4px;height:38px;padding:0 6px;border-radius:19px;font-weight:500;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.yqx-item.yqx-chip .yqx-note{display:none}
.yqx-item.yqx-chip .yqx-label{flex:none}
.yqx-item.yqx-chip .yqx-check{width:0;margin-right:-4px;transition:opacity .15s var(--yqx-ease),transform .35s var(--yqx-spring-fast),width .35s var(--yqx-spring-fast),margin .35s var(--yqx-spring-fast)}
.yqx-item.yqx-chip.yqx-checked{box-shadow:none}
.yqx-item.yqx-chip.yqx-checked .yqx-check{width:16px;height:16px;margin-right:0}
.yqx-item.yqx-chip.yqx-unavailable{box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.yqx-item.yqx-chip.yqx-unavailable.yqx-checked{box-shadow:inset 0 0 0 2px var(--yqx-primary);background:transparent;color:var(--yqx-primary)}
.yqx-unavailable .yqx-label{color:rgba(228,225,233,.38)}
.yqx-unavailable .yqx-note{color:rgba(228,225,233,.38);font-style:italic}

/* Auto / Highest: connected button group (outer corners round, inner corners tight) */
.yqx-seg{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:6px}
.yqx-item.yqx-mode{justify-content:center;height:42px;padding:0 10px;gap:6px;background:var(--yqx-surface-high);border-radius:22px 8px 8px 22px}
.yqx-item.yqx-mode+.yqx-item.yqx-mode{border-radius:8px 22px 22px 8px}
.yqx-item.yqx-mode .yqx-label{flex:none}
.yqx-item.yqx-mode .yqx-note{font-size:11px}
.yqx-item.yqx-mode .yqx-check{width:0;margin-right:-6px;transition:opacity .15s var(--yqx-ease),transform .35s var(--yqx-spring-fast),width .35s var(--yqx-spring-fast),margin .35s var(--yqx-spring-fast)}
.yqx-item.yqx-mode.yqx-checked .yqx-check{width:18px;margin-right:0}
.yqx-item.yqx-mode:hover{background:color-mix(in srgb,var(--yqx-on-surface) 10%,var(--yqx-surface-high))}
.yqx-item.yqx-mode.yqx-checked{background:var(--yqx-primary);color:var(--yqx-on-primary);border-radius:14px}
.yqx-item.yqx-mode.yqx-checked .yqx-note{color:var(--yqx-on-primary)}

/* save actions: role-coloured icon containers */
.yqx-iconbox{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:50%;margin-left:-4px;
  background:var(--yqx-surface-highest);color:var(--yqx-on-surface-variant);
  transition:background-color .2s var(--yqx-ease),color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast),transform .35s var(--yqx-spring-fast)}
.yqx-icon{width:18px;height:18px}
.yqx-action:active .yqx-iconbox{transform:scale(.88)}
.yqx-remember.yqx-on .yqx-iconbox{background:var(--yqx-secondary-container);color:var(--yqx-on-secondary-container);border-radius:10px}
.yqx-channel.yqx-on .yqx-iconbox{background:var(--yqx-tertiary-container);color:var(--yqx-on-tertiary-container);border-radius:10px}
.yqx-default.yqx-on .yqx-iconbox{background:var(--yqx-primary-container);color:var(--yqx-on-primary-container);border-radius:10px}
.yqx-channel-remove .yqx-iconbox{background:transparent}
.yqx-action.yqx-on .yqx-label{font-weight:500}
.yqx-action[aria-disabled="true"]{cursor:default}
.yqx-action[aria-disabled="true"]:hover{background:transparent}
.yqx-action[aria-disabled="true"] .yqx-label,.yqx-action[aria-disabled="true"] .yqx-iconbox{opacity:.45}

/* ---------- speed: the left half of one split pill (quality is the right half) ---------- */
#movie_player .yqx-button.yqs-button{padding:0 1px 0 6px!important;min-width:0}
#movie_player .yqx-button.yqs-button.yqx-floating{display:none!important}
#movie_player .yqx-button.yqx-joined{padding-left:1px!important;min-width:0}
.yqs-button .yqx-pill{min-width:36px;padding:0 8px 0 10px;border-radius:999px 6px 6px 999px;font-variant-numeric:tabular-nums}
.yqx-joined .yqx-pill{padding:0 10px 0 8px;border-radius:6px 999px 999px 6px}
.yqs-button .yqx-pill::after{right:auto;left:-3px} /* the dot sits on the outer corner, away from the joint */
#movie_player.ytp-big-mode .yqs-button .yqx-pill{padding:0 10px 0 13px}
#movie_player.ytp-big-mode .yqx-joined .yqx-pill{padding:0 13px 0 10px}
.yqs-menu .yqx-chip{flex-direction:column;gap:2px;height:44px}
.yqs-menu .yqx-chip .yqx-label{font-variant-numeric:tabular-nums}
.yqs-menu .yqx-chip .yqx-note{display:block;font-size:10.5px;line-height:1;font-variant-numeric:tabular-nums}
.yqs-menu .yqx-chip .yqx-note:empty{display:none}
.yqs-fine{display:flex;align-items:center;gap:8px;height:40px;margin-top:8px;padding:0 14px;border-radius:20px;background:var(--yqx-surface-high);cursor:pointer}
.yqs-fine input{flex:1;min-width:0;margin:0;accent-color:var(--yqx-primary);cursor:pointer}
#movie_player .yqs-fine input:focus-visible{outline:2px solid var(--yqx-primary);outline-offset:4px;border-radius:4px}
.yqs-end{font-size:11px;color:var(--yqx-on-surface-variant)}
.yqs-fine output{min-width:38px;text-align:right;font-weight:500;font-variant-numeric:tabular-nums}
.yqs-offer{display:flex;align-items:center;gap:6px;margin-top:8px;padding:5px 5px 5px 12px;border-radius:18px;
  background:var(--yqx-tertiary-container);color:var(--yqx-on-tertiary-container);font-size:12px;line-height:1.3;animation:yqx-swap .45s var(--yqx-spring)}
.yqs-offer[hidden]{display:none}
#movie_player .yqx-menu.yqs-menu{width:360px}
#movie_player.ytp-big-mode .yqx-menu.yqs-menu{width:400px}
.yqs-offer-text{flex:1;min-width:0;white-space:normal}
.yqs-offer .yqx-item{flex:none;height:30px;padding:0 12px;border-radius:15px;font-weight:500;color:inherit}
.yqs-offer .yqs-keep{background:var(--yqx-tertiary);color:#3f2e04}
.yqs-offer .yqs-keep:hover{background:color-mix(in srgb,#fff 14%,var(--yqx-tertiary))}
.yqs-channel.yqx-on .yqx-iconbox{background:var(--yqx-tertiary-container);color:var(--yqx-on-tertiary-container);border-radius:10px}
.yqs-default.yqx-on .yqx-iconbox{background:var(--yqx-primary-container);color:var(--yqx-on-primary-container);border-radius:10px}
.yqs-forget .yqx-iconbox{background:transparent}

/* the suggestion chip above the speed pill */
#movie_player .yqs-chip{position:absolute;z-index:71;display:flex;align-items:center;gap:6px;padding:5px 5px 5px 8px;border-radius:20px;
  background:var(--yqx-surface);color:var(--yqx-on-surface);-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);
  box-shadow:inset 0 0 0 1px var(--yqx-glass-edge),0 12px 30px rgba(0,0,0,.35);font:400 13px/1.3 "YouTube Sans","Roboto",Arial,sans-serif;text-shadow:none;white-space:nowrap;
  opacity:0;visibility:hidden;transform:translateY(8px) scale(.94);transform-origin:bottom right;
  transition:opacity .15s var(--yqx-exit),transform .2s var(--yqx-exit),visibility 0s linear .2s}
#movie_player .yqs-chip.yqs-show{opacity:1;visibility:visible;transform:none;transition:opacity .2s var(--yqx-ease),transform .5s var(--yqx-spring),visibility 0s}
.yqs-chip-mark{width:24px;height:24px;flex:none;display:grid;place-items:center;border-radius:8px;background:var(--yqx-tertiary-container);color:var(--yqx-on-tertiary-container);font-weight:500;font-size:12px}
.yqs-chip-text{padding:0 4px}
#movie_player .yqs-chip button{height:30px;margin:0;padding:0 12px;border:0;border-radius:15px;cursor:pointer;font:500 12.5px/1 "YouTube Sans","Roboto",Arial,sans-serif;
  color:var(--yqx-on-surface);background:transparent;transition:background-color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast),transform .35s var(--yqx-spring-fast)}
#movie_player .yqs-chip button:hover{background:rgba(255,255,255,.10)}
#movie_player .yqs-chip .yqs-chip-yes{background:var(--yqx-tertiary);color:#3f2e04}
#movie_player .yqs-chip .yqs-chip-yes:hover{background:color-mix(in srgb,#fff 14%,var(--yqx-tertiary))}
#movie_player .yqs-chip button:active{transform:scale(.94);border-radius:10px}
#movie_player .yqs-chip button:focus-visible{outline:2px solid var(--yqx-primary);outline-offset:2px}
#movie_player.ytp-big-mode .yqs-chip{font-size:15px}

/* fullscreen: larger targets */
#movie_player.ytp-big-mode .yqx-menu{font-size:16px;min-width:360px;border-radius:32px}
#movie_player.ytp-big-mode .yqx-item{height:48px;border-radius:24px}
#movie_player.ytp-big-mode .yqx-item.yqx-checked{border-radius:14px}
#movie_player.ytp-big-mode .yqx-item.yqx-mode{height:52px}
#movie_player.ytp-big-mode .yqx-item.yqx-chip{height:46px;border-radius:23px}
#movie_player.ytp-big-mode .yqx-item.yqx-chip.yqx-checked{border-radius:14px}
#movie_player.ytp-big-mode .yqx-title{font-size:19px}
#movie_player.ytp-big-mode .yqx-now,#movie_player.ytp-big-mode .yqx-note,#movie_player.ytp-big-mode .yqx-chan{font-size:14px}
#movie_player.ytp-big-mode .yqx-iconbox{width:38px;height:38px}
#movie_player.ytp-big-mode .yqx-icon{width:22px;height:22px}

/* ---------- tooltip: plain tooltip, inverse surface ---------- */
#movie_player .yqx-tip{position:absolute;z-index:73;padding:6px 10px;border-radius:8px;
  background:var(--yqx-inverse-surface);color:var(--yqx-inverse-on-surface);
  font:500 12px/1.3 "YouTube Sans","Roboto",Arial,sans-serif;white-space:nowrap;pointer-events:none;
  opacity:0;transform:translateY(4px) scale(.96);transition:opacity .15s var(--yqx-ease),transform .3s var(--yqx-spring)}
#movie_player .yqx-tip.yqx-show{opacity:1;transform:none}
#movie_player.ytp-big-mode .yqx-tip{font-size:15px}

/* ---------- "open videos paused" button beside the search box ---------- */
/* @yqx-ap-css-start (the design preview page copies this block) */
/* Material 3 Expressive tokens (seed: Resolute red). Springs are CSS linear() approximations. */
.yqx-au,.yqx-apm{
  --yqx-sp:linear(0,.0105 1.4%,.0436 3%,.1754 6.6%,.4153 11.8%,.6593 17.9%,.8448 24.5%,.9578 31.8%,1.0148 39.8%,1.0306 47.6%,1.0222 58.5%,1.0039 76%,1);
  --yqx-ease:cubic-bezier(.2,0,0,1);
  --yqx-fg:#231918;--yqx-sub:#534341;--yqx-rest:#f2f2f2;--yqx-rest-h:#e5e5e5;--yqx-shape0:#fff;
  --yqx-cont:#f6e9e7;--yqx-cont-h:#eeddda;--yqx-pc:#ffdad6;--yqx-opc:#410002;--yqx-p:#b3261e;--yqx-op:#fff;
  --yqx-menu:rgba(255,240,238,.62);--yqx-item:rgba(255,255,255,.55);--yqx-sel:rgba(255,218,214,.82);--yqx-edge:rgba(255,255,255,.7);
  --yqx-outline:#857371;--yqx-track:#f5e2df;--yqx-focus:#065fd4}
[dark] .yqx-au,.yqx-apm[dark]{
  --yqx-fg:#f1dedc;--yqx-sub:#d8c2bf;--yqx-rest:#272727;--yqx-rest-h:#3f3f3f;--yqx-shape0:#4a3e3c;
  --yqx-cont:#322826;--yqx-cont-h:#3d3231;--yqx-pc:#93000a;--yqx-opc:#ffdad6;--yqx-p:#ffb4ab;--yqx-op:#690005;
  --yqx-menu:rgba(30,20,19,.58);--yqx-item:rgba(255,255,255,.07);--yqx-sel:rgba(147,0,10,.62);--yqx-edge:rgba(255,255,255,.14);
  --yqx-outline:#a08c8a;--yqx-track:#3d3231;--yqx-focus:#3ea6ff}

/* YouTube's own autoplay switch on the player bar: Resolute's button replaces it */
.ytp-autonav-toggle-button-container,.ytp-autonav-toggle-button{display:none!important}

/* ---------- the button: a shape at rest, a split button when unfolded ---------- */
.yqx-au{position:relative;flex:none;width:40px;height:40px;margin:0 0 0 8px;z-index:5;color:var(--yqx-fg)}
.yqx-au.yqx-ap-end{margin:0 8px 0 0}
.yqx-au-row{position:absolute;top:0;left:0;height:40px;display:flex}
.yqx-au.yqx-open .yqx-seg+.yqx-seg,.yqx-au.yqx-open .yqx-au-trail,.yqx-au.yqx-held.yqx-open .yqx-au-go{margin-left:2px}
.yqx-au.yqx-held .yqx-seg+.yqx-seg{margin-left:0!important}
.yqx-ap-end .yqx-au-row{left:auto;right:0}
.yqx-au button{height:40px;margin:0;border:0;padding:0;cursor:pointer;color:inherit;display:flex;align-items:center;background:transparent;
  font:600 14px/1 "Roboto",Arial,sans-serif;-webkit-tap-highlight-color:transparent}
.yqx-au button:focus-visible{outline:2px solid var(--yqx-focus);outline-offset:2px}
.yqx-au-lead{width:40px;overflow:hidden;gap:8px;white-space:nowrap;border-radius:20px;
  transition:width .6s var(--yqx-sp),background-color .25s var(--yqx-ease),border-radius .55s var(--yqx-sp),box-shadow .3s var(--yqx-ease)}
.yqx-au-trail{width:0;overflow:hidden;justify-content:center;border-radius:6px 20px 20px 6px;opacity:0;
  transition:width .55s var(--yqx-sp),opacity .2s var(--yqx-ease),background-color .25s var(--yqx-ease),border-radius .55s var(--yqx-sp),box-shadow .3s var(--yqx-ease)}
.yqx-au.yqx-open .yqx-au-lead{background:var(--yqx-cont);border-radius:20px 6px 6px 20px;box-shadow:0 4px 16px rgba(0,0,0,.12)}
.yqx-au.yqx-open .yqx-seg+.yqx-seg{border-radius:6px}
.yqx-seg+.yqx-seg{width:0;opacity:0;pointer-events:none;padding:0}
.yqx-au.yqx-open:not(.yqx-held) .yqx-seg+.yqx-seg{opacity:1;pointer-events:auto}
.yqx-au.yqx-held .yqx-seg+.yqx-seg{width:0!important}
.yqx-au.yqx-open .yqx-au-lead:hover{background:var(--yqx-cont-h)}
.yqx-au.yqx-open .yqx-au-trail{width:36px;opacity:1;background:var(--yqx-cont);box-shadow:0 4px 16px rgba(0,0,0,.12);transition-delay:.06s,.1s,0s,0s,0s}
.yqx-au.yqx-open .yqx-au-trail:hover{background:var(--yqx-cont-h)}
.yqx-au .yqx-au-trail[aria-expanded="true"]{width:40px;border-radius:20px;background:var(--yqx-pc);color:var(--yqx-opc)}
.yqx-chev{width:12px;height:12px;flex:none;transition:transform .55s var(--yqx-sp)}
.yqx-au-trail[aria-expanded="true"] .yqx-chev{transform:rotate(180deg)}
/* "Video waiting": a red Play segment while Resolute holds a video, and a dot once folded */
.yqx-au-go{width:0;opacity:0;overflow:hidden;gap:6px;justify-content:center;border-radius:6px 20px 20px 6px;
  background:var(--yqx-p)!important;color:var(--yqx-op)!important;
  transition:width .55s var(--yqx-sp),opacity .2s var(--yqx-ease),border-radius .55s var(--yqx-sp),transform .3s var(--yqx-sp)}
.yqx-au.yqx-held.yqx-open .yqx-au-go{width:84px;opacity:1;transition-delay:.08s,.12s,0s,0s}
.yqx-au.yqx-held .yqx-au-trail{display:none}
.yqx-au-go:active{border-radius:20px;transform:scale(.96)}
.yqx-tri{width:9px;height:10px;flex:none;background:currentColor;clip-path:polygon(0 0,100% 50%,0 100%)}
.yqx-held-dot{position:absolute;top:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#ff0033;box-shadow:0 0 0 2px #fff;
  transform:scale(0);transition:transform .5s var(--yqx-sp)}
[dark] .yqx-held-dot{box-shadow:0 0 0 2px #0f0f0f}
.yqx-au.yqx-held:not(.yqx-open) .yqx-held-dot{transform:none}
/* labels: only the segment under the pointer shows words (small title over its state) */
.yqx-au-lbl{display:block;opacity:0;transform:translateX(-8px);transition:opacity .2s var(--yqx-ease),transform .55s var(--yqx-sp)}
.yqx-seg.yqx-hv .yqx-au-lbl{opacity:1;transform:none;transition-delay:.08s}
.yqx-in{display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:52px;line-height:1.1;text-align:left}
.yqx-in .cap{font-size:10.5px;font-weight:500;opacity:.7}
.yqx-in .cap:empty{display:none}
.yqx-in .st{font-size:14px;font-weight:700}

/* the shape: circle -> cookie -> rounded square (clip-path set from JS), tint = how much is on */
.yqx-ms{position:relative;flex:none;width:34px;height:34px;margin:3px}
.yqx-ms-shape{position:absolute;inset:3px;background:var(--yqx-rest);
  transition:clip-path .7s var(--yqx-sp),background-color .3s var(--yqx-ease),transform .7s var(--yqx-sp)}
.yqx-au.yqx-open .yqx-ms-shape{background:var(--yqx-shape0)}
.yqx-au:not(.yqx-open) .yqx-au-lead:hover .yqx-ms-shape{background:var(--yqx-rest-h)}
.yqx-seg[data-l="1"] .yqx-ms-shape{background:var(--yqx-pc)!important}
.yqx-seg[data-l="2"] .yqx-ms-shape{background:var(--yqx-p)!important}
.yqx-ms-core{position:absolute;inset:0;display:grid;place-items:center;color:var(--yqx-fg);transition:color .3s var(--yqx-ease)}
.yqx-seg[data-l="1"] .yqx-ms-core{color:var(--yqx-opc)}
.yqx-seg[data-l="2"] .yqx-ms-core{color:var(--yqx-op)}
.yqx-segico{position:relative;display:grid;place-items:center;width:16px;height:16px}
.yqx-segico .yqx-apm-next{width:12px;height:12px}
/* "stops": a line through the icon; folded, a small x on the shape when anything stops */
.yqx-seg[data-l="2"] .yqx-segico::after{content:"";position:absolute;left:-2px;right:-2px;top:50%;height:2px;border-radius:1px;background:currentColor;box-shadow:0 0 0 1.5px var(--yqx-p);transform:rotate(-40deg)}
.yqx-badge{position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;border-radius:50%;background:var(--yqx-p);opacity:0;transform:scale(0);transition:transform .4s var(--yqx-sp),opacity .2s;
  background-image:linear-gradient(45deg,transparent 43%,var(--yqx-op) 43% 57%,transparent 57%),linear-gradient(-45deg,transparent 43%,var(--yqx-op) 43% 57%,transparent 57%);background-size:60% 60%;background-position:center;background-repeat:no-repeat}
.yqx-au[data-stop="true"]:not(.yqx-open) .yqx-badge{opacity:1;transform:none}
.yqx-au-lead:hover .yqx-ms-shape{transform:rotate(18deg)}
.yqx-au-lead:active .yqx-ms-shape{transform:rotate(18deg) scale(.9)}
.yqx-seg[data-l="2"]:hover .yqx-ms-shape{transform:scale(1.06)} /* a tilted square reads as a card */
.yqx-seg[data-l="2"]:active .yqx-ms-shape{transform:scale(.9)}

/* wavy ring = YouTube's "up next" countdown = next videos play by themselves; it unwinds when they wait */
.yqx-wave{position:absolute;inset:-3px;width:calc(100% + 6px);height:calc(100% + 6px);transform:rotate(-90deg);overflow:visible;pointer-events:none}
.yqx-wave .yqx-act{fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:72 28;opacity:.75;
  transition:stroke-dasharray .7s var(--yqx-ease),opacity .4s var(--yqx-ease)}
.yqx-wave .yqx-track{fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-dasharray:0 76 20 4;opacity:.22;transition:opacity .4s var(--yqx-ease)}
.yqx-au[data-next="true"] .yqx-act{stroke-dasharray:0 100;opacity:0}
.yqx-au[data-next="true"] .yqx-track{opacity:0}
.yqx-au-lead:hover .yqx-wave{animation:yqx-sweep 1.4s var(--yqx-ease)}
@keyframes yqx-sweep{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}

/* glyph = videos you open: ▶ split in two halves, each half becomes one bar of ⏸ */
.yqx-ap-glyph{position:relative;display:block;width:11px;height:14px;transition:transform .5s var(--yqx-sp)}
.yqx-ap-glyph i{position:absolute;inset:0;background:currentColor;transition:clip-path .55s var(--yqx-sp)}
.yqx-ap-l{clip-path:polygon(0 0,50% 25%,50% 75%,0 100%)}
.yqx-ap-r{clip-path:polygon(50% 25%,100% 50%,100% 50%,50% 75%);transition-delay:.04s!important}
[data-opened="true"] .yqx-ap-glyph{transform:translateX(-1px)}
[data-opened="true"] .yqx-ap-l{clip-path:polygon(0 0,36% 0,36% 100%,0 100%)}
[data-opened="true"] .yqx-ap-r{clip-path:polygon(64% 0,100% 0,100% 100%,64% 100%)}

/* ---------- the menu (M3 Expressive) ---------- */
.yqx-apm{position:fixed;z-index:2300;box-sizing:border-box;width:312px;max-width:calc(100vw - 16px);padding:6px;border-radius:24px;
  background:var(--yqx-menu);color:var(--yqx-fg);
  -webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6); /* frosted, like the quality menu */
  box-shadow:inset 0 0 0 1px var(--yqx-edge),0 2px 6px rgba(0,0,0,.1),0 16px 40px rgba(0,0,0,.22);
  font:400 14px/1.35 "Roboto",Arial,sans-serif;user-select:none;-webkit-user-select:none;
  opacity:0;visibility:hidden;transform:translateY(-8px) scale(.9);
  transition:opacity .15s var(--yqx-ease),transform .25s var(--yqx-ease),visibility 0s linear .25s}
.yqx-apm.yqx-show{opacity:1;visibility:visible;transform:none;transition:opacity .2s var(--yqx-ease),transform .55s var(--yqx-sp),visibility 0s}
.yqx-apm-title{padding:10px 14px 8px;font-size:13px;font-weight:500;letter-spacing:.2px;color:var(--yqx-sub)}
.yqx-apm-list{display:flex;flex-direction:column;gap:2px}
.yqx-apm-row{display:flex;align-items:center;gap:12px;min-height:60px;padding:8px 12px;border-radius:6px;background:var(--yqx-item);cursor:pointer;outline:none;
  transition:background-color .25s var(--yqx-ease),color .25s var(--yqx-ease),border-radius .5s var(--yqx-sp)}
.yqx-apm-row:first-child{border-radius:18px 18px 6px 6px}
.yqx-apm-row:last-child{border-radius:6px 6px 18px 18px}
.yqx-apm-row:hover{background:color-mix(in srgb,var(--yqx-fg) 6%,var(--yqx-item))}
.yqx-apm-row[aria-checked="true"]{background:var(--yqx-sel);color:var(--yqx-opc);border-radius:18px}
.yqx-apm-row:focus-visible{box-shadow:inset 0 0 0 2px var(--yqx-focus)}
.yqx-apm-ico{width:36px;height:36px;flex:none;display:grid;place-items:center;border-radius:50%;background:var(--yqx-cont);
  transition:border-radius .55s var(--yqx-sp),background-color .25s var(--yqx-ease),color .25s var(--yqx-ease)}
.yqx-apm-row[aria-checked="true"] .yqx-apm-ico{background:var(--yqx-p);color:var(--yqx-op);border-radius:12px}
.yqx-apm-ico .yqx-ap-glyph{width:10px;height:12px}
.yqx-apm-next{position:relative;display:block;width:12px;height:12px}
.yqx-apm-next i{position:absolute;top:0;bottom:0;background:currentColor}
.yqx-apm-next i:first-child{left:0;width:8.5px;clip-path:polygon(0 0,100% 50%,0 100%)}
.yqx-apm-next i:last-child{right:0;width:2.4px;border-radius:1px}
.yqx-apm-pick{flex-wrap:wrap;cursor:default;min-height:0;gap:8px}
.yqx-apm-top{display:flex;align-items:center;gap:12px;flex:1 1 100%}
.yqx-apm-chips{display:flex;gap:2px;flex:1 1 100%}
.yqx-apm-chip{flex:1;height:32px;border:0;padding:0;border-radius:6px;cursor:pointer;color:inherit;background:var(--yqx-cont);font:500 13px/1 "Roboto",Arial,sans-serif;
  transition:background-color .25s var(--yqx-ease),color .25s var(--yqx-ease),border-radius .5s var(--yqx-sp)}
.yqx-apm-chip:first-child{border-radius:16px 6px 6px 16px}.yqx-apm-chip:last-child{border-radius:6px 16px 16px 6px}
.yqx-apm-chip:hover{background:var(--yqx-cont-h)}
.yqx-apm-chip[aria-checked="true"]{background:var(--yqx-p);color:var(--yqx-op);border-radius:16px}
.yqx-apm-chip:focus-visible{outline:2px solid var(--yqx-focus);outline-offset:1px}
.yqx-apm-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.yqx-apm-name{font-weight:500;font-size:14.5px}
.yqx-apm-hint{font-size:12px;opacity:.8}
/* M3 switch with icons in the thumb */
.yqx-apm-sw{position:relative;flex:none;width:52px;height:32px;border-radius:16px;background:color-mix(in srgb,var(--yqx-track) 80%,transparent);box-shadow:inset 0 0 0 2px var(--yqx-outline);
  transition:background-color .25s var(--yqx-ease),box-shadow .25s var(--yqx-ease)}
.yqx-apm-sw i{position:absolute;top:50%;left:16px;width:16px;height:16px;border-radius:50%;background:var(--yqx-outline);transform:translate(-50%,-50%);
  display:grid;place-items:center;color:var(--yqx-track);transition:left .5s var(--yqx-sp),width .4s var(--yqx-sp),height .4s var(--yqx-sp),background-color .25s var(--yqx-ease)}
.yqx-apm-sw svg{grid-area:1/1;width:12px;height:12px;fill:currentColor;transition:opacity .2s var(--yqx-ease)}
.yqx-sw-on{opacity:0}
.yqx-apm-row[aria-checked="true"] .yqx-apm-sw{background:var(--yqx-p);box-shadow:none}
.yqx-apm-row[aria-checked="true"] .yqx-apm-sw i{left:36px;width:24px;height:24px;background:var(--yqx-op);color:var(--yqx-p)}
.yqx-apm-row[aria-checked="true"] .yqx-sw-on{opacity:1}
.yqx-apm-row[aria-checked="true"] .yqx-sw-off{opacity:0}
.yqx-apm-row:active .yqx-apm-sw i{width:28px;height:28px}
.yqx-apm-foot{padding:10px 14px 8px;font-size:12px;color:var(--yqx-sub)}
/* no backdrop blur in this browser: use solid surfaces rather than a see-through menu that's hard to read */
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .yqx-apm{background:#fff0ee}.yqx-apm .yqx-apm-row{background:#fff}.yqx-apm .yqx-apm-row[aria-checked="true"]{background:#ffdad6}
  .yqx-apm[dark]{background:#231918}.yqx-apm[dark] .yqx-apm-row{background:#322826}.yqx-apm[dark] .yqx-apm-row[aria-checked="true"]{background:#93000a}
}
@media (prefers-reduced-motion: reduce){.yqx-au *,.yqx-apm,.yqx-apm *{transition:none!important;animation:none!important}}
/* @yqx-ap-css-end */

/* ---------- resume pill ---------- */
#movie_player .yqx-resume{position:absolute;left:20px;bottom:76px;z-index:71;box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:44px;
  padding:7px 8px;border-radius:22px;overflow:hidden;color:var(--yqx-on-surface);background:var(--yqx-surface);
  -webkit-backdrop-filter:blur(20px) saturate(1.7);backdrop-filter:blur(20px) saturate(1.7);
  box-shadow:inset 0 0 0 1px var(--yqx-glass-edge),0 8px 24px rgba(0,0,0,.3);
  font:500 13.5px/1.2 "YouTube Sans","Roboto",Arial,sans-serif;text-shadow:none;user-select:none;-webkit-user-select:none;
  opacity:0;transform:translateY(10px) scale(.94);transform-origin:left bottom;pointer-events:none;
  transition:opacity .2s var(--yqx-ease),transform .5s var(--yqx-spring)}
#movie_player .yqx-resume.yqx-on{opacity:1;transform:none;pointer-events:auto}
.yqx-resume-ico{width:30px;height:30px;flex:none;display:grid;place-items:center;border-radius:50%;
  background:var(--yqx-primary-container);color:var(--yqx-on-primary-container);transition:border-radius .5s var(--yqx-spring)}
.yqx-resume.yqx-on .yqx-resume-ico{border-radius:10px}
.yqx-resume-ico svg{width:17px;height:17px}
.yqx-resume-txt{white-space:nowrap;font-variant-numeric:tabular-nums;padding-right:2px}
.yqx-resume-btn{flex:none;border:0;cursor:pointer;height:30px;padding:0 12px;border-radius:999px;font:500 12.5px/1 "YouTube Sans","Roboto",Arial,sans-serif;
  color:var(--yqx-primary);background:var(--yqx-surface-high);
  transition:background-color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast),transform .35s var(--yqx-spring-fast)}
.yqx-resume-btn:hover{background:var(--yqx-surface-highest);border-radius:12px}
.yqx-resume-btn:active{transform:scale(.95)}
.yqx-resume-btn:focus-visible{outline:3px solid var(--yqx-primary);outline-offset:2px}
.yqx-resume-drain{position:absolute;left:0;bottom:0;width:100%;height:2px;background:var(--yqx-primary);transform-origin:left;transform:scaleX(0)}
.yqx-resume.yqx-on .yqx-resume-drain{animation:yqx-drain 6s linear forwards}
@keyframes yqx-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
#movie_player.ytp-big-mode .yqx-resume{bottom:110px;font-size:16px}

/* ---------- resume: progress-bar controls ---------- */
#movie_player .yqx-rlayer{position:absolute;left:0;top:0;width:100%;height:100%;z-index:70;pointer-events:none;transition:opacity .25s var(--yqx-ease)}
#movie_player.ytp-autohide .yqx-rlayer{opacity:0}
#movie_player.ad-showing .yqx-rlayer,#movie_player .yqx-rlayer.yqx-gone{display:none}
.yqx-ghost{position:absolute;height:3px;margin-top:-1.5px;border-radius:2px;background:rgba(255,255,255,.55);box-shadow:2px 0 0 rgba(255,255,255,.95);opacity:0;
  transition:opacity .5s var(--yqx-ease),height .15s var(--yqx-ease),margin .15s var(--yqx-ease)}
.yqx-ghost.yqx-on{opacity:1}
#movie_player.yqx-passed .yqx-ghost.yqx-on{opacity:.35}
.yqx-rlayer.yqx-hover .yqx-ghost{height:5px;margin-top:-2.5px}
.yqx-mkr{position:absolute;width:0;height:0;pointer-events:none}
.yqx-mk{position:absolute;left:0;top:-8px;width:3px;height:16px;margin-left:-1.5px;border-radius:2px;background:#fff;box-shadow:0 0 0 2px rgba(255,43,74,.9);
  transform:scaleY(0);transition:transform .5s var(--yqx-spring)}
.yqx-mtip{position:absolute;left:0;bottom:14px;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px 0 8px;border:0;border-radius:999px;white-space:nowrap;cursor:pointer;
  font:500 12.5px/1 "YouTube Sans","Roboto",Arial,sans-serif;font-variant-numeric:tabular-nums;color:var(--yqx-on-surface);background:var(--yqx-surface);
  -webkit-backdrop-filter:blur(16px) saturate(1.6);backdrop-filter:blur(16px) saturate(1.6);box-shadow:inset 0 0 0 1px var(--yqx-glass-edge);text-shadow:none;
  transform:translate(var(--yqx-tx,-50%),6px) scale(.85);transform-origin:bottom center;opacity:0;pointer-events:none;
  transition:transform .5s var(--yqx-spring),opacity .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast)}
.yqx-mtip:hover{border-radius:12px}
.yqx-mtip:focus-visible{outline:3px solid var(--yqx-primary);outline-offset:2px}
.yqx-mtip svg{width:16px;height:16px;flex:none;color:#ff8a9a}
.yqx-mdrain{position:absolute;left:12px;right:12px;bottom:0;height:2px;border-radius:2px;background:#ff8a9a;transform-origin:left;transform:scaleX(0)}
.yqx-fm.yqx-on .yqx-mk{transform:scaleY(1)}
.yqx-rlayer.yqx-hover .yqx-fm.yqx-on .yqx-mtip,.yqx-fm.yqx-on .yqx-mtip:focus-visible{opacity:1;pointer-events:auto;transform:translate(var(--yqx-tx,-50%),0) scale(1)}
@media (hover:none){.yqx-fm.yqx-on .yqx-mtip{opacity:1;pointer-events:auto;transform:translate(var(--yqx-tx,-50%),0) scale(1)}}
#movie_player.yqx-pilled .yqx-fm .yqx-mtip,#movie_player.yqx-bmnear .yqx-fm .yqx-mtip{opacity:0!important;pointer-events:none!important;transform:translate(var(--yqx-tx,-50%),6px) scale(.85)!important}
.yqx-bm.yqx-on .yqx-mk{transform:scaleY(1);background:var(--yqx-on-primary-container)}
.yqx-bm.yqx-on .yqx-mtip{opacity:1;pointer-events:auto;transform:translate(var(--yqx-tx,-50%),0) scale(1)}
.yqx-bm.yqx-on .yqx-mdrain{animation:yqx-drain8 8s linear forwards}
@keyframes yqx-drain8{from{transform:scaleX(1)}to{transform:scaleX(0)}}
#movie_player .yqx-rbutton{width:auto!important;min-width:0;padding:0 4px!important;display:inline-flex!important;align-items:center;justify-content:center;vertical-align:top;color:#fff;cursor:pointer;opacity:1}
#movie_player .yqx-rbutton[hidden]{display:none!important}
#movie_player .yqx-rbutton:focus-visible{outline:none;box-shadow:none}
.yqx-rpill{position:relative;display:inline-flex;align-items:center;gap:6px;height:26px;box-sizing:border-box;padding:0 11px 0 8px;border-radius:999px;background:var(--yqx-primary);color:var(--yqx-on-primary);
  font:600 12px/1 "YouTube Sans","Roboto",Arial,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.2px;white-space:nowrap;text-shadow:none;
  transition:background-color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast),transform .35s var(--yqx-spring-fast),opacity .2s var(--yqx-ease)}
.yqx-rpill svg{width:15px;height:15px;flex:none}
.yqx-rpill.yqx-bare{padding:0 7px}
.yqx-rpill.yqx-nospot{opacity:.65}
.yqx-rbutton:hover .yqx-rpill{background:color-mix(in srgb,#fff 22%,var(--yqx-primary))}
.yqx-rbutton:active .yqx-rpill{transform:scale(.92)}
.yqx-rbutton[aria-expanded="true"] .yqx-rpill{background:var(--yqx-inverse-surface);color:var(--yqx-inverse-on-surface);border-radius:9px}
.yqx-rbutton:focus-visible .yqx-rpill{outline:3px solid var(--yqx-primary);outline-offset:2px}
.yqx-rpill::after{content:"";position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;box-sizing:border-box;background:#ff2b4a;box-shadow:0 0 0 1.5px rgba(15,15,15,.75);transition:background-color .2s var(--yqx-ease)}
.yqx-rpill.yqx-nosave::after{background:#1f1f25;border:2px solid #fff;box-shadow:none}
#movie_player.ytp-big-mode .yqx-rpill{height:32px;padding:0 14px 0 10px;font-size:15px}
#movie_player.ytp-big-mode .yqx-rpill.yqx-bare{padding:0 9px}
#movie_player .yqx-rmenu{position:absolute;z-index:72;box-sizing:border-box;min-width:246px;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:22px;color:var(--yqx-on-surface);
  background:var(--yqx-surface);-webkit-backdrop-filter:blur(20px) saturate(1.7);backdrop-filter:blur(20px) saturate(1.7);box-shadow:inset 0 0 0 1px var(--yqx-glass-edge),0 8px 24px rgba(0,0,0,.3);
  font:500 13px/1.2 "YouTube Sans","Roboto",Arial,sans-serif;text-shadow:none;user-select:none;-webkit-user-select:none;
  opacity:0;transform:translateY(10px) scale(.94);transform-origin:bottom left;pointer-events:none;visibility:hidden;
  transition:opacity .2s var(--yqx-ease),transform .5s var(--yqx-spring),visibility 0s .5s}
#movie_player .yqx-rmenu.yqx-on{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition-delay:0s}
.yqx-mh{display:flex;flex-direction:column;gap:9px;padding:10px 12px 8px}
.yqx-mh b{display:block;font-weight:500;font-size:14px;font-variant-numeric:tabular-nums}
.yqx-mh small{display:block;margin-top:2px;font-weight:400;font-size:12px;opacity:.72}
.yqx-mt{position:relative;height:4px;border-radius:2px;background:rgba(255,255,255,.25)}
.yqx-mt i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:#ff2b4a}
.yqx-mt u{position:absolute;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #ff2b4a}
.yqx-rmenu hr{border:0;height:1px;margin:2px 8px;background:rgba(255,255,255,.12)}
.yqx-rrow{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:0 14px 0 10px;border:0;border-radius:12px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;
  transition:background-color .2s var(--yqx-ease),border-radius .35s var(--yqx-spring-fast)}
.yqx-rrow svg{width:18px;height:18px;flex:none;color:var(--yqx-primary)}
.yqx-rrow.yqx-two{padding-block:6px}
.yqx-rrow .yqx-tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.yqx-rrow .yqx-tx small{font-weight:400;font-size:11.5px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.yqx-rrow:hover:not(:disabled),.yqx-rrow:focus-visible{background:var(--yqx-surface-highest);border-radius:16px;outline:none}
.yqx-rrow:disabled{opacity:.4;cursor:default}
#movie_player.ytp-big-mode .yqx-rmenu{font-size:15px;min-width:290px}
@media (prefers-reduced-motion: reduce){
  .yqx-menu,.yqx-resume,.yqx-rmenu,.yqx-rpill,.yqx-mtip,.yqx-mk,.yqx-ghost,.yqx-mdrain,.yqx-rlayer,.yqx-rrow,.yqx-resume-ico,.yqx-resume-btn,.yqx-resume-drain,.yqx-pill,.yqx-pill::after,.yqx-check,.yqx-iconbox,.yqx-tip,.yqx-item,.yqx-now{transition:none!important;animation:none!important}
}`;
})();
