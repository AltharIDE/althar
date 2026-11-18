import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { decodePairingCode } from '@althar/transport-node'
import { connectionCredentials, type ProtectCredential } from './credentials'
import { Effect } from 'effect'
import { BrowserWindow, ipcMain, MessageChannelMain, utilityProcess, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { sshEnvironment } from '@althar/transport-node'

import type { WindowHome } from '../../homes'
import { homeController } from './controller'
import { homeGlances } from './glances'
import { connectHomeProcess, inspectHomeProcess, pairHomeProcess } from './process'
import { homePartition } from './policy'
import { homeStore, savedHome } from './store'

export const startHomeConnections = ({
  profile,
  entry,
  mine,
  open,
  log,
  protect,
}: {
  readonly protect: ProtectCredential
  readonly profile: string
  readonly entry: string
  readonly mine: (contents: WebContents) => boolean
  readonly open: (home: WindowHome, projectId?: string) => void
  readonly log: (message: string) => void
}) => {
  const connections = new Map<number, ReturnType<typeof connectHomeProcess>>()
  const children = new Map<Electron.UtilityProcess, Promise<void>>()
  let processes = 0
  const fork = () => {
    if (processes >= 24) throw new Error('Several home connections are closing. Try again shortly.')
    const child = utilityProcess.fork(entry, [], {
      serviceName: 'Althar home connection',
      stdio: 'pipe',
      env: { ...sshEnvironment(process.env), ...(process.env.FLATPAK_ID === undefined ? {} : { FLATPAK_ID: process.env.FLATPAK_ID }) },
    })
    processes++
    children.set(
      child,
      new Promise((resolve) => {
        child.once('exit', () => {
          processes--
          children.delete(child)
          resolve()
        })
      }),
    )
    // The worker exposes only bounded public errors. Never copy its raw output or SSH diagnostics into app logs.
    child.stdout?.resume()
    child.stderr?.resume()
    return child
  }
  const tell = (owner: number, state: unknown) => {
    const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.id === owner)?.webContents
    if (contents !== undefined && !contents.isDestroyed()) contents.send('althar:home-state', state)
  }
  const store = homeStore(profile)
  const credentials = connectionCredentials(profile, protect)
  const forgottenKeys = new Map<string, { restore: () => Promise<void>; timer: ReturnType<typeof setTimeout> }>()
  let keyChanges: Promise<unknown> = Promise.resolve()
  let queuedKeyChanges = 0
  const changingKey = <A>(change: () => Promise<A>): Promise<A> => {
    if (queuedKeyChanges >= 16) return Promise.reject(new Error('Home connections are busy. Try again shortly.'))
    queuedKeyChanges++
    const next = keyChanges.then(change).finally(() => {
      queuedKeyChanges--
    })
    keyChanges = next.catch(() => undefined)
    return next
  }
  // What the chip's menu and Manage homes show, sent to every window at most once a frame however much changed at once.
  let telling: ReturnType<typeof setTimeout> | undefined
  const overviewChanged = () => {
    if (telling !== undefined) return
    telling = setTimeout(() => {
      telling = undefined
      void controller
        .overview()
        .then((overview) => {
          for (const window of BrowserWindow.getAllWindows())
            if (!window.isDestroyed() && mine(window.webContents)) window.webContents.send('althar:homes-overview', overview)
        })
        .catch(() => undefined)
    }, 16)
  }
  const glances = homeGlances({ profile, wanted: () => controller.wanted(), changed: overviewChanged })
  const controller = homeController({
    store,
    pair: async (value, name, signal) => {
      const code = decodePairingCode(value.trim())
      if (code.expiresAt <= Date.now()) throw new Error('This pairing code expired. Create a new one on the host.')
      const used = (await controller.wanted()).ids
      if (signal.aborted) throw new Error('Pairing was cancelled.')
      const pending = await credentials.pending(
        createHash('sha256')
          .update(JSON.stringify(['althar.client.pairing', code.homeId, code.tlsKeyPin, code.token]))
          .digest('hex'),
        code.expiresAt,
        used,
      )
      const target = await pairHomeProcess(fork, value.trim(), pending.key, hostname().slice(0, 120) || 'Althar desktop', signal)
      return savedHome({ id: pending.id, name, homeId: code.homeId, https: target })
    },
    inspect: (target, signal) => inspectHomeProcess(fork, target, signal),
    open,
    changed: tell,
    overviewChanged,
    glances,
  })
  const owner = (event: IpcMainInvokeEvent) => {
    if (!mine(event.sender) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Home connections are available only in Althar’s own window.')
    return event.sender.id
  }
  ipcMain.handle('althar:homes-state', (event) => controller.state(owner(event)))
  ipcMain.handle('althar:homes-list', (event) => {
    owner(event)
    return controller.list()
  })
  ipcMain.handle('althar:homes-pairing-info', (event, value: unknown) => {
    owner(event)
    if (typeof value !== 'string') throw new Error('Paste a pairing code from the host.')
    const code = decodePairingCode(value.trim())
    if (code.expiresAt <= Date.now()) throw new Error('This pairing code expired. Create a new one on the host.')
    return { origin: code.origin, homeId: code.homeId, expiresAt: code.expiresAt }
  })
  ipcMain.handle('althar:homes-pair', (event, code: unknown, name: unknown) => controller.pair(owner(event), code, name))
  ipcMain.handle('althar:homes-inspect', (event, target: unknown) => controller.inspect(owner(event), target))
  ipcMain.handle('althar:homes-connect', (event, check: unknown, name: unknown) => controller.connect(owner(event), check, name))
  ipcMain.handle('althar:homes-overview', (event) => {
    owner(event)
    return controller.overview()
  })
  ipcMain.handle('althar:homes-save', (event, check: unknown, name: unknown) => controller.save(owner(event), check, name))
  ipcMain.handle('althar:homes-open', (event, id: unknown, projectId: unknown) => controller.open(owner(event), id, projectId))
  ipcMain.handle('althar:homes-rename', (event, id: unknown, name: unknown) => controller.rename(owner(event), id, name))
  ipcMain.handle('althar:homes-change', (event, id: unknown, check: unknown) => controller.change(owner(event), id, check))
  ipcMain.handle('althar:homes-forget', (event, id: unknown) => {
    const caller = owner(event)
    if (typeof id !== 'string' || !/^remote_[0-9a-f]{32}$/.test(id)) throw new Error('Choose a saved home to forget.')
    return changingKey(async () => {
      const home = (await store.list()).find((one) => one.id === id)
      await controller.forget(caller, id)
      if (home?.https === undefined) return
      let restore: (() => Promise<void>) | undefined
      try {
        restore = await credentials.forget(id)
      } catch (error) {
        await controller.restore(caller, id)
        throw error
      }
      const previous = forgottenKeys.get(id)
      if (previous !== undefined) clearTimeout(previous.timer)
      if (restore !== undefined)
        forgottenKeys.set(id, {
          restore,
          timer: setTimeout(() => forgottenKeys.delete(id), 30_000),
        })
    })
  })
  ipcMain.handle('althar:homes-restore', (event, id: unknown) => {
    const caller = owner(event)
    if (typeof id !== 'string' || !/^remote_[0-9a-f]{32}$/.test(id)) throw new Error('Choose a saved home to restore.')
    return changingKey(async () => {
      const held = forgottenKeys.get(id)
      if (held !== undefined) await held.restore()
      try {
        await controller.restore(caller, id)
      } catch (error) {
        if (held !== undefined && !(await store.list()).some((home) => home.id === id)) await credentials.forget(id)
        throw error
      }
      if (held !== undefined) clearTimeout(held.timer)
      forgottenKeys.delete(id)
    })
  })
  // A window's projects, as it reads them: a report main can't read, or from anything but Althar's own window, is dropped.
  ipcMain.on('althar:homes-report', (event, projects: unknown) => {
    try {
      if (!mine(event.sender) || event.senderFrame !== event.sender.mainFrame) return
      controller.report(event.sender.id, projects)
    } catch {
      // Nothing to answer: the window reports again as its projects change.
    }
  })
  ipcMain.handle('althar:homes-cancel', (event) => controller.cancel(owner(event)))
  const stop = (id: number) => {
    const connection = connections.get(id)
    connections.delete(id)
    return connection === undefined
      ? Promise.resolve()
      : Effect.runPromise(connection.stop).catch(() => {
          log('A home connection did not stop cleanly.')
        })
  }
  const connect = (window: BrowserWindow): boolean => {
    const id = window.webContents.id
    if (controller.state(id).current.kind === 'local') return false
    const { home, generation } = controller.begin(id)
    void stop(id).then(async () => {
      if (window.isDestroyed() || !controller.isCurrent(id, generation)) return
      const { port1, port2 } = new MessageChannelMain()
      let handed = false
      try {
        const key = home.https === undefined ? undefined : await credentials.load(home.id)
        if (window.isDestroyed() || !controller.isCurrent(id, generation)) {
          port1.close()
          port2.close()
          return
        }
        const connection = connectHomeProcess(
          fork,
          home,
          port1,
          {
            connected: (identity) => {
              if (!window.isDestroyed() && controller.connected(id, generation, identity)) {
                handed = true
                window.webContents.postMessage('althar:port', null, [port2])
              } else {
                port2.close()
                void stop(id)
              }
            },
            disconnected: (problem) => {
              if (!handed) port2.close()
              controller.disconnected(id, generation, problem)
            },
          },
          key,
        )
        connections.set(id, connection)
      } catch {
        port1.close()
        port2.close()
        controller.disconnected(
          id,
          generation,
          home.https === undefined ? undefined : 'The connection could not start. Unlock the system keyring or pair this home again.',
        )
      }
    })
    return true
  }
  ipcMain.handle('althar:homes-reconnect', (event) => {
    const id = owner(event)
    if (controller.state(id).current.kind === 'local') return
    // The replacement renderer must not read the previous disconnected state before its port is ready.
    controller.begin(id)
    BrowserWindow.fromWebContents(event.sender)?.webContents.reload()
  })
  return {
    state: controller.state,
    register: (window: BrowserWindow, home: WindowHome) => {
      const id = window.webContents.id
      controller.register(id, home)
      window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          controller.navigating(id)
          void stop(id)
        }
      })
      window.once('closed', () => {
        controller.closed(id)
        void stop(id)
      })
      if (homePartition(home) !== undefined) {
        window.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
        window.webContents.session.setPermissionCheckHandler(() => false)
      }
    },
    connect,
    stopAll: async () => {
      controller.stopping()
      await keyChanges
      for (const held of forgottenKeys.values()) clearTimeout(held.timer)
      forgottenKeys.clear()
      clearTimeout(telling)
      const kept = glances.flush().catch(() => undefined)
      const stopped = Promise.all([...connections.keys()].map(stop))
      for (const child of children.keys()) {
        try {
          child.postMessage({ type: 'disconnect' })
        } catch {
          child.kill()
        }
      }
      await Effect.runPromise(Effect.promise(() => Promise.all(children.values())).pipe(Effect.timeoutOption('12 seconds')))
      for (const child of children.keys()) child.kill()
      await Promise.all([stopped, kept])
    },
  }
}
