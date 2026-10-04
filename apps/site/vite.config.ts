import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/** The app's other routes; each gets its own index.html so any static host serves it. */
const ROUTES = ['shifts', 'thesis', 'enterprise'] as const

const routePages = (): Plugin => ({
  name: 'route-pages',
  apply: 'build',
  async closeBundle() {
    const out = resolve(import.meta.dirname, 'dist')
    for (const route of ROUTES) {
      await mkdir(resolve(out, route), { recursive: true })
      await copyFile(resolve(out, 'index.html'), resolve(out, route, 'index.html'))
    }
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), routePages()],
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  server: { port: 5320, strictPort: true },
  preview: { port: 4320, strictPort: true },
  build: { target: 'baseline-widely-available' },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
}))
