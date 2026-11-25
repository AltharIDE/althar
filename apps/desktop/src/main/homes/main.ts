import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { decodePairingCode, prepareApprovalKeyEnrollment, preparePermissionApproval, signDeviceMessage } from '@althar/transport-node'
import { ClientIdentity, PermissionApproval } from '@althar/contracts'
import { connectionCredentials, type ProtectCredential } from './credentials'
import { Effect, Schema } from 'effect'
import { app, BrowserWindow, ipcMain, MessageChannelMain, shell, utilityProcess, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { sshEnvironment, sshProgram } from '@althar/transport-node'

import type { WindowHome } from '../../homes'
import { homeController, type HomeUsageEvent } from './controller'
import { homeGlances } from './glances'
import { connectHomeProcess, inspectHomeProcess, pairHomeProcess } from './process'
import { homePartition } from './policy'
import { findRelease, HOST_RELEASE_KEYS, newestHostVersion, workerRelease } from './release'
import { canSetUp, homeSetups, nativeSetupSystem, runProgram } from './setup'
import { homeStore, homeTarget, savedHome } from './store'
import { homeUpdates } from './update'
import { startWorkerSetups } from './workerMain'
import type { WorkerLog } from './workerSetup'

/**
 * Where a new home's release comes from: the pinned keys, and in a build from source, a release of your own to try
 * (ALTHAR_HOST_RELEASE_KEY, a public key's PEM file, and ALTHAR_HOST_RELEASE_MANIFEST, its manifest's address), and
 * another folder's OpenSSH programs, for setting homes up and reaching them, as the end-to-end specs give a server of their
 * own (ALTHAR_SSH_TOOLS).
 */
const sshTools = () => (app.isPackaged ? undefined : process.env.ALTHAR_SSH_TOOLS)
const releaseSource = () => {
  const own = app.isPackaged ? undefined : process.env.ALTHAR_HOST_RELEASE_KEY
  let keys = HOST_RELEASE_KEYS
  try {
    // oxlint-disable-next-line althar/off-the-thread -- not a process: one small file, read once as main starts.
    if (own !== undefined) keys = [...keys, readFileSync(own, 'utf8')]
  } catch {
    // Without it, the pinned keys alone.
  }
  const manifest = app.isPackaged ? undefined : process.env.ALTHAR_HOST_RELEASE_MANIFEST
  const tools = sshTools()
  return { keys, ...(manifest === undefined ? {} : { manifest }), ...(tools === undefined ? {} : { tools }) }
}

export const startHomeConnections = ({
  profile,
  entry,
  mine,
  open,
  log,
  logs,
  protect,
  usage,
}: {
  /** main.log at each level, for what adding a worker does. */
  readonly logs: WorkerLog
  readonly protect: ProtectCredential
  readonly profile: string
  readonly entry: string
  readonly mine: (contents: WebContents) => boolean
  readonly open: (home: WindowHome, projectId?: string, fresh?: boolean) => void
  readonly log: (message: string) => void
  readonly usage: (event: HomeUsageEvent) => void
}) => {
  const connections = new Map<number, ReturnType<typeof connectHomeProcess>>()
  const approvals = new Map<number, AbortController>()
  const children = new Map<Electron.UtilityProcess, Promise<void>>()
  let processes = 0
  const fork = () => {
    if (processes >= 24) throw new Error('Several home connections are closing. Try again shortly.')
    const child = utilityProcess.fork(entry, [], {
      serviceName: 'Althar home connection',
      stdio: 'pipe',
      env: {
        ...sshEnvironment(process.env),
        ...(process.env.FLATPAK_ID === undefined ? {} : { FLATPAK_ID: process.env.FLATPAK_ID }),
        ...(sshTools() === undefined ? {} : { ALTHAR_SSH_TOOLS: sshTools() }),
      },
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
    usage,
  })
  // A home being set up over SSH: one for the whole app, told to every window as it goes.
  const source = releaseSource()
  const system = nativeSetupSystem(profile, (arch, signal) => findRelease(arch, source, signal), source.tools)
  const setups = homeSetups(system, (setup) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && mine(window.webContents)) window.webContents.send('althar:home-setup', setup)
  })
  // Workers added over SSH from Settings › Computers, from the same releases.
  const workers = startWorkerSetups({
    system,
    tools: source.tools,
    mine,
    // A home reached over the network gives no SSH address this computer's SSH goes to: only its own, or one over SSH.
    reachesOwnHome: (id) => controller.state(id).current.kind !== 'https',
    log: logs,
    release: (signal) => workerRelease(source, signal),
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
  const currentHttpsHome = (caller: number) => {
    const state = controller.state(caller)
    if (state.current.kind !== 'https' || state.connection !== 'connected' || state.current.home.https === undefined)
      throw new Error('Open the home through its paired HTTPS connection first.')
    return { home: state.current.home, target: state.current.home.https }
  }
  const withApprovalPage = async (
    caller: number,
    prepare: (
      key: Awaited<ReturnType<typeof credentials.load>>,
      target: ReturnType<typeof currentHttpsHome>['target'],
      signal: AbortSignal,
    ) => Promise<{ url: string; wait?: Effect.Effect<void, unknown> }>,
  ) => {
    const { home, target } = currentHttpsHome(caller)
    if (approvals.has(caller)) throw new Error('Finish the security-key confirmation already open in your browser.')
    const abort = new AbortController()
    approvals.set(caller, abort)
    try {
      const key = await credentials.load(home.id)
      const { url, wait } = await prepare(key, target, abort.signal)
      if (abort.signal.aborted || currentHttpsHome(caller).target !== target) throw new Error('This home connection changed.')
      await shell.openExternal(url)
      if (wait !== undefined) await Effect.runPromise(wait, { signal: abort.signal })
    } finally {
      if (approvals.get(caller) === abort) approvals.delete(caller)
    }
  }
  ipcMain.handle('althar:homes-answer-permission', (event, input: unknown) => {
    const caller = owner(event)
    const action = Schema.decodeUnknownSync(PermissionApproval)(input)
    return withApprovalPage(caller, (key, target, signal) =>
      Effect.runPromise(
        preparePermissionApproval(target, (message) => signDeviceMessage(key.privateKey, message), action),
        { signal },
      ),
    )
  })
  ipcMain.handle('althar:homes-enroll-approval-key', (event) =>
    withApprovalPage(owner(event), async (key, target, signal) => ({
      url: await Effect.runPromise(
        prepareApprovalKeyEnrollment(target, (message) => signDeviceMessage(key.privateKey, message)),
        { signal },
      ),
    })),
  )
  ipcMain.handle('althar:homes-inspect', (event, target: unknown) => controller.inspect(owner(event), target))
  ipcMain.handle('althar:homes-connect', (event, check: unknown, name: unknown) => controller.connect(owner(event), check, name))
  ipcMain.handle('althar:homes-overview', (event) => {
    owner(event)
    return controller.overview()
  })
  ipcMain.handle('althar:homes-save', (event, check: unknown, name: unknown) => controller.save(owner(event), check, name))
  ipcMain.handle('althar:homes-open', (event, id: unknown, projectId: unknown, fresh: unknown) =>
    controller.open(owner(event), id, projectId, fresh),
  )
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
  ipcMain.handle('althar:homes-setup', (event) => {
    owner(event)
    return setups.state()
  })
  ipcMain.handle('althar:homes-set-up', (event, target: unknown) => {
    owner(event)
    if (!canSetUp()) throw new Error('Set the home up by hand, then connect to it over SSH or with a pairing code.')
    setups.start(homeTarget(target))
  })
  ipcMain.handle('althar:homes-setup-act', (event, action: unknown) => {
    owner(event)
    if (action !== 'trust' && action !== 'stop' && action !== 'resume' && action !== 'upload' && action !== 'dismiss')
      throw new Error('Choose what to do with the setup.')
    void setups.act(action).catch(() => undefined)
  })
  // A window's home, over SSH, updated by its own updater; the window reconnects once it answers.
  const quitting = new AbortController()
  // By the ssh the window's connection runs (connection/bridge.ts): the Flatpak's way out, or a build's own tools.
  const tools = sshTools()
  const updates = homeUpdates({
    run: runProgram,
    program: sshProgram(tools === undefined || tools === '' ? undefined : join(tools, 'ssh')),
    latest: (arch, signal) => findRelease(arch, source, signal),
    signal: quitting.signal,
    log,
  })
  const sshHome = (event: IpcMainInvokeEvent) => {
    const { current } = controller.state(owner(event))
    if (current.kind !== 'ssh' || current.home.ssh === undefined) throw new Error('Only a home reached over SSH updates from its window.')
    return current.home
  }
  ipcMain.handle('althar:homes-update', (event, accept: unknown) =>
    updates.update(sshHome(event), typeof accept === 'string' ? accept : undefined),
  )
  ipcMain.handle('althar:homes-update-check', (event) => updates.check(sshHome(event)))
  // The newest host release, for an older home's welcome to offer its update by: asked of GitHub a few minutes apart at
  // most, from here rather than over the home's own network, and afresh on Check again.
  let news: { readonly at: number; readonly newest: Promise<string | null> } | undefined
  ipcMain.handle('althar:homes-release', async (event, fresh: unknown) => {
    owner(event)
    if (fresh === true || news === undefined || Date.now() - news.at > 10 * 60_000) {
      const newest = newestHostVersion(source, AbortSignal.any([quitting.signal, AbortSignal.timeout(20_000)]))
      news = { at: Date.now(), newest }
      // A failed look isn't kept: the next asks again.
      newest.catch(() => {
        if (news?.newest === newest) news = undefined
      })
    }
    try {
      return { newest: await news.newest }
    } catch (error) {
      log(`The newest host release couldn’t be found: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Couldn’t find out the newest host release.')
    }
  })
  ipcMain.handle('althar:homes-cancel', (event) => controller.cancel(owner(event)))
  const stop = (id: number) => {
    approvals.get(id)?.abort()
    approvals.delete(id)
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
  const previewPort = async (owner: number, signal: AbortSignal): Promise<Electron.MessagePortMain> => {
    const { current, connection, identity } = controller.state(owner)
    if (current.kind === 'local' || connection !== 'connected' || identity === undefined)
      throw new Error('Reconnect to the home to open its preview.')
    const { home } = current
    const key = home.https === undefined ? undefined : await credentials.load(home.id)
    signal.throwIfAborted()
    if (controller.state(owner).identity !== identity) throw new Error('The home connection changed.')
    const { port1, port2 } = new MessageChannelMain()
    return new Promise((resolve, reject) => {
      try {
        const client = connectHomeProcess(
          fork,
          home,
          port1,
          {
            connected: (value) => {
              const reported = Schema.decodeUnknownSync(ClientIdentity)(value)
              if (reported.homeId !== identity.homeId || reported.deviceId !== identity.deviceId || reported.role !== identity.role)
                throw new Error('The preview opened on a different home connection.')
              resolve(port2)
            },
            disconnected: (problem) => {
              port2.close()
              reject(new Error(problem))
            },
          },
          key,
        )
        signal.addEventListener(
          'abort',
          () => {
            port2.close()
            void Effect.runPromise(client.stop).catch(() => undefined)
            reject(signal.reason)
          },
          { once: true },
        )
      } catch (error) {
        port1.close()
        port2.close()
        reject(error)
      }
    })
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
    previewPort,
    stopAll: async () => {
      controller.stopping()
      workers.stop()
      quitting.abort()
      await setups.stop()
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
