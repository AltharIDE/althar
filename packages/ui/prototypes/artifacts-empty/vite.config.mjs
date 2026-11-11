import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real Artifacts screen under the real project header, in a
 * browser. One seam: the screen's empty branch is handed to the prototype,
 * which draws the direction chosen (or today's, as it was handed). Nothing
 * of the screen's own code changes. Plain JavaScript, so the kit's type
 * check leaves it out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const EMPTY = /<div className=\{s\.empty\}>[\s\S]*?<\/p>\s*<\/div>/

/** @type {import('vite-plus').Plugin} */
const seam = {
  name: 'artifacts-empty-seam',
  enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0].endsWith('src/screens/Artifacts/Artifacts.tsx')) return null
    const today = EMPTY.exec(code)?.[0]
    if (today === undefined) throw new Error('The empty branch moved: the seam no longer finds it.')
    return (
      `import { Empty as ProtoEmpty } from ${JSON.stringify(resolve(here, 'empty.tsx'))}\n` +
      code.replace(EMPTY, `<ProtoEmpty t={t} today={${today}} />`)
    )
  },
}

export default defineConfig({
  root: here,
  plugins: [seam, react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // Polling, so a server started inside the sandbox still sees edits.
  server: { port: 5386, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
