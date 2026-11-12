import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Prototype: a calmer card for a running project, a few directions on one
 * live page, built from the kit's own components. Delete once a direction is
 * picked.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6151, strictPort: true },
})
