import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { WorkerGrant } from '@althar/contracts'
import { sshEnvironment } from '@althar/transport-node'
import { Schema } from 'effect'
import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'

import type { WorkerSetupAction } from '../../workers'
import type { WorkerRelease } from './release'
import { canSetUp, type SetupSystem } from './setup'
import { homeTarget } from './store'
import { workerSetups, type WorkerLog } from './workerSetup'

/*
 * Adding a worker over SSH, from Settings › Computers (`workerSetup.ts`), for every window: its IPC, and what it tells
 * them as it goes. The window's own home signs the worker's key, through the window's own connection; main never holds
 * the home's word for it, only what the home gave, to hand to the worker.
 */

/** The answer, or the signal's reason once it's aborted, whichever comes first. */
const abortable = <A>(promise: Promise<A>, signal: AbortSignal) =>
  new Promise<A>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    promise.then(resolve, reject)
  })

export const startWorkerSetups = ({
  system,
  tools,
  mine,
  reachesOwnHome,
  log,
  release,
}: {
  readonly system: SetupSystem
  /** main.log: each step, what SSH said where it failed, never a secret. */
  readonly log: WorkerLog
  /** Whether the newest host release can add a worker (`release.ts`, `workerRelease`). */
  readonly release: (signal: AbortSignal) => Promise<WorkerRelease>
  /** Where OpenSSH's programs are, where not where the system keeps them. */
  readonly tools?: string | undefined
  readonly mine: (contents: WebContents) => boolean
  /** Whether a window's home is this computer's or one reached over SSH: only those may have SSH run to a worker's address. */
  readonly reachesOwnHome: (windowId: number) => boolean
}) => {
  const tell = (channel: string, value: unknown) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && mine(window.webContents)) window.webContents.send(channel, value)
  }
  // Asked of GitHub a few minutes apart at most, and afresh on Try again or Check again; a failed look isn't kept.
  const quitting = new AbortController()
  let asked: { readonly at: number; readonly answer: Promise<WorkerRelease> } | undefined
  const able = (fresh: boolean) => {
    if (fresh || asked === undefined || Date.now() - asked.at > 10 * 60_000) {
      const answer = release(AbortSignal.any([quitting.signal, AbortSignal.timeout(20_000)]))
      asked = { at: Date.now(), answer }
      answer.then(
        (found) =>
          log.info('Whether a release can add a worker', {
            kind: found.kind,
            version: found.kind === 'ready' ? found.version : (found.newest ?? undefined),
            ...(found.kind === 'none' ? { why: found.why } : {}),
          }),
        (error: unknown) => {
          log.warn('Couldn’t find out whether a release can add a worker', { error: String(error) })
          if (asked?.answer === answer) asked = undefined
        },
      )
    }
    return asked.answer
  }
  const ssh = join(
    tools ?? (process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/OpenSSH') : '/usr/bin'),
    'ssh',
  )
  const setups = workerSetups(
    system,
    (args) => spawn(ssh, [...args], { env: sshEnvironment(process.env), windowsHide: true, stdio: 'pipe' }),
    (setup) => tell('althar:worker-setup', setup),
    (event) => {
      // The worker has no browser: the page its agent would have opened opens here.
      if (event.kind === 'open' && event.url.startsWith('https://')) void shell.openExternal(event.url)
      tell('althar:worker-sign-in', event)
    },
    { log, release: (fresh, signal) => abortable(able(fresh), signal) },
  )
  const owner = (event: IpcMainInvokeEvent) => {
    if (!mine(event.sender) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Workers are added only in Althar’s own window.')
  }
  /** Its own window, on a home whose workers it may reach over SSH. */
  const operator = (event: IpcMainInvokeEvent) => {
    owner(event)
    if (!reachesOwnHome(event.sender.id)) throw new Error('A window on a home paired over the network can’t reach its workers over SSH.')
  }
  const address = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 270 || !/^[A-Za-z0-9_.@:[\]-]+$/u.test(value))
      throw new Error('Give the worker’s SSH address.')
    return value
  }
  ipcMain.handle('althar:workers-release', async (event, fresh: unknown) => {
    owner(event)
    try {
      const found = await able(fresh === true)
      return found.kind === 'ready' ? { kind: 'ready', version: found.version, base: found.base } : { kind: 'none', newest: found.newest }
    } catch {
      throw new Error('Couldn’t find out whether a release can add a worker.')
    }
  })
  ipcMain.handle('althar:workers-setup', (event) => {
    owner(event)
    return setups.current()
  })
  ipcMain.handle('althar:workers-set-up', (event, target: unknown, here: unknown) => {
    operator(event)
    if (!canSetUp()) throw new Error('This Althar can’t reach your SSH keys: add the worker with a code instead.')
    setups.start(homeTarget(target), here === true)
  })
  ipcMain.handle('althar:workers-setup-act', (event, action: unknown) => {
    owner(event)
    const kind = typeof action === 'object' && action !== null && 'kind' in action ? action.kind : undefined
    if (kind === 'enroll') {
      const grant = Schema.decodeUnknownSync(WorkerGrant)((action as { grant?: unknown }).grant)
      return setups.act({ kind, grant })
    }
    if (kind === 'unsigned') {
      const said = (action as { said?: unknown }).said
      return setups.act({ kind, ...(typeof said === 'string' ? { said: said.slice(0, 2_000) } : {}) })
    }
    if (kind !== 'trust' && kind !== 'stop' && kind !== 'again' && kind !== 'dismiss' && kind !== 'check' && kind !== 'sandbox')
      throw new Error('Choose what to do with the worker.')
    return setups.act({ kind } satisfies WorkerSetupAction)
  })
  ipcMain.handle('althar:workers-agents', (event, at: unknown) => {
    operator(event)
    return setups.agents(address(at))
  })
  ipcMain.handle('althar:workers-sign-in', (event, at: unknown, agent: unknown, way: unknown) => {
    operator(event)
    if (typeof agent !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(agent)) throw new Error('Choose one of the worker’s agents.')
    return setups.signIn(address(at), agent, way === 'device' ? 'device' : 'browser')
  })
  ipcMain.handle('althar:workers-sign-in-act', (event, action: unknown) => {
    owner(event)
    if (
      typeof action === 'object' &&
      action !== null &&
      'paste' in action &&
      typeof action.paste === 'string' &&
      action.paste.length <= 4096
    )
      return setups.signInAct({ paste: action.paste })
    return setups.signInAct({ cancel: true })
  })
  return {
    stop: () => {
      quitting.abort()
      setups.stop()
    },
  }
}
