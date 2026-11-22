import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { Effect, Exit, Layer, Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import { clientProtocol, emitterPort, untraced, WorkerPreviewApi, workerPreviewTarget } from '@althar/contracts'
import { PREVIEW_HEADER, workerPreviewLoopback } from './workerPreviewLoopback'
import { workerPreviewTransport } from './workerPreviewTransport'

const LIMIT = 4

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
    let local: Awaited<ReturnType<typeof workerPreviewLoopback>> | undefined
    const allowed = (value: string) => {
      const url = URL.parse(value)
      return (
        local !== undefined &&
        url !== null &&
        url.host === local.host &&
        !url.username &&
        !url.password &&
        (url.protocol === 'http:' || url.protocol === 'ws:')
      )
    }
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
    browser.webRequest.onBeforeSendHeaders((request, reply) => {
      if (local === undefined || !allowed(request.url)) {
        reply({ cancel: true })
        return
      }
      reply({ requestHeaders: { ...request.requestHeaders, [PREVIEW_HEADER]: local.secret } })
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
      owner.removeListener('closed', close)
      if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.removeListener('did-start-navigation', documentGone)
      void Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
      void browser.clearStorageData().catch(() => undefined)
    })
    void workerPreviewLoopback(
      async (signal) => workerPreviewTransport(await opened, { projectId: target.projectId, id: target.id }, signal),
      controller.signal,
      async (path, method, signal) =>
        Effect.runPromise((await opened).ReadLaunchPreview({ projectId: target.projectId, id: target.id, path, method }), { signal }),
    )
      .then(async (loopback) => {
        local = loopback
        if (!preview.isDestroyed()) await preview.loadURL(loopback.origin + target.path)
      })
      .catch(() => close())
    return true
  }
}
