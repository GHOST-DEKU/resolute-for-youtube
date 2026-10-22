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
 * Optional "open videos paused": the first time each video starts playing on its own,
 * it is paused. A play you start yourself (click/tap in the player, K, Space,
 * media key) is never undone.
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
  let holdAutoplay = false;      // "open videos paused" setting
  let autoplayKnown = false;
  let heldVid = '';              // video whose first start was already checked
  let lastPlayGesture = 0;       // time of the user's last play-like input
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
      const want = choiceFor(vid).q;
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

  // ---------- open videos paused ----------
  const PLAY_KEYS = new Set([' ', 'k', 'K', 'MediaPlayPause', 'MediaPlay']);
  function holdIfAutoplayed() {
    if (!holdAutoplay) return;
    const p = getPlayer();
    const v = p && p.querySelector('video');
    if (!v || v.paused || p.classList.contains('ad-showing')) return; // ads: wait for the real video
    const vid = videoIdOf(p);
    if (!vid || vid === heldVid) return;  // only the first start of each video
    heldVid = vid;
    if (Date.now() - lastPlayGesture < 1000) return; // you pressed play: leave it playing
    call(p, 'pauseVideo');
  }

  // ---------- the same switch next to YouTube's search box (top page only) ----------
  const IS_TOP = window === window.top && location.hostname === 'www.youtube.com';
  const mast = { btn: null, tip: null, tipTimer: 0, note: '' };
  function buildMast() {
    const btn = el('button', 'yqx-ap', { id: 'yqx-autoplay', type: 'button', 'aria-pressed': 'false' });
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const x of ['7', '13.5']) { // two pause bars (animated separately)
      const r = document.createElementNS(NS, 'rect');
      Object.entries({ x, y: '5', width: '3.5', height: '14', rx: '1.2', fill: 'currentColor' }).forEach(([k, v]) => r.setAttribute(k, v));
      svg.append(r);
    }
    btn.append(svg);
    btn.addEventListener('click', () => {
      holdAutoplay = !holdAutoplay;
      postToExt({ type: 'autoplay', value: holdAutoplay });
      btn.classList.remove('yqx-ap-bump');
      void btn.offsetWidth; // restart the animation
      btn.classList.add('yqx-ap-bump');
      updateMast();
      showMastTip(holdAutoplay ? 'Videos will open paused' : 'Autoplay is back on', 1600);
    });
    btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showMastTip(); });
    btn.addEventListener('pointerleave', () => hideMastTip());
    btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) showMastTip(); });
    btn.addEventListener('blur', () => hideMastTip());
    mast.btn = btn;
    mast.tip = el('div', 'yqx-ap-tip', { 'aria-hidden': 'true' });
  }
  function updateMast() {
    if (!mast.btn) return;
    const on = holdAutoplay;
    mast.btn.setAttribute('aria-pressed', String(on));
    mast.btn.setAttribute('aria-label', 'Open videos paused');
    mast.note = on ? 'Videos open paused · click to allow autoplay' : 'Autoplay on · click to open videos paused';
    if (mast.tip.classList.contains('yqx-show') && !mast.tipTimer) mast.tip.textContent = mast.note;
  }
  function showMastTip(text, ms) {
    clearTimeout(mast.tipTimer);
    mast.tipTimer = 0;
    mast.tip.textContent = text || mast.note;
    const r = mast.btn.getBoundingClientRect();
    mast.tip.style.top = `${r.bottom + 8}px`;
    mast.tip.style.left = `${r.left + r.width / 2}px`;
    mast.tip.classList.add('yqx-show');
    if (ms) mast.tipTimer = setTimeout(() => { mast.tipTimer = 0; hideMastTip(true); }, ms);
  }
  function hideMastTip(force) {
    if (mast.tipTimer && !force) return; // let the click feedback finish
    if (mast.tip) mast.tip.classList.remove('yqx-show');
  }
  function ensureMast() {
    if (!IS_TOP || !autoplayKnown) return;
    const center = document.querySelector('ytd-masthead #center');
    if (!center) return;
    injectStyle();
    if (!mast.btn) buildMast();
    const voice = center.querySelector(':scope > #voice-search-button');
    if (mast.btn.parentElement !== center) {
      if (voice) voice.after(mast.btn);
      else center.append(mast.btn);
    }
    if (mast.tip.parentElement !== document.body && document.body) document.body.append(mast.tip);
    document.querySelectorAll('.yqx-ap').forEach((b) => { if (b !== mast.btn) b.remove(); });
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
    } else if (msg.type === 'autoplay' && typeof msg.value === 'boolean') {
      holdAutoplay = msg.value;
      autoplayKnown = true;
      ensureMast();
      updateMast();
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

  document.addEventListener('yt-navigate-start', () => closeMenu(false));
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
        if (e.type === 'playing') holdIfAutoplayed();
      }
    }, true);
  }
  // Remember when the user asks for playback, so their own play is never paused.
  document.addEventListener('pointerdown', (e) => {
    const p = getPlayer();
    const ours = ui.menu && (ui.menu.contains(e.target) || ui.btn.contains(e.target)); // quality menu isn't "play"
    if (p && p.contains(e.target) && !ours) lastPlayGesture = Date.now();
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (mast.btn && mast.btn.contains(t)) return; // Space on our switch toggles it, it isn't "play"
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); // e.g. a space in search
    if (PLAY_KEYS.has(e.key) && !typing) lastPlayGesture = Date.now();
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (ui.open && !ui.menu.contains(e.target) && !ui.btn.contains(e.target)) closeMenu(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (ui.open && e.key === 'Escape' && !ui.menu.contains(e.target)) closeMenu(false);
  }, true);
  const relayout = () => requestAnimationFrame(() => {
    if (ui.open) positionMenu();
    hideTip();
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
  --yqx-primary:#bfc2ff;--yqx-on-primary:#1a1f73;--yqx-primary-container:#33378b;--yqx-on-primary-container:#e0e0ff;
  --yqx-secondary:#c5c4dd;--yqx-secondary-container:#444559;--yqx-on-secondary-container:#e1e0f9;
  --yqx-tertiary:#eab6d6;--yqx-tertiary-container:#5f3854;--yqx-on-tertiary-container:#ffd8ef;
  --yqx-success:#9ed69e;
  --yqx-surface:rgba(24,24,30,.58);--yqx-surface-high:rgba(255,255,255,.08);--yqx-surface-highest:rgba(255,255,255,.12);
  --yqx-glass-edge:rgba(255,255,255,.14);
  --yqx-on-surface:#e4e1e9;--yqx-on-surface-variant:#c7c5d0;--yqx-outline-variant:#46464f;
  --yqx-inverse-surface:#e4e1e9;--yqx-inverse-on-surface:#303036;
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

/* ---------- "open videos paused" switch beside the search box (matches YouTube's mic button) ---------- */
#yqx-autoplay{position:relative;flex:none;box-sizing:border-box;width:40px;height:40px;margin:0 0 0 8px;padding:0;border:0;
  display:grid;place-items:center;border-radius:20px;cursor:pointer;
  background:rgba(0,0,0,.05);color:#0f0f0f;-webkit-tap-highlight-color:transparent;
  transition:background-color .2s cubic-bezier(.34,.8,.34,1),color .2s cubic-bezier(.34,.8,.34,1),
    border-radius .35s cubic-bezier(.42,1.67,.21,.9),transform .35s cubic-bezier(.42,1.67,.21,.9)}
#yqx-autoplay svg{width:24px;height:24px;overflow:visible}
#yqx-autoplay rect{transform-box:fill-box;transform-origin:center}
#yqx-autoplay:hover{background:rgba(0,0,0,.1)}
#yqx-autoplay:active{transform:scale(.9)}
#yqx-autoplay:focus-visible{outline:2px solid #065fd4;outline-offset:2px}
#yqx-autoplay[aria-pressed="true"]{background:#4a4fa6;color:#fff;border-radius:12px}
#yqx-autoplay[aria-pressed="true"]:hover{background:#5a5fb6}
html[dark] #yqx-autoplay{background:rgba(255,255,255,.1);color:#f1f1f1}
html[dark] #yqx-autoplay:hover{background:rgba(255,255,255,.2)}
html[dark] #yqx-autoplay:focus-visible{outline-color:#3ea6ff}
html[dark] #yqx-autoplay[aria-pressed="true"]{background:#bfc2ff;color:#1a1f73}
html[dark] #yqx-autoplay[aria-pressed="true"]:hover{background:#d0d2ff}
/* on toggle: the two bars squash and spring back one after the other */
#yqx-autoplay.yqx-ap-bump rect{animation:yqx-bar .45s cubic-bezier(.38,1.21,.22,1)}
#yqx-autoplay.yqx-ap-bump rect+rect{animation-delay:.05s}
@keyframes yqx-bar{30%{transform:scaleY(.55)}}
.yqx-ap-tip{position:fixed;z-index:2300;transform:translate(-50%,-4px);padding:8px;border-radius:4px;
  background:rgba(97,97,97,.92);color:#fff;font:400 12px/1.3 "Roboto",Arial,sans-serif;white-space:nowrap;pointer-events:none;
  opacity:0;transition:opacity .15s cubic-bezier(.34,.8,.34,1),transform .3s cubic-bezier(.38,1.21,.22,1)}
.yqx-ap-tip.yqx-show{opacity:1;transform:translate(-50%,0)}

@media (prefers-reduced-motion: reduce){
  #yqx-autoplay,#yqx-autoplay rect,.yqx-ap-tip{transition:none!important;animation:none!important}
  .yqx-menu,.yqx-pill,.yqx-pill::after,.yqx-check,.yqx-iconbox,.yqx-tip,.yqx-item,.yqx-now{transition:none!important;animation:none!important}
}`;
})();
