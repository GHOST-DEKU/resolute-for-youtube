/*
 * YouTube Quality Control — in-player button, menu and quality logic.
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
  let holdNext = false;          // "Next in queue or playlist" start paused
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
          if (p2 && videoIdOf(p2) === vid && call(p2, 'getPlaybackQuality') !== target &&
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
    endedAt = 0;
    if (Date.now() - lastPlayGesture < 1000) return false; // you pressed play: leave it playing
    if (!(next ? holdNext : holdOpened)) return false;
    call(p, 'pauseVideo');
    markHeld(vid);
    return true;
  }
  const ownControl = (t) => !!(mast.btn && t && t.nodeType === 1 && (mast.btn.contains(t) || mast.menu.contains(t)));

  // ---------- background saver: lower quality while you're on another tab ----------
  // Rough YouTube bitrates (Mbit/s) per quality, only to estimate what was saved. shortcut: fixed table, not measured
  const MBPS = { tiny: 0.1, small: 0.3, medium: 0.6, large: 1.1, hd720: 2.5, hd1080: 4.5, hd1440: 9, hd2160: 18, highres: 30 };
  const inPip = () => !!document.pictureInPictureElement;
  function armSaver() {
    clearTimeout(saverTimer);
    if (!IS_TOP || !saver.on || !PIP_KNOWN || document.visibilityState !== 'hidden') return;
    saverTimer = setTimeout(startSaver, saver.after * 1000);
  }
  function startSaver() {
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (saverActive || !saver.on || document.visibilityState !== 'hidden' || !p || !v || v.paused || inPip()) return;
    if (p.classList.contains('ad-showing')) { saverTimer = setTimeout(startSaver, 5000); return; } // ads: try after
    const levels = availableLevels(p);
    const fromQ = call(p, 'getPlaybackQuality');
    const target = resolveTarget(saver.to, levels);
    if (!target || !HEIGHT[fromQ] || HEIGHT[fromQ] <= HEIGHT[target]) return; // already that low: nothing to save
    saverActive = { q: saver.to, fromQ, ms: 0, t0: Date.now() };
    forceQuality(p, target);
    forcedEarlier = true;
    lastApplied = `${videoIdOf(p)}|${saver.to}`;
    tabMark(heightLabel(target));
  }
  function endSaver() {
    clearTimeout(saverTimer);
    if (!saverActive) return;
    const a = saverActive;
    saverActive = null;
    if (a.t0) a.ms += Date.now() - a.t0;
    tabMark('');
    const mb = ((MBPS[a.fromQ] || 0) - (MBPS[resolveTarget(a.q, Object.keys(MBPS))] || 0)) * a.ms / 8000;
    if (mb >= 0.5) postToExt({ type: 'saved', mb: Math.round(mb * 10) / 10 });
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
  function tabMark(label) {
    if (tab.obs) { tab.obs.disconnect(); tab.obs = null; }
    if (tab.prefix && document.title.startsWith(tab.prefix)) document.title = document.title.slice(tab.prefix.length);
    tab.prefix = '';
    // Browsers (Chromium/Vivaldi especially) don't always repaint the tab when an icon's href changes in place,
    // but always pick up a new icon element. So: take YouTube's icons out, add ours, and put theirs back after.
    if (label && !tab.icon) {
      tab.saved = [...document.querySelectorAll('link[rel~="icon"]')].map((l) => [l, l.parentNode, l.nextSibling]);
      tab.saved.forEach(([l]) => l.remove());
      tab.icon = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: LEAF_ICON });
      tab.icon.id = 'yqx-saver-icon';
      (document.head || document.documentElement).append(tab.icon);
    } else if (!label && tab.icon) {
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

  // ---------- autoplay button next to YouTube's search box (top page only) ----------
  // Material 3 Expressive "unfolding split button". At rest it is one small shape beside the mic button:
  //   the glyph  ▶ → ⏸            = videos you open start paused
  //   the wavy ring unwinds       = next videos in a queue/playlist start paused
  //   the shape: circle → cookie → rounded square, tinted soft → solid = how much is on
  // Pointing at it unfolds a split button: [shape + words] switches both settings, [chevron] opens a menu
  // with a switch for each. It floats over empty space, so YouTube's layout never moves.
  const IS_TOP = window === window.top && location.hostname === 'www.youtube.com';
  const mast = { btn: null, lead: null, go: null, trail: null, lbl: null, menu: null, rows: {}, live: null, hover: false, open: false, word: '',
    held: false, heldFor: '', flash: false, timer: 0 };
  const summary = () => (holdOpened && holdNext ? 'Videos wait for you'
    : holdOpened ? 'Opened videos wait' : holdNext ? 'Next videos wait' : 'Autoplay on');
  const shortWord = () => (holdOpened && holdNext ? 'No autoplay' : holdOpened ? 'Opened wait' : holdNext ? 'Next wait' : 'Autoplay');
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
  function buildMast() {
    const btn = el('span', 'yqx-au', { id: 'yqx-autoplay' });
    const row = el('span', 'yqx-au-row');
    const lead = el('button', 'yqx-au-lead', { type: 'button', 'aria-pressed': 'false' });
    const ms = el('span', 'yqx-ms', { 'aria-hidden': 'true' });
    const core = el('span', 'yqx-ms-core');
    core.append(glyph());
    ms.append(ring('yqx-wave'), el('span', 'yqx-ms-shape'), core, el('span', 'yqx-held-dot'));
    const lbl = el('span', 'yqx-au-lbl', { 'aria-hidden': 'true' });
    lbl.append(el('span', 'yqx-in'), el('span', 'yqx-out'));
    lead.append(ms, lbl);
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
    row.append(lead, go, trail);
    btn.append(row);

    // The menu: one row per setting. Each row's icon is the part of the button it controls.
    const menu = el('div', 'yqx-apm', { id: 'yqx-apm', role: 'menu', 'aria-label': 'Start paused' });
    const title = el('div', 'yqx-apm-title', { 'aria-hidden': 'true' });
    title.textContent = 'Start paused';
    const list = el('div', 'yqx-apm-list');
    const makeRow = (key, name, hint) => {
      const r = el('div', `yqx-apm-row yqx-apm-row-${key}`, { role: 'menuitemcheckbox', tabindex: '-1', 'aria-checked': 'false', 'aria-label': `${name}: ${hint}` });
      const ico = el('span', 'yqx-apm-ico', { 'aria-hidden': 'true' });
      if (key === 'opened') ico.append(glyph());
      else {
        const nx = el('span', 'yqx-apm-next'); // ⏭
        nx.append(el('i'), el('i'));
        ico.append(nx);
      }
      const text = el('span', 'yqx-apm-text');
      const b = el('span', 'yqx-apm-name');
      b.textContent = name;
      const sm = el('span', 'yqx-apm-hint');
      sm.textContent = hint;
      text.append(b, sm);
      const sw = el('span', 'yqx-apm-sw', { 'aria-hidden': 'true' });
      const knob = el('i');
      const check = svgEl('svg', { class: 'yqx-sw-on', viewBox: '0 0 24 24' });
      check.append(svgEl('path', { d: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z' }));
      const cross = svgEl('svg', { class: 'yqx-sw-off', viewBox: '0 0 24 24' });
      cross.append(svgEl('path', { d: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' }));
      knob.append(check, cross);
      sw.append(knob);
      r.append(ico, text, sw);
      r.addEventListener('click', () => toggleHold(key));
      list.append(r);
      return r;
    };
    mast.rows.opened = makeRow('opened', 'Videos I open', 'Clicked, linked or in a new tab');
    mast.rows.next = makeRow('next', 'Next in queue or playlist', 'When one video follows another');
    const foot = el('div', 'yqx-apm-foot', { 'aria-hidden': 'true' });
    foot.textContent = 'Pressing play always works.';
    const live = el('div', 'yqx-live', { role: 'status', 'aria-live': 'polite' });
    menu.append(title, list, foot, live);

    const narrow = () => btn.classList.contains('yqx-ap-end');
    lead.addEventListener('click', (e) => {
      if (mast.held) { playHeld(); return; } // while a video waits, the shape and words mean "play it"
      if (narrow()) { // no room to unfold: the shape opens the menu
        if (mast.open) closeApMenu(e.detail === 0);
        else openApMenu(lead, e.detail === 0);
        return;
      }
      const all = !(holdOpened || holdNext); // one click: everything waits, or everything plays again
      holdOpened = all;
      holdNext = all;
      saveHold();
      mast.live.textContent = all ? 'Videos will start paused' : 'Autoplay is back on';
    });
    trail.addEventListener('click', (e) => {
      if (mast.open) closeApMenu(e.detail === 0);
      else openApMenu(trail, e.detail === 0);
    });
    go.addEventListener('click', playHeld);
    for (const b of [lead, go, trail]) {
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openApMenu(narrow() ? lead : trail, true); }
        if ([' ', 'Enter', 'ArrowDown', 'ArrowUp', 'k', 'K'].includes(e.key)) e.stopPropagation(); // keep YouTube's shortcuts out
      });
    }
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { mast.hover = true; unfold(); } });
    btn.addEventListener('pointerleave', () => { mast.hover = false; fold(); });
    btn.addEventListener('focusin', () => { if (btn.querySelector(':focus-visible')) unfold(); });
    btn.addEventListener('focusout', () => setTimeout(fold));
    menu.addEventListener('keydown', onApMenuKey);
    menu.addEventListener('keyup', (e) => e.stopPropagation());
    menu.addEventListener('pointermove', (e) => {
      const r = e.target.closest('.yqx-apm-row');
      if (r && menu.contains(document.activeElement) && document.activeElement !== r) r.focus({ preventScroll: true });
    });
    Object.assign(mast, { btn, lead, go, trail, lbl, menu, live });
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
    postToExt({ type: 'autoplay', value: { opened: holdOpened, next: holdNext } });
    updateMast();
  }
  function toggleHold(key) {
    if (key === 'opened') holdOpened = !holdOpened;
    else holdNext = !holdNext;
    saveHold();
    const on = key === 'opened' ? holdOpened : holdNext;
    mast.live.textContent = `${key === 'opened' ? 'Videos you open' : 'Next videos'} will ${on ? 'start paused' : 'play by themselves'}`;
  }
  /** Unfold into the split button (not in narrow windows, where there is no room). */
  function unfold() {
    if (!mast.btn || mast.btn.classList.contains('yqx-ap-end')) return;
    mast.btn.classList.add('yqx-open');
    mast.trail.tabIndex = 0;
    mast.lead.style.width = `${40 + 8 - 3 + mast.lbl.firstChild.offsetWidth + 16}px`; // the new word only, not the one rolling out
  }
  function fold() {
    if (!mast.btn || mast.hover || mast.open || mast.timer || mast.btn.contains(document.activeElement)) return;
    mast.btn.classList.remove('yqx-open');
    mast.lead.style.width = '';
    mast.trail.tabIndex = -1;
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
    const rows = [mast.rows.opened, mast.rows.next];
    const i = rows.indexOf(document.activeElement);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowUp': rows[(i + 1) % 2].focus(); break;
      case 'Home': rows[0].focus(); break;
      case 'End': rows[1].focus(); break;
      case ' ': case 'Enter': if (i >= 0) toggleHold(i === 0 ? 'opened' : 'next'); break;
      case 'Escape': case 'Tab': closeApMenu(true); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    e.stopPropagation(); // keep YouTube's shortcuts out while in the menu
  }
  /** Roll the label: the old word slides up and out, the new one rolls in from below. */
  function rollWord(w) {
    if (w === mast.word) return;
    const inEl = mast.lbl.firstChild;
    const outEl = mast.lbl.lastChild;
    outEl.textContent = mast.word;
    inEl.textContent = w;
    for (const [node, op, tf] of [[outEl, '1', 'none'], [inEl, '0', 'translateY(8px)']]) {
      node.style.transition = 'none';
      node.style.opacity = op;
      node.style.transform = tf;
      void node.offsetWidth; // restart from that frame
      node.style.transition = '';
      node.style.opacity = '';
      node.style.transform = '';
    }
    mast.word = w;
  }
  function updateMast() {
    if (!mast.btn) return;
    const b = mast.btn;
    const level = Number(holdOpened) + Number(holdNext);
    b.dataset.opened = String(holdOpened);
    b.dataset.next = String(holdNext);
    b.dataset.level = String(level); // 0 none, 1 one, 2 both
    b.querySelector('.yqx-ms-shape').style.clipPath = SHAPES[level];
    const narrow = b.classList.contains('yqx-ap-end');
    mast.lead.setAttribute('aria-pressed', String(level > 0));
    mast.lead.setAttribute('aria-label', mast.held ? 'Video waiting: Resolute paused it. Play'
      : narrow ? `Autoplay: ${summary()}. Opens settings`
      : `Autoplay: ${summary()}. Click to ${level ? 'allow autoplay' : 'pause all videos'}`);
    mast.rows.opened.setAttribute('aria-checked', String(holdOpened));
    mast.rows.next.setAttribute('aria-checked', String(holdNext));
    mast.menu.dataset.opened = String(holdOpened);
    rollWord(mast.held ? 'Video waiting' : mast.flash ? 'Playing' : shortWord());
    // new word, new width (only if still unfolded by the time the frame comes)
    if (b.classList.contains('yqx-open')) requestAnimationFrame(() => { if (b.classList.contains('yqx-open')) unfold(); });
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

    // Remove any stray copies (should never happen, but keeps it to one button).
    document.querySelectorAll('.yqx-button').forEach((b) => { if (b !== ui.btn) b.remove(); });
    document.querySelectorAll('.yqx-menu').forEach((m) => { if (m !== ui.menu) m.remove(); });

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
  function positionMenu() {
    const p = getPlayer();
    if (!p || !ui.btn) return;
    const pr = p.getBoundingClientRect();
    const br = ui.btn.getBoundingClientRect();
    const bar = p.querySelector('.ytp-chrome-bottom');
    const floating = ui.btn.classList.contains('yqx-floating');
    const top = !floating && bar ? Math.min(bar.getBoundingClientRect().top, br.top) : br.top;
    const gap = 12;
    const bottom = Math.max(gap, pr.bottom - top + gap);
    let right = Math.max(gap, pr.right - br.right);
    const width = ui.menu.offsetWidth;
    if (width && right + width > pr.width - gap) right = Math.max(gap, pr.width - width - gap);
    ui.menu.style.bottom = `${bottom}px`;
    ui.menu.style.right = `${right}px`;
    ui.menu.style.maxHeight = `${Math.max(120, pr.height - bottom - gap)}px`;
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
  function showTip() {
    const p = getPlayer();
    if (ui.open || !p || !ready()) return;
    ui.tip.textContent = ui.tipText;
    const pr = p.getBoundingClientRect();
    const br = ui.btn.getBoundingClientRect();
    const bar = p.querySelector('.ytp-chrome-bottom');
    const floating = ui.btn.classList.contains('yqx-floating');
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
    } else if (msg.type === 'autoplay' && msg.value && typeof msg.value.opened === 'boolean' && typeof msg.value.next === 'boolean') {
      holdOpened = msg.value.opened;
      holdNext = msg.value.next;
      autoplayKnown = true;
      ensureMast();
      updateMast();
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
  }, 3000);

  // ---------- lifecycle ----------
  let ensureQueued = false;
  function queueEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    setTimeout(() => {
      ensureQueued = false;
      ensureUI();
      ensureMast();
    }, 150);
  }

  document.addEventListener('yt-navigate-start', () => { closeMenu(false); clearHeld(); });
  for (const type of ['yt-navigate-finish', 'yt-player-updated', 'yt-page-data-updated']) {
    document.addEventListener(type, () => {
      ensureUI();
      scheduleApply(false);
    });
  }
  // Media events don't bubble, but the capture phase sees them (works in embeds too).
  for (const type of ['loadedmetadata', 'playing']) {
    document.addEventListener(type, (e) => {
      const p = getPlayer();
      if (p && e.target instanceof HTMLVideoElement && p.contains(e.target)) {
        checkVideoChange();
        if (e.type === 'playing') {
          saverPlaying(true);
          if (!holdIfAutoplayed() && mast.held) releaseHeld(); // a later start = someone pressed play
        }
      }
    }, true);
  }
  document.addEventListener('pause', (e) => { if (e.target instanceof HTMLVideoElement) saverPlaying(false); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') armSaver(); else endSaver(); });
  document.addEventListener('enterpictureinpicture', () => endSaver(), true); // never lower a video you're watching in PiP
  // A video that plays to its end: the next one to start without any input from you counts as "next".
  document.addEventListener('ended', (e) => {
    const p = getPlayer();
    if (p && e.target instanceof HTMLVideoElement && p.contains(e.target) && !p.classList.contains('ad-showing')) {
      endedAt = Date.now();
      endedVid = videoIdOf(p);
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
    hideTip();
    ensureMast(); // wide <-> narrow top bar
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

/* ---------- the button: a shape at rest, a split button when unfolded ---------- */
.yqx-au{position:relative;flex:none;width:40px;height:40px;margin:0 0 0 8px;z-index:5;color:var(--yqx-fg)}
.yqx-au.yqx-ap-end{margin:0 8px 0 0}
.yqx-au-row{position:absolute;top:0;left:0;height:40px;display:flex;gap:2px}
.yqx-ap-end .yqx-au-row{left:auto;right:0}
.yqx-au button{height:40px;margin:0;border:0;padding:0;cursor:pointer;color:inherit;display:flex;align-items:center;background:transparent;
  font:600 14px/1 "Roboto",Arial,sans-serif;-webkit-tap-highlight-color:transparent}
.yqx-au button:focus-visible{outline:2px solid var(--yqx-focus);outline-offset:2px}
.yqx-au-lead{width:40px;overflow:hidden;gap:8px;white-space:nowrap;border-radius:20px;
  transition:width .6s var(--yqx-sp),background-color .25s var(--yqx-ease),border-radius .55s var(--yqx-sp),box-shadow .3s var(--yqx-ease)}
.yqx-au-trail{width:0;overflow:hidden;justify-content:center;border-radius:6px 20px 20px 6px;opacity:0;
  transition:width .55s var(--yqx-sp),opacity .2s var(--yqx-ease),background-color .25s var(--yqx-ease),border-radius .55s var(--yqx-sp),box-shadow .3s var(--yqx-ease)}
.yqx-au.yqx-open .yqx-au-lead{background:var(--yqx-cont);border-radius:20px 6px 6px 20px;box-shadow:0 4px 16px rgba(0,0,0,.12)}
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
/* rolling label */
.yqx-au-lbl{display:grid;justify-items:start;opacity:0;transform:translateX(-8px);transition:opacity .2s var(--yqx-ease),transform .55s var(--yqx-sp)}
.yqx-au.yqx-open .yqx-au-lbl{opacity:1;transform:none;transition-delay:.08s}
.yqx-au-lbl span{grid-area:1/1;transition:opacity .2s var(--yqx-ease),transform .45s var(--yqx-sp)}
.yqx-au-lbl .yqx-out{opacity:0;transform:translateY(-8px)}

/* the shape: circle -> cookie -> rounded square (clip-path set from JS), tint = how much is on */
.yqx-ms{position:relative;flex:none;width:34px;height:34px;margin:3px}
.yqx-ms-shape{position:absolute;inset:3px;background:var(--yqx-rest);
  transition:clip-path .7s var(--yqx-sp),background-color .3s var(--yqx-ease),transform .7s var(--yqx-sp)}
.yqx-au.yqx-open .yqx-ms-shape{background:var(--yqx-shape0)}
.yqx-au:not(.yqx-open) .yqx-au-lead:hover .yqx-ms-shape{background:var(--yqx-rest-h)}
.yqx-au[data-level="1"] .yqx-ms-shape{background:var(--yqx-pc)!important}
.yqx-au[data-level="2"] .yqx-ms-shape{background:var(--yqx-p)!important}
.yqx-ms-core{position:absolute;inset:0;display:grid;place-items:center;color:var(--yqx-fg);transition:color .3s var(--yqx-ease)}
.yqx-au[data-level="1"] .yqx-ms-core{color:var(--yqx-opc)}
.yqx-au[data-level="2"] .yqx-ms-core{color:var(--yqx-op)}
.yqx-au-lead:hover .yqx-ms-shape{transform:rotate(18deg)}
.yqx-au-lead:active .yqx-ms-shape{transform:rotate(18deg) scale(.9)}
.yqx-au[data-level="2"] .yqx-au-lead:hover .yqx-ms-shape{transform:scale(1.06)} /* a tilted square reads as a card */
.yqx-au[data-level="2"] .yqx-au-lead:active .yqx-ms-shape{transform:scale(.9)}

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

@media (prefers-reduced-motion: reduce){
  .yqx-menu,.yqx-pill,.yqx-pill::after,.yqx-check,.yqx-iconbox,.yqx-tip,.yqx-item,.yqx-now{transition:none!important;animation:none!important}
}`;
})();
