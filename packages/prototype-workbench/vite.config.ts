import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

import { PROTOTYPE_FILE, workbench } from './src/plugin'

/*
 * One config for serving a prototype and for the tests. `vp dev <folder>`
 * here, or `bun run prototype <folder>` from the repository's root, serves
 * the prototype in that folder on the workbench's page, at the first free
 * port from 5400, and prints its address.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react({ exclude: [/\/node_modules\//, PROTOTYPE_FILE] }), ...(process.env.VITEST === undefined ? [workbench()] : [])],
  css: {
    modules: {
      // As the kit's own: its components read their classes in camel case.
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  server: {
    port: 5400,
    // Polled: started in an agent's sandbox, Vite is told of no edits and serves what it first read. Idle, it costs nothing to see.
    watch: { usePolling: true, interval: 500 },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      // The page's script and its mount wire the rest together, and are run by serving the example.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/entry.ts', 'src/mount.tsx', 'src/index.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
}))
