import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The held-back lab: Up next, its rows and a waiting task's own view while
 * this Mac lets fewer agents work than the person's number, drawn on the
 * app's own board and task view with no runtime (README.md). The kit comes
 * through `kit.ts`, which hands the app the kit's own components, a few of
 * them wrapped so each direction can say what is held back.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: join(import.meta.dirname, 'vitest.ts') },
      { find: /^@althar\/testing$/, replacement: join(import.meta.dirname, 'testing.ts') },
      { find: /^@althar\/ui$/, replacement: join(import.meta.dirname, 'kit.ts') },
    ],
  },
  server: { port: 6171, strictPort: true },
})
