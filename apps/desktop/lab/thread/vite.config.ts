import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The thread lab: the app's own task and coordinator threads, drawn from a
 * long thread made up for it and an agent's words streamed as the runtime
 * streams them, with no runtime behind them. For feeling how a thread
 * streams and folds, and timing its frames (lab/thread/README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(import.meta.dirname, 'vitest.ts') } },
  server: { port: 6131, strictPort: true },
  // Built as the app is, for timing frames as it runs (`vp build`, then `vp preview`, both with this config).
  build: { outDir: join(import.meta.dirname, '../../test-results/lab-build'), emptyOutDir: true, target: 'chrome140' },
  preview: { port: 6132, strictPort: true },
})
