import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        runtime: fileURLToPath(new URL('./canvas-runtime.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Workbench interaction suites are CPU-heavy; bound concurrency to avoid timer starvation.
    maxWorkers: 4,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
