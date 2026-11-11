import { makeCtx } from './core';
import { startWorld } from './world';

startWorld();

/* theme toggle (the first paint is set by the inline script in Base.astro) */
const body = document.body;
document.getElementById('themebtn')?.addEventListener('click', () => {
  const next = body.dataset.theme === 'dark' ? 'light' : 'dark';
  body.dataset.theme = next;
  try { localStorage.setItem('resolute-theme', next); } catch {}
});

/* each interactive stage loads only when it is near the screen */
type Runner = (stage: HTMLElement, ctx: ReturnType<typeof makeCtx>) => void;
const loaders: Record<string, () => Promise<Runner>> = {
  hero: () => import('./hero').then((m) => m.heroSetup),
  features: () => import('./features').then((m) => m.f1),
  'how-ladder': () => import('./how').then((m) => m.h1),
  privacy: () => import('./privacy').then((m) => m.privacySetup),
  faq: () => import('./faq').then((m) => m.faqSetup),
  install: () => import('./install').then((m) => m.i2),
  'how-dots': () => import('./how').then((m) => m.h2),
};
export function register(name: string, load: () => Promise<Runner>) { loaders[name] = load; }

/* Stages mount one after another when the browser is idle (not on scroll), so the page height settles
   early and anchor links such as #install land in the right place. Each stage pauses itself off screen. */
const idle = (fn: () => void) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 80));
const stages = [...document.querySelectorAll<HTMLElement>('[data-mount]')];
function mountNext() {
  const el = stages.shift();
  if (!el) {
    const id = location.hash.slice(1);
    const target = id && document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    document.documentElement.dataset.ready = '1';
    return;
  }
  const load = loaders[el.dataset.mount || ''];
  if (!load) return mountNext();
  load().then((run) => {
    const section = (el.closest('section') as HTMLElement) || el;
    run(el, makeCtx(document.body, section));
    el.dataset.mounted = '1';
    el.closest('[data-enhance]')?.setAttribute('data-enhanced', '1');
  }).catch((err) => console.error('stage failed', el.dataset.mount, err)).finally(() => idle(mountNext));
}
if (document.readyState === 'complete') idle(mountNext); else addEventListener('load', () => idle(mountNext));
