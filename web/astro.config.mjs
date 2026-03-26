// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
  integrations: [vue()],
  // GitHub Pages deployment settings — update these for your repo
  site: 'https://TranslatorSRI.github.io',
  base: '/babel-explorer',
});
