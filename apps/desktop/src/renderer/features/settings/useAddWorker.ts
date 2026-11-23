import { useCallback, useEffect, useRef, useState } from 'react'

import type { HomeWorkers } from '@althar/contracts'
import type { WorkerCodeView, WorkerSetupView } from '@althar/ui'

import type { SshHomeTarget } from '../../../homes'
import type { WorkerSetup } from '../../../workers'
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

/** Where the code's line fetches the bootstrap from: beside the newest release. */
export const WORKER_SCRIPT = 'https://github.com/AltharIDE/althar/releases/latest/download/althar-worker.sh'

const text = {
  emptyAddress: 'Give its SSH address, as you would after ssh.',
  badAddress: 'That isn’t an SSH address. Use a name from your SSH config, or user@host.',
  lasts: (minutes: number) => (minutes <= 1 ? 'a minute' : `${minutes} minutes`),
  codeFailed: 'The home couldn’t make a code.',
}

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
  setup: Pick<WorkerSetup, 'name' | 'target'>,
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
      return { title: `The release couldn’t get to ${name}.`, ...(said === undefined ? {} : { body: said }), retry: true }
    case 'AccountConflict':
      return {
        title: `${name} has a user named althar that Althar didn’t make.`,
        body: 'Reach it as a user of your own instead.',
        retry: false,
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
      return { title: 'Adding the worker stopped.', ...(said === undefined ? {} : { body: said }), retry: true }
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
  hostKey: setup.hostKey === undefined ? undefined : { fingerprint: setup.hostKey.fingerprint },
  problem: setup.problem === undefined ? undefined : problemOf(setup.problem.code, setup, setup.problem.said),
  linger: setup.linger,
})

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
      },
    )
  }, [bridge, client, setup])

  // Started and connected: the dialog gives way to its sheet.
  const workerId = setup?.phase === 'done' ? setup.workerId : undefined
  const connected = workerId !== undefined && workers?.workers.some((one) => one.workerId === workerId && one.connected) === true
  useEffect(() => {
    if (!connected || workerId === undefined || bridge === undefined) return
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
      way !== 'code'
        ? null
        : codeFailed !== null
          ? { command: null, lasts: null, failed: codeFailed }
          : code === null || expired
            ? { command: null, lasts: null }
            : {
                command: `curl -fsSL ${WORKER_SCRIPT} | sh -s -- join '${code.code}'`,
                lasts: text.lasts(Math.max(1, Math.round((code.expiresAt - now) / 60_000))),
              },
    close,
    ssh: bridge !== undefined,
  }
}
