import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The WSL lab: where a Windows person whose work lives in WSL meets it in
 * Althar, in three directions, on the app's own screens and the kit (README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6157, strictPort: true },
})
