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
    // vmThreads: the default forks pool fails module resolution in this
    // environment ("Vitest failed to find the runner" from setup files);
    // vmThreads loads worker modules through the same runner as the CLI.
    pool: 'vmThreads',
    // Workbench interaction suites are CPU-heavy; bound concurrency to avoid timer starvation.
    maxWorkers: 4,
    // Heavy App-render suites take 6-8s when dev servers and MCP hosts share the machine;
    // keep the default above 5s so CPU contention does not flip them into false failures.
    testTimeout: 15000,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
