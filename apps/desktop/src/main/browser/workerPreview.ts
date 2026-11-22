import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { Effect, Exit, Layer, Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import {
  clientProtocol,
  emitterPort,
  untraced,
  WorkerPreviewApi,
  WORKER_PREVIEW_SCHEME,
  workerPreviewAddress,
  workerPreviewTarget,
} from '@althar/contracts'

const LIMIT = 4
const page = (status: number, message: string) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/** A preview is a native, private browser surface. Its session knows exactly one live run. */
export const workerPreviews = (connect: (owner: BrowserWindow, signal: AbortSignal) => Promise<Electron.MessagePortMain>) => {
  const windows = new Map<string, BrowserWindow>()
  return (owner: BrowserWindow, address: string): boolean => {
    const target = workerPreviewTarget(address)
    if (target === null) return false
    const id = `${owner.webContents.id}:${target.host}`
    const existing = windows.get(id)
    if (existing !== undefined) {
      existing.show()
      existing.focus()
      return true
    }
    if (windows.size >= LIMIT) return true
    const scope = Effect.runSync(Scope.make())
    const controller = new AbortController()
    const browser = session.fromPartition(`worker-preview:${randomUUID()}`)
    const allowed = (value: string) => workerPreviewTarget(value)?.host === target.host
    const opened = Effect.runPromise(
      Effect.gen(function* () {
        const port = yield* Effect.tryPromise(() => connect(owner, controller.signal))
        yield* Effect.addFinalizer(() => Effect.sync(() => port.close()))
        const protocol = yield* Layer.build(clientProtocol(emitterPort(port)))
        return yield* RpcClient.make(WorkerPreviewApi, untraced).pipe(Effect.provideContext(protocol))
      }).pipe(Scope.provide(scope)),
      { signal: controller.signal },
    )
    void opened.catch(() => undefined)
    browser.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
    browser.setPermissionCheckHandler(() => false)
    browser.on('will-download', (event) => event.preventDefault())
    browser.webRequest.onBeforeRequest((request, reply) => reply({ cancel: !allowed(request.url) }))
    browser.protocol.handle(WORKER_PREVIEW_SCHEME, async (request) => {
      const ref = workerPreviewTarget(request.url)
      if (ref?.host !== target.host) return page(404, 'This preview belongs to another run.')
      const method = request.method
      if (method !== 'GET' && method !== 'HEAD') return page(405, 'This preview supports reading the page and its assets.')
      try {
        const client = await opened
        const result = await Effect.runPromise(client.ReadLaunchPreview({ projectId: ref.projectId, id: ref.id, path: ref.path, method }), {
          signal: AbortSignal.any([request.signal, controller.signal]),
        })
        const headers = new Headers({
          'content-type': result.contentType,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        if (result.location !== null) headers.set('location', workerPreviewAddress(ref.projectId, ref.id, result.location))
        const noBody = method === 'HEAD' || result.status === 204 || result.status === 205 || result.status === 304
        const contents = noBody ? null : Uint8Array.from(Buffer.from(result.bodyBase64, 'base64'))
        return new Response(contents, { status: result.status, headers })
      } catch {
        return page(502, 'The worker preview is unavailable. Check that the run is still running and listening on localhost.')
      }
    })
    const preview = new BrowserWindow({
      parent: owner,
      title: 'Worker preview',
      width: 1_080,
      height: 740,
      autoHideMenuBar: true,
      webPreferences: { session: browser, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    windows.set(id, preview)
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const navigate = (event: { preventDefault(): void }, url: string) => {
      if (!allowed(url)) event.preventDefault()
    }
    preview.webContents.on('will-navigate', navigate)
    preview.webContents.on('will-redirect', navigate)
    const close = () => {
      if (!preview.isDestroyed()) preview.close()
    }
    const documentGone = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) close()
    }
    owner.once('closed', close)
    owner.webContents.on('did-start-navigation', documentGone)
    preview.on('closed', () => {
      windows.delete(id)
      controller.abort()
      browser.protocol.unhandle(WORKER_PREVIEW_SCHEME)
      owner.removeListener('closed', close)
      if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.removeListener('did-start-navigation', documentGone)
      void Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
      void browser.clearStorageData().catch(() => undefined)
    })
    void preview.loadURL(address).catch(() => undefined)
    return true
  }
}
