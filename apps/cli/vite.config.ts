import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

/*
 * The CLI runs on Node, which has the `node:sqlite` the store uses; Bun
 * doesn't. Node can't run the workspace's TypeScript as it is, so the CLI is
 * built into one file with everything but Node's own modules inlined.
 */
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'althar.js', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true, target: 'node' },
  test: {
    ...testing('medium'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // The entry point wires the runtime to the terminal; what it uses is tested on its own.
      exclude: ['src/main.ts'],
      reporter: ['text', 'html'],
      // Checked when a test fails too, so a run that only quarantined tests fail still gates on it (@althar/testing).
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
