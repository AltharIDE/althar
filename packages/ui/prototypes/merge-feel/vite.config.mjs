import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Prototype: what pressing Merge feels like, a few directions on one live
 * page, over the kit's own SmallChange, ChangeSet and BoardCard. Delete once
 * a direction is picked.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6153, strictPort: true },
})
