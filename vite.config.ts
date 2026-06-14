import { defineConfig } from 'vite';

export default defineConfig({
  base: '/heizlast_en_12831/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
