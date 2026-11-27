import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/* The worker setup prototype: one live page on the kit's real components. Prototype only; not part of the app. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5391, strictPort: true, host: '0.0.0.0', fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url))] } },
})
