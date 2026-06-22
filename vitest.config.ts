import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Unit tests run in Node — the modules under test are pure (no DOM).
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    globals: true,
  },
});
