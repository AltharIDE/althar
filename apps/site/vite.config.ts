import { readdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * Each page is rendered to its own HTML after the build, by
 * scripts/prerender.ts, from the renderer `vp build --ssr` makes.
 */

/**
 * The wallpapers are the brand pack's (brand/export/wallpaper), kept once:
 * served from there at /wallpaper/ in development, and copied into the build.
 */
const WALLPAPERS = resolve(import.meta.dirname, '../../brand/export/wallpaper')
const wallpapers = (): Plugin => ({
  name: 'wallpapers',
  configureServer(server) {
    server.middlewares.use('/wallpaper', (req, res, next) => {
      const name = basename(decodeURIComponent((req.url ?? '').split('?')[0] ?? ''))
      readFile(resolve(WALLPAPERS, name)).then(
        (body) => {
          res.setHeader('content-type', 'image/jpeg')
          res.end(body)
        },
        () => next(),
      )
    })
  },
  async generateBundle() {
    if (this.environment.config.consumer === 'server') return
    for (const name of await readdir(WALLPAPERS))
      if (name.endsWith('.jpg'))
        this.emitFile({ type: 'asset', fileName: `wallpaper/${name}`, source: await readFile(resolve(WALLPAPERS, name)) })
  },
})

/** The day of the build, in UTC: the client and the renderer are built minutes apart, so both read the same. */
const BUILT_ON = new Date().toISOString().slice(0, 10)

export default defineConfig(({ mode }) => ({
  plugins: [react(), wallpapers()],
  define: { 'import.meta.env.BUILT_ON': JSON.stringify(BUILT_ON) },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  server: { port: 5320, strictPort: true },
  preview: { port: 4320, strictPort: true },
  /* The manifest tells the prerender which stylesheets a lazy page needs up front. */
  build: { target: 'baseline-widely-available', manifest: true },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
}))
