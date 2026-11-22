// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canvasAddress, canvasPartitionOf, manifestBytes } from '@althar/contracts'
import { artifactPath } from '@althar/runtime/artifacts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * An HTML canvas in the main process (ADR-104): its files served only at the
 * address of a version Althar's window opened, from the manifest it named;
 * what a navigation in it may do; that it never reaches Althar's own
 * listeners; and that only Althar's windows show one.
 */

const channels = vi.hoisted(() => ({ listened: new Map<string, (...args: Array<unknown>) => unknown>() }))
const sessions = vi.hoisted(() => ({ protocols: new Map<string, (request: Request) => Promise<Response>>() }))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
  ipcMain: {
    on: (channel: string, listener: (...args: Array<unknown>) => unknown) => void channels.listened.set(channel, listener),
    handle: (channel: string, listener: (...args: Array<unknown>) => unknown) => void channels.listened.set(channel, listener),
  },
  session: {
    fromPartition: (partition: string) => ({
      protocol: {
        handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => sessions.protocols.set(partition, handler),
      },
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      on: () => {},
      webRequest: { onBeforeRequest: () => {} },
    }),
  },
  WebContentsView: class {},
}))

const { CANVAS_HEADERS, fileIn, forgetManifests, GROUND_PAGE, serveCanvas } = await import('../src/main/canvases/serve')
const { canvasNavigation, loadAddress, reachesAlthar, startCanvases } = await import('../src/main/canvases/views')
const { boardsAt, groundChangeOf, groundPartOf, groundPinsOf } = await import('../src/main/canvases/boards')
const { downloadOf, handleCanvases, keyOf, targetOf } = await import('../src/main/canvases/ipc')
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

  it('serve Althar’s print document for a board version and can draw just one board', async () => {
    const { root, put } = store()
    const board = { name: 'First', file: 'index.html', width: 1440, height: 900 }
    const words = JSON.stringify({ boards: [board, { ...board, name: 'Second', width: 390, height: 844 }] })
    const manifest = put(
      manifestBytes({
        entry: 'canvas.json',
        files: [
          { path: 'canvas.json', sha256: put(words), size: words.length, type: 'application/json' },
          { path: 'index.html', sha256: put('<p>board</p>'), size: 12, type: 'text/html' },
        ],
      }),
    )
    const serve = serveCanvas(
      root,
      (_host, version) => (version === 2 ? manifest : null),
      () => '',
    )
    const print = canvasAddress(CANVAS, 2, '.althar/print.html')
    const both = await serve(get(print))
    expect(both.status).toBe(200)
    expect((await both.text()).match(/<iframe /g)).toHaveLength(2)
    const one = await serve(get(`${print}?board=1`))
    expect(await one.text()).toContain('size: 390px 844px')
    expect((await serve(get(`${print}?board=2`))).status).toBe(404)
    expect((await serve(get(canvasAddress(CANVAS, 1, '.althar/print.html')))).status).toBe(404)
  })

  it('serve a version while a download holds it and only in its own project', async () => {
    const { root, manifest } = store()
    const canvases = startCanvases({ root, tokens: () => '', listening: () => new Set(), outside: () => {} })
    const target = { projectId: PROJECT, canvasId: CANVAS, version: 2, manifest }
    const first = canvases.serveDownload(target)
    const second = canvases.serveDownload(target)
    const other = `proj_${'d4'.repeat(16)}`
    const elsewhere = canvases.serveDownload({ ...target, projectId: other, version: 3 })
    const request = get(canvasAddress(CANVAS, 2, ''))
    const serve = sessions.protocols.get(canvasPartitionOf(PROJECT))!
    const otherProject = sessions.protocols.get(canvasPartitionOf(other))!
    expect((await serve(request)).status).toBe(200)
    expect((await otherProject(request)).status).toBe(404)
    first.release()
    expect((await serve(request)).status).toBe(200)
    second.release()
    expect((await serve(request)).status).toBe(404)
    elsewhere.release()
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
  it('are each checked: only Althar’s windows, a thread’s key and a version whole', async () => {
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
    const picture = vi.fn(async () => 'data:image/jpeg;base64,AAAA')
    const covered = vi.fn()
    const changed = vi.fn()
    const pinned = vi.fn(async () => [1])
    const found = vi.fn(async () => null)
    const cleared = vi.fn()
    const pictured = vi.fn(async () => 'data:image/jpeg;base64,DDDD')
    const download = vi.fn(async () => ({ kind: 'saved' as const, path: '/download/login.png' }))
    handleCanvases(
      {
        show: shown,
        close: closed,
        reload: reloaded,
        still: picture,
        cover: covered,
        change: changed,
        pins: pinned,
        find: found,
        clear: cleared,
        picture: pictured,
      },
      (contents) => contents === (mine as never),
      download,
    )
    const call = (channel: string, sender: unknown, ...args: Array<unknown>) => channels.listened.get(channel)?.({ sender }, ...args)
    const invoke = (channel: string, sender: unknown, ...args: Array<unknown>) => Promise.resolve(call(channel, sender, ...args))
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
    expect(await invoke('althar:canvas-still', mine, THREAD)).toBe('data:image/jpeg;base64,AAAA')
    expect(await invoke('althar:canvas-still', mine, 'nope')).toBeNull()
    call('althar:canvas-cover', mine, THREAD, true)
    expect(covered).toHaveBeenLastCalledWith(THREAD, true)
    call('althar:canvas-cover', mine, THREAD, 'yes')
    expect(covered).toHaveBeenLastCalledWith(THREAD, false)
    call('althar:canvas-cover', mine, 'nope', true)
    expect(covered).toHaveBeenCalledTimes(2)
    expect(() => call('althar:canvas-cover', { name: 'a canvas' }, THREAD, true)).toThrow('Only Althar’s own windows')
    expect(() => call('althar:canvas-close', { name: 'a canvas' }, THREAD)).toThrow('Only Althar’s own windows')

    // A canvas of boards: what the window asks of its ground is checked too.
    call('althar:canvas-ground', mine, THREAD, { view: 'one', board: { page: 0, board: 2 }, zoom: 'fit' })
    expect(changed).toHaveBeenLastCalledWith(THREAD, { view: 'one', board: { page: 0, board: 2 }, zoom: 'fit' })
    call('althar:canvas-ground', mine, THREAD, { view: 'sideways' })
    call('althar:canvas-ground', mine, 'nope', { view: 'one' })
    expect(changed).toHaveBeenCalledTimes(1)
    const pin = { n: 1, page: 'Checkout', board: 'Desktop', selector: 'button.go', answered: false, draft: true }
    expect(await call('althar:canvas-pins', mine, THREAD, [pin])).toEqual([1])
    expect(pinned).toHaveBeenLastCalledWith(THREAD, [pin])
    expect(await call('althar:canvas-pins', mine, THREAD, [{ ...pin, n: 0 }])).toBeNull()
    expect(await call('althar:canvas-find', mine, THREAD, { page: 'Checkout', board: 'Desktop', selector: 'h1' })).toBeNull()
    expect(found).toHaveBeenCalledWith(THREAD, { page: 'Checkout', board: 'Desktop', selector: 'h1' })
    call('althar:canvas-clear', mine, THREAD)
    expect(cleared).toHaveBeenCalledWith(THREAD)
    expect(() => call('althar:canvas-ground', { name: 'a canvas' }, THREAD, { view: 'one' })).toThrow('Only Althar’s own windows')
    // A card's picture, by a version's manifest alone.
    expect(await call('althar:canvas-picture', mine, 'a'.repeat(64))).toBe('data:image/jpeg;base64,DDDD')
    expect(await call('althar:canvas-picture', mine, '../etc/passwd')).toBeNull()
    expect(targetOf({ projectId: PROJECT, canvasId: CANVAS, version: 2, manifest: 'f'.repeat(64), boards: true })?.boards).toBe(true)
    expect(targetOf({ projectId: PROJECT, canvasId: CANVAS, version: 2, manifest: 'f'.repeat(64), boards: 'yes' })).toBeNull()

    const request = { ...target, name: 'login', kind: 'html', format: 'png' }
    expect(await invoke('althar:canvas-download', mine, request)).toEqual({ kind: 'saved', path: '/download/login.png' })
    expect(download).toHaveBeenCalledWith({ id: 1 }, request)
    expect(await invoke('althar:canvas-download', {}, request)).toMatchObject({ kind: 'failed' })
    expect(await invoke('althar:canvas-download', mine, { ...request, name: '../login' })).toMatchObject({ kind: 'failed' })
    expect(download).toHaveBeenCalledTimes(1)
    download.mockRejectedValueOnce(new Error('some detail from the operating system'))
    expect(await invoke('althar:canvas-download', mine, request)).toEqual({ kind: 'failed', why: 'Couldn’t download this canvas.' })
  })

  it('accepts only download formats offered for the kind, and checks diagrams and every target field', () => {
    const request = {
      projectId: PROJECT,
      canvasId: CANVAS,
      version: 2,
      manifest: 'f'.repeat(64),
      name: 'sign-in',
      kind: 'mermaid',
      format: 'svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    }
    expect(downloadOf(request)).toEqual(request)
    expect(downloadOf({ ...request, kind: 'boards', format: 'pdf', svg: undefined })).toMatchObject({ kind: 'boards', format: 'pdf' })
    expect(downloadOf({ ...request, format: 'source', svg: undefined })).toMatchObject({ format: 'source' })
    for (const patch of [
      { projectId: 'wrong' },
      { canvasId: 'wrong' },
      { version: 1.5 },
      { version: 1e12 },
      { manifest: '_' },
      { name: 'Some Name' },
      { name: 'a'.repeat(61) },
      { kind: '__proto__' },
      { format: 'jpeg' },
      { format: 'pdf' },
      { kind: 'html' },
      { svg: 1 },
      { svg: '' },
      { svg: undefined },
      { svg: '€'.repeat(1_400_000) },
    ])
      expect(downloadOf({ ...request, ...patch })).toBeNull()
  })
})

describe('a canvas of boards', () => {
  beforeEach(() => forgetManifests())

  it('loads Althar’s own empty page at its version, with no script of its own, and reads its boards from canvas.json', async () => {
    const target = { projectId: PROJECT, canvasId: CANVAS, version: 3, manifest: 'f'.repeat(64) }
    expect(loadAddress(target)).toBe(canvasAddress(CANVAS, 3, ''))
    expect(loadAddress({ ...target, boards: true })).toBe(canvasAddress(CANVAS, 3, '.althar/boards.html'))
    expect(GROUND_PAGE).not.toContain('<script')

    const { root, put } = store()
    const boards = JSON.stringify({
      pages: [{ name: 'Sign in', boards: [{ name: 'Desktop', file: 'index.html', width: 1440, height: 900 }] }],
    })
    const files = [
      { path: 'canvas.json', sha256: put(boards), size: boards.length, type: 'application/json; charset=utf-8' },
      { path: 'index.html', sha256: digest('<h1>Sign in</h1>'), size: 16, type: 'text/html; charset=utf-8' },
    ]
    const manifest = put(manifestBytes({ entry: 'canvas.json', files }))
    expect(await boardsAt(root, manifest)).toEqual({
      pages: [{ name: 'Sign in', boards: [{ name: 'Desktop', file: 'index.html', width: 1440, height: 900 }] }],
    })
    const serve = serveCanvas(
      root,
      () => manifest,
      () => ':root{}',
    )
    const ground = await serve(get(canvasAddress(CANVAS, 3, '.althar/boards.html')))
    expect(ground.status).toBe(200)
    expect(await ground.text()).toBe(GROUND_PAGE)
    // A version whose entry isn't canvas.json has no boards.
    expect(await boardsAt(root, store().manifest)).toBeNull()
  })

  it('takes from the window only a change, pins and a part that are what they should be', () => {
    expect(groundChangeOf({ page: -1, step: 1, tool: 'hand', zoom: 0.5 })).toEqual({ page: -1, step: 1, tool: 'hand', zoom: 0.5 })
    for (const bad of [null, { tool: 'pen' }, { page: -2 }, { step: 2 }, { zoom: 0 }, { zoom: 'max' }, { board: { page: 1 } }])
      expect(groundChangeOf(bad)).toBeNull()
    expect(groundPinsOf([{ n: 2, page: 'A', board: 'B', selector: 'p' }])).toEqual([
      { n: 2, page: 'A', board: 'B', selector: 'p', answered: false, draft: false },
    ])
    for (const bad of ['x', [{ n: 1, page: '', board: 'B', selector: 'p' }], [{ n: 1, page: 'A', board: 'B', selector: '' }]])
      expect(groundPinsOf(bad)).toBeNull()
    expect(groundPartOf({ page: 'A', board: 'B', selector: 'p' })).toEqual({ page: 'A', board: 'B', selector: 'p' })
    expect(groundPartOf({ page: 'A', board: 'B' })).toBeNull()
  })
})

describe('Althar’s tokens, as a canvas reads them', () => {
  it('are the kit’s light set, with its dark one where the scheme is dark', () => {
    const tokens = canvasTokens(':root { --paper: #fff; }', ":root[data-theme='dark'] { --paper: #1c1a17; }")
    expect(tokens).toContain(':root { --paper: #fff; }')
    expect(tokens).toContain('@media (prefers-color-scheme: dark) {\n:root { --paper: #1c1a17; }\n}')
  })
})
