import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/* Throwaway showcase: where the CPU/memory meter's switch lives. Not shipped. */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5420, strictPort: true, host: '127.0.0.1' },
})
