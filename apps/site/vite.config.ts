import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

import { PAGE_META } from './src/content/pages'
import { withMeta } from './src/lib/meta'

/**
 * Each page gets its own index.html, so any static host serves it, with its
 * own title, description and preview tags. SITE_URL, the public origin set
 * as a build variable (as the pitch app has it), makes the preview image's
 * address absolute, as most previewers want.
 */
const routePages = (): Plugin => ({
  name: 'route-pages',
  apply: 'build',
  async closeBundle() {
    const out = resolve(import.meta.dirname, 'dist')
    const html = await readFile(resolve(out, 'index.html'), 'utf8')
    const origin = process.env.SITE_URL ?? ''
    for (const page of Object.values(PAGE_META)) {
      const dir = resolve(out, `.${page.path}`)
      await mkdir(dir, { recursive: true })
      await writeFile(resolve(dir, 'index.html'), withMeta(html, page, origin))
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
