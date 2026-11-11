// @ts-nocheck  (ported from the approved demo: the page is a picture that sharpens while you scroll)
import { SCENES, WIDTHS, NAMES, buildScene, clamp, lerp, RM } from './core';

export function startWorld() {
  const root = document.documentElement;
  const cv = document.createElement('canvas');
  cv.id = 'world'; cv.width = 960; cv.height = 540; cv.setAttribute('aria-hidden', 'true');
  const g = cv.getContext('2d');
  if (!g) return;
  document.body.prepend(cv);
  const small = document.createElement('canvas'), mix = document.createElement('canvas');
  mix.width = 960; mix.height = 540;
  const scenes = [];
  const scene = (i) => scenes[i] || (scenes[i] = buildScene(SCENES[i]));
  const pill = document.getElementById('pagepill'), pq = document.getElementById('pq');
  const ease = (t) => 1 - Math.pow(1 - t, 2.2);
  let last = '', raf = 0;

  const draw = () => {
    raf = 0;
    const max = Math.max(1, root.scrollHeight - innerHeight), p = clamp(scrollY / max, 0, 1);
    const q = RM() ? 7 : lerp(0.2, 7, ease(Math.min(1, p * 1.15)));
    const t = p * (SCENES.length - 1), i = Math.min(SCENES.length - 2, Math.floor(t)), f = t - i;
    const key = Math.round(q * 20) + ':' + i + ':' + Math.round(f * 40);
    if (key === last) return;
    last = key;
    let src = scene(i);
    if (f > 0.025) {
      const mg = mix.getContext('2d');
      mg.globalAlpha = 1; mg.drawImage(scene(i), 0, 0);
      mg.globalAlpha = f; mg.drawImage(scene(i + 1), 0, 0); mg.globalAlpha = 1;
      src = mix;
    }
    if (q >= 6.97) {
      g.imageSmoothingEnabled = true; g.drawImage(src, 0, 0, 960, 540);
    } else {
      const k = Math.floor(q), fr = q - k;
      const w = Math.round(Math.exp(lerp(Math.log(WIDTHS[k]), Math.log(WIDTHS[Math.min(7, k + 1)]), fr)));
      const h = Math.max(2, Math.round((w * 9) / 16));
      small.width = w; small.height = h;
      const sg = small.getContext('2d'); sg.imageSmoothingEnabled = true; sg.drawImage(src, 0, 0, w, h);
      g.imageSmoothingEnabled = false; g.clearRect(0, 0, 960, 540); g.drawImage(small, 0, 0, 960, 540);
    }
    if (pq) { pq.textContent = q >= 6.9 ? '4K' : NAMES[clamp(Math.round(q), 0, 7)]; pq.dataset.hi = q > 6.9 ? '1' : ''; }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(document.body);
  root.dataset.world = '1';
  if (pill) pill.hidden = false;
  draw();

  /* big headings "resolve" in; the small tag above them counts up 144p to 4K */
  const heads = [...document.querySelectorAll('[data-res]')];
  if (RM() || !('IntersectionObserver' in window)) { heads.forEach((h) => h.classList.add('res')); return; }
  const steps = ['144p', '360p', '720p', '1080p', '4K'];
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    e.target.classList.add('res');
    const qq = e.target.parentElement?.querySelector('.qq');
    if (qq) steps.forEach((s, n) => setTimeout(() => { qq.textContent = s; }, n * 170));
  }), { threshold: 0.3 });
  heads.forEach((h) => io.observe(h));
}
