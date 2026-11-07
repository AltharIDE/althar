import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The divider bench's page (run.ts): the project's Home, both views, drawn
 * from the tests' fixtures in a real browser, with a production React so its
 * timings are the app's.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  resolve: { alias: { vitest: join(import.meta.dirname, 'vitestShim.ts') } },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[local]_[hash:base64:5]' } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: join(import.meta.dirname, '../../test-results/dragBench'),
    emptyOutDir: true,
    target: 'chrome140',
    minify: process.env.BENCH_MINIFY !== '0',
  },
})
