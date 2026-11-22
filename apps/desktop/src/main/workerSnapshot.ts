import { ApiError, WorkerSnapshotApi, WorkerSnapshotRequest, clientProtocol, emitterPort, untraced } from '@althar/contracts'
import { installWorkerSnapshot } from '@althar/transport-node'
import { dialog, shell, type BrowserWindow, type MessagePortMain } from 'electron'
import { Cause, Effect, Layer, Option, Schema } from 'effect'
import { RpcClient } from 'effect/rpc'

/** The person chooses the local destination. Remote paths never enter the file dialog or shell. */
export const saveWorkerSnapshot = (connect: (window: BrowserWindow, signal: AbortSignal) => Promise<MessagePortMain>) => {
  const saving = new Set<number>()
  return async (window: BrowserWindow, value: unknown) => {
    const input = Schema.decodeUnknownSync(WorkerSnapshotRequest)({ ...(value as object), source: 'worker' })
    if (saving.has(window.id)) return
    saving.add(window.id)
    const cancel = new AbortController()
    const closed = () => cancel.abort()
    window.once('closed', closed)
    const navigator = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) closed()
    }
    window.webContents.on('did-start-navigation', navigator)
    try {
      const place = await dialog.showOpenDialog(window, {
        title: 'Choose where the copy goes',
        message: 'Choose the folder the task’s files are copied into',
        buttonLabel: 'Copy here',
        properties: ['openDirectory', 'createDirectory'],
      })
      const folder = place.filePaths[0]
      if (place.canceled || folder === undefined || cancel.signal.aborted) return
      const path = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const port = yield* Effect.acquireRelease(
              Effect.tryPromise(() => connect(window, cancel.signal)),
              (port) => Effect.sync(() => port.close()),
            )
            const protocol = yield* Layer.build(clientProtocol(emitterPort(port)))
            const client = yield* RpcClient.make(WorkerSnapshotApi, untraced).pipe(Effect.provideContext(protocol))
            const fresh = yield* Effect.exit(client.PrepareWorkerSnapshot(input))
            let snapshot
            if (fresh._tag === 'Success') snapshot = fresh.value
            else {
              const failed = Cause.findErrorOption(fresh.cause)
              if (Option.isNone(failed) || !(failed.value instanceof ApiError) || failed.value.reason !== 'WorkerUnavailable')
                return yield* Effect.failCause(fresh.cause)
              const answer = yield* Effect.tryPromise(() =>
                dialog.showMessageBox(window, {
                  type: 'question',
                  title: 'Copy the home’s files instead?',
                  message: 'The worker can’t send its files now.',
                  detail: 'The home keeps a copy from the lead’s last checkpoint, which may miss its newest changes.',
                  buttons: ['Copy the home’s files', 'Cancel'],
                  defaultId: 1,
                  cancelId: 1,
                }),
              )
              if (answer.response !== 0) return null
              snapshot = yield* client.PrepareWorkerSnapshot({ ...input, source: 'home_copy' })
            }
            yield* Effect.addFinalizer(() =>
              client
                .ReleaseWorkerSnapshot({ id: snapshot.id })
                .pipe(Effect.interruptible, Effect.timeoutOption('3 seconds'), Effect.ignore),
            )
            return yield* Effect.tryPromise((signal) =>
              installWorkerSnapshot(
                snapshot,
                folder,
                (chunk, signal) => Effect.runPromise(client.ReadWorkerSnapshotChunk(chunk), { signal }),
                signal,
              ),
            )
          }),
        ),
        { signal: cancel.signal },
      )
      if (path !== null) shell.showItemInFolder(path)
    } catch {
      if (!window.isDestroyed() && !cancel.signal.aborted)
        await dialog.showMessageBox(window, {
          type: 'error',
          message: 'Althar couldn’t copy the task’s files.',
          detail: 'Check that the home is connected, Git is installed and the folder has room, then try again.',
        })
    } finally {
      saving.delete(window.id)
      window.removeListener('closed', closed)
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.removeListener('did-start-navigation', navigator)
    }
  }
}
