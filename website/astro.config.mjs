import { defineConfig } from 'astro/config';

// Served from https://ghost-deku.github.io/resolute-for-youtube/
export default defineConfig({
  site: 'https://ghost-deku.github.io',
  base: '/resolute-for-youtube',
  trailingSlash: 'always',
  build: { assets: 'assets' },
});
