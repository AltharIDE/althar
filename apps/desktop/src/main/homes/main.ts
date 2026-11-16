import { Effect } from 'effect'
import { BrowserWindow, ipcMain, MessageChannelMain, utilityProcess, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { sshEnvironment } from '@althar/transport-node'

import type { WindowHome } from '../../homes'
import { homeController } from './controller'
import { connectHomeProcess, inspectHomeProcess } from './process'
import { homePartition } from './policy'
import { homeStore } from './store'

export const startHomeConnections = ({
  profile,
  entry,
  mine,
  open,
  log,
}: {
  readonly profile: string
  readonly entry: string
  readonly mine: (contents: WebContents) => boolean
  readonly open: (home: WindowHome) => void
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
  const controller = homeController({
    store: homeStore(profile),
    inspect: (target, signal) => inspectHomeProcess(fork, target, signal),
    open,
    changed: tell,
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
  ipcMain.handle('althar:homes-inspect', (event, target: unknown) => controller.inspect(owner(event), target))
  ipcMain.handle('althar:homes-connect', (event, check: unknown, name: unknown) => controller.connect(owner(event), check, name))
  ipcMain.handle('althar:homes-open', (event, id: unknown) => controller.open(owner(event), id))
  ipcMain.handle('althar:homes-forget', (event, id: unknown) => controller.forget(owner(event), id))
  ipcMain.handle('althar:homes-cancel', (event) => controller.navigating(owner(event)))
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
    if (controller.state(id).current.kind !== 'ssh') return false
    const { home, generation } = controller.begin(id)
    void stop(id).then(() => {
      if (window.isDestroyed() || !controller.isCurrent(id, generation)) return
      const { port1, port2 } = new MessageChannelMain()
      let handed = false
      try {
        const connection = connectHomeProcess(fork, home, port1, {
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
        })
        connections.set(id, connection)
      } catch {
        port1.close()
        port2.close()
        controller.disconnected(id, generation)
      }
    })
    return true
  }
  ipcMain.handle('althar:homes-reconnect', (event) => {
    const id = owner(event)
    if (controller.state(id).current.kind !== 'ssh') return
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
      await stopped
    },
  }
}
