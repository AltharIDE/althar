import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The errand lab: a prototype of how a kept errand reads in the coordinator's
 * thread, drawn with the app's own thread and UI kit and no runtime behind
 * it. Letters swap the direction, numbers where the errand stands.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  resolve: { alias: { vitest: join(import.meta.dirname, 'vitest.ts'), '@althar/testing': join(import.meta.dirname, 'testing.ts') } },
  server: { port: 6133, strictPort: true },
})
