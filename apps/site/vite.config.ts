import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/** The thesis is a route in the app; give it its own index.html so any static host serves it. */
const thesisPage = (): Plugin => ({
  name: 'thesis-page',
  apply: 'build',
  async closeBundle() {
    const out = resolve(import.meta.dirname, 'dist')
    await mkdir(resolve(out, 'thesis'), { recursive: true })
    await copyFile(resolve(out, 'index.html'), resolve(out, 'thesis/index.html'))
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), thesisPage()],
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  server: { port: 5320, strictPort: true },
  preview: { port: 4320, strictPort: true },
  build: { target: 'baseline-widely-available' },
}))
