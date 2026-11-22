import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The phone pairing lab (README.md): the whole desktop app in the browser, on
 * made-up data with no runtime, with two layers laid over its files, each at
 * the file's own path, so its relative imports stay as they are:
 *
 * - computers/: the "Agents and workers beside This Mac, and Settings ›
 *   Computers" task's files as they stood at its head (055f2c457), so
 *   Settings › Computers and the bar's popover are as that task built them.
 *   Main hadn't changed any of them since that task branched.
 * - seams/: the few files this lab changes, for where each direction puts a
 *   phone: Computers' section, the bar's popover and the homes chip.
 *
 * Each ends in .lab (Computers.tsx.lab stands in for Computers.tsx), so the
 * desktop's own type check and lint, which take in lab/, leave them be.
 */

const here = import.meta.dirname
const repo = resolve(here, '../../../..')
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
/** Each file laid over ends in .lab, so the app's own type check and lint pass it by: it only makes sense at its path. */
const LAID = '.lab'

/** Every file under a layer, by the repository path it stands in for. */
const layer = (folder: string): Map<string, string> => {
  const files = new Map<string, string>()
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith(LAID)) files.set(join(repo, relative(folder, path.slice(0, -LAID.length))), path)
    }
  }
  if (existsSync(folder)) walk(folder)
  return files
}

const overlay = (): Plugin => {
  // The lab's own changes win over the Computers task's.
  const read = () => new Map([...layer(join(here, 'computers')), ...layer(join(here, 'seams'))])
  let files = read()
  const laid = (path: string) => EXTENSIONS.map((end) => path + end).find((one) => files.has(one))
  return {
    name: 'phone-pairing-lab:overlay',
    enforce: 'pre',
    // A file laid over, or taken away, while the lab runs.
    configureServer(server) {
      const again = (path: string) => {
        if (path.startsWith(join(here, 'seams')) || path.startsWith(join(here, 'computers'))) files = read()
      }
      server.watcher.on('add', again)
      server.watcher.on('unlink', again)
    },
    async resolveId(source, importer) {
      if (importer === undefined || !(source.startsWith('.') || source.startsWith('/'))) return null
      const from = importer.split('?')[0] ?? importer
      const found = laid(source.startsWith('/') ? source : resolve(dirname(from), source))
      return found ?? null
    },
    load(id) {
      const path = id.split('?')[0] ?? id
      const file = files.get(path)
      if (file === undefined) return null
      this.addWatchFile(file)
      return readFileSync(file, 'utf8')
    },
  }
}

export default defineConfig({
  root: here,
  plugins: [overlay(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts'), '@lab': here } },
  server: { port: 6189, strictPort: true, fs: { allow: [repo] } },
})
