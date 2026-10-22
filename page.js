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
 * Saved preference lives in extension storage; content.js passes it here.
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
  let preference = DEFAULT_PREF;
  let prefKnown = false;
  let lastApplied = '';   // "videoId|preference" already applied
  let lastVideoId = '';
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
  function forceQuality(p, q) {
    call(p, 'setPlaybackQualityRange', q, q);
    call(p, 'setPlaybackQuality', q);
  }

  // ---------- applying the preference ----------
  function scheduleApply(force) {
    clearTimeout(applyTimer);
    clearTimeout(verifyTimer);
    let tries = 0;

    const attempt = () => {
      const p = getPlayer();
      const vid = p ? videoIdOf(p) : '';
      const levels = p ? availableLevels(p) : [];
      const waiting = !prefKnown || !p || !vid || !levels.length || p.classList.contains('ad-showing');
      if (waiting) {
        // Wait for the player, the video's quality list, or the end of an ad.
        tries += 1;
        if (tries <= 120) applyTimer = setTimeout(attempt, tries < 20 ? 250 : 1000);
        return;
      }

      const key = `${vid}|${preference}`;
      if (!force && key === lastApplied) {
        updateUI();
        return;
      }
      lastApplied = key;
      lastVideoId = vid;

      if (preference === 'auto') {
        // Only undo a forced quality when the user picks Auto; otherwise YouTube decides.
        if (force) forceQuality(p, 'auto');
      } else {
        const target = resolveTarget(preference, levels);
        forceQuality(p, target);
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
    }
    updateUI();
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

  // ---------- building the UI ----------
  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }
  function checkIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'yqx-check');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z');
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
    const title = el('span', 'yqx-title');
    title.textContent = 'Quality';
    const now = el('span', 'yqx-now');
    head.append(title, now);
    const list = el('div', 'yqx-list');
    menu.append(head, list);

    for (const o of OPTIONS) {
      const item = el('div', 'yqx-item', { role: 'menuitemradio', tabindex: '-1', 'aria-checked': 'false' });
      item.dataset.q = o.id;
      const label = el('span', 'yqx-label');
      label.textContent = o.label;
      const note = el('span', 'yqx-note');
      item.append(checkIcon(), label, note);
      item.addEventListener('click', () => choose(o.id, false));
      item.addEventListener('pointermove', () => {
        if (document.activeElement && document.activeElement.classList.contains('yqx-item') &&
            document.activeElement !== item) item.focus({ preventScroll: true });
      });
      list.append(item);
      if (o.id === 'highest') list.append(el('div', 'yqx-sep', { role: 'separator' }));
      ui.items.set(o.id, item);
    }

    menu.addEventListener('keydown', onMenuKey);
    menu.addEventListener('keyup', (e) => e.stopPropagation());
    // Keep clicks/taps inside the menu from reaching the player (which would pause/play).
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
                        'touchstart', 'touchend', 'contextmenu', 'wheel']) {
      menu.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }

    const tip = el('div', 'yqx-tip', { 'aria-hidden': 'true' });

    Object.assign(ui, { btn, pill, menu, list, now, tip });
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

  function updateUI() {
    if (!ui.btn) return;
    ui.btn.classList.toggle('yqx-pending', !prefKnown);
    if (!prefKnown) return;

    const p = getPlayer();
    const opt = optionById(preference);
    const levels = p ? availableLevels(p) : [];
    const known = levels.length > 0;
    const playing = p ? playingLabel(p) : '';
    const target = resolveTarget(preference, levels);

    setPill(opt.short);
    ui.tipText = `Quality: ${opt.label}${playing ? ` · Playing ${playing}` : ''}`;
    if (ui.tip.classList.contains('yqx-show')) ui.tip.textContent = ui.tipText;
    ui.btn.setAttribute('aria-label',
      `Video quality: ${opt.label}${playing ? `. Now playing ${playing}` : ''}`);
    ui.now.textContent = playing ? `Playing ${playing}` : '';

    for (const o of OPTIONS) {
      const item = ui.items.get(o.id);
      const checked = o.id === preference;
      let note = '';
      let unavailable = false;
      if (o.id === 'highest') {
        note = known ? heightLabel(levels[0]) : '';
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
    if (ui.open || !getPlayer() || !prefKnown) return;
    ensureUI();
    hideTip();
    ui.open = true;
    ui.viaKeyboard = byKeyboard;
    positionMenu();
    ui.menu.classList.add('yqx-open');
    ui.btn.setAttribute('aria-expanded', 'true');
    clearInterval(ui.keepAlive);
    ui.keepAlive = setInterval(nudgeControls, 1500);
    if (byKeyboard) focusItem(ui.items.get(preference));
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
    const list = ui.menu;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop - 8;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight + 8;
    }
  }

  function onMenuKey(e) {
    const items = [...ui.items.values()];
    const i = items.indexOf(document.activeElement);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': focusItem(items[(i + 1) % items.length]); break;
      case 'ArrowUp': focusItem(items[(i - 1 + items.length) % items.length]); break;
      case 'Home': focusItem(items[0]); break;
      case 'End': focusItem(items[items.length - 1]); break;
      case 'Enter':
      case ' ':
        if (i >= 0) choose(items[i].dataset.q, true);
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

  function choose(id, byKeyboard) {
    if (!VALID.has(id)) return;
    const changed = id !== preference;
    preference = id;
    prefKnown = true;
    closeMenu(byKeyboard);
    updateUI();
    if (changed) postToExt({ type: 'set', value: id });
    scheduleApply(true); // apply to the current video right away
  }

  // ---------- tooltip ----------
  function showTip() {
    const p = getPlayer();
    if (ui.open || !p || !prefKnown) return;
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
    if (msg.type !== 'pref' || !VALID.has(msg.value)) return;
    const first = !prefKnown;
    const changed = msg.value !== preference;
    preference = msg.value;
    prefKnown = true;
    if (first || changed) {
      updateUI();
      scheduleApply(!first); // a change from the popup applies to the current video too
    }
  });

  // If the bridge never answers (very unlikely), still work with the default.
  setTimeout(() => {
    if (!prefKnown) {
      prefKnown = true;
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
      if (p && e.target instanceof HTMLVideoElement && p.contains(e.target)) checkVideoChange();
    }, true);
  }
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
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const CSS = `
#movie_player .yqx-button{width:auto!important;min-width:48px;padding:0 4px!important;display:inline-flex!important;
  align-items:center;justify-content:center;vertical-align:top;color:#fff;cursor:pointer;opacity:1}
#movie_player .yqx-button.yqx-pending{display:none!important}
#movie_player .yqx-button:focus-visible{outline:none;box-shadow:none}
.yqx-pill{display:inline-block;box-sizing:border-box;min-width:34px;padding:3px 6px;border:1.5px solid rgba(255,255,255,.85);
  border-radius:6px;font-size:12px;font-weight:600;line-height:1;letter-spacing:.2px;text-align:center;color:#fff;
  white-space:nowrap;text-shadow:none;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .18s ${EASE}}
#movie_player .yqx-button:hover .yqx-pill{background:rgba(255,255,255,.14);border-color:#fff}
#movie_player .yqx-button:active .yqx-pill{transform:scale(.94)}
#movie_player .yqx-button[aria-expanded="true"] .yqx-pill{background:#fff;border-color:#fff;color:#0f0f0f}
#movie_player .yqx-button:focus-visible .yqx-pill{outline:2px solid #fff;outline-offset:2px}
#movie_player.ytp-big-mode .yqx-pill{font-size:15px;padding:4px 8px;border-radius:7px;border-width:2px}
.yqx-pill.yqx-swap{animation:yqx-swap .24s ${EASE}}
@keyframes yqx-swap{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

#movie_player .yqx-button.yqx-floating{position:absolute;right:12px;bottom:64px;height:32px;z-index:60;padding:0 2px!important;
  border-radius:16px;background:rgba(0,0,0,.5);transition:opacity .25s cubic-bezier(0,0,.2,1)}
#movie_player.ytp-autohide .yqx-button.yqx-floating{opacity:0;pointer-events:none}

#movie_player .yqx-menu{position:absolute;z-index:72;box-sizing:border-box;min-width:240px;max-width:calc(100% - 24px);
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent;
  padding:6px 0;border-radius:12px;background:rgba(28,28,28,.92);color:#eee;font-size:13px;line-height:normal;
  text-shadow:0 0 2px rgba(0,0,0,.5);user-select:none;-webkit-user-select:none;
  opacity:0;visibility:hidden;transform:translateY(8px) scale(.97);transform-origin:bottom right;
  transition:opacity .14s ease,transform .2s ${EASE},visibility 0s linear .2s}
#movie_player .yqx-menu.yqx-open{opacity:1;visibility:visible;transform:none;
  transition:opacity .16s ease,transform .24s ${EASE},visibility 0s}
.yqx-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:8px 16px 8px 16px;font-weight:500;color:#fff}
.yqx-now{color:rgba(255,255,255,.6);font-weight:400;font-size:12px;white-space:nowrap}
.yqx-sep{height:1px;margin:5px 0;background:rgba(255,255,255,.14)}
.yqx-item{display:flex;align-items:center;gap:10px;height:36px;padding:0 16px 0 12px;cursor:pointer;outline:none;
  transition:background-color .1s ease}
.yqx-item:hover,.yqx-item:focus-visible{background:rgba(255,255,255,.1)}
.yqx-check{width:18px;height:18px;flex:none;color:#fff;opacity:0;transform:scale(.5);
  transition:opacity .15s ease,transform .22s ${EASE}}
.yqx-checked .yqx-check{opacity:1;transform:none}
.yqx-label{flex:1;white-space:nowrap}
.yqx-checked .yqx-label{color:#fff;font-weight:500}
.yqx-note{font-size:12px;color:rgba(255,255,255,.55);white-space:nowrap}
.yqx-unavailable .yqx-label{color:rgba(255,255,255,.38)}
.yqx-unavailable .yqx-note{color:rgba(255,255,255,.38);font-style:italic}
#movie_player.ytp-big-mode .yqx-menu{font-size:16px;min-width:300px}
#movie_player.ytp-big-mode .yqx-item{height:44px}
#movie_player.ytp-big-mode .yqx-now,#movie_player.ytp-big-mode .yqx-note{font-size:14px}

#movie_player .yqx-tip{position:absolute;z-index:73;padding:5px 9px;border-radius:4px;background:rgba(28,28,28,.9);
  color:#eee;font-size:12.5px;line-height:1.3;font-weight:500;white-space:nowrap;pointer-events:none;
  opacity:0;transition:opacity .12s ease}
#movie_player .yqx-tip.yqx-show{opacity:1}
#movie_player.ytp-big-mode .yqx-tip{font-size:15px}

@media (prefers-reduced-motion: reduce){
  .yqx-menu,.yqx-pill,.yqx-check,.yqx-tip,.yqx-item{transition:none!important;animation:none!important}
}`;
})();
