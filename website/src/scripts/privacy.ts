// Forget / put back buttons for the example rows (the markup is static HTML in Privacy.astro).
export function privacySetup(stage: HTMLElement, ctx: any) {
  const { O } = ctx;
  const rows = [...stage.querySelectorAll<HTMLElement>('.vrow')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  stage.querySelectorAll<HTMLElement>('.vrow button').forEach((b) => { b.hidden = false; });
  (stage.querySelector('#priv-btns') as HTMLElement).hidden = false;
  rows.forEach((r) => r.querySelector('button')!.addEventListener('click', () => r.classList.add('gone'), O));
  stage.querySelector('#priv-forget-all')!.addEventListener('click', () => rows.forEach((r, i) => ctx.T(() => r.classList.add('gone'), reduce ? 0 : i * 90)), O);
  stage.querySelector('#priv-restore')!.addEventListener('click', () => rows.forEach((r) => r.classList.remove('gone')), O);
}
