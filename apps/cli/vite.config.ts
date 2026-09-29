import { defineConfig } from 'vite-plus'

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
    rollupOptions: { output: { entryFileNames: 'charrette.js', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true, target: 'node' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // The entry point wires the runtime to the terminal; what it uses is tested on its own.
      exclude: ['src/main.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
