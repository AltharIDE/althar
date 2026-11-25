import { useCallback, useEffect, useRef, useState } from 'react'

import type { HomeWorkers } from '@althar/contracts'
import type { WorkerCodeView, WorkerSetupView } from '@althar/ui'

import type { SshHomeTarget } from '../../../homes'
import type { WorkerReleaseState, WorkerSetup } from '../../../workers'
import { useServices } from '../../data/services'

/*
 * Add a worker, from Settings › Computers (ADR-103): an SSH address, and main installs the worker there
 * (`main/homes/workerSetup.ts`); once the worker has made its key, this window has its own home sign it (`AddWorker`)
 * and hands what the home gave back to main, which starts the worker as a service. Or a one-time code, and the line
 * that takes it on a machine without SSH. Once the worker it added connects, the dialog closes onto its sheet, where
 * its projects are picked and its agents signed in.
 *
 * Pressing Add shows its first step at once; the steps follow as main says them.
 */

/** Where the code's line fetches the bootstrap from, where it's said: beside the newest host release that has it. */
export const workerScript = (base: string) => `${base}/althar-worker.sh`

const text = {
  emptyAddress: 'Give its SSH address, as you would after ssh.',
  badAddress: 'That isn’t an SSH address. Use a name from your SSH config, or user@host.',
  lasts: (minutes: number) => (minutes <= 1 ? 'a minute' : `${minutes} minutes`),
  codeFailed: 'The home couldn’t make a code.',
  noRelease: 'There’s no Althar release with workers yet.',
  newest: (newest: string | null) =>
    newest === null
      ? 'No host release is published. Check again once one is out.'
      : `The newest host release, ${newest}, came before workers. Check again once a newer one is out.`,
  releaseUnknown: 'Couldn’t find out which release to install from. Check your connection, then check again.',
}

/** Where no release can add a worker, in words: for both ways, before anything is pressed. */
export const unavailableOf = (release: WorkerReleaseState | null) =>
  release?.kind === 'none' ? { title: text.noRelease, body: text.newest(release.newest) } : null

/** An address as the person types it: `user@host`, `host`, or with `:port`. */
export const sshTargetOf = (address: string): SshHomeTarget | null => {
  const value = address.trim().replace(/^ssh\s+/u, '')
  const match = /^((?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|\[[a-fA-F0-9:]+\]))(?::(\d{1,5}))?$/u.exec(value)
  if (match === null) return null
  const port = match[2] === undefined ? undefined : Number(match[2])
  if (port !== undefined && (port < 1 || port > 65_535)) return null
  return { target: match[1]!, ...(port === undefined ? {} : { port }) }
}
const addressOf = (target: SshHomeTarget) => (target.port === undefined ? target.target : `${target.target}:${target.port}`)

/** Where it stopped, in words: what happened, what to do, and whether trying again can help. */
export const problemOf = (
  code: string,
  setup: Pick<WorkerSetup, 'name' | 'target'> & { readonly version?: string | undefined },
  said?: string,
): NonNullable<WorkerSetupView['problem']> => {
  const name = setup.name
  switch (code) {
    case 'AuthFailed':
      return {
        title: `Couldn’t sign in to ${name} over SSH.`,
        body: 'Check that this works from here with your SSH key:',
        command: `ssh ${setup.target.target}`,
        retry: true,
      }
    case 'Unreachable':
      return { title: `${name} couldn’t be reached.`, body: 'Check its address, and that it’s on and reachable from here.', retry: true }
    case 'HostKeyChanged':
      return {
        title: `${name}’s SSH key isn’t the one you trusted before.`,
        body: 'Where you expect that, as for a machine set up again, forget its old key, then try again:',
        command: `ssh-keygen -R ${name}`,
        retry: true,
      }
    case 'UnsupportedOS':
    case 'UnsupportedArchitecture':
      return { title: 'A worker needs 64-bit Linux, on x64 or arm64.', retry: false }
    case 'NoSystemd':
    case 'NoUserManager':
      return { title: 'A worker needs systemd, with a service manager for its user.', retry: false }
    case 'NotEnoughDisk':
      return { title: `${name} hasn’t the room for the worker.`, body: 'Free a gigabyte or so, then try again.', retry: true }
    // Found out as it starts, with the newest release's version; or the release it was given has no worker in it.
    case 'NoWorkerRelease':
      return { title: text.noRelease, body: text.newest(said ?? null), retry: true }
    case 'NoWorker':
      return {
        title: text.noRelease,
        ...(setup.version === undefined ? {} : { body: text.newest(setup.version) }),
        retry: true,
      }
    case 'NoRelease':
      return {
        title: 'There’s no Althar release to install yet.',
        body: 'Set the worker up by hand for now, from the host’s README.',
        retry: false,
      }
    case 'ReleaseRejected':
      return { title: 'The release didn’t pass its signature check.', body: 'Nothing was installed.', retry: true }
    case 'CannotDownload':
    case 'UploadFailed':
      return { title: `The release couldn’t get to ${name}.`, retry: true }
    case 'AccountConflict':
      return {
        title: `${name} has a user named althar that Althar didn’t make.`,
        body: 'Reach it as a user of your own instead.',
        retry: false,
      }
    case 'LingerOff':
      return {
        title: `${name} would stop the worker whenever you log out.`,
        body: 'Its login can’t keep services running on its own. Have its administrator run this, then try again:',
        ...(said === undefined ? {} : { command: said }),
        retry: true,
      }
    case 'NoPublicKey':
      return {
        title: 'Althar couldn’t tell which of your SSH keys logged in, to make the worker’s user with it.',
        body: 'Reach it as a user of your own rather than root, or load your key into ssh-agent.',
        retry: true,
      }
    case 'WorkerNotAdded':
      return { title: said ?? 'The home couldn’t sign the worker’s key.', retry: true }
    case 'Stopped':
      return { title: 'Stopped.', retry: true }
    default:
      // What it said goes to Althar's log (main.log), not here: a short line only.
      return { title: 'Adding the worker stopped.', retry: true }
  }
}

/** A setup as the kit's dialog draws it. */
export const setupView = (setup: WorkerSetup): WorkerSetupView => ({
  name: setup.name,
  phase: setup.phase,
  at: setup.at,
  facts: setup.facts,
  progress:
    setup.progress === undefined
      ? undefined
      : {
          fraction: setup.progress.total === 0 ? 0 : setup.progress.bytes / setup.progress.total,
          megabytes: Math.round(setup.progress.total / 1_048_576),
          sending: setup.sending === true,
        },
  version: setup.version,
  hostKey: setup.hostKey === undefined ? undefined : { fingerprint: setup.hostKey.fingerprint, type: setup.hostKey.type },
  problem: setup.problem === undefined ? undefined : problemOf(setup.problem.code, setup, setup.problem.said),
})

/** The code's way as the dialog draws it: its line and how long it lasts, being made, or why the home made none. */
export const codeView = (
  code: { readonly code: string; readonly expiresAt: number } | null,
  failed: string | null,
  now: number,
  /** Where the release's files are: the line takes the script and the release from there. Null while it's found out. */
  base: string | null,
): WorkerCodeView =>
  failed !== null
    ? { command: null, lasts: null, failed }
    : code === null || code.expiresAt <= now || base === null
      ? { command: null, lasts: null }
      : {
          command: `curl -fsSL ${workerScript(base)} | ALTHAR_RELEASE_BASE=${base} sh -s -- join '${code.code}'`,
          lasts: text.lasts(Math.max(1, Math.round((code.expiresAt - now) / 60_000))),
        }

export interface AddWorkerModel {
  readonly way: 'ssh' | 'code'
  readonly setWay: (way: 'ssh' | 'code') => void
  readonly address: string
  readonly setAddress: (value: string) => void
  readonly addressError: string | null
  readonly add: () => void
  readonly setup: WorkerSetupView | null
  readonly trust: () => void
  readonly again: () => void
  readonly stop: () => void
  readonly code: WorkerCodeView | null
  /** Where no release can add a worker: said in place of both ways. */
  readonly unavailable: { readonly title: string; readonly body: string } | null
  /** Check again is pressed and not yet answered. */
  readonly checking: boolean
  /** Asks afresh whether a release can, and the home for a code where it made none. */
  readonly check: () => void
  /** Closes it; a setup that went on stays as it is, and one that ended is put away. */
  readonly close: () => void
  /** This build can add one over SSH. */
  readonly ssh: boolean
}

/**
 * Adding a worker while the dialog is `open`. `here`: the window's home is this computer, so the address SSH came from
 * reaches it. `workers`: the home's, as read; `added` once the worker it added has connected.
 */
export const useAddWorker = ({
  open,
  here,
  workers,
  onClose,
  added,
}: {
  open: boolean
  here: boolean
  workers: HomeWorkers | null
  onClose: () => void
  added: (workerId: string) => void
}): AddWorkerModel => {
  const { client, host } = useServices()
  const bridge = host.workers
  const [way, setWay] = useState<'ssh' | 'code'>(bridge === undefined ? 'code' : 'ssh')
  const [address, setAddress] = useState('')
  const [addressError, setAddressError] = useState<string | null>(null)
  const [setup, setSetup] = useState<WorkerSetup | null>(null)
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [codeFailed, setCodeFailed] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [release, setRelease] = useState<WorkerReleaseState | null>(null)
  const [releaseFailed, setReleaseFailed] = useState(false)
  const [checks, setChecks] = useState(0)
  // Check again pressed and not yet answered: what it said before stays meanwhile, its button saying it's checking.
  const [checking, setChecking] = useState(false)
  // A code asked again by Check again, where the home made none: its error stays shown until this one is answered.
  const [codeAsking, setCodeAsking] = useState(false)
  const codeAsked = useRef(0)
  const enrolled = useRef<string | null>(null)

  useEffect(() => {
    if (bridge === undefined) return
    let live = true
    void bridge.setup().then((kept) => live && setSetup(kept))
    const stop = bridge.onSetup(setSetup)
    return () => {
      live = false
      stop()
    }
  }, [bridge])

  // Its key made: this window's own home signs it, and main hands that to the worker. Once a key.
  useEffect(() => {
    if (bridge === undefined || setup?.phase !== 'enroll' || setup.publicKey === undefined || enrolled.current === setup.publicKey) return
    enrolled.current = setup.publicKey
    client.addWorker({ publicKey: setup.publicKey, name: setup.name, ssh: addressOf(setup.target) }).then(
      (grant) => void bridge.act({ kind: 'enroll', grant }),
      (error: unknown) => {
        enrolled.current = null
        setSetup((was) =>
          was === null
            ? was
            : { ...was, phase: 'failed', problem: { code: 'WorkerNotAdded', said: error instanceof Error ? error.message : undefined } },
        )
        // Main keeps it in the log and tells every window.
        void bridge.act({ kind: 'unsigned', said: error instanceof Error ? error.message : String(error) })
      },
    )
  }, [bridge, client, setup])

  // Whether a release can add a worker, asked as the dialog opens: no press waits on it, and main asks again as setup starts.
  useEffect(() => {
    if (!open || bridge === undefined) return
    let live = true
    bridge.release(checks > 0).then(
      (found) => {
        if (!live) return
        setRelease(found)
        setReleaseFailed(false)
        setChecking(false)
      },
      () => {
        if (!live) return
        setRelease(null)
        setReleaseFailed(true)
        setChecking(false)
      },
    )
    return () => {
      live = false
    }
  }, [bridge, checks, open])

  // Started and connected: the dialog gives way to its sheet.
  const workerId = setup?.phase === 'done' ? setup.workerId : undefined
  const connected = workerId !== undefined && workers?.workers.some((one) => one.workerId === workerId && one.connected) === true
  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (!connected || workerId === undefined || bridge === undefined || shown.current === workerId) return
    shown.current = workerId
    // Main says it is put away; the dialog is closed meanwhile.
    void bridge.act({ kind: 'dismiss' })
    added(workerId)
  }, [added, bridge, connected, workerId])

  // A code, once that way is chosen, and a new one once it has expired.
  const expired = code !== null && code.expiresAt <= now
  useEffect(() => {
    if (!open || way !== 'code' || (code !== null && !expired) || codeFailed !== null) return
    let live = true
    client.createWorkerCode('Worker').then(
      (made) => live && setCode(made),
      (error: unknown) => live && setCodeFailed(error instanceof Error ? error.message : text.codeFailed),
    )
    return () => {
      live = false
    }
  }, [client, code, codeFailed, expired, open, way])
  useEffect(() => {
    if (!open || way !== 'code') return
    // How long it still works, as the person reads it: a quarter-minute is close enough.
    // oxlint-disable-next-line althar/one-clock -- the window's countdown, not the runtime's.
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [open, way])

  const add = useCallback(() => {
    if (bridge === undefined) return
    if (address.trim() === '') return setAddressError(text.emptyAddress)
    const target = sshTargetOf(address)
    if (target === null) return setAddressError(text.badAddress)
    setAddressError(null)
    enrolled.current = null
    // Its first step shows in this frame; main's word follows.
    const name = target.target.split('@').at(-1) ?? target.target
    setSetup({ target, name, phase: 'running', at: 0, log: [] })
    bridge.setUp(target, here).catch((error: unknown) => {
      setSetup(null)
      setAddressError(error instanceof Error ? error.message : text.badAddress)
    })
  }, [address, bridge, here])

  const close = useCallback(() => {
    if (setup !== null && (setup.phase === 'failed' || setup.phase === 'done')) {
      void bridge?.act({ kind: 'dismiss' })
      setSetup(null)
    }
    setCode(null)
    setCodeFailed(null)
    // A code asked again and not yet answered is dropped with the dialog.
    codeAsked.current++
    setCodeAsking(false)
    onClose()
  }, [bridge, onClose, setup])

  return {
    way,
    setWay: (chosen) => {
      setWay(chosen)
      setCodeFailed(null)
    },
    address,
    setAddress: (value) => {
      setAddress(value)
      setAddressError(null)
    },
    addressError,
    add,
    setup: setup === null ? null : setupView(setup),
    trust: () => {
      setSetup((was) => (was === null ? was : { ...was, phase: 'running' }))
      void bridge?.act({ kind: 'trust' })
    },
    again: () => {
      enrolled.current = null
      setSetup((was) => (was === null ? was : { ...was, phase: 'running', at: 0 }))
      void bridge?.act({ kind: 'again' })
    },
    stop: () => {
      void bridge?.act({ kind: 'stop' })
    },
    code:
      way === 'code'
        ? codeView(
            code,
            codeFailed ?? (releaseFailed && release === null ? text.releaseUnknown : null),
            now,
            // Outside Althar's own window, no release is asked: the line can't be given.
            release?.kind === 'ready' ? release.base : null,
          )
        : null,
    unavailable: unavailableOf(release),
    checking: checking || codeAsking,
    check: () => {
      setChecking(true)
      setChecks((count) => count + 1)
      if (codeFailed === null) return
      // The home's code is asked again too, where it couldn't make one: its error and Checking… stay until it answers.
      const asked = ++codeAsked.current
      setCodeAsking(true)
      client.createWorkerCode('Worker').then(
        (made) => {
          if (codeAsked.current !== asked) return
          setCode(made)
          setCodeFailed(null)
          setCodeAsking(false)
        },
        (error: unknown) => {
          if (codeAsked.current !== asked) return
          setCodeFailed(error instanceof Error ? error.message : text.codeFailed)
          setCodeAsking(false)
        },
      )
    },
    close,
    ssh: bridge !== undefined,
  }
}
