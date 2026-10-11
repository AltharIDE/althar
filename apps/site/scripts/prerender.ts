/* Runs after `vp build` (the client) and `vp build --ssr` (the renderer).
   Renders every page to static HTML with its own head (title, description,
   canonical address, preview tags, structured data), so it reads before any
   JavaScript runs and crawlers that run none see its words. Writes 404.html
   for any address that isn't a page, robots.txt, sitemap.xml and llms.txt,
   and the pages that are text at heart as Markdown beside them.

   SITE_URL serves the site from another origin (a staging domain); by
   default it is SITE, althar.ai. */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { SITE } from '../src/content/facts'
import type { PagePath } from '../src/content/pages'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const ssr = resolve(root, '.ssr')

const origin = (process.env.SITE_URL || SITE).replace(/\/+$/, '')
if (!/^https?:\/\/[^/]+$/.test(origin))
  throw new Error(`SITE_URL must be an origin like https://example.com, got "${process.env.SITE_URL}"`)

const entry = (await import(pathToFileURL(resolve(ssr, 'entry-server.js')).href)) as typeof import('../src/entry-server')

/*
 * A lazy page's chunk and its stylesheets aren't in the shell: without them
 * up front, its prerendered words would show unstyled until the script
 * fetched them. Read from the client build's manifest.
 */
const LAZY: Partial<Record<PagePath, string>> = { '/thesis': 'src/thesis/Thesis.tsx', '/enterprise': 'src/enterprise/Home.tsx' }
type Manifest = Record<string, { file: string; css?: string[]; imports?: string[] }>
const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8')) as Manifest
const shell = await readFile(resolve(dist, 'index.html'), 'utf8')

const lazyHead = (module: string | undefined): string => {
  if (!module) return ''
  if (!manifest[module]) throw new Error(`prerender: ${module} is missing from the build's manifest`)
  const css = new Set<string>()
  const scripts = new Set<string>()
  const walk = (key: string) => {
    const chunk = manifest[key]
    if (!chunk || scripts.has(chunk.file)) return
    scripts.add(chunk.file)
    for (const file of chunk.css ?? []) css.add(file)
    for (const next of chunk.imports ?? []) walk(next)
  }
  walk(module)
  const fresh = (file: string) => !shell.includes(`/${file}"`)
  return [
    ...[...css].filter(fresh).map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`),
    ...[...scripts].filter(fresh).map((file) => `<link rel="modulepreload" crossorigin href="/${file}">`),
  ]
    .map((tag) => `  ${tag}\n`)
    .join('')
}

const fill = (html: string, body: string, head: string) =>
  html.replace('<div id="app"></div>', `<div id="app">${body}</div>`).replace('</head>', `${head}</head>`)

/** / is index.html, and /shifts is shifts.html: Cloudflare serves each at its path, with no trailing slash. */
const fileOf = (path: string) => resolve(dist, path === '/' ? 'index.html' : `.${path}.html`)

const written: string[] = []
for (const page of Object.values(entry.PAGE_META)) {
  const path = page.path as PagePath
  // The enterprise page is a 3D scene drawn on a canvas, kept out of search: it opens in the browser, as before.
  const body = path === '/enterprise' ? '' : await entry.render(path)
  const html = entry.withMeta(shell, page, origin, entry.structuredData(path, origin))
  await writeFile(fileOf(path), fill(html, body, lazyHead(LAZY[path])))
  written.push(path)
}

// Any address that isn't a page. Its script hydrates the same page, which reads the address and finds no page there.
await writeFile(resolve(dist, '404.html'), fill(entry.withMeta(shell, entry.NOT_FOUND, origin), await entry.render('/404'), ''))

const today = new Date().toISOString().slice(0, 10)
const thesis = await readFile(resolve(root, '../../THESIS.md'), 'utf8')
const text: Record<string, string> = {
  'robots.txt': entry.robotsTxt(origin),
  'sitemap.xml': entry.sitemapXml(origin),
  'llms.txt': entry.llmsTxt(origin),
  [entry.MARKDOWN['/shifts']!.slice(1)]: entry.shiftsMd(origin, today),
  [entry.MARKDOWN['/thesis']!.slice(1)]: thesis,
}
for (const [file, body] of Object.entries(text)) await writeFile(resolve(dist, file), body)
// The manifest was for this script; it isn't for the site.
await rm(resolve(dist, '.vite'), { recursive: true, force: true })
await rm(ssr, { recursive: true, force: true })

console.warn(`prerender (${origin}): ${written.join(', ')}, 404, ${Object.keys(text).join(', ')}`)
