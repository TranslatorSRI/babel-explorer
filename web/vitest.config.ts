import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // The live contract tests call real NodeNorm and NameRes deployments; they run only
    // through vitest.live.config.ts (`npm run test:live`), so an outage never fails CI.
    exclude: [...configDefaults.exclude, 'src/**/*.live.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
