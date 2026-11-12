import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The drafting lab: a task's card from the moment the coordinator starts
 * drafting it, in four directions, on the kit's real plan card (README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6133, strictPort: true },
})
