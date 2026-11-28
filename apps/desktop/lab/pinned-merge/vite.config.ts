import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/* The pinned merge lab: the merge line held above the composer, in three directions (README.md). */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 6143, strictPort: true },
})
