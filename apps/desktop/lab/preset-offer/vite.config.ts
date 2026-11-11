import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Prototype: the coordinator's offer to keep parts as a preset, a few
 * directions on the app's own thread and the kit, with no runtime behind it.
 * cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/preset-offer/vite.config.ts
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  resolve: { alias: { vitest: join(import.meta.dirname, '../thread/vitest.ts') } },
  server: { port: 6133, strictPort: true },
})
