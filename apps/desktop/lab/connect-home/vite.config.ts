import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The Connect a home lab: the app's own Connect a home dialog, each state of
 * it driven on a fake home host, with no Electron (README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6141, strictPort: true },
})
