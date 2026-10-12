import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/* Throwaway showcase: where a pasted link's card sits, so it reads as the person's. Not shipped. */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5430, strictPort: true, host: '127.0.0.1' },
})
