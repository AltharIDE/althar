import { createReadStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * Scrappy: evidence that reads well. A light page per direction, served from
 * here; never built. The app's own task view renders as it is, thread and
 * Outputs; only the kit's Evidence is swapped, through `kit.ts`, for the
 * page's direction. Pictures are real ones, read by digest from Althar's
 * artifact store, as the app's own picture address does.
 */
const here = import.meta.dirname
const store = join(homedir(), 'Library/Application Support/Althar/artifacts')
// DEV-58's screenshots, which its lead left in its sandbox's temp folder: copied in by `bun pictures.ts`.
const extra = join(here, '../../test-results/evidence-reads-well/pictures')

const pictures = (): Plugin => ({
  name: 'pictures',
  configureServer(server) {
    server.middlewares.use('/pictures', (req, res, next) => {
      const digest = (req.url ?? '').replace(/^\//, '').replace(/\?.*$/, '')
      if (!/^[0-9a-f]{64}$/.test(digest)) return next()
      const path = [join(store, digest.slice(0, 2), digest), join(extra, digest)].find((one) => existsSync(one))
      if (path === undefined) return next()
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'max-age=3600')
      createReadStream(path).pipe(res)
    })
  },
})

export default defineConfig({
  root: here,
  // The screenshots shoot.mjs takes, which the comparison page shows.
  publicDir: join(here, '../../test-results/evidence-reads-well'),
  plugins: [react(), pictures()],
  resolve: {
    alias: [
      // The kit as the app imports it, with the Evidence of the page's direction.
      { find: /^@althar\/ui$/, replacement: join(here, 'kit.ts') },
      // A picture's address: served here, by digest, in place of the app's own scheme.
      { find: /^(\.\.\/)+main\/pictureAddress$/, replacement: join(here, 'pictureAddress.ts') },
      // The app's own test fixtures make the fake runtime; their vi.fn is a plain function here.
      { find: /^vitest$/, replacement: join(here, 'vitest.ts') },
    ],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5361, strictPort: true, fs: { allow: [join(here, '../../../..')] } },
})
