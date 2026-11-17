// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
  integrations: [vue()],
  // Astro 7 changed the default to 'jsx', which drops the whitespace between a line of
  // text and an inline element on the next line: "using the<a>NodeNormalization API</a>".
  // The pages' prose is written across lines like that, so keep Astro 6's behaviour.
  compressHTML: true,
  // GitHub Pages deployment settings — update these for your repo
  site: 'https://TranslatorSRI.github.io',
  base: '/babel-explorer/',
});
