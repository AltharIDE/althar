// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PROTOTYPE, PROTOTYPE_FILE, bare, forPage, pageOf, prototypeIn, reactAliases, workbench } from '../src/plugin'

const home = resolve(import.meta.dirname, '..')

/** A folder outside the workspace, as a task's scratch folder is to its packages: it has none of its own. */
const folder = (files: Record<string, string>) => {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'prototype-')))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(made, name), text)
  return made
}

const serve = (root: string) =>
  createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [react(), workbench()],
    server: { port: 0, host: '127.0.0.1' },
    // What the page imports is found when it is asked for; nothing is bundled ahead.
    optimizeDeps: { noDiscovery: true },
  })

describe('the parts of the plugin', () => {
  it('finds a folder’s prototype, as any of the names it may have', () => {
    const tsx = folder({ 'prototype.tsx': '' })
    const js = folder({ 'prototype.js': '', 'other.tsx': '' })
    const none = folder({ 'main.tsx': '' })
    expect(prototypeIn(tsx)).toBe(join(tsx, 'prototype.tsx'))
    expect(prototypeIn(js)).toBe(join(js, 'prototype.js'))
    expect(prototypeIn(none)).toBeNull()
    for (const made of [tsx, js, none]) rmSync(made, { recursive: true })
  })

  it('takes packages by name, and leaves paths and Vite’s own ids alone', () => {
    for (const id of ['react', 'react/jsx-dev-runtime', '@althar/ui', '@fontsource-variable/inter']) expect(bare(id)).toBe(true)
    for (const id of ['./kit', '../ui', '/src/x.ts', 'virtual:prototype-workbench/prototype', '\0missing', 'node:fs', '@vite/client'])
      expect(bare(id)).toBe(id === '@vite/client')
  })

  it('serves the page for the address, and for a route of the prototype’s own, never for a file', () => {
    expect(forPage('/', undefined)).toBe(true)
    expect(forPage('/?d=B&s=pushing', '*/*')).toBe(true)
    expect(forPage('/index.html', undefined)).toBe(true)
    expect(forPage('/tasks/7', 'text/html,application/xhtml+xml')).toBe(true)
    expect(forPage('/tasks/7', '*/*')).toBe(false)
    expect(forPage('/kit.tsx', 'text/html')).toBe(false)
    expect(forPage('/@vite/client', 'text/html')).toBe(false)
  })

  it('knows a prototype’s own file, wherever it is, and nothing else', () => {
    for (const path of ['/w/.althar/scratch/card/prototype.tsx', '/w/example/prototype.ts', '/w/x/prototype.jsx'])
      expect(PROTOTYPE_FILE.test(path)).toBe(true)
    for (const path of ['/w/x/prototypes.tsx', '/w/x/prototype.tsx.map', '/w/x/my-prototype.tsx'])
      expect(PROTOTYPE_FILE.test(path)).toBe(false)
  })

  it('gives every page the workbench’s one React, its parts by their paths in it', () => {
    const [react, dom] = reactAliases()
    expect('react/jsx-dev-runtime'.replace(react?.find ?? '', react?.replacement ?? '')).toMatch(/\/react\/jsx-dev-runtime$/)
    expect('react-dom/client'.replace(dom?.find ?? '', dom?.replacement ?? '')).toMatch(/\/react-dom\/client$/)
    expect(react?.find.test('react-dom')).toBe(false)
    expect(react?.find.test('react-redux')).toBe(false)
  })

  it('writes a page that loads its script on the kit’s root', () => {
    const page = pageOf('/@fs/workbench/src/entry.ts')
    expect(page).toContain('<body class="ch-root">')
    expect(page).toContain('<script type="module" src="/@fs/workbench/src/entry.ts"></script>')
  })
})

describe('serving a folder outside the workspace’s packages', () => {
  let root = ''
  let server: ViteDevServer
  let address = ''

  beforeAll(async () => {
    root = folder({
      'prototype.tsx': [
        "import { prototype, useShared } from '@althar/prototype-workbench'",
        "import { Button } from '@althar/ui'",
        "import { useState } from 'react'",
        "export default prototype({ title: 'Scratch', directions: [{ key: 'A', name: 'One', render: () => <Button>Go</Button> }] })",
      ].join('\n'),
    })
    server = await serve(root)
    await server.listen()
    address = server.resolvedUrls?.local[0] ?? ''
  })

  afterAll(async () => {
    await server.close()
    rmSync(server.config.cacheDir, { recursive: true, force: true })
    rmSync(root, { recursive: true })
  })

  it('serves the workbench’s page at its address, which is what it prints', async () => {
    const page = await fetch(address)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain(`src="/@fs${join(home, 'src', 'entry.ts')}"`)
    expect(html).toContain('<div id="root"></div>')
  })

  it('serves it for a route of the prototype’s own, as a browser asks for a page', async () => {
    const page = await fetch(new URL('/tasks/7', address), { headers: { accept: 'text/html' } })
    expect(await page.text()).toContain('<div id="root"></div>')
  })

  it('gives the page the folder’s prototype', async () => {
    expect((await server.pluginContainer.resolveId(PROTOTYPE))?.id).toBe(join(root, 'prototype.tsx'))
  })

  it('gives the folder the workbench’s packages, the workbench itself among them', async () => {
    const importer = join(root, 'prototype.tsx')
    const resolved = async (id: string) => (await server.pluginContainer.resolveId(id, importer))?.id ?? ''
    expect(await resolved('@althar/prototype-workbench')).toBe(join(home, 'src', 'index.ts'))
    expect(await resolved('@althar/ui')).toMatch(/packages\/ui\/src\/index\.ts$/)
    expect(await resolved('react')).toMatch(/react/)
    expect(await resolved('no-such-package')).toBe('')
  })

  it('draws the prototype with the kit, from the folder', async () => {
    const drawn = await server.transformRequest('/prototype.tsx')
    expect(drawn?.code).toMatch(/packages\/ui\/src\/index\.ts/)
  })

  it('keeps its cache in the workbench, not in the folder', () => {
    expect(server.config.cacheDir.startsWith(join(home, 'node_modules', '.vite', 'prototypes'))).toBe(true)
    expect(server.config.server.fs.allow).toEqual(expect.arrayContaining([resolve(home, '../..'), server.config.root]))
  })
})

describe('serving a folder with no prototype yet', () => {
  it('says on the page where to make one', async () => {
    const root = folder({})
    const server = await serve(root)
    const missing = await server.pluginContainer.resolveId(PROTOTYPE)
    const code = await server.pluginContainer.load(missing?.id ?? '')
    expect(typeof code === 'string' ? code : code?.code).toContain(`There is no prototype.tsx in ${server.config.root}`)
    expect(await server.pluginContainer.load(join(root, 'other.ts'))).toBeNull()
    await server.close()
    rmSync(server.config.cacheDir, { recursive: true, force: true })
    rmSync(root, { recursive: true })
  })
})
