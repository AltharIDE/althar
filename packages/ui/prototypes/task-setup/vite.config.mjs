import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5364, strictPort: true, fs: { allow: [resolve(root, '../../../..')] } },
})
