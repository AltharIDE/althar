import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite-plus'

/*
 * Serves a prototype's folder as the workbench's page: Vite is started on the
 * folder, and its address, `/`, is the workbench with the folder's
 * `prototype.tsx` on it. So the address the server prints, which Althar's
 * Running pill opens, is the page itself. The folder needs no index.html
 * and no packages of its own: one in a task's scratch folder, outside the
 * workspace's packages, is given the workbench's (React, the kit).
 */

/** The workbench's own folder. */
const home = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The page's script. */
const entry = join(home, 'src', 'entry.ts')
/** Where the workbench's packages are found from. */
const anchor = join(home, 'src', 'index.ts')

/** A package of the workbench's own, by its folder. */
const own = (name: string) => dirname(realpathSync(createRequire(anchor).resolve(`${name}/package.json`)))

/**
 * React, always the workbench's: one React for the page, the kit and the
 * prototype, wherever its folder is. As an alias, since Vite bundles React
 * ahead by its name, from the folder, without asking the plugins.
 */
export const reactAliases = () =>
  ['react', 'react-dom'].map((name) => ({ find: new RegExp(`^${name}(/.*)?$`), replacement: `${own(name)}$1` }))

/** What a prototype imports the workbench as. */
const NAME = '@althar/prototype-workbench'

/** The prototype the page draws, as the page's script imports it. */
export const PROTOTYPE = 'virtual:prototype-workbench/prototype'
const MISSING = '\0prototype-workbench/missing'

/** A prototype's file in its folder, as it may be written. */
const FILES = ['prototype.tsx', 'prototype.ts', 'prototype.jsx', 'prototype.js']

/**
 * A prototype's own file, which React's fast refresh leaves to the page: its
 * default export is the prototype, not a component, so fast refresh would
 * reload the page, losing what was done in it. The page draws it again in
 * place instead (entry.ts).
 */
export const PROTOTYPE_FILE = /\/prototype\.[jt]sx?$/

/** The prototype in a folder, or null where it has none yet. */
export const prototypeIn = (folder: string) => FILES.map((name) => join(folder, name)).find((path) => existsSync(path)) ?? null

/** The page, with its script. */
export const pageOf = (script: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prototype</title>
  </head>
  <body class="ch-root">
    <div id="root"></div>
    <script type="module" src="${script}"></script>
  </body>
</html>
`

/** A package's name, as an import gives it: not a path, nor one of Vite's own ids. */
export const bare = (id: string) => /^(@[\w.-]+\/)?\w/.test(id) && !id.includes(':')

/** Whether a request is for the page: the address itself, or a path of the prototype's own routes, never a file. */
export const forPage = (url: string, accept: string | undefined) => {
  const path = url.split(/[?#]/)[0] ?? '/'
  if (path === '/' || path === '/index.html') return true
  return (accept ?? '').includes('text/html') && !path.startsWith('/@') && extname(path) === ''
}

/** Where the missing prototype's error says to look. */
const missing = (root: string) =>
  `throw new Error(${JSON.stringify(`There is no prototype.tsx in ${root}: make one there that exports prototype({ title, directions }) by default.`)})`

export function workbench(): Plugin {
  let root = process.cwd()
  return {
    name: 'prototype-workbench',
    apply: 'serve',
    enforce: 'pre',
    config(config) {
      // By its real path, as Vite reads the files: a folder under /tmp is in /private/tmp on a Mac.
      const given = resolve(config.root ?? process.cwd())
      root = existsSync(given) ? realpathSync(given) : given
      const file = prototypeIn(root)
      const named = `${basename(root)}-${createHash('sha1').update(root).digest('hex').slice(0, 8)}`
      return {
        // Each prototype's own, in the workbench's: none is written in the prototype's folder.
        cacheDir: join(home, 'node_modules', '.vite', 'prototypes', named),
        optimizeDeps: { entries: [entry, ...(file === null ? [] : [file])] },
        resolve: { alias: reactAliases() },
        // The repository, for the kit, the app's screens and the packages, and the folder, wherever it is.
        server: { fs: { allow: [resolve(home, '../..'), root] } },
      }
    },
    configResolved(config) {
      root = config.root
    },
    async resolveId(id, importer, options) {
      if (id === PROTOTYPE) return prototypeIn(root) ?? MISSING
      if (id === MISSING) return MISSING
      // The workbench by its name, from its own example as from a folder anywhere.
      if (id === NAME) return anchor
      if (importer === undefined || !bare(id) || importer.startsWith(home)) return null
      const own = await this.resolve(id, importer, { ...options, skipSelf: true })
      return own ?? (await this.resolve(id, anchor, { ...options, skipSelf: true }))
    },
    load(id) {
      return id === MISSING ? missing(root) : null
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || !forPage(request.url ?? '/', request.headers.accept)) return next()
        server
          .transformIndexHtml(request.url ?? '/', pageOf(`/@fs${entry}`), request.originalUrl)
          .then((html) => {
            response.statusCode = 200
            response.setHeader('Content-Type', 'text/html')
            response.end(html)
          })
          .catch(next)
      })
    },
  }
}
