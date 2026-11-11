# Resolute website

Static site for the extension, built with [Astro](https://astro.build) and plain CSS. Served at https://ghost-deku.github.io/resolute-for-youtube/.

```
cd website
npm ci
npm run dev      # local preview
npm run build    # writes website/dist
```

- `src/components/` the sections. All text (features, steps, privacy, FAQ) is static HTML, so it works without JavaScript and can be read by search engines.
- `src/scripts/` the interactive demos. They load one after another when the browser is idle. `real/` holds the drawn player, autoplay button and resume pieces, ported from the extension's own `page.js` and CSS.
- `src/styles/` the theme. It uses the same Material 3 colours as the extension, in light and dark.
- `src/data/` the shared wording (features, install steps, FAQ).

Notes
- The ported demo scripts start with `// @ts-nocheck`. They were written and tested as plain JavaScript and are not type-checked.
- The website is not part of the extension. `scripts/build.py` only packs the files it lists, so `website/` never ends up in the ZIP.
- The site is published by `.github/workflows/pages.yml` when `website/` changes on `main`. In the repository settings, Pages must be set to the "GitHub Actions" source.


## The world (scroll look)
- `src/scripts/world.ts` paints a fixed canvas scene that sharpens from 144p to 4K while you scroll, and crossfades the four scenes like a day. It also drives the "Page quality" pill in the nav and the "resolve" animation on the big headings.
- With JavaScript off, or with reduced motion, the page shows the normal soft wall and sharp 4K headings.
- Headings use the width axis of Google Sans Flex (`public/fonts/gsf-wdth.woff2`, 119 KB) in `src/styles/world.css`.
