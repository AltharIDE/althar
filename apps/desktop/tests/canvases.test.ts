// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canvasAddress, manifestBytes } from '@althar/contracts'
import { artifactPath } from '@althar/runtime/artifacts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * An HTML canvas in the main process (ADR-104): its files served only at the
 * address of a version Althar's window opened, from the manifest it named;
 * what a navigation in it may do; that it never reaches Althar's own
 * listeners; and that only Althar's windows show one.
 */

const channels = vi.hoisted(() => ({ listened: new Map<string, (...args: Array<unknown>) => void>() }))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
  ipcMain: { on: (channel: string, listener: (...args: Array<unknown>) => void) => void channels.listened.set(channel, listener) },
  session: { fromPartition: () => ({}) },
  WebContentsView: class {},
}))

const { CANVAS_HEADERS, fileIn, forgetManifests, serveCanvas } = await import('../src/main/canvases/serve')
const { canvasNavigation, reachesAlthar } = await import('../src/main/canvases/views')
const { handleCanvases, keyOf, targetOf } = await import('../src/main/canvases/ipc')
const { canvasTokens } = await import('../src/main/canvases/tokens')

const CANVAS = `cnv_${'c3'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`
const THREAD = `thr_${'a1'.repeat(16)}`
const HOST = 'c3'.repeat(16)

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A store with a version's files and its manifest, as the runtime keeps them. */
const store = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-canvas-store-'))
  const put = (bytes: string | Uint8Array) => {
    const sha = digest(bytes)
    mkdirSync(join(root, sha.slice(0, 2)), { recursive: true })
    writeFileSync(artifactPath(root, sha), bytes)
    return sha
  }
  const page = '<h1>Sign in</h1>'
  const css = 'h1 { color: green }'
  const files = [
    { path: 'index.html', sha256: put(page), size: page.length, type: 'text/html; charset=utf-8' },
    { path: 'css/site.css', sha256: put(css), size: css.length, type: 'text/css; charset=utf-8' },
    { path: 'docs/index.html', sha256: put('<p>docs</p>'), size: 11, type: 'text/html; charset=utf-8' },
  ]
  const manifest = put(manifestBytes({ entry: 'index.html', files }))
  return { root, manifest, put }
}

const get = (address: string, method = 'GET') => new Request(address, { method })

describe('a canvas’s files', () => {
  beforeEach(() => forgetManifests())

  it('are served at the address of a version the window opened, with headers Althar writes', async () => {
    const { root, manifest } = store()
    const serve = serveCanvas(
      root,
      (host, version) => (host === HOST && version === 2 ? manifest : null),
      () => ':root{}',
    )
    const entry = await serve(get(canvasAddress(CANVAS, 2, '')))
    expect(entry.status).toBe(200)
    expect(await entry.text()).toBe('<h1>Sign in</h1>')
    expect(entry.headers.get('content-type')).toBe('text/html; charset=utf-8')
    for (const [name, value] of Object.entries(CANVAS_HEADERS)) expect(entry.headers.get(name)).toBe(value)
    expect(await (await serve(get(canvasAddress(CANVAS, 2, 'css/site.css')))).text()).toBe('h1 { color: green }')
    expect(await (await serve(get(canvasAddress(CANVAS, 2, 'docs')))).text()).toBe('<p>docs</p>')
    expect(await (await serve(get(canvasAddress(CANVAS, 2, '.althar/tokens.css')))).text()).toBe(':root{}')
    const head = await serve(get(canvasAddress(CANVAS, 2, 'index.html'), 'HEAD'))
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('are nothing for a version no window opened, a path not in its manifest, another method, or a manifest that isn’t its digest', async () => {
    const { root, manifest, put } = store()
    const serve = serveCanvas(
      root,
      (_host, version) => (version === 2 ? manifest : version === 3 ? put('{"entry":1}') : null),
      () => '',
    )
    expect((await serve(get(canvasAddress(CANVAS, 1, 'index.html')))).status).toBe(404)
    expect((await serve(get(canvasAddress(CANVAS, 2, 'secret.txt')))).status).toBe(404)
    expect((await serve(get(canvasAddress(CANVAS, 3, 'index.html')))).status).toBe(404)
    expect((await serve(get(`althar-canvas://${HOST}/index.html`))).status).toBe(404)
    expect((await serve(get(canvasAddress(CANVAS, 2, 'index.html'), 'POST'))).status).toBe(405)
    // A manifest file whose bytes aren't its digest is refused, as anything not as the runtime kept it.
    const forged = digest('forged')
    mkdirSync(join(root, forged.slice(0, 2)), { recursive: true })
    writeFileSync(artifactPath(root, forged), manifestBytes({ entry: 'index.html', files: [] }))
    expect(
      (
        await serveCanvas(
          root,
          () => forged,
          () => '',
        )(get(canvasAddress(CANVAS, 2, 'index.html')))
      ).status,
    ).toBe(404)
  })

  it('find the entry for a version’s root, a folder’s index, or the path itself', () => {
    const manifest = {
      entry: 'a.html',
      files: [
        { path: 'a.html', sha256: 'a', size: 1, type: 't' },
        { path: 'x/index.html', sha256: 'b', size: 1, type: 't' },
      ],
    }
    expect(fileIn(manifest, '')?.path).toBe('a.html')
    expect(fileIn(manifest, 'x/')?.path).toBe('x/index.html')
    expect(fileIn(manifest, 'y')).toBeNull()
  })
})

describe('what a canvas may reach', () => {
  it('is anything but Althar’s own listeners on this computer', () => {
    const listening = new Set([41234])
    expect(reachesAlthar('http://127.0.0.1:41234/mcp', listening)).toBe(true)
    expect(reachesAlthar('http://localhost:41234/', listening)).toBe(true)
    expect(reachesAlthar('ws://[::1]:41234/', listening)).toBe(true)
    expect(reachesAlthar('http://api.localhost:41234/', listening)).toBe(true)
    expect(reachesAlthar('http://127.0.0.1:5173/', listening)).toBe(false)
    expect(reachesAlthar('https://cdn.jsdelivr.net/npm/chart.js', listening)).toBe(false)
    expect(reachesAlthar('http://example.com:41234/', listening)).toBe(false)
    expect(reachesAlthar('http://localhost/', new Set([80]))).toBe(true)
    expect(reachesAlthar('wss://localhost/', new Set([443]))).toBe(true)
    expect(reachesAlthar('althar-canvas://x/v1/', listening)).toBe(false)
    expect(reachesAlthar('not an address', listening)).toBe(false)
  })

  it('goes on within its own version, out to the browser for a web link, and nowhere else', () => {
    const target = { projectId: PROJECT, canvasId: CANVAS, version: 2, manifest: 'f'.repeat(64) }
    expect(canvasNavigation(canvasAddress(CANVAS, 2, 'b.html'), target)).toBe('go')
    expect(canvasNavigation(canvasAddress(CANVAS, 1, 'b.html'), target)).toBe('refuse')
    expect(canvasNavigation(canvasAddress(`cnv_${'d4'.repeat(16)}`, 2, 'b.html'), target)).toBe('refuse')
    expect(canvasNavigation('https://example.com/', target)).toBe('outside')
    expect(canvasNavigation('file:///etc/passwd', target)).toBe('refuse')
    expect(canvasNavigation('javascript:alert(1)', target)).toBe('refuse')
    expect(canvasNavigation('nonsense', target)).toBe('refuse')
  })
})

describe('the window’s calls about canvases', () => {
  it('are each checked: only Althar’s windows, a thread’s key and a version whole', () => {
    expect(targetOf({ projectId: PROJECT, canvasId: CANVAS, version: 2, manifest: 'f'.repeat(64) })).not.toBeNull()
    for (const bad of [
      null,
      'x',
      { projectId: 'p', canvasId: CANVAS, version: 2, manifest: 'f'.repeat(64) },
      { projectId: PROJECT, canvasId: 'c', version: 2, manifest: 'f'.repeat(64) },
      { projectId: PROJECT, canvasId: CANVAS, version: 0, manifest: 'f'.repeat(64) },
      { projectId: PROJECT, canvasId: CANVAS, version: 2, manifest: 'nope' },
    ])
      expect(targetOf(bad)).toBeNull()
    expect(keyOf(THREAD)).toBe(THREAD)
    expect(keyOf('thr_x')).toBeNull()

    const shown = vi.fn()
    const closed = vi.fn()
    const reloaded = vi.fn()
    const mine = { name: 'Althar’s window' }
    handleCanvases({ show: shown, close: closed, reload: reloaded, opened: () => null }, (contents) => contents === (mine as never))
    const call = (channel: string, sender: unknown, ...args: Array<unknown>) => channels.listened.get(channel)?.({ sender }, ...args)
    const target = { projectId: PROJECT, canvasId: CANVAS, version: 2, manifest: 'f'.repeat(64) }
    call('althar:canvas-show', mine, THREAD, target, { x: 1, y: 2, width: 300, height: 400 })
    expect(shown).toHaveBeenCalledWith({ id: 1 }, THREAD, target, { x: 1, y: 2, width: 300, height: 400 })
    call('althar:canvas-show', mine, THREAD, target, null)
    expect(shown).toHaveBeenLastCalledWith({ id: 1 }, THREAD, target, null)
    call('althar:canvas-show', mine, 'nope', target, null)
    expect(shown).toHaveBeenCalledTimes(2)
    call('althar:canvas-reload', mine, THREAD)
    call('althar:canvas-close', mine, THREAD)
    expect(reloaded).toHaveBeenCalledWith(THREAD)
    expect(closed).toHaveBeenCalledWith(THREAD)
    expect(() => call('althar:canvas-close', { name: 'a canvas' }, THREAD)).toThrow('Only Althar’s own windows')
  })
})

describe('Althar’s tokens, as a canvas reads them', () => {
  it('are the kit’s light set, with its dark one where the scheme is dark', () => {
    const tokens = canvasTokens(':root { --paper: #fff; }', ":root[data-theme='dark'] { --paper: #1c1a17; }")
    expect(tokens).toContain(':root { --paper: #fff; }')
    expect(tokens).toContain('@media (prefers-color-scheme: dark) {\n:root { --paper: #1c1a17; }\n}')
  })
})
