// Opens and closes the replies. The questions and answers are static HTML in Faq.astro.
export function faqSetup(stage: HTMLElement, ctx: any) {
  stage.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.fq-vr');
    if (!b) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    b.nextElementSibling!.classList.toggle('open', open);
  }, ctx.O);
}
