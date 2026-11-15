import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node24',
    rollupOptions: { output: { entryFileNames: 'althar-host.js', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true, target: 'node' },
  test: {
    ...testing('medium'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    silent: 'passed-only',
    coverage: {
      include: ['src/**/*.ts'],
      // Only process wiring; the command runner is covered directly and the built entry is exercised by process tests.
      exclude: ['src/main.ts'],
      reporter: ['text', 'html'],
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
